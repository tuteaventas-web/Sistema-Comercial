import ExcelJS from 'exceljs';
import {createHash} from 'node:crypto';
export const fields={code:'Código del cliente',name:'Nombre',date:'Fecha',type:'Tipo de archivo',place:'Ubicación',storage:'Ubicación en comercial',responsible:'Responsable',action:'Acción',notes:'Observación',description:'Descripción',quantity:'Cantidad'};
const norm=(v:string)=>v.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const aliases:any={code:['codigodelcliente','codigo','codigocliente'],name:['nombre','cliente','nombredelcliente'],date:['fecha','fechadeingreso'],type:['tipodearchivo','tipo'],place:['ubicacion'],storage:['ubicacionencomercial','almacenamiento'],responsible:['responsable'],action:['accion'],notes:['observacion','observaciones'],description:['descripcion'],quantity:['cantidad']};
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
  if(map.code&&typeof row.getCell(headers.indexOf(map.code)+1).value==='number')issues.push('Código numérico: revise la presentación; se conservan el valor y el formato de la celda, sin inventar ceros ausentes');
  if(!mapped.date)issues.push('Fecha vacía; se conserva sin fecha');else if(!effectiveDate)issues.push('Fecha incompleta o inválida; requiere revisión');
  if(norm(mapped.type)==='sindocumentos')issues.push('Sin documentos: indicador de ausencia, no crea un bloque');
  if(mapped.quantity!==''&&(!/^\d+$/.test(mapped.quantity)||Number(mapped.quantity)<1))issues.push('Cantidad inválida; no se deduce de observaciones');
  if(mapped.place&&!['Comercial','Operativo','Cliente','Reciclado'].includes(mapped.place))issues.push('Ubicación no reconocida');
  if(mapped.action==='Retirado'&&mapped.place!=='Cliente')issues.push('Contradicción entre Retirado y ubicación');
  if(mapped.place==='Reciclado'&&mapped.action!=='Reciclaje')issues.push('Destino Reciclado requiere revisar la acción original');
  if(mapped.storage&&mapped.place!=='Comercial')issues.push('Almacenamiento comercial con ubicación diferente');
  if(count>1)issues.push('Fila idéntica repetida en esta hoja: revisar posible duplicado');
  const hashAliases=[...new Set([hash,oldHash])];const duplicate=existing.some(x=>hashAliases.includes(x.hash)||x.hashAliases?.some((alias:string)=>hashAliases.includes(alias)));if(duplicate)issues.push('Ya importada: se omitirá sin duplicarla');
  issues.push('Agrupación no demostrada: conservar como legado hasta conciliación explícita');
  rows.push({hash,hashAliases,original,originalCells,mapped,effectiveDate,issues,row:n,duplicate,mapping:map,sheet:sheet.name});
 });
 return {sheets:workbook.worksheets.map(x=>x.name),sheet:sheet.name,headers,mapping:map,fields,rows,summary:{total:rows.length,duplicates:rows.filter(x=>x.duplicate).length,withoutDate:rows.filter(x=>!x.effectiveDate).length}};
}
