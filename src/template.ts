import ExcelJS from 'exceljs';
// Plantilla de carga masiva; las listas desplegables salen de los catálogos activos del sistema.
export async function bulkTemplate(catalogs:any){
const names=(k:string)=>catalogs[k].filter((x:any)=>!x.deleted&&x.active!==false).map((x:any)=>x.name);const types=names('types'),storage=names('storage'),resp=names('responsible');
const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet('Carga');
const cols=[['Código del cliente*',18],['Nombre persona 1*',28],['Nombre persona 2',28],['Vincular a otro código (opcional)',22],['Fecha de ingreso*',15],['Tipo de archivo*',30],['Cantidad',10],['Ubicación en comercial',22],['Responsable*',16],['Nota',40]];
ws.columns=cols.map(([h,w]:any)=>({header:h,width:w}));const h=ws.getRow(1);h.font={bold:true,color:{argb:'FFFFFFFF'}};h.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1F4E79'}};h.height=32;h.alignment={vertical:'middle',wrapText:true};
ws.views=[{state:'frozen',ySplit:1}];ws.autoFilter={from:'A1',to:'J1'};
const li=wb.addWorksheet('Listas');[types,storage,resp].forEach((v:string[],i:number)=>v.forEach((x:string,j:number)=>li.getCell(j+1,i+1).value=x));li.state='veryHidden';
const L=(c:string,n:number)=>`Listas!$${c}$1:$${c}$${n}`;
for(let r=2;r<=3000;r++){const g=(k:number)=>ws.getCell(r,k);g(1).numFmt='@';g(4).numFmt='@';g(5).numFmt='dd/mm/yyyy';
 g(5).dataValidation={type:'date',operator:'greaterThan',formulae:[new Date('2000-01-01')],allowBlank:true,showErrorMessage:true,error:'Fecha inválida (dd/mm/aaaa)'};
 g(6).dataValidation={type:'list',formulae:[L('A',types.length)],allowBlank:true,showErrorMessage:true,error:'Elija un tipo de la lista'};
 g(7).dataValidation={type:'whole',operator:'greaterThan',formulae:[0],allowBlank:true,showErrorMessage:true,error:'Entero mayor a 0'};
 g(8).dataValidation={type:'list',formulae:[L('B',storage.length)],allowBlank:true,showErrorMessage:true,error:'Elija de la lista'};
 g(9).dataValidation={type:'list',formulae:[L('C',resp.length)],allowBlank:true,showErrorMessage:true,error:'Elija un responsable de la lista'};}
const d=new Date('2026-10-15T12:00:00Z');
[['EJ-0001','María Pérez','','',d,types[1]??types[0],1,storage[0]??'',resp[0]??'','Ejemplo – borrar'],
 ['EJ-0001','María Pérez','','',d,types[3]??types[0],40,storage[0]??'',resp[0]??'','Ejemplo – mismo cliente, otro documento'],
 ['EJ-0002','','','EJ-0001',d,types[2]??types[0],1,storage[0]??'',resp[1]??resp[0]??'','Ejemplo – segundo contrato de María']].forEach((v:any[])=>{const r=ws.addRow(v);r.font={italic:true,color:{argb:'FF808080'}};});
const ins=wb.addWorksheet('Instrucciones');ins.getColumn(1).width=115;
['CÓMO LLENAR LA HOJA "Carga" (todo en una sola hoja; puede ordenar y filtrar libremente)','',
'• Una fila = un bloque de documentos recibido. Si un cliente tiene varios documentos, repita su código en varias filas.',
'• Código del cliente*: formato texto (conserva ceros a la izquierda).',
'• Nombre persona 1* / 2: basta con escribirlos en UNA de las filas del código; si los repite deben coincidir.',
'• Vincular a otro código (opcional): si este código es un segundo contrato del MISMO cliente, escriba aquí el código ya existente (en esta hoja o en el sistema). No se crea cliente nuevo y los nombres pueden ir vacíos.',
'• Fecha de ingreso* (dd/mm/aaaa), Tipo de archivo*, Responsable*: obligatorios para registrar el documento.',
'• Si solo quiere dar de alta el cliente sin documentos, deje vacías las columnas de Fecha a Responsable.',
'• Cantidad: entero mayor a 0 o vacío. Tipo, Ubicación y Responsable: elegir de la lista desplegable.',
'• Nota: detalle del documento (ej. "anillado", "2 copias"); como en el sistema, el nombre del documento es su tipo. Si la fila no tiene documento, es nota del cliente.',
'• Las filas de ejemplo con código EJ-… se ignoran. No cambie los encabezados.',
'• Se valida todo el archivo antes de cargar: con un solo error no se carga nada y se devuelve la lista de filas a corregir.'
].forEach((t:string,i:number)=>{const c=ins.getCell(i+1,1);c.value=t;c.alignment={wrapText:true};if(!i)c.font={bold:true,size:13};});
return Buffer.from(await wb.xlsx.writeBuffer());
}
