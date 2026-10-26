import {validateAccessPin} from './access-pin.ts';
import http from 'node:http';
import {editHistory} from './edit-history.ts';
import {readFileSync,existsSync} from 'node:fs';
import {randomBytes,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import pg from 'pg';
import ExcelJS from 'exceljs';
import {initial,operate,balances} from './domain.ts';
import {encryptCredential,decryptCredential} from './credentials.ts';
import {previewImport} from './imports.ts';
import {bulkTemplate} from './template.ts';
import {parseBulk,applyBulk,deleteBulk,BulkErrors} from './bulk.ts';
import {filterBlocks,filterEvents} from '../public/query.js';
const pool=process.env.DATABASE_URL?new pg.Pool({connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:10000}):null;
type Session={expires:number,role:string,account:string,username?:string,revision?:number};
// Sessions live in PostgreSQL so they survive across serverless instances; the map is only a fallback without database.
const sessions=new Map<string,Session>();const loaded=new WeakMap<http.IncomingMessage,Session|undefined>();
const behindProxy=!!process.env.VERCEL;
function sessionToken(req:http.IncomingMessage){return req.headers.cookie?.match(/(?:^|; )session=([a-f0-9]+)/)?.[1];}
function tokenHash(token:string){return createHash('sha256').update(token).digest('hex');}
function clientAddress(req:http.IncomingMessage){return behindProxy?String(req.headers['x-forwarded-for']||'').split(',')[0].trim():req.socket.remoteAddress||'';}
async function loadSession(req:http.IncomingMessage){const token=sessionToken(req);let value:Session|undefined;if(token&&pool){const row=(await pool.query('SELECT role,account,username,revision,expires FROM app_sessions WHERE token_hash=$1 AND expires>now()',[tokenHash(token)])).rows[0];if(row)value={expires:new Date(row.expires).getTime(),role:row.role,account:row.account,username:row.username??undefined,revision:row.revision??undefined};}else if(token)value=sessions.get(token);loaded.set(req,value);}
async function saveSession(token:string,value:Session){if(!pool){sessions.set(token,value);return;}await pool.query('DELETE FROM app_sessions WHERE expires<now()');await pool.query('INSERT INTO app_sessions(token_hash,role,account,username,revision,expires) VALUES($1,$2,$3,$4,$5,$6)',[tokenHash(token),value.role,value.account,value.username??null,value.revision??null,new Date(value.expires)]);}
async function dropSession(req:http.IncomingMessage){const token=sessionToken(req);loaded.set(req,undefined);if(!token)return;sessions.delete(token);if(pool)await pool.query('DELETE FROM app_sessions WHERE token_hash=$1',[tokenHash(token)]);}const attempts=new Map<string,{count:number,at:number}>();
const root=new URL('../public/',import.meta.url);const port=Number(process.env.PORT||3000);
if(pool){await pool.query(readFileSync(new URL('../migrations/001_initial.sql',import.meta.url),'utf8'));await pool.query('INSERT INTO app_state(id,data) VALUES(1,$1) ON CONFLICT DO NOTHING',[JSON.stringify(initial())]);}
function session(req:http.IncomingMessage){const value=loaded.get(req);return value&&value.expires>Date.now()?value:undefined;}
function auth(req:http.IncomingMessage){return session(req)?.role==='admin';}
function allowed(req:http.IncomingMessage,input:any){
 if(auth(req))return true;if(session(req)?.role!=='advisor')return false;
 if(['client','editClient','receive','move','editBlock'].includes(input.kind))return true;
 if(input.kind==='eventCorrection')return !Object.hasOwn(input.data||{},'deleted');
 // Advisors manage customer code links; existing codes require explicit domain confirmation.
 return input.kind==='code';
}
async function permitted(req:http.IncomingMessage,input:any){
 if(!allowed(req,input))return false;
 return true;
}
const deletionAttempts=new Map<string,{count:number,at:number}>();
function confirmDeletion(req:http.IncomingMessage,value:any){
 const identity=clientAddress(req);let attempt=deletionAttempts.get(identity);if(!attempt||Date.now()-attempt.at>900000){attempt={count:0,at:Date.now()};deletionAttempts.set(identity,attempt);}
 if(attempt.count>=10)throw Error('Demasiados intentos. Espere 15 minutos.');
 if(!timingSafeEqual(scryptSync(String(value||''),'archivo-delete-v1',64),scryptSync('1608','archivo-delete-v1',64))){attempt.count++;throw Error('Contraseña incorrecta');}attempt.count=0;
}
async function body(req:http.IncomingMessage){let buffer=Buffer.alloc(0);for await(const c of req){buffer=Buffer.concat([buffer,c]);if(buffer.length>10*1024*1024)throw Error('Archivo demasiado grande (máximo 10 MB)');}return buffer;}
async function state(){if(!pool)throw Error('Base de datos no configurada. Consulte README para iniciar PostgreSQL local.');const value=(await pool.query('SELECT data FROM app_state WHERE id=1')).rows[0].data;value.defaults??={transportResponsible:value.catalogs.responsible[1]?.id||null};return value;}
function projected(s:any){return {...s,blocks:s.blocks.filter((b:any)=>!b.deleted).map((b:any)=>({...b,balances:balances(s,b.id)}))};}
function filtered(s:any,q:URLSearchParams){return filterBlocks(projected(s),q);}
export const server=http.createServer(async(req,res)=>{
 const protocol=behindProxy?String(req.headers['x-forwarded-proto']||'https').split(',')[0]:'http';const url=new URL(req.url||'/',`${protocol}://${req.headers.host}`);const secure=protocol==='https'?'; Secure':'';const send=(status:number,value:any)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 try{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'");
  if(req.method!=='GET'&&req.headers.origin!==url.origin){send(403,{error:'Origen no autorizado'});return;}
  await loadSession(req);const viewer=session(req);if(viewer?.role==='advisor'){const account=await pool?.query('SELECT active,revision FROM advisor_accounts WHERE username=$1',[viewer.username]);if(!account?.rows[0]?.active||account.rows[0].revision!==viewer.revision)await dropSession(req);}
  if(url.pathname==='/api/session'&&req.method==='GET'){send(200,{admin:auth(req),canEdit:!!session(req),role:session(req)?.role||'reader',account:session(req)?.account,database:!!pool,capabilities:{blockInitialFields:true,catalogReorder:true,editHistory:true,customerPeople:true,blockEditTypes:true,quantityCorrections:true}});return;}
  if(url.pathname==='/api/login-options'&&req.method==='GET'){const accounts=pool?(await pool.query('SELECT username,name FROM advisor_accounts WHERE active=true ORDER BY name')).rows:[];send(200,{accounts});return;}
  if(url.pathname==='/api/login'&&req.method==='POST'){
   const ip=clientAddress(req);let a=attempts.get(ip);if(!a||Date.now()-a.at>900000){a={count:0,at:Date.now()};attempts.set(ip,a);}if(++a.count>10){send(429,{error:'Demasiados intentos. Espere 15 minutos.'});return;}
   const {password,role,username}=JSON.parse((await body(req)).toString());let account='administrador';let revision;let expected=process.env.ADMIN_PASSWORD_HASH||'';
   if(role==='advisor'){const row=(await pool?.query('SELECT * FROM advisor_accounts WHERE username=$1 AND active=true',[String(username||'').trim().toLowerCase()]))?.rows[0];expected=row?.password_hash||'';account=row?row.name+' ('+row.username+')':'';revision=row?.revision;}
   const [salt,hash]=expected.split(':');const actual=salt?scryptSync(String(password),salt,64):Buffer.alloc(0);const stored=hash?Buffer.from(hash,'hex'):Buffer.alloc(1);if(actual.length!==stored.length||!timingSafeEqual(actual,stored)){send(401,{error:'Usuario o PIN incorrectos, o cuenta inactiva'});return;}
   a.count=0;const token=randomBytes(32).toString('hex');await saveSession(token,{expires:Date.now()+8*3600000,role:role==='advisor'?'advisor':'admin',account,username:role==='advisor'?String(username).trim().toLowerCase():undefined,revision});res.setHeader('Set-Cookie',`session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}`);send(200,{ok:true,admin:role!=='advisor',canEdit:true,role:role==='advisor'?'advisor':'admin',account});return;
  }
  if(url.pathname==='/api/logout'&&req.method==='POST'){await dropSession(req);res.setHeader('Set-Cookie',`session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);send(200,{ok:true});return;}
  if(req.method==='POST'&&url.pathname.startsWith('/api/')&&!session(req)){send(403,{error:'Acceso administrativo requerido'});return;}
  if(['/api/advisors/credential','/api/advisors/delete'].includes(url.pathname)&&req.method==='POST'){
   if(!auth(req)){send(403,{error:'Solo el administrador puede gestionar cuentas'});return;}if(!pool)throw Error('PostgreSQL no configurado');const p=JSON.parse((await body(req)).toString());const username=String(p.username||'').trim().toLowerCase();
   if(url.pathname.endsWith('/delete')){confirmDeletion(req,p.deletePassword);const result=await pool.query('DELETE FROM advisor_accounts WHERE username=$1 RETURNING username',[username]);if(!result.rowCount)throw Error('Cuenta inexistente');send(200,{ok:true});}
   else {const row=(await pool.query('SELECT credential_cipher FROM advisor_accounts WHERE username=$1',[username])).rows[0];if(!row)throw Error('Cuenta inexistente');send(200,{password:row.credential_cipher?decryptCredential(row.credential_cipher):null});}return;
  }
  if(url.pathname==='/api/advisors'){
   if(!auth(req)){send(403,{error:'Solo el administrador puede gestionar cuentas'});return;}
   if(!pool)throw Error('PostgreSQL no configurado');
   if(req.method==='POST'){
    const p=JSON.parse((await body(req)).toString());const username=String(p.username||'').trim().toLowerCase();const name=String(p.name||'').trim();
    if(!/^[a-z0-9._-]{3,60}$/.test(username)||!name||name.length>120)throw Error('Indique un usuario de 3 a 60 caracteres (letras, números, punto, guion) y un nombre de hasta 120 caracteres');
    const old=(await pool.query('SELECT username FROM advisor_accounts WHERE username=$1',[username])).rows[0];let hash='';let encrypted:string|null=null;
    if(p.password){validateAccessPin(p.password);const salt=randomBytes(24).toString('hex');hash=salt+':'+scryptSync(p.password,salt,64).toString('hex');encrypted=encryptCredential(p.password);}
    if(!old&&!hash)throw Error('Defina un PIN para el nuevo asesor');
    await pool.query("INSERT INTO advisor_accounts(username,name,password_hash,active,credential_cipher) VALUES($1,$2,$3,$4,$5) ON CONFLICT(username) DO UPDATE SET name=EXCLUDED.name,password_hash=CASE WHEN EXCLUDED.password_hash='' THEN advisor_accounts.password_hash ELSE EXCLUDED.password_hash END,active=EXCLUDED.active,revision=advisor_accounts.revision+1,credential_cipher=COALESCE(EXCLUDED.credential_cipher,advisor_accounts.credential_cipher)",[username,name,hash,p.active!==false,encrypted]);
   }else if(req.method!=='GET'){send(405,{error:'Método no permitido'});return;}
   send(200,{accounts:(await pool.query('SELECT username,name,active FROM advisor_accounts ORDER BY name')).rows});return;
  }
  if(req.method==='POST'&&['/api/import-preview'].includes(url.pathname)&&!auth(req)){send(403,{error:'Acceso administrativo requerido'});return;}
  if(url.pathname==='/api/data'&&req.method==='GET'){const s=await state();const blocks=filtered(s,url.searchParams);const visible=new Set(blocks.map((b:any)=>b.id));send(200,{...s,editHistory:editHistory(s,visible),audit:auth(req)?s.audit:undefined,loads:auth(req)?s.loads||[]:undefined,requests:undefined,requestDigests:undefined,requestResults:undefined,events:s.events.filter((e:any)=>!e.deleted).map((e:any)=>({...e,lines:e.lines.filter((l:any)=>!l.deleted&&visible.has(l.blockId))})).filter((e:any)=>e.lines.length),blocks});return;}
  if(url.pathname==='/api/deleted'&&req.method==='GET'){
   if(!auth(req)){send(403,{error:'Acceso administrativo requerido'});return;}const s=await state();send(200,{blocks:s.blocks.filter((b:any)=>b.deleted),events:s.events.filter((e:any)=>e.deleted)});return;
  }
  if(['/api/bulk-preview','/api/bulk-load','/api/bulk-delete'].includes(url.pathname)&&req.method==='POST'){
   if(!auth(req)){send(403,{error:'Solo el administrador puede gestionar cargas masivas'});return;}if(!pool)throw Error('PostgreSQL no configurado');
   const input=JSON.parse((await body(req)).toString());const account=session(req)?.account||'administrador';
   if(url.pathname==='/api/bulk-delete')confirmDeletion(req,input.deletePassword);
   const rows=url.pathname==='/api/bulk-delete'?[]:await parseBulk(String(input.base64||''));
   const db=await pool.connect();try{await db.query('BEGIN');const s=(await db.query('SELECT data FROM app_state WHERE id=1 FOR UPDATE')).rows[0].data;
    try{const result=url.pathname==='/api/bulk-delete'?deleteBulk(s,String(input.id||''),account):applyBulk(s,rows,account,input.file);
     if(url.pathname==='/api/bulk-preview'){await db.query('ROLLBACK');send(200,{ok:true,rows:rows.length,summary:result.summary});return;}
     await db.query('UPDATE app_state SET data=$1,version=version+1 WHERE id=1',[JSON.stringify(s)]);await db.query('COMMIT');send(200,{ok:true,load:result});
    }catch(e){await db.query('ROLLBACK');if(e instanceof BulkErrors){send(422,{error:e.message,errors:e.list});return;}throw e;}
   }finally{db.release();}return;
  }
  if(url.pathname==='/api/operate'&&req.method==='POST'){
   if(!pool)throw Error('PostgreSQL no configurado');const input=JSON.parse((await body(req)).toString());if(!await permitted(req,input)){send(403,{error:'Su perfil no permite esta operación'});return;}if(['catalogDelete','deleteClient'].includes(input.kind)){confirmDeletion(req,input.data?.deletePassword);delete input.data.deletePassword;}const db=await pool.connect();try{await db.query('BEGIN');const s=(await db.query('SELECT data FROM app_state WHERE id=1 FOR UPDATE')).rows[0].data;const result=operate(s,input,session(req)?.account);await db.query('UPDATE app_state SET data=$1,version=version+1 WHERE id=1',[JSON.stringify(s)]);await db.query('COMMIT');send(200,result);}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}return;
  }
  if(url.pathname==='/api/operation-preview'&&req.method==='POST'){
   const input=JSON.parse((await body(req)).toString());if(!await permitted(req,input)){send(403,{error:'Su perfil no permite esta operación'});return;}if(['catalogDelete','deleteClient'].includes(input.kind)){confirmDeletion(req,input.data?.deletePassword);delete input.data.deletePassword;}const current=await state();const draft=structuredClone(current);operate(draft,input,session(req)?.account);const affected=draft.blocks.map((b:any)=>({id:b.id,description:b.description,before:current.blocks.some((x:any)=>x.id===b.id&&!x.deleted)?balances(current,b.id):[],after:b.deleted?[]:balances(draft,b.id)})).filter((x:any)=>JSON.stringify(x.before)!==JSON.stringify(x.after));send(200,{ok:true,affected});return;
  }
  if(url.pathname==='/api/import-preview'&&req.method==='POST'){
   const input=JSON.parse((await body(req)).toString());send(200,await previewImport(input.base64,input.sheet,input.mapping,(await state()).legacy));return;
  }
  if(url.pathname==='/api/export'&&req.method==='GET'){
   const s=await state();const book=new ExcelJS.Workbook();const q=url.searchParams;const history=q.get('mode')==='history';const blocks=filterBlocks(projected(s),q,history);const lines:any[]=[];
   const label=(list:any[],key:string)=>list.find(x=>x.id===key)?.name||'';
   const append=(b:any,e:any,l:any)=>{const c=s.codes.find((x:any)=>x.id===(e?(l.codeId||b.codeId):b.codeId));const cl=s.clients.find((x:any)=>x.id===c.clientId);lines.push([cl.name,c.code,s.codes.filter((x:any)=>x.clientId===cl.id).map((x:any)=>x.code).join(' / '),(e?.date||b.date)?new Date((e?.date||b.date)+'T12:00:00Z'):null,label(s.catalogs.types,b.typeId),b.description,l.quantity,l.to||l.place,l.storage||'',e?label(s.catalogs.responsible,e.responsible):'',e?.action||'Situación actual',e?.notes||b.notes,b.id,e?.id||'']);};
   if(history){for(const e of filterEvents(projected(s),q))for(const l of e.lines)append(s.blocks.find((b:any)=>b.id===l.blockId),e,l);}else for(const b of blocks)for(const l of b.balances)append(b,null,l);
   // Shared filters already provide the same record order as the screen.
   if(!lines.length&&q.get('mode')!=='legacy')throw Error('No existen resultados para descargar');
   const sheet=book.addWorksheet(history?'Historial':'Situación actual');sheet.addRow(['Cliente','Código original','Códigos vinculados','Fecha','Tipo','Descripción','Cantidad','Ubicación','Almacenamiento','Responsable','Acción','Observaciones','ID bloque','ID movimiento']);sheet.addRows(lines);sheet.getColumn(2).numFmt='@';sheet.getColumn(4).numFmt='dd/mm/yyyy';sheet.columns.forEach(c=>c.width=24);sheet.getRow(1).font={bold:true};sheet.views=[{state:'frozen',ySplit:1}];if(q.get('mode')==='legacy'){book.removeWorksheet(sheet.id);const sh=book.addWorksheet('Legados sin conciliar');sh.addRow(['ID','Original','Estado','Bloque vinculado','Motivo de conciliación']);for(const l of s.legacy)sh.addRow([l.id,JSON.stringify(l.original),l.pending?'Pendiente de conciliación':'Conciliado',l.blockId||'',l.reason||'']);}
   res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="registros-${q.get('mode')||'actual'}-${q.get('start')||'inicio'}-${q.get('end')||'fin'}-${q.get('order')||'desc'}.xlsx"`});res.end(Buffer.from(await book.xlsx.writeBuffer()));return;
  }
  if(url.pathname==='/plantilla-carga.xlsx'&&req.method==='GET'){if(!auth(req)){send(403,{error:'Acceso administrativo requerido'});return;}res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="plantilla-carga.xlsx"','Cache-Control':'no-store'});res.end(await bulkTemplate((await state()).catalogs));return;}
  if(req.method==='GET'&&!url.pathname.startsWith('/api/')){const file=url.pathname==='/'?'index.html':url.pathname.slice(1);if(!['index.html','app.js','query.js','audit.js','style.css'].includes(file)){send(404,{error:'No encontrado'});return;}res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8'});res.end(readFileSync(new URL(file,root)));return;}
  send(404,{error:'No encontrado'});
 }catch(e){const code=(e as any)?.code==='STALE_REVISION'?'STALE_REVISION':undefined;send(code?409:400,{error:e instanceof Error?e.message:'Error inesperado',code});}
});
export async function shutdown(){if(server.listening)await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));if(pool)await pool.end();}
if(process.env.APP_NO_LISTEN!=='1')server.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`Gestión de archivos: http://${process.env.HOST||'127.0.0.1'}:${port}`));

