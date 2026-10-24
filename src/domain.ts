import { randomUUID,createHash } from 'node:crypto';
import {registerImportedRows} from './imports.ts';
import {auditSnapshots} from './audit-diff.ts';
export const id = () => randomUUID();
export const initial = () => ({clients:[],codes:[],blocks:[],events:[],legacy:[],audit:[],requests:[],catalogs:{responsible:['Ada','Evelyn','Chrystel'].map(name=>({id:id(),name,active:true})),types:['Carta de Aceptación','Plan de Tesis','Informe Final','Encuestas o Entrevistas','Validación de Instrumentos','Archivo de observación','Dictámenes','Archivo distinto (Material extra)','Sustentación'].map(name=>({id:id(),name,active:true})),storage:['Bolsa de papel','Bolsa de plástico','Folder','Escritorio','Carpeta Leo'].map(name=>({id:id(),name,active:true}))}});
export function requireValue(ok:any,message:string){if(!ok)throw Error(message);}
function checkRevision(record:any,expected:any){if(expected!==undefined&&(!record||!Number.isSafeInteger(expected)||expected!==(record.revision||0)))throw Object.assign(Error('Este registro cambió desde que abrió el formulario. Actualice la consulta y revise los cambios antes de guardar.'),{code:'STALE_REVISION'});}
function revise(record:any){record.revision=(record.revision||0)+1;}
export function date(value:string){const parsed=typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?new Date(value+'T12:00:00Z'):null;requireValue(parsed&&!isNaN(+parsed)&&parsed.toISOString().slice(0,10)===value,'Fecha inválida');return value;}
export function balances(s:any,blockId:string){
 const block=s.blocks.find((b:any)=>b.id===blockId);const result:any[]=block?.openingBalance&&!block.deleted?[structuredClone(block.openingBalance)]:[];
 for(const e of s.events.filter((e:any)=>!e.deleted)) for(const line of e.lines.filter((l:any)=>!l.deleted&&l.blockId===blockId)){
  if(e.action!=='Recepción'){
   const source=result.find(x=>x.place===line.from&&x.storage===(line.fromStorage||''));
   requireValue(source,'El origen no tiene saldo');
   if(line.quantity===null){requireValue(source.quantity===null,'Cantidad desconocida incompatible');result.splice(result.indexOf(source),1);}
   else {requireValue(Number.isInteger(line.quantity)&&line.quantity>0&&source.quantity!==null&&source.quantity>=line.quantity,'Cantidad superior al saldo o inválida');source.quantity-=line.quantity;if(source.quantity===0)result.splice(result.indexOf(source),1);}
  }
  const target=result.find(x=>x.place===line.to&&x.storage===(line.storage||''));
  if(target){requireValue(target.quantity!==null&&line.quantity!==null,'No se pueden mezclar cantidades desconocidas');target.quantity+=line.quantity;}
  else result.push({place:line.to,storage:line.storage||'',quantity:line.quantity});
 }
 return result;
}
export function operate(s:any,input:any,account='administrador'){
 input=structuredClone(input);
 requireValue(input.key&&typeof input.key==='string','Falta clave de operación');
 const fingerprint=createHash('sha256').update(JSON.stringify({kind:input.kind,data:input.data})).digest('hex');
 if(s.requests.includes(input.key)){requireValue(!s.requestDigests?.[input.key]||s.requestDigests[input.key]===fingerprint,'La clave ya fue utilizada con datos diferentes. Abra una nueva operación.');return {...s.requestResults?.[input.key],duplicate:true};}
 const before=JSON.stringify({...s,audit:[],requests:[],requestDigests:{},requestResults:{}});const p=input.data;const kind=input.kind;let importSummary;
 s.defaults??={transportResponsible:s.catalogs.responsible[1]?.id||null};
 if(kind==='client'){
  requireValue(p.name?.trim()&&p.code?.trim(),'Nombre y código obligatorios');requireValue(!s.codes.some((x:any)=>x.code===p.code.trim()),'Código ya registrado');
  const personNames=[p.name.trim(),String(p.secondName||'').trim()].filter(Boolean);const client={id:id(),name:personNames.join(' y '),personNames};s.clients.push(client);s.codes.push({id:id(),clientId:client.id,code:p.code.trim(),current:true});
 }else if(kind==='editClient'){
  const c=s.clients.find((x:any)=>x.id===p.id);requireValue(c&&p.name?.trim(),'Cliente y nombre obligatorios');checkRevision(c,p.expectedRevision);c.personNames=[p.name.trim(),String(Object.hasOwn(p,'secondName')?p.secondName||'':c.personNames?.[1]||'').trim()].filter(Boolean);c.name=c.personNames.join(' y ');c.namePending=false;revise(c);
 }else if(kind==='code'){
  p.code=String(p.code||'').trim();
  requireValue(s.clients.some((x:any)=>x.id===p.clientId),'Cliente inexistente');
  const existing=s.codes.find((x:any)=>x.code===p.code);
  if(existing){requireValue(p.confirm===true,'Confirme la vinculación');checkRevision(existing,p.expectedRevision);existing.clientId=p.clientId;}
  else {requireValue(p.code?.trim(),'Código obligatorio');s.codes.push({id:id(),clientId:p.clientId,code:p.code.trim(),current:!!p.current});}
  const c=existing||s.codes.at(-1);if(p.current!==undefined){if(p.current)for(const other of s.codes.filter((x:any)=>x.clientId===p.clientId&&x.id!==c.id&&x.current)){other.current=false;revise(other);}c.current=!!p.current;}for(const key of ['validFrom','validTo'])if(p[key]!==undefined)c[key]=p[key]?date(p[key]):null;requireValue(!c.validFrom||!c.validTo||c.validFrom<=c.validTo,'Vigencia invertida');revise(c);
 }else if(kind==='catalogReorder'){
  requireValue(['responsible','types','storage'].includes(p.catalog),'Catálogo inválido');const all=s.catalogs[p.catalog];const list=all.filter((item:any)=>!item.deleted);
  requireValue(Array.isArray(p.order)&&p.order.length===list.length&&new Set(p.order).size===list.length&&p.order.every((key:string)=>list.some((item:any)=>item.id===key)),'El orden debe incluir cada opción del catálogo exactamente una vez');
  if(!Array.isArray(p.expectedOrder)||JSON.stringify(p.expectedOrder)!==JSON.stringify(list.map((item:any)=>item.id)))throw Object.assign(Error('Este catálogo cambió en otra sesión. Actualice la consulta antes de reordenar.'),{code:'STALE_REVISION'});
  s.catalogs[p.catalog]=[...p.order.map((key:string)=>list.find((item:any)=>item.id===key)),...all.filter((item:any)=>item.deleted)];
 }else if(kind==='catalogDelete'){
  requireValue(['responsible','types','storage'].includes(p.catalog),'Catálogo inválido');const item=s.catalogs[p.catalog].find((x:any)=>x.id===p.id&&!x.deleted);requireValue(item,'Opción inexistente');checkRevision(item,p.expectedRevision);item.deleted=true;item.active=false;revise(item);
 }else if(kind==='catalog'){
  requireValue(['responsible','types','storage'].includes(p.catalog),'Catálogo inválido');const list=s.catalogs[p.catalog];const old=list.find((x:any)=>x.id===p.id);
  requireValue(p.name?.trim(),'Nombre obligatorio');if(old){checkRevision(old,p.expectedRevision);Object.assign(old,{name:p.name.trim(),active:p.active!==false});revise(old);}else list.push({id:id(),name:p.name.trim(),active:true});
 }else if(kind==='receive'){
  requireValue(s.codes.some((x:any)=>x.id===p.codeId),'Seleccione un código');requireValue(p.blocks?.length,'Agregue bloques');
  const lines=p.blocks.map((b:any)=>{requireValue(b.description?.trim(),'Descripción obligatoria');requireValue(s.catalogs.types.some((x:any)=>x.id===b.typeId&&x.active),'Tipo inválido');const q=b.quantity===''||b.quantity==null?null:Number(b.quantity);requireValue(q===null||Number.isInteger(q)&&q>0,'Cantidad inválida');const block={id:id(),codeId:p.codeId,typeId:b.typeId,description:b.description,date:date(p.date),notes:b.notes||'',deleted:false};s.blocks.push(block);return {blockId:block.id,to:'Comercial',storage:b.storage||'',quantity:q};});
  addEvent(s,{...p,action:'Recepción',lines},account);
 }else if(kind==='move'){
  requireValue(['Traslado','Retirado','Reciclaje','Almacenado'].includes(p.action),'Acción inválida');requireValue(p.lines?.length,'Seleccione bloques');
  if(p.action==='Reciclaje')requireValue(p.notes?.trim(),'Motivo obligatorio al reciclar');if(p.action==='Retirado'&&!p.deliveredBy?.trim())p.deliveredBy=s.catalogs.responsible.find((r:any)=>r.id===p.responsible&&r.active)?.name||'';if(p.action==='Retirado')requireValue(p.deliveredBy?.trim(),'Seleccione responsable');
  for(const l of p.lines){requireValue(s.blocks.some((x:any)=>x.id===l.blockId&&!x.deleted),'Bloque inexistente');requireValue(['Comercial','Operativo'].includes(l.from),'No se trasladan destinos finales');l.to=p.action==='Retirado'?'Cliente':p.action==='Reciclaje'?'Reciclado':l.to;requireValue(['Comercial','Operativo','Cliente','Reciclado'].includes(l.to),'Destino inválido');if(['Traslado','Almacenado'].includes(p.action))requireValue(['Comercial','Operativo'].includes(l.to),'Use entrega o reciclaje para destinos finales');if(p.action==='Almacenado')requireValue(l.from===l.to,'Almacenado conserva la oficina');if(l.to!=='Comercial')l.storage='';}
  addEvent(s,p,account);
 }else if(kind==='deleteBlock'){
  const b=s.blocks.find((x:any)=>x.id===p.id&&!x.deleted);requireValue(b,'Bloque obligatorio');checkRevision(b,p.expectedRevision);requireValue(!s.events.some((e:any)=>!e.deleted&&e.action!=='Recepción'&&e.lines.some((l:any)=>!l.deleted&&l.blockId===b.id)),'Hay movimientos dependientes; corríjalos primero');b.deleted=true;revise(b);for(const e of s.events.filter((e:any)=>!e.deleted&&e.action==='Recepción'&&e.lines.some((l:any)=>l.blockId===b.id))){for(const l of e.lines.filter((l:any)=>l.blockId===b.id))l.deleted=true;if(e.lines.every((l:any)=>l.deleted))e.deleted=true;revise(e);}
 }else if(kind==='editBlock'){
  const b=s.blocks.find((x:any)=>x.id===p.id&&!x.deleted);requireValue(b,'Registro obligatorio');checkRevision(b,p.expectedRevision);requireValue(p.description?.trim(),'Descripción obligatoria');b.description=p.description;b.notes=p.notes||'';revise(b);
  if(p.codeId){requireValue(s.codes.some((c:any)=>c.id===p.codeId),'Código inexistente');b.codeId=p.codeId;}
  if(p.typeId){requireValue(s.catalogs.types.some((t:any)=>t.id===p.typeId),'Tipo inexistente');b.typeId=p.typeId;}
  if(p.date)b.date=date(p.date);
  const changesInitial=['quantity','storage','responsible'].some(key=>Object.hasOwn(p,key));
  if(changesInitial){
   const quantity=Object.hasOwn(p,'quantity')?(p.quantity===''||p.quantity==null?null:Number(p.quantity)):undefined;
   requireValue(quantity===undefined||quantity===null||Number.isSafeInteger(quantity)&&quantity>0,'Cantidad inicial inválida');
   const responsible=p.responsible?s.catalogs.responsible.find((r:any)=>r.id===p.responsible):null;
   requireValue(!p.responsible||responsible,'Responsable inexistente');
   if(b.openingBalance){
    if(quantity!==undefined)b.openingBalance.quantity=quantity;
    if(Object.hasOwn(p,'storage')){requireValue(b.openingBalance.place==='Comercial'||!p.storage,'Almacenamiento solo corresponde a Comercial');b.openingBalance.storage=String(p.storage||'').trim();}
    if(Object.hasOwn(p,'responsible'))b.initialResponsible=responsible?.id||null;
   }else{
    let receipt=s.events.find((e:any)=>!e.deleted&&e.action==='Recepción'&&e.lines.some((l:any)=>!l.deleted&&l.blockId===b.id));
    requireValue(receipt,'No se encontró el ingreso original del bloque');
    const receiptLine=receipt.lines.find((l:any)=>!l.deleted&&l.blockId===b.id);
    const headerChange=(p.date&&p.date!==receipt.date)||(responsible&&responsible.id!==receipt.responsible);
    // Separate only this block when editing shared reception headers; other blocks retain their data.
    if(headerChange&&receipt.lines.length>1){const index=s.events.indexOf(receipt);receipt.lines=receipt.lines.filter((l:any)=>l!==receiptLine);revise(receipt);receipt={...structuredClone(receipt),id:id(),revision:1,lines:[receiptLine],splitFrom:receipt.id};s.events.splice(index+1,0,receipt);}
    if(quantity!==undefined)receiptLine.quantity=quantity;
    if(Object.hasOwn(p,'storage'))receiptLine.storage=String(p.storage||'').trim();
    if(p.date)receipt.date=date(p.date);if(responsible)receipt.responsible=responsible.id;revise(receipt);
   }
  }
 }else if(kind==='eventCorrection'){
  const e=s.events.find((x:any)=>x.id===p.id&&!x.deleted);requireValue(e,'Registro obligatorio');checkRevision(e,p.expectedRevision);revise(e);for(const l of e.lines.filter((l:any)=>!l.deleted)){const b=s.blocks.find((b:any)=>b.id===l.blockId);if(b)revise(b);}
  if(p.deleted){e.deleted=true;if(e.action==='Recepción')for(const l of e.lines){requireValue(!s.events.some((x:any)=>!x.deleted&&x.id!==e.id&&x.lines.some((z:any)=>z.blockId===l.blockId)),'Hay movimientos dependientes; corríjalos primero');s.blocks.find((b:any)=>b.id===l.blockId).deleted=true;}}
  else {if(p.date)e.date=date(p.date);if(p.notes!==undefined)e.notes=p.notes;if(p.lines){const active=e.lines.filter((l:any)=>!l.deleted);requireValue(p.lines.length===active.length&&p.lines.every((l:any,i:number)=>!l.deleted&&l.blockId===active[i].blockId),'Una corrección conserva los bloques del movimiento');let index=0;e.lines=e.lines.map((old:any)=>old.deleted?old:{...p.lines[index++],codeId:old.codeId||s.blocks.find((b:any)=>b.id===old.blockId).codeId});}if(p.responsible){requireValue(s.catalogs.responsible.some((x:any)=>x.id===p.responsible),'Responsable inexistente');e.responsible=p.responsible;}if(p.deliveredBy!==undefined)e.deliveredBy=p.deliveredBy;}
 }else if(kind==='restoreBlock'){
  const b=s.blocks.find((x:any)=>x.id===p.id&&x.deleted);requireValue(b,'Bloque eliminado obligatorio');checkRevision(b,p.expectedRevision);
  let receipt=s.events.find((e:any)=>e.action==='Recepción'&&e.lines.some((l:any)=>l.blockId===b.id));
  // Compatibilidad con las primeras bajas lógicas, cuyo detalle quedó en auditoría.
  if(!receipt){for(const a of [...s.audit].reverse()){const old=a.before?.events?.find((e:any)=>e.action==='Recepción'&&e.lines.some((l:any)=>l.blockId===b.id));if(old){receipt=s.events.find((e:any)=>e.id===old.id);if(receipt)receipt.lines.push(structuredClone(old.lines.find((l:any)=>l.blockId===b.id)));break;}}}
  if(!receipt&&b.openingBalance){b.deleted=false;revise(b);validateState(s);}else{
  requireValue(receipt,'No se encontró una recepción verificable para este bloque');
  if(receipt.deleted)for(const l of receipt.lines)if(s.blocks.find((x:any)=>x.id===l.blockId)?.deleted)l.deleted=true;
  b.deleted=false;revise(b);receipt.deleted=false;revise(receipt);receipt.lines.find((l:any)=>l.blockId===b.id).deleted=false;}

 }else if(kind==='restoreEvent'){
  const e=s.events.find((x:any)=>x.id===p.id&&x.deleted);requireValue(e,'Movimiento eliminado obligatorio');checkRevision(e,p.expectedRevision);requireValue(e.lines.some((l:any)=>!l.deleted),'Restaure los bloques individuales de esta recepción');e.deleted=false;revise(e);
  for(const l of e.lines.filter((l:any)=>!l.deleted)){const b=s.blocks.find((x:any)=>x.id===l.blockId);requireValue(b,'Bloque inexistente');if(e.action==='Recepción')b.deleted=false;else requireValue(!b.deleted,'Restaure primero el ingreso del bloque');revise(b);}
 }else if(kind==='reopen'){
  requireValue(p.lines?.length,'Seleccione saldo final');for(const l of p.lines){requireValue(['Cliente','Reciclado'].includes(l.from)&&['Comercial','Operativo'].includes(l.to),'La reapertura debe partir de un destino final y volver a una oficina');}addEvent(s,{...p,action:'Reapertura',notes:p.reason},account);
 }else if(kind==='reconcile'){
  const row=s.legacy.find((x:any)=>x.id===p.id);const block=s.blocks.find((x:any)=>x.id===p.blockId&&!x.deleted);requireValue(row&&block&&p.confirm===true,'Seleccione legado y bloque y confirme');checkRevision(row,p.expectedRevision);row.pending=false;row.blockId=block.id;row.reconciledAt=new Date().toISOString();row.reason=p.reason;revise(row);
 }else if(kind==='import'){
  requireValue(Array.isArray(p.rows),'Filas inválidas');importSummary=registerImportedRows(s,p.rows.map((row:any)=>({...row,batchKey:input.key})),account);
 }else throw Error('Operación desconocida');
 validateState(s);
 const eventId=['receive','move','reopen'].includes(kind)?s.events.at(-1)?.id:undefined;
 const result={ok:true,...(eventId?{eventId}: {}),...(importSummary?{importSummary}:{})};
 s.audit.push({id:id(),at:new Date().toISOString(),account,kind,responsible:p.responsible||null,reason:p.reason||p.notes||'',...auditSnapshots(JSON.parse(before),JSON.parse(JSON.stringify({...s,audit:[],requests:[],requestDigests:{},requestResults:{}})))});s.requests.push(input.key);s.requestDigests??={};s.requestDigests[input.key]=fingerprint;s.requestResults??={};s.requestResults[input.key]=result;return result;
}
function addEvent(s:any,p:any,account:string){requireValue(s.catalogs.responsible.some((r:any)=>r.id===p.responsible&&r.active),'Seleccione responsable');s.events.push({id:id(),action:p.action,date:date(p.date),at:new Date().toISOString(),responsible:p.responsible,account,notes:p.notes||'',deliveredBy:p.deliveredBy||'',lines:p.lines.map((l:any)=>({...l,codeId:s.blocks.find((b:any)=>b.id===l.blockId)?.codeId})),deleted:false,revision:1});for(const blockId of new Set(p.lines.map((l:any)=>l.blockId))){const block=s.blocks.find((b:any)=>b.id===blockId);if(block)revise(block);}}
export function validateState(s:any){
 for(const b of s.blocks.filter((b:any)=>!b.deleted&&b.openingBalance)){
  const opening=b.openingBalance;requireValue(b.sourceImport?.rowHash,'Saldo inicial sin procedencia verificable');
  requireValue(s.codes.some((c:any)=>c.id===b.codeId)&&s.catalogs.types.some((t:any)=>t.id===b.typeId),'Código o tipo de saldo inicial inválido');
  if(b.date)date(b.date);requireValue(['Comercial','Operativo','Cliente','Reciclado'].includes(opening.place),'Ubicación inicial inválida');
  requireValue(opening.quantity===null||Number.isSafeInteger(opening.quantity)&&opening.quantity>0,'Cantidad inicial inválida');
  requireValue(opening.place==='Comercial'||!opening.storage,'Almacenamiento inicial solo corresponde a Comercial');
 }

 for(const e of s.events.filter((x:any)=>!x.deleted)){
  date(e.date);requireValue(e.lines?.length,'Movimiento sin bloques');
  if(e.action==='Reciclaje')requireValue(e.notes?.trim(),'Motivo obligatorio al reciclar');if(e.action==='Retirado')requireValue(e.deliveredBy?.trim(),'Indique quién entrega');
  for(const l of e.lines.filter((l:any)=>!l.deleted)){const b=s.blocks.find((b:any)=>b.id===l.blockId&&!b.deleted);requireValue(b,'Bloque inexistente o eliminado');requireValue(l.quantity===null||Number.isSafeInteger(l.quantity)&&l.quantity>0,'Cantidad inválida');requireValue(['Comercial','Operativo','Cliente','Reciclado'].includes(l.to),'Destino inválido');requireValue(l.to==='Comercial'||!l.storage,'Almacenamiento solo corresponde a Comercial');
   if(e.action==='Recepción')requireValue(l.to==='Comercial'&&!l.from,'La recepción ingresa en Comercial');
   else if(e.action==='Reapertura')requireValue(['Cliente','Reciclado'].includes(l.from)&&['Comercial','Operativo'].includes(l.to),'Reapertura inválida');
   else {requireValue(['Comercial','Operativo'].includes(l.from),'No se trasladan destinos finales');if(e.action==='Retirado')requireValue(l.to==='Cliente','Entrega con destino inválido');else if(e.action==='Reciclaje')requireValue(l.to==='Reciclado','Reciclaje con destino inválido');else requireValue(['Comercial','Operativo'].includes(l.to),'Destino ordinario inválido');if(e.action==='Almacenado')requireValue(l.from===l.to,'Almacenado conserva la oficina');}
  }
 }
 for(const b of s.blocks.filter((b:any)=>!b.deleted))balances(s,b.id);
}
