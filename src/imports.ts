import ExcelJS from 'exceljs';
import {createHash,randomUUID} from 'node:crypto';
export const fields={code:'Código del cliente',name:'Nombre',date:'Fecha',type:'Tipo de archivo',place:'Ubicación',storage:'Ubicación en comercial',responsible:'Responsable',action:'Acción',notes:'Nota',description:'Descripción (archivos anteriores)',quantity:'Cantidad',linkedCode:'Código vinculado'};
const norm=(v:string)=>v.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const aliases:any={code:['codigodelcliente','codigo','codigocliente'],name:['nombre','cliente','nombredelcliente'],date:['fecha','fechadeingreso'],type:['tipodearchivo','tipo'],place:['ubicacion'],storage:['ubicacionencomercial','almacenamiento'],responsible:['responsable'],action:['accion'],notes:['nota','observacion','observaciones'],description:['descripcion'],quantity:['cantidad'],linkedCode:['codigovinculado']};
export function parseDate(value:any):string|null {
 if(value instanceof Date&&!isNaN(+value))return value.toISOString().slice(0,10);
 const str=String(value||'').trim();if(!str)return null;
 const m=str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);const iso=m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:str;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(iso))return null;const d=new Date(iso+'T12:00:00Z');return !isNaN(+d)&&d.toISOString().slice(0,10)===iso?iso:null;
}
function display(cell:ExcelJS.Cell){
 if(typeof cell.value==='number'&&Number.isSafeInteger(cell.value)&&cell.value>=0&&/^0+$/.test(cell.numFmt||''))return String(cell.value).padStart(cell.numFmt.length,'0');
 return cell.text;
}
export async function previewImport(base64:string,sheetName?:string,mapping?:Record<string,string>,existing:any[]=[]) {
 const workbook=new ExcelJS.Workbook();try{await workbook.xlsx.load(Buffer.from(base64,'base64') as any);}catch{throw Error('No se pudo leer el archivo XLSX. Verifique que no esté dañado ni protegido con contraseña.');}const sheet=sheetName?workbook.getWorksheet(sheetName):workbook.worksheets[0];if(!sheet)throw Error('Hoja inexistente');
 const headers=Array.from({length:sheet.columnCount},(_,i)=>sheet.getRow(1).getCell(i+1).text.trim()||`Columna ${i+1}`);if(new Set(headers).size!==headers.length)throw Error('Hay encabezados repetidos: asígneles nombres distintos antes de importar');
 const map=mapping||Object.fromEntries(Object.keys(fields).map(k=>[k,headers.find(h=>aliases[k].includes(norm(h)))||'']));
 for(const [key,column] of Object.entries(map)){if(!Object.hasOwn(fields,key)||typeof column!=='string'||column&&!headers.includes(column))throw Error('El mapeo contiene una columna inexistente o inválida');}
 const rows:any[]=[];const counts=new Map<string,number>();const oldCounts=new Map<string,number>();sheet.eachRow((row,n)=>{
  if(n===1)return;const original:any={};const originalCells:any={};headers.forEach((h,i)=>{const cell=row.getCell(i+1);original[h]=display(cell);originalCells[h]={value:cell.value,numberFormat:cell.numFmt||'General',text:cell.text,type:cell.type};});
  const canonical=JSON.stringify(Object.fromEntries(Object.entries(original).sort(([a],[b])=>a.localeCompare(b))));const count=(counts.get(canonical)||0)+1;counts.set(canonical,count);const hash=createHash('sha256').update(canonical+'#'+count).digest('hex');
  const oldCanonical=JSON.stringify(Object.fromEntries(headers.map(h=>[h,originalCells[h].text]).sort(([a],[b])=>a.localeCompare(b))));const oldCount=(oldCounts.get(oldCanonical)||0)+1;oldCounts.set(oldCanonical,oldCount);const oldHash=createHash('sha256').update(oldCanonical+'#'+oldCount).digest('hex');
  const mapped:any={};for(const key of Object.keys(fields))mapped[key]=original[map[key]]||'';
  const cell=map.date?row.getCell(headers.indexOf(map.date)+1):undefined;const effectiveDate=parseDate(cell?.value)||parseDate(mapped.date);const issues:string[]=[];
  if(!mapped.code.trim())issues.push('Falta código de contrato');
  if(!mapped.name.trim())issues.push('Falta nombre del cliente');
  if(!mapped.type.trim())issues.push('Falta tipo de archivo');
  if(!mapped.place.trim())issues.push('Falta ubicación');
  if(map.code&&typeof row.getCell(headers.indexOf(map.code)+1).value==='number')issues.push('Código numérico: revise la presentación; se conservan el valor y el formato de la celda, sin inventar ceros ausentes');
  if(!mapped.date)issues.push('Fecha vacía; se conserva sin fecha');else if(!effectiveDate)issues.push('Fecha incompleta o inválida; requiere revisión');
  if(norm(mapped.type)==='sindocumentos')issues.push('Sin documentos: indicador de ausencia, no crea un bloque');
  if(mapped.quantity!==''&&(!/^\d+$/.test(mapped.quantity)||Number(mapped.quantity)<1))issues.push('Cantidad inválida; no se deduce de observaciones');
  if(mapped.place&&!['Comercial','Operativo','Cliente','Reciclado'].includes(mapped.place))issues.push('Ubicación no reconocida');
  if(mapped.action==='Retirado'&&mapped.place!=='Cliente')issues.push('Contradicción entre Retirado y ubicación');
  if(mapped.action==='Recepción'&&mapped.place!=='Comercial')issues.push('Contradicción entre Recepción y ubicación');
  if(mapped.place==='Reciclado'&&mapped.action!=='Reciclaje')issues.push('Destino Reciclado requiere revisar la acción original');
  if(mapped.storage&&mapped.place!=='Comercial')issues.push('Almacenamiento comercial con ubicación diferente');
  if(count>1)issues.push('Fila idéntica repetida en esta hoja: revisar posible duplicado');
  const hashAliases=[...new Set([hash,oldHash])];const previous=existing.find(x=>hashAliases.includes(x.hash)||x.hashAliases?.some((alias:string)=>hashAliases.includes(alias)));const duplicate=!!previous&&!previous.pending;if(duplicate)issues.push('Ya importada: se omitirá sin duplicarla');
  rows.push({hash,hashAliases,original,originalCells,mapped,effectiveDate,issues,row:n,duplicate,mapping:map,sheet:sheet.name});
 });
 return {sheets:workbook.worksheets.map(x=>x.name),sheet:sheet.name,headers,mapping:map,fields,rows,summary:{total:rows.length,duplicates:rows.filter(x=>x.duplicate).length,withoutDate:rows.filter(x=>!x.effectiveDate).length}};
}

// Import rows as independent documents. Never infer a chain of movements from repeated codes.
export function registerImportedRows(state:any,rows:any[],account:string){
 const summary={registered:0,pending:0,skipped:0};
 for(const input of rows){
  if(!input.hash||!input.original)throw Error('Fila inválida');
  const hashes=new Set([input.hash,...(input.hashAliases||[])]);
  const old=state.legacy.find((r:any)=>hashes.has(r.hash)||r.hashAliases?.some((h:string)=>hashes.has(h)));
  if(old&&!old.pending){summary.skipped++;continue;}
  const registered=state.blocks.find((b:any)=>hashes.has(b.sourceImport?.rowHash));
  if(registered){if(old)Object.assign(old,{pending:false,blockId:registered.id,issues:[]});summary.skipped++;continue;}
  // A failed row must not leave orphan clients, codes or documents behind.
  const draft=structuredClone({...state,audit:[],requests:[],requestDigests:{},requestResults:{}});
  const row={...structuredClone(input),id:old?.id||randomUUID(),pending:true};
  try{
   const m:any={...input.mapped};
   // Revalidate server-side; do not trust preview issues supplied by the browser.
   const text=(v:any)=>String(v??'').trim();
   const code=text(m.code),name=text(m.name),place=text(m.place),action=text(m.action),storage=text(m.storage),effectiveDate=parseDate(input.originalCells?.[input.mapping?.date]?.value)||parseDate(m.date)||parseDate(input.effectiveDate);
   if(input.issues?.some((issue:string)=>issue.startsWith('Fila idéntica repetida')))throw Error('Fila idéntica repetida: revise antes de registrar');
   const codeCell=input.originalCells?.[input.mapping?.code]?.value;
   if(!code||!name||!effectiveDate||typeof codeCell==='number')throw Error('Complete código de texto, nombre y fecha válida');
   if(!['Comercial','Operativo','Cliente','Reciclado'].includes(place))throw Error('Ubicación no reconocida');
   if(action&&!['Recepción','Traslado','Retirado','Almacenado','Reciclaje','Reapertura'].includes(action))throw Error('Acción no reconocida');
   if(action==='Recepción'&&place!=='Comercial'||action==='Retirado'&&place!=='Cliente'||action==='Reciclaje'&&place!=='Reciclado'||place==='Reciclado'&&action!=='Reciclaje'||['Traslado','Almacenado','Reapertura'].includes(action)&&!['Comercial','Operativo'].includes(place))throw Error('Acción y ubicación contradictorias');
   if(storage&&place!=='Comercial')throw Error('Almacenamiento solo corresponde a Comercial');
   const find=(catalog:string,value:string)=>draft.catalogs[catalog].filter((x:any)=>x.active&&!x.deleted&&norm(x.name)===norm(value));
   const types=find('types',text(m.type));if(types.length!==1)throw Error('Tipo de archivo inexistente o ambiguo en el catálogo');
   const people=text(m.responsible)?find('responsible',text(m.responsible)):[];
   if(text(m.responsible)&&people.length!==1)throw Error('Responsable inexistente o ambiguo');
   if(storage&&find('storage',storage).length!==1)throw Error('Almacenamiento inexistente o ambiguo');
   const q=text(m.quantity)===''?null:Number(m.quantity);
   if(q!==null&&(!/^\d+$/.test(text(m.quantity))||!Number.isSafeInteger(q)||q<1))throw Error('Cantidad inválida');
   if(place==='Reciclado'&&!text(m.notes))throw Error('Indique el motivo de reciclaje en Nota');
   const sameCode=(a:string,b:string)=>a.trim().toUpperCase()===b.trim().toUpperCase();
   let c=draft.codes.find((x:any)=>sameCode(x.code,code));
   const linked=text(m.linkedCode||input.original['Código vinculado']);
   const target=linked?draft.codes.find((x:any)=>sameCode(x.code,linked)):null;
   if(c&&target&&c.clientId!==target.clientId)throw Error('Los códigos pertenecen a clientes diferentes; revise el vínculo');
   let client=draft.clients.find((x:any)=>x.id===(c?.clientId||target?.clientId));
   const names=name.split(/\r?\n|\s+y\s+/i).map((x:string)=>x.trim()).filter(Boolean);
   if(names.length>2)throw Error('Revise los nombres: se admiten hasta dos personas');
   if(client&&!client.namePending&&norm(client.name)!==norm(names.join(' y ')))throw Error('El nombre no coincide con el cliente del código; revise antes de importar');
   if(!client){client={id:randomUUID(),name:names.join(' y '),personNames:names};draft.clients.push(client);}
   else if(client.namePending){client.name=names.join(' y ');client.personNames=names;client.namePending=false;client.revision=(client.revision||0)+1;}
   if(!c){c={id:randomUUID(),clientId:client.id,code,current:!draft.codes.some((x:any)=>x.clientId===client.id&&x.current)};draft.codes.push(c);}
   if(linked&&!target&&!sameCode(linked,code))draft.codes.push({id:randomUUID(),clientId:client.id,code:linked,current:false});
   const block:any={id:randomUUID(),codeId:c.id,typeId:types[0].id,description:types[0].name,date:effectiveDate,notes:text(m.notes),deleted:false,revision:1,initialResponsible:people[0]?.id||null,sourceImport:{rowHash:row.hash,sheet:row.sheet,row:row.row,originalResponsible:text(m.responsible),originalAction:action,account}};
   // A documented reception is an actual initial event. Other rows are current snapshots.
   if(action==='Recepción'&&people.length===1){
    const signature=JSON.stringify([c.id,effectiveDate,people[0].id,storage,block.notes]);
    let event=draft.events.find((e:any)=>e.importBatchKey===input.batchKey&&e.importSignature===signature&&!e.deleted);
    if(!event){event={id:randomUUID(),action:'Recepción',date:effectiveDate,at:new Date().toISOString(),responsible:people[0].id,account,notes:block.notes,deliveredBy:'',lines:[],deleted:false,revision:1,importBatchKey:input.batchKey,importSignature:signature};draft.events.push(event);}
    event.lines.push({blockId:block.id,codeId:c.id,to:'Comercial',storage,quantity:q});
   }else block.openingBalance={place,storage,quantity:q};
   draft.blocks.push(block);row.pending=false;row.blockId=block.id;row.issues=[];row.registeredAt=new Date().toISOString();
   for(const key of ['clients','codes','blocks','events'])state[key]=draft[key];
   summary.registered++;
  }catch(error){row.issues=[error instanceof Error?error.message:'Revise la fila'];summary.pending++;}
  if(old)Object.assign(old,row);else state.legacy.push(row);
 }
 return summary;
}
