import ExcelJS from 'exceljs';
import {operate,id} from './domain.ts';
import {parseDate} from './imports.ts';
// Carga masiva desde la plantilla de una sola hoja ("Carga"). Cada carga queda registrada en s.loads
// con los registros que creó, para poder revisarla y deshacerla mientras nadie los haya usado después.
export class BulkErrors extends Error{list:string[];constructor(list:string[]){super(`No se cargó nada. ${list.length} error(es) en el archivo.`);this.list=list;}}
const columns=['Código del cliente','Nombre persona 1','Nombre persona 2','Vincular a otro código','Fecha de ingreso','Tipo de archivo','Cantidad','Ubicación en comercial','Responsable','Nota'];
const norm=(v:string)=>v.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export async function parseBulk(base64:string){
 const wb=new ExcelJS.Workbook();try{await wb.xlsx.load(Buffer.from(base64,'base64') as any);}catch{throw Error('No se pudo leer el archivo XLSX. Verifique que no esté dañado ni protegido con contraseña.');}
 const ws=wb.getWorksheet('Carga')||wb.worksheets[0];if(!ws)throw Error('El archivo no tiene hojas');
 const header=Array.from({length:columns.length},(_,i)=>norm(ws.getRow(1).getCell(i+1).text));
 const missing=columns.filter((c,i)=>!header[i]?.startsWith(norm(c)));if(missing.length)throw Error('Use la plantilla oficial: no coinciden los encabezados '+missing.join(', '));
 const txt=(c:ExcelJS.Cell)=>String(c.text??'').trim();const rows:any[]=[];
 ws.eachRow((r,n)=>{if(n===1)return;const v=columns.map((_,i)=>txt(r.getCell(i+1)));if(!v.some(Boolean)||/^EJ-\d+$/.test(v[0]))return;
  rows.push({n,code:v[0],name:v[1],second:v[2],link:v[3],date:parseDate(r.getCell(5).value)||parseDate(v[4]),dateText:v[4],type:v[5],qty:v[6],store:v[7],resp:v[8],note:v[9]});});
 if(!rows.length)throw Error('El archivo no tiene filas para cargar (las filas de ejemplo EJ-… se ignoran)');
 return rows;
}
export function applyBulk(s:any,rows:any[],account:string,file:string){
 const errors:string[]=[];const created={clients:[] as string[],codes:[] as string[],blocks:[] as string[],events:[] as string[]};const summary:string[]=[];
 const run=(kind:string,data:any,where:string)=>{try{operate(s,{kind,data,key:id()},account);return true;}catch(e:any){errors.push(`${where}: ${e.message}`);return false;}};
 const byName=(list:any[],name:string)=>list.find((x:any)=>!x.deleted&&x.active!==false&&x.name.trim().toLowerCase()===name.trim().toLowerCase());
 const groups=new Map<string,any>();
 for(const r of rows){if(!r.code){errors.push(`Fila ${r.n}: falta Código del cliente`);continue;}
  const g=groups.get(r.code)||{code:r.code,rows:[],name:'',second:'',link:''};g.rows.push(r);
  for(const [k,label] of [['name','Nombre persona 1'],['second','Nombre persona 2'],['link','Vincular a otro código']] as const)if(r[k]){if(g[k]&&g[k].toLowerCase()!==r[k].toLowerCase())errors.push(`Fila ${r.n}: "${label}" distinto al de otra fila del código ${r.code}`);else g[k]=g[k]||r[k];}
  groups.set(r.code,g);}
 const codeOf=(c:string)=>s.codes.find((x:any)=>x.code===c);
 const fresh=[...groups.values()].filter(g=>!codeOf(g.code));
 for(const g of [...groups.values()].filter(g=>codeOf(g.code)&&g.link))errors.push(`Código ${g.code} (fila ${g.rows[0].n}): ya existe en el sistema; quite el vínculo o vincúlelo desde el sistema`);
 for(const g of fresh.filter(g=>!g.link)){if(!g.name){errors.push(`Código ${g.code} (fila ${g.rows[0].n}): falta Nombre persona 1`);continue;}
  if(run('client',{name:g.name,secondName:g.second,code:g.code},`Código ${g.code}`)){const c=codeOf(g.code);created.codes.push(c.id);created.clients.push(c.clientId);summary.push(`Cliente nuevo ${g.code}`);}}
 let pending=fresh.filter(g=>g.link),progress=true;
 while(pending.length&&progress){progress=false;for(const g of [...pending]){const target=codeOf(g.link);if(!target)continue;pending=pending.filter(x=>x!==g);progress=true;
  if(g.link===g.code){errors.push(`Código ${g.code}: no puede vincularse a sí mismo`);continue;}
  if(run('code',{code:g.code,clientId:target.clientId,current:false},`Código ${g.code}`)){created.codes.push(codeOf(g.code).id);summary.push(`Código ${g.code} vinculado a ${g.link}`);}}}
 for(const g of pending)errors.push(`Código ${g.code} (fila ${g.rows[0].n}): el código a vincular "${g.link}" no existe`);
 for(const r of rows.filter(r=>r.code)){if(![r.dateText,r.type,r.qty,r.store,r.resp].some(Boolean))continue;const c=codeOf(r.code);if(!c)continue;
  const type=byName(s.catalogs.types,r.type),store=r.store?byName(s.catalogs.storage,r.store):null,resp=byName(s.catalogs.responsible,r.resp);const e:string[]=[];
  if(!r.date)e.push('fecha vacía o inválida');if(!type)e.push(r.type?`tipo "${r.type}" no está en el catálogo`:'falta Tipo de archivo');if(r.qty&&!/^[1-9][0-9]*$/.test(r.qty))e.push('cantidad inválida');if(r.store&&!store)e.push(`ubicación "${r.store}" no está en el catálogo`);if(!resp)e.push(r.resp?`responsable "${r.resp}" no está en el catálogo`:'falta Responsable');
  if(e.length){errors.push(`Fila ${r.n} (${r.code}): ${e.join('; ')}`);continue;}
  if(run('receive',{codeId:c.id,date:r.date,responsible:resp.id,notes:r.note,blocks:[{typeId:type.id,description:type.name,quantity:r.qty?Number(r.qty):null,storage:store?.name||'',notes:r.note}]},`Fila ${r.n}`)){created.events.push(s.events.at(-1).id);created.blocks.push(...s.events.at(-1).lines.map((l:any)=>l.blockId));}}
 if(created.blocks.length)summary.push(`${created.blocks.length} documento(s) registrados como Recepción`);
 if(errors.length)throw new BulkErrors(errors);
 const notes=rows.filter(r=>r.note&&![r.dateText,r.type,r.resp].some(Boolean)).map(r=>`${r.code}: ${r.note}`);
 const revisions=Object.fromEntries([...s.blocks.filter((x:any)=>created.blocks.includes(x.id)),...s.events.filter((x:any)=>created.events.includes(x.id))].map((x:any)=>[x.id,x.revision||0]));
 const load={id:id(),at:new Date().toISOString(),account,file:String(file||'archivo.xlsx').slice(0,200),rows:rows.length,summary,notes,created,revisions,deleted:false};
 s.loads??=[];s.loads.push(load);s.audit.push({id:id(),at:load.at,account,kind:'bulkLoad',reason:`Carga masiva ${load.file}: ${summary.join('; ')}${notes.length?' · Notas: '+notes.join(' | '):''}`});
 return load;
}
export function deleteBulk(s:any,loadId:string,account:string){
 const load=(s.loads||[]).find((x:any)=>x.id===loadId&&!x.deleted);if(!load)throw Error('Carga inexistente o ya eliminada');
 const c=load.created,blocks=new Set(c.blocks),events=new Set(c.events),codes=new Set(c.codes),clients=new Set(c.clients);
 // Solo se deshace si nada posterior depende de lo cargado.
 const used:string[]=[];
 if(s.events.some((e:any)=>!events.has(e.id)&&!e.deleted&&e.lines.some((l:any)=>blocks.has(l.blockId))))used.push('hay movimientos posteriores sobre documentos de esta carga');
 if(s.blocks.some((b:any)=>!blocks.has(b.id)&&codes.has(b.codeId)))used.push('se registraron otros documentos en códigos creados por esta carga');
 if(s.codes.some((x:any)=>!codes.has(x.id)&&clients.has(x.clientId)))used.push('se vincularon otros códigos a clientes creados por esta carga');
 if((s.legacy||[]).some((x:any)=>blocks.has(x.blockId)))used.push('hay registros conciliados con documentos de esta carga');
 const changed=(x:any)=>x.deleted||(x.revision||0)!==(load.revisions?.[x.id]??0);
 if(s.blocks.some((b:any)=>blocks.has(b.id)&&changed(b))||s.events.some((e:any)=>events.has(e.id)&&changed(e)))used.push('se editaron o eliminaron documentos de esta carga');
 if(used.length)throw Error('No se puede eliminar la carga: '+used.join('; ')+'. Corrija esos registros en el sistema primero.');
 s.events=s.events.filter((e:any)=>!events.has(e.id));s.blocks=s.blocks.filter((b:any)=>!blocks.has(b.id));s.codes=s.codes.filter((x:any)=>!codes.has(x.id));s.clients=s.clients.filter((x:any)=>!clients.has(x.id));
 load.deleted=true;load.deletedAt=new Date().toISOString();load.deletedBy=account;
 s.audit.push({id:id(),at:load.deletedAt,account,kind:'bulkLoadDelete',reason:`Eliminada la carga ${load.file} del ${load.at.slice(0,10)}: ${c.clients.length} cliente(s), ${c.codes.length} código(s), ${c.blocks.length} documento(s)`});
 return load;
}
