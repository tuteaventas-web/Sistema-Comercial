import {editHistory} from '../src/edit-history.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {initial,operate,balances,id} from '../src/domain.ts';
import {filterBlocks,filterEvents} from '../public/query.js';
import {previewImport} from '../src/imports.ts';
import ExcelJS from 'exceljs';
import {auditHTML} from '../public/audit.js';

function fixture(){
 const state:any=initial();
 const run=(kind:string,data:any,key=id())=>operate(state,{kind,data,key});
 run('client',{name:'Cliente de prueba DOM',code:'0001-DOM'});
 run('client',{name:'Otro cliente DOM',code:'0002-DOM'});
 const responsible=state.catalogs.responsible[1].id;
 run('receive',{codeId:state.codes[0].id,date:'2026-10-14',responsible,blocks:[{typeId:state.catalogs.types[3].id,description:'Encuestas originales',quantity:300}]});
 return {state,run,responsible};
}

async function ui(options:{admin?:boolean,advisor?:boolean,unsupportedReorder?:boolean,interleave?:boolean,confirm?:boolean}={}){
 const f=fixture();const requests:any[]=[];const errors:string[]=[];const printed:string[]=[];const confirms:string[]=[];
 let admin=options.advisor?false:options.admin!==false;let canEdit=admin||!!options.advisor;let advisors=[{username:'evelyn',name:'Evelyn',active:true}];
 const dom=new JSDOM(readFileSync(new URL('../public/index.html',import.meta.url),'utf8'),{url:'http://192.168.1.20:3000',runScripts:'outside-only'});
 const w=dom.window;const doc=w.document;
 (w as any).__query={filterBlocks,filterEvents,auditHTML};
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 w.confirm=(message?:string)=>{confirms.push(String(message));return options.confirm===true;};
 w.alert=(message?:any)=>{errors.push(String(message));};w.prompt=()=> '3';w.print=()=>{printed.push(doc.querySelector('.print-only')?.textContent||'');};
 (w.URL as any).createObjectURL=()=> 'blob:prueba';(w.URL as any).revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){};
 w.fetch=(async(path:any,init:any={})=>{
  const data=init.body?JSON.parse(init.body):undefined;requests.push({path:String(path),data});
  try{
   let value:any;
   if(path==='/api/session')value={admin,canEdit,account:canEdit&&!admin?'Evelyn (evelyn)':undefined,database:true,capabilities:{blockInitialFields:true,customerPeople:true}};
   else if(path==='/api/deleted')value={blocks:f.state.blocks.filter((b:any)=>b.deleted),events:f.state.events.filter((e:any)=>e.deleted)};
   else if(path==='/api/data')value={...f.state,editHistory:editHistory(f.state,new Set(f.state.blocks.map((b:any)=>b.id))),audit:admin?f.state.audit:undefined,defaults:f.state.defaults,blocks:f.state.blocks.filter((b:any)=>!b.deleted).map((b:any)=>({...b,balances:balances(f.state,b.id)})),events:f.state.events.filter((e:any)=>!e.deleted)};
   else if(path==='/api/advisors')value={accounts:advisors};else if(path==='/api/advisors/credential')value={password:'Contraseña de prueba 123'};else if(path==='/api/advisors/delete'){if(data.deletePassword!=='1608')throw Error('Contraseña incorrecta');advisors=advisors.filter(a=>a.username!==data.username);value={ok:true};}
   else if(path==='/api/operate'){
    if(options.unsupportedReorder&&data.kind==='catalogReorder')throw Error('Operación desconocida');
    if(data.kind==='catalogDelete'){if(data.data.deletePassword!=='1608')throw Error('Contraseña incorrecta');delete data.data.deletePassword;}value=f.run(data.kind,data.data,data.key);
    if(options.interleave&&data.kind==='receive')f.run('receive',{codeId:f.state.codes[1].id,date:'2026-10-15',responsible:f.responsible,blocks:[{typeId:f.state.catalogs.types[0].id,description:'Movimiento de OTRA PESTAÑA',quantity:9}]});
   }else if(path==='/api/import-preview')value=await previewImport(data.base64,data.sheet,data.mapping,f.state.legacy);
   else if(path==='/api/operation-preview'){
    const draft=structuredClone(f.state);operate(draft,data);value={ok:true,affected:draft.blocks.map((b:any)=>({id:b.id,description:b.description,before:balances(f.state,b.id),after:balances(draft,b.id)}))};
   }else if(path==='/api/login'){admin=data.role==='admin';canEdit=true;value={ok:true,admin,canEdit:true};}
   else if(path==='/api/logout'){admin=false;canEdit=false;value={ok:true};}
   else if(String(path).startsWith('/api/export?'))return {ok:true,blob:async()=>new w.Blob(['excel'])};else throw Error('Ruta no simulada: '+path);
   return {ok:true,status:200,json:async()=>structuredClone(value)};
  }catch(error){return {ok:false,status:(error as any).code==='STALE_REVISION'?409:400,json:async()=>({error:(error as Error).message,code:(error as any).code})};}
 }) as any;
 w.eval(readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace("import {filterBlocks,filterEvents} from './query.js';","const {filterBlocks,filterEvents}=globalThis.__query;").replace("import {auditHTML} from './audit.js';","const {auditHTML}=globalThis.__query;"));
 async function waitFor(condition:()=>boolean){for(let i=0;i<100;i++){if(condition())return;await new Promise(r=>setTimeout(r,5));}assert.ok(condition(),'La interfaz no llegó al estado esperado; '+errors.join('; '));}
 await waitFor(()=>!!doc.querySelector('#search'));
 const pick=(selector:string,value:string)=>{const el=doc.querySelector(selector==='[name=quantity]'?'#form [name=quantity]:not(:disabled)':selector.startsWith('[name=')?'#form '+selector:selector) as HTMLInputElement;assert.ok(el,selector);el.value=value;el.dispatchEvent(new w.Event('change',{bubbles:true}));el.dispatchEvent(new w.Event('input',{bubbles:true}));};
 const click=(selector:string)=>{const el=doc.querySelector(selector) as HTMLElement;assert.ok(el,selector);el.click();};
 const submit=(print=false)=>{const form=doc.querySelector('#form') as HTMLFormElement;assert.ok(form.checkValidity(),'El formulario contiene un campo requerido inválido: '+[...form.elements].filter((e:any)=>e.validity&&!e.validity.valid).map((e:any)=>e.name).join(', '));const button=form.querySelector(print?'[data-print=true]':'button[type=submit]') as HTMLElement;assert.ok(button);button.click();};
 return {...f,dom,w,doc,requests,errors,printed,confirms,waitFor,pick,click,submit};
}

test('DOM: consulta pública busca por código y no ofrece escritura',async()=>{
 const app=await ui({admin:false});try{app.pick('#search','0001-DOM');assert.equal(app.doc.querySelectorAll('.card').length,1);assert.equal(app.doc.querySelector('#receive'),null);assert.equal(app.doc.querySelector('[data-edit]'),null);app.pick('#search','no existe');assert.match(app.doc.querySelector('#results')!.textContent!,/No hay archivos/);}finally{app.dom.window.close();}
});

test('DOM: ingreso no solicita impresión y el resumen imprime su propio movimiento',async()=>{
 const app=await ui({interleave:true});try{
  app.click('#receive');app.pick('#receipt-search','0001');app.click(`[data-receipt-code="${app.state.codes[0].id}"]`);app.pick('[name=responsible]',app.responsible);app.pick('[name=typeId]',app.state.catalogs.types[3].id);app.pick('[name=description]','Resumen propio');app.pick('[name=quantity]','20');
  app.submit();await app.waitFor(()=>!app.doc.querySelector('#modal')!.hasAttribute('open'));assert.equal(app.printed.length,0);assert.ok(!app.confirms.some(x=>x.includes('¿Imprimir')));const event=app.state.events.find((e:any)=>e.lines.some((l:any)=>app.state.blocks.find((b:any)=>b.id===l.blockId)?.description==='Resumen propio'));app.click('[data-view=history]');app.click('#movement-history');app.click(`[data-reprint="${event.id}"]`);await app.waitFor(()=>app.printed.length===1);assert.match(app.printed[0],/0001-DOM/);assert.match(app.printed[0],/Cantidad: 20/);assert.doesNotMatch(app.printed[0],/OTRA PESTAÑA|0002-DOM/);assert.equal(app.errors.length,0);
 }finally{app.dom.window.close();}
});

test('DOM: traslado parcial y entrega ocultan campos irrelevantes y conservan saldos',async()=>{
 const app=await ui();try{
  app.click('[data-view=history]');app.click('#move');app.pick('[name=action]','Traslado');assert.equal((app.doc.querySelector('[name=responsible]') as HTMLInputElement).value,app.responsible);app.pick('[name=pick]','0');(app.doc.querySelector('[name=pick]') as HTMLInputElement).checked=true;app.pick('#qty-0','100');app.submit();await app.waitFor(()=>app.state.events.length===2);assert.deepEqual(balances(app.state,app.state.blocks[0].id).map(x=>x.quantity),[200,100]);await app.waitFor(()=>!app.doc.querySelector('#modal')!.hasAttribute('open'));
  app.click('[data-view=history]');app.click('#move');app.pick('[name=action]','Retirado');assert.equal((app.doc.querySelector('[name=to]') as HTMLInputElement).disabled,true);assert.equal(app.doc.querySelector('[name=deliveredBy]'),null);app.pick('[name=responsible]',app.responsible);(app.doc.querySelector('[name=pick]') as HTMLInputElement).checked=true;app.pick('#qty-0','50');app.submit();await app.waitFor(()=>app.state.events.length===3);assert.equal(balances(app.state,app.state.blocks[0].id).find(x=>x.place==='Cliente').quantity,50);assert.equal(app.errors.length,0);
 }finally{app.dom.window.close();}
});

test('DOM: corrección bloqueada muestra error y cancelar eliminación no escribe',async()=>{
 const app=await ui({confirm:true});try{
  app.run('move',{action:'Traslado',date:'2026-10-15',responsible:app.responsible,lines:[{blockId:app.state.blocks[0].id,from:'Comercial',to:'Operativo',quantity:100}]});
  // Recargar por el flujo real de consulta tras una sesión nueva.
  app.click('#session');await app.waitFor(()=>app.doc.querySelector('#session')!.textContent==='Iniciar sesión');app.click('#session');app.pick('[name=role]','admin');app.pick('[name=password]','contraseña de prueba DOM');app.submit();await app.waitFor(()=>!!app.doc.querySelector('#receive'));
  app.click('[data-history]');app.click(`[data-correct="${app.state.events[0].id}"]`);app.pick('.correction-line [name=quantity]','90');app.pick('[name=reason]','Corregir cantidad errónea');app.submit();await app.waitFor(()=>!app.doc.querySelector('#form-error')!.hasAttribute('hidden'));assert.match(app.doc.querySelector('#form-error')!.textContent!,/saldo|Cantidad/);assert.equal(app.state.events[0].lines[0].quantity,300);
  app.w.confirm=()=>false;app.click('#close');const before=app.requests.filter(x=>x.path==='/api/operate').length;app.click('[data-delete-block]');assert.equal(app.requests.filter(x=>x.path==='/api/operate').length,before);
 }finally{app.dom.window.close();}
});

test('DOM: tarjeta abre historial con identidad del cliente sin botón de ficha',async()=>{
 const app=await ui();try{assert.equal(app.doc.querySelector('.card [data-client]'),null);assert.equal(app.doc.querySelector('.card .card-event-trail'),null);app.click('[data-history]');assert.match(app.doc.querySelector('#modal-content')!.textContent!,/Cliente de prueba DOM/);assert.match(app.doc.querySelector('#modal-content')!.textContent!,/Ingreso inicial/);assert.doesNotMatch(app.doc.querySelector('#modal-content')!.textContent!,/Otro cliente DOM/);}finally{app.dom.window.close();}
});

test('DOM: cambiar mapeo impide confirmar hasta volver a validar el XLSX',async()=>{
 const app=await ui();try{
  const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('Datos');sheet.addRow(['CÓDIGO DEL CLIENTE','FECHA','OBSERVACIÓN','NOTA EXTRA']);sheet.addRow(['0001-DOM','','Original','Revisada']);const bytes=Buffer.from(await book.xlsx.writeBuffer());
  app.click('[data-view=admin]');app.click('#import');const input=app.doc.querySelector('#file') as HTMLInputElement;Object.defineProperty(input,'files',{value:[new app.w.File([Uint8Array.from(bytes).buffer],'prueba.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})]});input.dispatchEvent(new app.w.Event('change'));await app.waitFor(()=>!!app.doc.querySelector('#confirm-import'));
  app.pick('[data-map=notes]','NOTA EXTRA');assert.equal((app.doc.querySelector('#confirm-import') as HTMLButtonElement).disabled,true);app.click('#confirm-import');assert.equal(app.state.legacy.length,0);app.click('#validate-import');await app.waitFor(()=>!(app.doc.querySelector('#confirm-import') as HTMLButtonElement).disabled);app.click('#confirm-import');await app.waitFor(()=>app.state.legacy.length===1);assert.equal(app.state.legacy[0].mapping.notes,'NOTA EXTRA');assert.equal(app.state.blocks.length,1);assert.equal(app.errors.length,0);
 }finally{app.dom.window.close();}
});

test('DOM: desactivar responsable conserva filtros e historial y muestra antes/después',async()=>{
 const app=await ui();try{
  app.click('[data-view=admin]');app.click(`[data-cat=responsible][data-id="${app.responsible}"]`);app.pick('[name=name]','Responsable corregida');app.pick('[name=reason]','Corrección y baja de prueba');app.pick('[name=active]','false');app.submit();await app.waitFor(()=>app.state.catalogs.responsible.find((x:any)=>x.id===app.responsible).active===false);await app.waitFor(()=>!app.doc.querySelector('#modal')!.hasAttribute('open'));
  const audit=app.doc.querySelector('[data-audit]')!;assert.match(audit.textContent!,/Antes/);assert.match(audit.textContent!,/Después/);assert.match(audit.textContent!,/Evelyn/);assert.match(audit.textContent!,/Responsable corregida/);
  app.click('[data-view=history]');app.click('#movement-history');assert.ok(app.doc.querySelector(`#responsible option[value="${app.responsible}"]`));assert.match(app.doc.querySelector('#results')!.textContent!,/Responsable corregida/);app.click('[data-view=legacy]');app.click('[data-view=history]');app.click('#move');assert.equal(app.doc.querySelector(`[name=responsible] option[value="${app.responsible}"]`),null);
 }finally{app.dom.window.close();}
});

test('DOM: fallo y cancelación de impresión no deshacen ni repiten el ingreso',async()=>{
 const app=await ui();try{
  app.w.print=()=>{throw Error('Impresión no disponible');};app.click('#receive');app.pick('#receipt-search','0001');app.click(`[data-receipt-code="${app.state.codes[0].id}"]`);app.pick('[name=responsible]',app.responsible);app.pick('[name=typeId]',app.state.catalogs.types[0].id);app.pick('[name=description]','Ingreso que debe persistir');app.pick('[name=quantity]','5');app.submit();await app.waitFor(()=>!app.doc.querySelector('#modal')!.hasAttribute('open'));assert.equal(app.printed.length,0);app.click('[data-print]');await app.waitFor(()=>app.doc.querySelector('#notice')!.textContent!.includes('registro sigue guardado'));assert.equal(app.state.events.length,2);assert.equal(app.requests.filter(x=>x.path==='/api/operate').length,1);assert.equal(app.errors.length,0);
  app.w.prompt=()=>null;const block=app.state.blocks.find((b:any)=>b.description==='Ingreso que debe persistir');app.click(`[data-print="${block.id}"]`);assert.equal(app.state.events.length,2);assert.equal(app.requests.filter(x=>x.path==='/api/operate').length,1);
 }finally{app.dom.window.close();}
});

test('DOM: edición desactualizada ofrece cargar los cambios vigentes sin sobrescribirlos',async()=>{
 const app=await ui({confirm:true});try{
  app.click('[data-edit]');app.pick('[name=description]','Texto obsoleto');app.pick('[name=reason]','Error de captura');const b=app.state.blocks[0];app.run('editBlock',{id:b.id,description:'Cambio de la otra pestaña',reason:'Actualización externa'});app.submit();await app.waitFor(()=>!!app.doc.querySelector('#reload-conflict'));assert.equal(app.state.blocks[0].description,'Cambio de la otra pestaña');assert.match(app.doc.querySelector('#form-error')!.textContent!,/cambió desde/);app.click('#reload-conflict');await app.waitFor(()=>app.doc.querySelector('#results')!.textContent!.includes('Cambio de la otra pestaña'));assert.equal(app.doc.querySelector('#modal')!.hasAttribute('open'),false);
 }finally{app.dom.window.close();}
});

test('DOM: baja lógica puede restaurarse desde la administración sin duplicar la recepción',async()=>{
 const app=await ui({confirm:true});try{
  app.w.prompt=()=> 'Registro eliminado por error';app.click('[data-delete-block]');await app.waitFor(()=>app.state.blocks[0].deleted===true);app.click('[data-view=admin]');app.click('#trash');await app.waitFor(()=>!!app.doc.querySelector('[data-restore-block]'));app.click('[data-restore-block]');app.pick('[name=reason]','Ingreso físico comprobado');app.submit();await app.waitFor(()=>app.state.blocks[0].deleted===false);assert.equal(app.state.events.length,1);assert.equal(balances(app.state,app.state.blocks[0].id)[0].quantity,300);assert.ok(app.state.audit.some((x:any)=>x.kind==='restoreBlock'));assert.equal(app.errors.length,0);
 }finally{app.dom.window.close();}
});

test('DOM: archivo XLSX inválido retira la confirmación de la vista previa anterior',async()=>{
 const app=await ui();try{
  const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('Datos');sheet.addRow(['CÓDIGO DEL CLIENTE']);sheet.addRow(['0001-DOM']);const valid=Buffer.from(await book.xlsx.writeBuffer());app.click('[data-view=admin]');app.click('#import');const input=app.doc.querySelector('#file') as HTMLInputElement;
  const select=(bytes:Buffer)=>{Object.defineProperty(input,'files',{value:[new app.w.File([Uint8Array.from(bytes).buffer],'prueba.xlsx')],configurable:true});input.dispatchEvent(new app.w.Event('change'));};select(valid);await app.waitFor(()=>!!app.doc.querySelector('#confirm-import'));select(Buffer.from('Archivo dañado'));await app.waitFor(()=>app.errors.length===1);assert.equal(app.doc.querySelector('#confirm-import'),null);assert.match(app.errors[0],/No se pudo leer el archivo XLSX/);assert.equal(app.state.legacy.length,0);
 }finally{app.dom.window.close();}
});


test('DOM: filtros se conservan al actualizar y los indicadores permiten filtrar y limpiar',async()=>{
 const app=await ui();try{
  app.pick('#search','0001-DOM');app.click('[data-place="Comercial"]');
  assert.equal(app.doc.querySelector('[data-place="Comercial"]')!.getAttribute('aria-pressed'),'true');
  const before=app.requests.length;app.click('#refresh');await app.waitFor(()=>app.requests.length>before&&app.doc.querySelector('#notice')!.textContent==='');
  assert.equal((app.doc.querySelector('#search') as HTMLInputElement).value,'0001-DOM');
  assert.equal((app.doc.querySelector('#place') as HTMLSelectElement).value,'Comercial');
  assert.match(app.doc.querySelector('#result-count')!.textContent!,/1 registros · 1 bloque/);
  app.click('#reset-filters');assert.equal((app.doc.querySelector('#search') as HTMLInputElement).value,'');assert.equal(app.doc.activeElement?.id,'search');
  app.click('[data-view="history"]');assert.equal(app.doc.querySelector('[aria-current="page"]')!.getAttribute('data-view'),'history');assert.match(app.doc.querySelector('#view-title')!.textContent!,/Movimientos/);
  app.click('#movement-history');app.click('[data-correct]');assert.equal(app.doc.querySelector('#modal h2')!.id,'dialog-title');
 }finally{app.dom.window.close();}
});

test('DOM: asesor puede registrar y editar, sin eliminar ni administrar',async()=>{
 const app=await ui({advisor:true});try{assert.ok(app.doc.querySelector('#receive'));assert.ok(app.doc.querySelector('[data-edit]'));assert.equal(app.doc.querySelector('[data-delete-block]'),null);assert.match(app.doc.querySelector('#access-badge')!.textContent!,/Evelyn/);app.click('[data-view=admin]');assert.equal(app.doc.querySelector('#new-client'),null);}finally{app.dom.window.close();}
});
test('DOM: búsqueda de ingreso por nombre y código permite crear un cliente sin salir',async()=>{
 const app=await ui({advisor:true});try{
  app.click('#receive');app.pick('#receipt-search','0001');assert.match(app.doc.querySelector('#receipt-options')!.textContent!,/Cliente de prueba DOM/);app.pick('#receipt-search','Otro cliente');assert.doesNotMatch(app.doc.querySelector('#receipt-options')!.textContent!,/0001-DOM/);
  app.pick('#receipt-search','0099-NUEVO');assert.match(app.doc.querySelector('#receipt-search-status')!.textContent!,/No se encontró/);app.click('#add-receipt-client');app.pick('[name=newCode]','0099-NUEVO');app.pick('[name=newName]','Cliente agregado desde ingreso');app.pick('[name=responsible]',app.responsible);app.pick('[name=typeId]',app.state.catalogs.types[0].id);app.pick('[name=description]','Archivo del nuevo cliente');app.pick('[name=quantity]','4');app.submit();await app.waitFor(()=>app.state.blocks.length===2);assert.ok(app.state.codes.some((c:any)=>c.code==='0099-NUEVO'));assert.equal(app.state.clients.length,3);assert.equal(app.errors.length,0);
 }finally{app.dom.window.close();}
});
test('DOM: búsqueda en traslado y reciclaje oculta y desmarca bloques ajenos',async()=>{
 const app=await ui();try{
  app.click('[data-view=history]');app.click('#move');assert.match(app.doc.querySelector('#dialog-title')!.textContent!,/Registrar destino/);app.pick('#transfer-search','0001-DOM');assert.equal(app.doc.querySelector('.transfer-item')!.hasAttribute('hidden'),false);(app.doc.querySelector('[name=pick]') as HTMLInputElement).checked=true;app.pick('#transfer-search','Otro cliente');assert.equal((app.doc.querySelector('[name=pick]') as HTMLInputElement).checked,false);assert.equal((app.doc.querySelector('[name=pick]') as HTMLInputElement).disabled,true);app.pick('[name=action]','Reciclaje');app.pick('#transfer-search','Cliente de prueba');assert.equal(app.doc.querySelector('.transfer-item')!.hasAttribute('hidden'),false);
 }finally{app.dom.window.close();}
});
test('DOM: descarga exige rango válido y lo envía al Excel conservando búsqueda',async()=>{
 const app=await ui({admin:false});try{
  app.pick('#search','0001-DOM');app.click('#export');app.pick('[name=exportStart]','2026-10-16');app.pick('[name=exportEnd]','2026-10-14');app.submit();await app.waitFor(()=>!app.doc.querySelector('#form-error')!.hasAttribute('hidden'));assert.equal(app.requests.filter(x=>x.path.startsWith('/api/export?')).length,0);app.pick('[name=exportStart]','2026-10-14');app.pick('[name=exportEnd]','2026-10-15');app.submit();await app.waitFor(()=>app.requests.some(x=>x.path.startsWith('/api/export?')));const q=new URL(app.requests.find(x=>x.path.startsWith('/api/export?'))!.path,'http://localhost').searchParams;assert.equal(q.get('start'),'2026-10-14');assert.equal(q.get('end'),'2026-10-15');assert.equal(q.get('q'),'0001-DOM');
 }finally{app.dom.window.close();}
});
test('DOM: fecha efectiva más reciente aparece al inicio y la ubicación tiene color propio',async()=>{
 const app=await ui();try{app.run('move',{action:'Traslado',date:'2026-10-15',responsible:app.responsible,lines:[{blockId:app.state.blocks[0].id,from:'Comercial',to:'Operativo',quantity:10}]});app.click('#refresh');await app.waitFor(()=>!!app.doc.querySelector('.card .location-operativo'));assert.match(app.doc.querySelector('.card')!.firstElementChild!.textContent!,/15\/10\/2026/);assert.ok(app.doc.querySelector('.location-comercial'));}finally{app.dom.window.close();}
});

test('DOM: código nuevo puede vincularse al cliente existente sin duplicarlo',async()=>{
 const app=await ui({advisor:true});try{
  app.click('#receive');app.pick('#receipt-search','0001');app.click(`[data-receipt-code="${app.state.codes[0].id}"]`);app.click('#link-receipt-code');app.pick('[name=newCode]','0033-DOM');app.pick('[name=responsible]',app.responsible);app.pick('[name=typeId]',app.state.catalogs.types[0].id);app.pick('[name=description]','Contrato adicional');app.pick('[name=quantity]','3');app.submit();await app.waitFor(()=>app.state.blocks.length===2);assert.equal(app.state.clients.length,2);const code=app.state.codes.find((c:any)=>c.code==='0033-DOM');assert.equal(code.clientId,app.state.clients[0].id);assert.ok(app.state.blocks.some((b:any)=>b.codeId===code.id));assert.equal(app.doc.querySelector('#modal')!.hasAttribute('open'),false);
 }finally{app.dom.window.close();}
});

test('DOM: Cliente es un solo autocompletado accesible con selección por teclado',async()=>{
 const app=await ui();try{
  assert.match(app.doc.querySelector('#receive')!.textContent!,/Ingresar documento/);app.click('#receive');assert.equal(app.doc.querySelector('#dialog-title')!.textContent,'Ingresar documento');assert.equal(app.doc.querySelector('select[name=codeId]'),null);
  app.pick('#receipt-search','Cli');const search=app.doc.querySelector('#receipt-search') as HTMLInputElement;assert.equal(search.getAttribute('aria-expanded'),'true');search.dispatchEvent(new app.w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));assert.ok(search.getAttribute('aria-activedescendant'));search.dispatchEvent(new app.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.equal(search.getAttribute('aria-expanded'),'false');assert.equal((app.doc.querySelector('[name=codeId]') as HTMLInputElement).value,app.state.codes[0].id);assert.equal(search.checkValidity(),true);
  app.pick('#receipt-search','Otro');assert.equal((app.doc.querySelector('[name=codeId]') as HTMLInputElement).value,'');assert.equal(search.checkValidity(),false);app.click(`[data-receipt-code="${app.state.codes[1].id}"]`);assert.equal(search.checkValidity(),true);assert.equal((app.doc.querySelector('[name=codeId]') as HTMLInputElement).value,app.state.codes[1].id);
 }finally{app.dom.window.close();}
});
test('DOM: crear cliente parte de la búsqueda y cancelar no modifica datos',async()=>{
 const app=await ui();try{app.click('#receive');app.pick('#receipt-search','Jesús nuevo');app.click('#add-receipt-client');assert.equal((app.doc.querySelector('[name=newName]') as HTMLInputElement).value,'Jesús nuevo');assert.equal(app.doc.querySelector('#receipt-new')!.hasAttribute('hidden'),false);app.click('#cancel-receipt-client');assert.equal(app.state.clients.length,2);assert.equal(app.state.blocks.length,1);assert.equal(app.requests.filter(x=>x.path==='/api/operate').length,0);assert.equal(app.doc.querySelector('#receipt-new')!.hasAttribute('hidden'),true);}finally{app.dom.window.close();}
});

test('DOM: vínculo opcional solo se muestra al marcarlo y no duplica al cliente',async()=>{
 const app=await ui({advisor:true});try{
  app.click('#receive');app.pick('#receipt-search','Nuevo contrato');app.click('#add-receipt-client');const toggle=app.doc.querySelector('#receipt-link-toggle') as HTMLInputElement;const code=app.doc.querySelector('[name=linkExistingCode]') as HTMLSelectElement;
  assert.equal(toggle.checked,false);assert.equal(app.doc.querySelector('#receipt-link-fields')!.hasAttribute('hidden'),true);assert.equal(code.disabled,true);
  app.click('#receipt-link-toggle');assert.equal(app.doc.querySelector('#receipt-link-fields')!.hasAttribute('hidden'),false);assert.equal(code.required,true);app.pick('[name=linkExistingCode]',app.state.codes[0].id);
  app.click('#receipt-link-toggle');assert.equal(code.disabled,true);assert.equal((app.doc.querySelector('[name=existingClient]') as HTMLInputElement).value,'');assert.equal((app.doc.querySelector('[name=newName]') as HTMLInputElement).disabled,false);
  app.click('#receipt-link-toggle');app.pick('[name=linkExistingCode]',app.state.codes[0].id);app.pick('[name=newCode]','OPCIONAL-123');app.pick('[name=responsible]',app.responsible);app.pick('[name=typeId]',app.state.catalogs.types[0].id);app.pick('[name=description]','Vínculo opcional');app.pick('[name=quantity]','2');app.submit();await app.waitFor(()=>app.state.blocks.length===2);assert.equal(app.state.clients.length,2);assert.equal(app.state.codes.find((c:any)=>c.code==='OPCIONAL-123').clientId,app.state.clients[0].id);
 }finally{app.dom.window.close();}
});

test('DOM: alta sugiere nombres similares con sus códigos y vincula solo al seleccionarlos',async()=>{
 const app=await ui({advisor:true});try{
  app.click('#receive');app.pick('#receipt-search','Cliente de prueva DOM');app.click('#add-receipt-client');const panel=app.doc.querySelector('#receipt-similar')!;assert.match(panel.textContent!,/Cliente de prueba DOM/);assert.match(panel.textContent!,/0001-DOM/);assert.equal((app.doc.querySelector('[name=existingClient]') as HTMLInputElement).value,'');
  app.click(`#receipt-similar [data-similar-client="${app.state.clients[0].id}"]`);assert.equal((app.doc.querySelector('[name=existingClient]') as HTMLInputElement).value,app.state.clients[0].id);app.pick('[name=newCode]','SIMILAR-001');app.pick('[name=responsible]',app.responsible);app.pick('[name=typeId]',app.state.catalogs.types[0].id);app.pick('[name=description]','Contrato del mismo cliente');app.pick('[name=quantity]','3');app.submit();await app.waitFor(()=>app.state.blocks.length===2);assert.equal(app.state.clients.length,2);assert.equal(app.state.codes.find((c:any)=>c.code==='SIMILAR-001').clientId,app.state.clients[0].id);
 }finally{app.dom.window.close();}
});
test('DOM: agregar cliente muestra coincidencias y cambiar el nombre retira el vínculo',async()=>{
 const app=await ui();try{
  app.click('[data-view=admin]');app.click('#new-client');app.pick('[name=name]','CLIENTE de PRUÉBA DOM');assert.match(app.doc.querySelector('#admin-client-similar')!.textContent!,/0001-DOM/);app.click(`#admin-client-similar [data-similar-client="${app.state.clients[0].id}"]`);assert.equal((app.doc.querySelector('[name=existingClient]') as HTMLInputElement).value,app.state.clients[0].id);app.pick('[name=name]','Nombre completamente distinto');assert.equal((app.doc.querySelector('[name=existingClient]') as HTMLInputElement).value,'');assert.equal(app.doc.querySelector('[data-similar-client]'),null);
 }finally{app.dom.window.close();}
});

test('DOM: traslado se registra desde Movimientos y no se duplica en Archivos',async()=>{
 const app=await ui();try{assert.equal(app.doc.querySelector('[data-view=consulta]'),null);assert.equal(app.doc.querySelector('[data-move]'),null);app.click('[data-view=history]');assert.ok(app.doc.querySelector('#move'));app.click('#move');assert.match(app.doc.querySelector('#dialog-title')!.textContent!,/Registrar destino/);}finally{app.dom.window.close();}
});

test('DOM: Movimientos inicia seleccionado sin opción Archivos y conserva consulta e historial',async()=>{
 const app=await ui();try{
  assert.equal(app.doc.querySelector('[data-view=consulta]'),null);assert.equal(app.doc.querySelectorAll('nav [data-view]').length,3);assert.equal(app.doc.querySelector('nav [aria-current=page]')!.getAttribute('data-view'),'history');assert.equal(app.doc.querySelector('#view-title')!.textContent,'Movimientos');assert.equal(app.doc.querySelector('#overview-movements'),null);
  assert.equal(app.doc.querySelectorAll('.card').length,1);app.click('#movement-history');assert.ok(app.doc.querySelector('[data-reprint]'));app.click('#movement-current');assert.equal(app.doc.querySelectorAll('.card').length,1);assert.ok(app.doc.querySelector('#receive'));assert.ok(app.doc.querySelector('#move'));
 }finally{app.dom.window.close();}
});

test('DOM: resumen impreso presenta código, datos destacados y nota como la referencia',async()=>{
 const app=await ui();try{
  app.state.blocks[0].notes='Su compañera trajo 30 encuestas';app.click('#refresh');await app.waitFor(()=>app.doc.querySelector('#notice')!.textContent==='');app.click('[data-print]');
  const paper=app.doc.querySelector('.print-only')!;assert.equal(paper.querySelector('.print-code')!.textContent,'0001-DOM');assert.match(paper.querySelector('.print-details')!.textContent!,/Fecha de ingreso: 14\/10\/2026/);assert.match(paper.querySelector('.print-details')!.textContent!,/Archivo: Encuestas o Entrevistas/);assert.equal(paper.querySelectorAll('.print-details strong').length,4);assert.equal(paper.querySelector('.print-note')!.textContent,'Nota: Su compañera trajo 30 encuestas');assert.doesNotMatch(paper.textContent!,/Resumen textual|Código:|Responsable del registro/);
 }finally{app.dom.window.close();}
});

test('DOM: traslado empieza con cliente y dos últimos bloques; anteriores siguen disponibles',async()=>{
 const app=await ui();try{
  for(let i=0;i<3;i++)app.run('receive',{codeId:app.state.codes[0].id,date:'2026-10-16',responsible:app.responsible,blocks:[{typeId:app.state.catalogs.types[0].id,description:'Nuevo '+i,quantity:10}]});
  app.click('#refresh');await app.waitFor(()=>app.doc.querySelectorAll('.card').length===4);app.click('#move');const form=app.doc.querySelector('#form')!;const items=[...app.doc.querySelectorAll('.transfer-item')];assert.equal(items.filter(x=>!x.hasAttribute('hidden')).length,2);assert.equal(app.doc.querySelector('[name=deliveredBy]'),null);assert.ok(form.querySelector('#transfer-search'));assert.ok(form.querySelector('fieldset')!.compareDocumentPosition(form.querySelector('[name=action]')!)&app.w.Node.DOCUMENT_POSITION_FOLLOWING);
  app.click('#transfer-more');assert.equal(items.filter(x=>!x.hasAttribute('hidden')).length,4);app.pick('#transfer-search','0001-DOM');assert.equal(items.filter(x=>!x.hasAttribute('hidden')).length,4);assert.equal((app.doc.querySelector('#transfer-more') as HTMLElement).hidden,true);
  const picks=items.map(item=>item.querySelector('[name=pick]') as HTMLInputElement);picks[0].checked=true;picks[2].checked=true;assert.equal(picks.filter(pick=>pick.checked&&!pick.disabled).length,2);
  app.pick('#transfer-search','Cliente de prueba');assert.equal(items.filter(x=>!x.hasAttribute('hidden')).length,4);
  app.pick('#transfer-search','');assert.equal(items.filter(x=>!x.hasAttribute('hidden')).length,2);assert.equal(picks.filter(pick=>pick.disabled&&pick.checked).length,0);
  app.pick('#transfer-search','cliente inexistente');assert.equal(items.filter(x=>!x.hasAttribute('hidden')).length,0);
 }finally{app.dom.window.close();}
});

test('DOM: editar ofrece campos de ingreso y corrige cantidad, almacenamiento y responsable',async()=>{
 const app=await ui({confirm:true});try{
  app.click('[data-edit]');for(const field of ['codeId','date','responsible','typeId','description','quantity','storage','notes','reason'])assert.ok(app.doc.querySelector(`#form [name="${field}"]`),field);assert.equal((app.doc.querySelector('[name=quantity]') as HTMLInputElement).value,'300');assert.equal((app.doc.querySelector('[name=responsible]') as HTMLSelectElement).value,app.responsible);assert.ok(app.doc.querySelector('#receipt-search'));
  app.pick('[name=quantity]','280');app.pick('[name=storage]','Folder');app.pick('[name=responsible]',app.state.catalogs.responsible[0].id);app.pick('[name=reason]','Verificación del ingreso original');app.submit();await app.waitFor(()=>!app.doc.querySelector('#modal')!.hasAttribute('open'));assert.deepEqual(balances(app.state,app.state.blocks[0].id),[{place:'Comercial',storage:'Folder',quantity:280}]);assert.equal(app.state.events[0].responsible,app.state.catalogs.responsible[0].id);
 }finally{app.dom.window.close();}
});

test('DOM: resumen bajo tarjetas agrupa tipos y presenta solo etapas verificadas',async()=>{
 const app=await ui();try{
  const block=app.state.blocks[0];app.run('editBlock',{id:block.id,description:block.description,storage:'Folder',reason:'Verificación'});app.run('move',{action:'Traslado',date:'2026-10-16',responsible:app.responsible,lines:[{blockId:block.id,from:'Comercial',fromStorage:'Folder',to:'Operativo',quantity:100}]});app.click('#refresh');await app.waitFor(()=>!!app.doc.querySelector('[data-stage=operative] .summary-stage-entry'));
  assert.equal(app.doc.querySelectorAll('.card').length,2);assert.equal(app.doc.querySelector('.card .document-flow'),null);const summary=app.doc.querySelector('.client-document-summary')!;assert.ok(app.doc.querySelector('.cards')!.compareDocumentPosition(summary)&app.w.Node.DOCUMENT_POSITION_FOLLOWING);assert.match(summary.textContent!,/Encuestas o Entrevistas/);assert.match(summary.querySelector('[data-stage=commercial]')!.textContent!,/Folder/);assert.match(summary.querySelector('[data-stage=operative]')!.textContent!,/16\/10\/2026/);assert.equal(summary.querySelector('[data-stage=return] .summary-stage-entry'),null);assert.equal(summary.querySelector('[data-stage=client] .summary-stage-entry'),null);
 }finally{app.dom.window.close();}
});

test('DOM: resumen numera los bloques de antiguo a reciente y muestra cero sin reciclaje',async()=>{
 const app=await ui();try{
  for(const date of ['2026-10-16','2026-10-13'])app.run('receive',{codeId:app.state.codes[0].id,date,responsible:app.responsible,blocks:[{typeId:app.state.catalogs.types[3].id,description:'Archivo '+date,quantity:10,storage:'Folder'}]});
  app.click('#refresh');await app.waitFor(()=>app.doc.querySelectorAll('[data-stage=commercial] .summary-stage-entry').length===3);const entries=[...app.doc.querySelectorAll('[data-stage=commercial] .summary-stage-entry')];assert.deepEqual(entries.map(el=>el.querySelector('strong')!.textContent),['13/10/2026','14/10/2026','16/10/2026']);assert.deepEqual(entries.map(el=>el.querySelector('b')!.textContent),['#1','#2','#3']);assert.equal(app.doc.querySelector('[data-stage=recycled]')!.textContent,'0');assert.equal(app.doc.querySelector('[data-stage=return]')!.textContent,'—');
 }finally{app.dom.window.close();}
});

test('DOM: crear cliente conserva nombre y código y muestra responsable y nota en la tarjeta',async()=>{
 const app=await ui();try{
  app.click('#receive');app.pick('#receipt-search','Ne Prueba');app.click('#add-receipt-client');app.pick('[name=newCode]','500-26_ADMI_UTEA_NE');app.pick('[name=date]','2026-10-16');app.pick('[name=responsible]',app.state.catalogs.responsible[2].id);app.pick('[name=typeId]',app.state.catalogs.types[1].id);app.pick('[name=description]','Anillado');app.pick('[name=quantity]','1');app.pick('[name=storage]','Escritorio');app.pick('[name=notes]','Falta 1 documento');app.submit();await app.waitFor(()=>app.doc.querySelectorAll('.card').length===2);
  const customer=app.state.clients.find((c:any)=>c.name==='Ne Prueba');assert.ok(customer);const contract=app.state.codes.find((c:any)=>c.code==='500-26_ADMI_UTEA_NE');assert.equal(contract.clientId,customer.id);const card=[...app.doc.querySelectorAll('.card')].find(c=>c.querySelector('.card-contract-code')!.textContent==='500-26_ADMI_UTEA_NE')!;assert.equal(card.querySelector('.card-customer-name')!.textContent,'Ne Prueba');assert.equal(card.querySelector('.card-event-trail'),null);assert.equal(card.querySelector('.card-note p')!.textContent,'Falta 1 documento');assert.match(card.textContent!,/Escritorio/);assert.ok(card.querySelector('.card-contract-code')!.compareDocumentPosition(card.querySelector('.card-customer-name')!)&app.w.Node.DOCUMENT_POSITION_FOLLOWING);
 }finally{app.dom.window.close();}
});

test('DOM: ingreso y traslados conservan tarjetas separadas y todas las visitas al mismo destino',async()=>{
 const app=await ui();try{
  const block=app.state.blocks[0];app.run('move',{action:'Traslado',date:'2026-10-15',responsible:app.responsible,lines:[{blockId:block.id,from:'Comercial',to:'Operativo',quantity:100}]});app.run('move',{action:'Traslado',date:'2026-10-16',responsible:app.responsible,lines:[{blockId:block.id,from:'Operativo',to:'Comercial',storage:'Folder',quantity:100}]});app.run('move',{action:'Traslado',date:'2026-10-17',responsible:app.responsible,lines:[{blockId:block.id,from:'Comercial',fromStorage:'Folder',to:'Operativo',quantity:100}]});app.click('#refresh');await app.waitFor(()=>app.doc.querySelectorAll('.card').length===4);const cards=[...app.doc.querySelectorAll('.card')];assert.match(cards[0].querySelector('.last-movement')!.textContent!,/17\/10\/2026/);assert.match(cards[3].querySelector('.last-movement')!.textContent!,/14\/10\/2026/);assert.match(cards[3].querySelector('.pill')!.textContent!,/Comercial/);assert.match(cards[0].querySelector('.pill')!.textContent!,/Operativo/);assert.match(cards[3].querySelector('.card-document-quantity')!.textContent!,/300/);assert.match(cards[0].querySelector('.card-document-quantity')!.textContent!,/100/);assert.match(cards[3].textContent!,/Registro histórico/);assert.equal(app.doc.querySelectorAll('[data-stage=operative] .summary-stage-entry').length,2);assert.equal(app.state.blocks.length,1);assert.deepEqual(balances(app.state,block.id).map(x=>x.quantity),[200,100]);
 }finally{app.dom.window.close();}
});

test('DOM: retorno de Operativo a Comercial propone Escritorio y permite elegir otro almacenamiento',async()=>{
 const app=await ui();try{
  const block=app.state.blocks[0];app.run('move',{action:'Traslado',date:'2026-10-16',responsible:app.responsible,lines:[{blockId:block.id,from:'Comercial',to:'Operativo',quantity:300}]});app.click('#refresh');await app.waitFor(()=>app.doc.querySelectorAll('.card').length===2);app.click('#move');const storage=app.doc.querySelector('[name=storage]') as HTMLSelectElement;assert.equal((app.doc.querySelector('[name=to]') as HTMLSelectElement).value,'Comercial');assert.equal(storage.disabled,false);assert.equal(storage.value,'Escritorio');
  app.pick('[name=storage]','Folder');(app.doc.querySelector('[name=pick]') as HTMLInputElement).checked=true;app.doc.querySelector('[name=pick]')!.dispatchEvent(new app.w.Event('change',{bubbles:true}));assert.equal(storage.value,'Folder');app.submit();await app.waitFor(()=>app.state.events.length===3);assert.deepEqual(balances(app.state,block.id),[{place:'Comercial',storage:'Folder',quantity:300}]);
 }finally{app.dom.window.close();}
});

test('DOM: tarjeta presenta fecha, identidad, datos, recorrido cronológico e iconos accesibles',async()=>{
 const app=await ui();try{
  const block=app.state.blocks[0];app.run('move',{action:'Traslado',date:'2026-10-16',responsible:app.state.catalogs.responsible[2].id,lines:[{blockId:block.id,from:'Comercial',to:'Operativo',quantity:100}]});app.click('#refresh');await app.waitFor(()=>app.doc.querySelectorAll('.card').length===2);const cards=[...app.doc.querySelectorAll('.card')];assert.equal(cards[0].querySelectorAll('.card-event-step').length,0);assert.equal(cards[1].querySelectorAll('.card-event-step').length,0);assert.equal(cards[0].querySelector('[data-client]'),null);app.click('[data-history]');const history=app.doc.querySelector('#modal-content')!;assert.equal(history.querySelectorAll('.card-event-step').length,2);assert.match(history.querySelectorAll('.card-event-copy p')[0].textContent!,/14\/10\/2026/);assert.match(history.querySelectorAll('.card-event-copy p')[1].textContent!,/16\/10\/2026/);for(const button of cards[0].querySelectorAll('footer button')){assert.ok(button.querySelector('svg'));assert.ok(button.getAttribute('aria-label'));assert.ok(button.getAttribute('title'));}assert.equal(app.state.blocks.length,1);
 }finally{app.dom.window.close();}
});

test('DOM: Administración permite reordenar catálogos con el asa y conserva el orden en selectores',async()=>{
 const app=await ui();try{
  app.click('[data-view=admin]');const original=app.state.catalogs.types.map((x:any)=>x.id);const first=app.doc.querySelector('[data-order-catalog="types"] .catalog-grip')!;first.dispatchEvent(new app.w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));await app.waitFor(()=>app.state.catalogs.types[0].id===original[1]);await app.waitFor(()=>app.doc.querySelector('#notice')!.textContent!.includes('Orden guardado'));assert.equal(app.state.catalogs.types[1].id,original[0]);assert.ok(app.state.audit.some((a:any)=>a.kind==='catalogReorder'));app.click('[data-view=history]');const options=app.doc.querySelectorAll('#type option');assert.equal((options[1] as HTMLOptionElement).value,original[1]);assert.equal((options[2] as HTMLOptionElement).value,original[0]);
 }finally{app.dom.window.close();}
});

test('DOM: arrastre real del asa reordena al soltar fuera del botón y persiste',async()=>{
 const app=await ui();try{
  app.click('[data-view=admin]');const list=app.doc.querySelector('[data-order-catalog="storage"]') as HTMLElement;const original=app.state.catalogs.storage.map((item:any)=>item.id);const rows=[...list.children] as HTMLElement[];
  list.getBoundingClientRect=()=>({left:0,right:300,top:0,bottom:250,width:300,height:250} as DOMRect);for(const row of rows)row.getBoundingClientRect=()=>{const i=[...list.children].indexOf(row);return {top:i*50,height:50,left:0,right:300,bottom:i*50+50,width:300} as DOMRect;};
  const handle=rows[0].querySelector('.catalog-grip') as HTMLElement;assert.equal(handle.draggable,true);const start=new app.w.Event('dragstart',{bubbles:true,cancelable:true});Object.defineProperty(start,'dataTransfer',{value:{setData(){},effectAllowed:''}});handle.dispatchEvent(start);
  rows[2].dispatchEvent(new app.w.MouseEvent('dragover',{bubbles:true,cancelable:true,clientX:100,clientY:149}));list.dispatchEvent(new app.w.Event('drop',{bubbles:true,cancelable:true}));await app.waitFor(()=>app.state.catalogs.storage[2].id===original[0]);await app.waitFor(()=>app.doc.querySelector('#notice')!.textContent!.includes('Orden guardado'));assert.equal(app.state.catalogs.storage[0].id,original[1]);assert.equal(app.requests.filter(x=>x.data?.kind==='catalogReorder').length,1);
 }finally{app.dom.window.close();}
});
test('DOM: arrastre cancelado devuelve el orden original sin guardar',async()=>{
 const app=await ui();try{app.click('[data-view=admin]');const handle=app.doc.querySelector('[data-order-catalog="responsible"] .catalog-grip') as HTMLElement;handle.dispatchEvent(new app.w.Event('dragstart',{bubbles:true,cancelable:true}));app.doc.dispatchEvent(new app.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));handle.dispatchEvent(new app.w.Event('dragend',{bubbles:true}));assert.equal(app.requests.filter(x=>x.data?.kind==='catalogReorder').length,0);assert.equal(app.doc.querySelector('.is-dragging'),null);}finally{app.dom.window.close();}
});

test('DOM: servidor antiguo no revierte el orden elegido y permite reintentar el guardado',async()=>{
 const options={unsupportedReorder:true};const app=await ui(options);try{
  app.click('[data-view=admin]');const original=app.state.catalogs.storage.map((x:any)=>x.id);const handle=app.doc.querySelector('[data-order-catalog="storage"] .catalog-grip')!;handle.dispatchEvent(new app.w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));await app.waitFor(()=>!!app.doc.querySelector('#retry-catalog-order'));assert.equal(app.state.catalogs.storage[0].id,original[0]);assert.equal((app.doc.querySelector('[data-order-catalog="storage"] [data-order-id]') as HTMLElement).dataset.orderId,original[1]);assert.match(app.doc.querySelector('#catalog-order-feedback')!.textContent!,/versión anterior/);
  options.unsupportedReorder=false;app.click('#retry-catalog-order');await app.waitFor(()=>app.state.catalogs.storage[0].id===original[1]);await app.waitFor(()=>app.doc.querySelector('#notice')!.textContent!.includes('Orden guardado'));assert.equal(app.doc.querySelector('#catalog-order-feedback')!.hasAttribute('hidden'),true);
 }finally{app.dom.window.close();}
});

test('DOM: eliminar catálogo solicita clave y rechaza cualquier valor diferente a 1608',async()=>{
 const app=await ui();try{
  app.click('[data-view=admin]');const item=app.state.catalogs.types[0];app.click(`[data-delete-catalog="types"][data-id="${item.id}"]`);app.pick('[name=deletePassword]','0000');app.submit();await app.waitFor(()=>!app.doc.querySelector('#form-error')!.hasAttribute('hidden'));assert.match(app.doc.querySelector('#form-error')!.textContent!,/Contraseña incorrecta/);assert.ok(!item.deleted);app.pick('[name=deletePassword]','1608');app.submit();await app.waitFor(()=>app.state.catalogs.types.find((x:any)=>x.id===item.id).deleted===true);await app.waitFor(()=>!app.doc.querySelector('#modal')!.hasAttribute('open'));assert.equal(app.doc.querySelector(`[data-delete-catalog="types"][data-id="${item.id}"]`),null);
 }finally{app.dom.window.close();}
});
test('DOM: editar responsable permite consultar usuario y contraseña y ocultarla',async()=>{
 const app=await ui();try{
  app.click('[data-view=admin]');app.click(`[data-cat="responsible"][data-id="${app.responsible}"]`);app.click('#responsible-access');await app.waitFor(()=>!!app.doc.querySelector('#view-advisor-password'));assert.equal((app.doc.querySelector('[name=username]') as HTMLInputElement).value,'evelyn');app.click('#view-advisor-password');await app.waitFor(()=>!app.doc.querySelector('#current-credential')!.hasAttribute('hidden'));assert.equal((app.doc.querySelector('#current-credential') as HTMLInputElement).value,'Contraseña de prueba 123');app.click('#hide-advisor-password');assert.equal((app.doc.querySelector('#current-credential') as HTMLInputElement).value,'');assert.equal(app.doc.querySelector('#current-credential')!.hasAttribute('hidden'),true);
 }finally{app.dom.window.close();}
});

test('DOM: corrección muestra almacenamiento solo para Comercial con opciones del catálogo',async()=>{
 const app=await ui();try{
  app.run('move',{action:'Traslado',date:'2026-10-15',responsible:app.responsible,lines:[{blockId:app.state.blocks[0].id,from:'Comercial',fromStorage:'',to:'Operativo',storage:'',quantity:300}]});
  app.click('#refresh');await app.waitFor(()=>app.doc.querySelectorAll('.card').length===2);
  app.click('[data-history]');app.click(`[data-correct="${app.state.events.at(-1).id}"]`);
  const origin=app.doc.querySelector('.correction-line [name=fromStorage]') as HTMLSelectElement;
  assert.equal(origin.tagName,'SELECT');assert.equal(origin.disabled,false);
  for(const item of app.state.catalogs.storage.filter((x:any)=>x.active))assert.ok([...origin.options].some(x=>x.value===item.name));
  app.pick('.correction-line [name=from]','Operativo');assert.equal(origin.closest('label')!.hidden,true);assert.equal(origin.disabled,true);
  app.pick('.correction-line [name=from]','Comercial');assert.equal(origin.closest('label')!.hidden,false);assert.equal(origin.disabled,false);
 }finally{app.dom.window.close();}
});

test('DOM: corregir movimiento permite guardar sin motivo',async()=>{
 const app=await ui({confirm:true});try{
  app.click('[data-history]');app.click(`[data-correct="${app.state.events[0].id}"]`);
  const reason=app.doc.querySelector('#form [name=reason]') as HTMLInputElement;
  assert.equal(reason.required,false);assert.equal(reason.value,'');
  app.pick('[name=notes]','Observación corregida sin motivo');app.submit();
  await app.waitFor(()=>!app.doc.querySelector('#modal')!.hasAttribute('open'));
  assert.equal(app.state.events[0].notes,'Observación corregida sin motivo');
 }finally{app.dom.window.close();}
});


test('DOM: sesión de asesor muestra su identidad al cargar y la limpia al salir',async()=>{
 const app=await ui({advisor:true});try{
  assert.equal(app.doc.querySelector('#session')!.textContent,'Evelyn');
  assert.equal(app.doc.querySelector('#access-badge')!.textContent,'Evelyn');assert.ok(app.doc.querySelector('#session svg use[href="#i-cliente"]'));assert.equal(app.doc.querySelector('#session')!.getAttribute('aria-label'),'Cerrar sesión de Evelyn');
  app.click('#session');await app.waitFor(()=>app.doc.querySelector('#session')!.textContent==='Iniciar sesión');
  assert.equal(app.doc.querySelector('#access-badge')!.textContent,'Solo consulta');
 }finally{app.dom.window.close();}
});



test('DOM: edición de almacenamiento identifica a Ada y conserva autoría de Evelyn',async()=>{
 const app=await ui({advisor:true});try{
  const blockId=app.state.blocks[0].id;
  operate(app.state,{kind:'move',key:id(),data:{action:'Traslado',date:'2026-10-15',responsible:app.responsible,lines:[{blockId,from:'Comercial',fromStorage:'',to:'Operativo',quantity:300}]}},'Evelyn (evelyn)');
  operate(app.state,{kind:'move',key:id(),data:{action:'Traslado',date:'2026-10-16',responsible:app.responsible,lines:[{blockId,from:'Operativo',fromStorage:'',to:'Comercial',storage:'Escritorio',quantity:300}]}},'Evelyn (evelyn)');
  const event=app.state.events.at(-1);
  operate(app.state,{kind:'eventCorrection',key:id(),data:{id:event.id,responsible:app.responsible,lines:event.lines.map((l:any)=>({...l,storage:'Folder'})),account:'Evelyn (evelyn)'}},'Ada (ada)');
  app.click('#refresh');await app.waitFor(()=>app.doc.querySelectorAll('.card').length===3);
  app.click('[data-history]');const trail=app.doc.querySelector('#modal-content .card-event-trail')!.textContent!;
  assert.match(trail,/Evelyn/);assert.match(trail,/Edición de almacenamiento/);assert.match(trail,/Ada/);assert.match(trail,/Escritorio.*Folder/);
  app.click('[data-history]');assert.match(app.doc.querySelector('#modal-content')!.textContent!,/Edición.*Ada/s);
  assert.equal(event.account,'Evelyn (evelyn)');
  const edits=editHistory(app.state,new Set([blockId]));assert.equal(edits.at(-1).account,'Ada (ada)');assert.equal(editHistory(app.state,new Set()).length,0);assert.equal(edits.at(-1).before.storage,'Escritorio');
 }finally{app.dom.window.close();}
});

test('DOM: buscador sugiere clientes coincidentes y selecciona todos sus códigos',async()=>{
 const app=await ui();try{
  app.run('code',{code:'VINCULADO-XYZ',clientId:app.state.clients[0].id,current:false});
  app.click('#refresh');await app.waitFor(()=>[...app.doc.querySelectorAll('#code option')].some(option=>option.textContent==='VINCULADO-XYZ'));
  app.pick('#search','VINCULADO');
  await app.waitFor(()=>app.doc.querySelectorAll('#search-clients [role=option]').length===1);
  assert.match(app.doc.querySelector('#search-clients')!.textContent!,/Cliente de prueba DOM/);
  assert.match(app.doc.querySelector('#search-clients')!.textContent!,/0001-DOM.*VINCULADO-XYZ/);
  app.click('#search-clients [role=option]');
  assert.equal((app.doc.querySelector('#client') as HTMLSelectElement).value,app.state.clients[0].id);
  assert.equal(app.doc.querySelectorAll('.card').length,1);
  assert.equal(app.doc.querySelector('#search')!.getAttribute('aria-expanded'),'false');
  app.pick('#search','Otro');assert.equal((app.doc.querySelector('#client') as HTMLSelectElement).value,'');
  const input=app.doc.querySelector('#search')!;
  input.dispatchEvent(new app.w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
  input.dispatchEvent(new app.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  assert.equal((app.doc.querySelector('#client') as HTMLSelectElement).value,app.state.clients[1].id);
  app.pick('#search','cliente inexistente');assert.match(app.doc.querySelector('#search-clients')!.textContent!,/No encontramos/);
  app.click('#reset-filters');assert.equal(app.doc.querySelector('#search')!.getAttribute('aria-expanded'),'false');
 }finally{app.dom.window.close();}
});

test('DOM: Registrar destino permite elegir cliente entre sugerencias y conserva selección múltiple',async()=>{
 const app=await ui();try{
  app.run('receive',{codeId:app.state.codes[1].id,date:'2026-10-16',responsible:app.responsible,blocks:[{typeId:app.state.catalogs.types[0].id,description:'Otro archivo',quantity:2}]});
  app.click('#refresh');await app.waitFor(()=>app.doc.querySelectorAll('.card').length===2);app.click('#move');
  const input=app.doc.querySelector('#transfer-search')!;assert.equal(input.getAttribute('aria-expanded'),'false');
  app.pick('#transfer-search','Otro');assert.equal(app.doc.querySelectorAll('#transfer-clients [role=option]').length,1);
  assert.match(app.doc.querySelector('#transfer-clients')!.textContent!,/0002-DOM/);
  input.dispatchEvent(new app.w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));input.dispatchEvent(new app.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  assert.equal((input as HTMLInputElement).value,'Otro cliente DOM');assert.equal(input.getAttribute('aria-expanded'),'false');
  const shown=[...app.doc.querySelectorAll('.transfer-item')].filter((el:any)=>!el.hidden);assert.equal(shown.length,1);assert.match(shown[0].textContent!,/Otro archivo/);
  app.pick('#transfer-search','0001');app.click('#transfer-clients [role=option]');assert.equal((input as HTMLInputElement).value,'Cliente de prueba DOM');
  app.pick('#transfer-search','');assert.equal(input.getAttribute('aria-expanded'),'false');
  app.doc.querySelector('#close')!.dispatchEvent(new app.w.MouseEvent('click',{bubbles:true}));app.click('#receive');
  (app.doc.querySelector('#receipt-search') as HTMLInputElement).focus();assert.equal(app.doc.querySelector('#receipt-options')!.hasAttribute('hidden'),true);
 }finally{app.dom.window.close();}
});

test('DOM: ingreso múltiple guarda un bloque por tipo y el resumen los separa',async()=>{
 const app=await ui();try{
  app.click('#receive');app.pick('#receipt-search','0001-DOM');app.click('[data-receipt-code]');
  const types=app.doc.querySelector('#entries [name=typeId]') as HTMLSelectElement;assert.equal(types.multiple,true);
  const wanted=[app.state.catalogs.types[1],app.state.catalogs.types[3]];
  for(const option of types.options)option.selected=wanted.some((type:any)=>type.id===option.value);types.dispatchEvent(new app.w.Event('change',{bubbles:true}));
  app.pick('[name=description]','Paquete recibido');app.pick('[name=quantity]','1');app.pick('[name=storage]','Folder');app.pick('[name=responsible]',app.responsible);app.submit();
  await app.waitFor(()=>app.state.blocks.length===3);await app.waitFor(()=>!app.doc.querySelector('#modal')!.hasAttribute('open'));
  const received=app.state.blocks.filter((block:any)=>block.description==='Paquete recibido');assert.equal(received.length,2);assert.deepEqual(new Set(received.map((block:any)=>block.typeId)),new Set(wanted.map((type:any)=>type.id)));
  const summary=app.doc.querySelector('.document-summary')||app.doc.querySelector('#results');assert.match(summary!.textContent!,/Plan de Tesis/);assert.match(summary!.textContent!,/Encuestas/);
 }finally{app.dom.window.close();}
});


test('DOM: tarjeta compacta agrupa tipos del mismo ingreso sin perder edición individual',async()=>{
 const app=await ui();try{
  app.run('receive',{codeId:app.state.codes[0].id,date:'2026-10-16',responsible:app.responsible,blocks:[{typeId:app.state.catalogs.types[1].id,description:'Plan anillado',quantity:1,storage:'Escritorio'},{typeId:app.state.catalogs.types[3].id,description:'Encuestas',quantity:200,storage:'Escritorio'}]});
  app.click('#refresh');await app.waitFor(()=>app.doc.querySelectorAll('.card-document-row').length===3);
  assert.equal(app.doc.querySelectorAll('.card').length,2);const card=app.doc.querySelector('.card')!;assert.equal(card.querySelectorAll('.card-document-row').length,2);
  assert.match(card.querySelector('.pill')!.textContent!,/Comercial.*Escritorio/);assert.doesNotMatch(card.querySelector('.pill')!.textContent!,/200/);
  (card.querySelector('[data-edit]') as HTMLElement).click();assert.equal(app.doc.querySelectorAll('[data-group-choice]').length,2);
  ([ ...app.doc.querySelectorAll('[data-group-choice]')].find(button=>button.textContent!.includes('Cant: 200')) as HTMLElement).click();assert.equal((app.doc.querySelector('#form [name=quantity]') as HTMLInputElement).value,'200');
  assert.equal((app.doc.querySelector('#form [name=description]') as HTMLInputElement).value,'Encuestas');assert.equal(app.state.blocks.length,3);
 }finally{app.dom.window.close();}
});

test('DOM: checklist de tipos permite marcar y desmarcar sin Ctrl',async()=>{
 const app=await ui();try{
  app.click('#receive');const checks=[...app.doc.querySelectorAll('[data-document-type]')] as HTMLInputElement[];
  assert.ok(checks.length>2);assert.equal(app.doc.querySelector('.document-type-checklist select')!.hasAttribute('hidden'),true);
  assert.equal(checks[0].validity.valid,false);checks[1].click();checks[3].click();
  const select=app.doc.querySelector('.document-type-checklist select') as HTMLSelectElement;
  assert.equal(select.selectedOptions.length,2);assert.equal(checks[0].validity.valid,true);
  checks[1].click();assert.equal(select.selectedOptions.length,1);checks[3].click();assert.equal(checks[0].validity.valid,false);
  app.click('#add-block');assert.equal(app.doc.querySelectorAll('.document-type-checklist').length,2);
 }finally{app.dom.window.close();}
});


test('DOM: cada tipo seleccionado guarda su propia cantidad y usa la etiqueta Nota',async()=>{
 const app=await ui();try{
  app.click('#receive');app.pick('#receipt-search','0001');app.click('[data-receipt-code]');app.pick('[name=responsible]',app.responsible);
  const types=[app.state.catalogs.types[1],app.state.catalogs.types[3]];
  for(const type of types)app.click(`[data-document-type="${type.id}"]`);
  app.pick(`[data-type-quantity="${types[0].id}"]`,'1');app.pick(`[data-type-quantity="${types[1].id}"]`,'200');
  const disabled=app.doc.querySelector('[data-type-quantity]:disabled') as HTMLInputElement;assert.ok(disabled);
  assert.equal(app.doc.querySelector('#form [name=notes]')!.closest('label')!.textContent!.includes('Nota'),true);
  app.pick('[name=description]','Documentos del cliente');app.pick('[name=storage]','Escritorio');app.submit();
  await app.waitFor(()=>!app.doc.querySelector('#modal')!.hasAttribute('open'));
  const received=app.state.events.at(-1);assert.equal(received.lines.length,2);
  for(const [i,type] of types.entries()){const block=app.state.blocks.find((b:any)=>b.typeId===type.id&&b.description==='Documentos del cliente');assert.ok(block);assert.equal(received.lines.find((l:any)=>l.blockId===block.id).quantity,i===0?1:200);}
  assert.match(app.doc.querySelector('.card-document-list')!.textContent!,/Cant: (1|200)/);
 }finally{app.dom.window.close();}
});

test('DOM: Responsable preselecciona la sesión, admite cambios y no pide descripción',async()=>{
 const app=await ui({advisor:true});try{
  app.click('#receive');const responsible=app.doc.querySelector('#form [name=responsible]') as HTMLSelectElement;
  assert.equal(responsible.value,app.state.catalogs.responsible[1].id);assert.match(responsible.closest('label')!.textContent!,/^Responsable/);assert.doesNotMatch(responsible.closest('label')!.textContent!,/operativo/);
  assert.equal(app.doc.querySelector('#form [name=description]')!.getAttribute('type'),'hidden');
  app.pick('[name=responsible]',app.state.catalogs.responsible[0].id);app.pick('#receipt-search','0001');app.click('[data-receipt-code]');
  const type=app.state.catalogs.types[1];app.click(`[data-document-type="${type.id}"]`);app.pick(`[data-type-quantity="${type.id}"]`,'2');app.submit();
  await app.waitFor(()=>!app.doc.querySelector('#modal')!.hasAttribute('open'));
  assert.equal(app.state.events.at(-1).responsible,app.state.catalogs.responsible[0].id);assert.equal(app.state.blocks.at(-1).description,type.name);
  app.click('#move');assert.equal((app.doc.querySelector('#form [name=responsible]') as HTMLSelectElement).value,app.state.catalogs.responsible[1].id);
 }finally{app.dom.window.close();}
});


test('DOM: ingreso propone Escritorio por bloque y permite cambiarlo',async()=>{
 const app=await ui();try{
  app.click('#receive');const storage=app.doc.querySelector('#entries [name=storage]') as HTMLSelectElement;assert.equal(storage.value,'Escritorio');
  app.pick('#entries [name=storage]','Folder');assert.equal(storage.value,'Folder');app.click('#add-block');
  const storages=[...app.doc.querySelectorAll('#entries [name=storage]')] as HTMLSelectElement[];assert.deepEqual(storages.map(input=>input.value),['Folder','Escritorio']);
 }finally{app.dom.window.close();}
});


test('DOM: guardar corrección valida y persiste sin ventana de confirmación',async()=>{
 const app=await ui();try{
  app.click('[data-edit]');app.pick('[name=storage]','Folder');app.submit();
  await app.waitFor(()=>!app.doc.querySelector('#modal')!.hasAttribute('open'));
  assert.equal(app.confirms.length,0);assert.ok(app.requests.some(request=>request.path==='/api/operation-preview'));
  assert.ok(app.requests.some(request=>request.path==='/api/operate'&&request.data.kind==='editBlock'));
  assert.equal(balances(app.state,app.state.blocks[0].id)[0].storage,'Folder');
 }finally{app.dom.window.close();}
});


test('DOM: ingreso inicial del administrador conserva Escritorio y muestra edición de Chrystel',async()=>{
 const app=await ui({advisor:true});try{
  const original=app.state.events[0],block=app.state.blocks[0];original.account='administrador';original.lines[0].storage='Escritorio';
  operate(app.state,{kind:'editBlock',key:id(),data:{id:block.id,description:block.description,storage:'Bolsa de papel',responsible:app.state.catalogs.responsible[2].id}},'Chrystel (chrystel)');
  app.click('#refresh');await app.waitFor(()=>app.doc.querySelector('.pill')!.textContent!.includes('Bolsa de papel'));
  app.click('[data-history]');const trail=app.doc.querySelector('#modal-content .card-event-trail')!.textContent!;
  assert.match(trail,/Ingreso inicial.*Escritorio.*administrador/s);assert.match(trail,/Edición de almacenamiento.*Escritorio.*Bolsa de papel.*Chrystel/s);
  assert.equal(app.state.events[0].account,'administrador');
 }finally{app.dom.window.close();}
});


test('DOM: tarjetas uniformes conservan detalle desplazable y acciones fuera del contenido',async()=>{
 const app=await ui();try{
  const grid=app.doc.querySelector('#results > .cards')!;assert.ok(grid.classList.contains('uniform-document-cards'));
  const card=grid.querySelector('.record-design')!,content=card.querySelector('.card-content')!;
  assert.equal(content.getAttribute('tabindex'),'0');assert.equal(content.getAttribute('aria-label'),'Detalle del documento');
  assert.ok(content.querySelector('.card-document-list'));assert.equal(content.querySelector('footer'),null);assert.ok(card.querySelector(':scope > footer'));
 }finally{app.dom.window.close();}
});


test('DOM: cliente de dos personas muestra ambos nombres, icono de persona y cantidad vacía como guion',async()=>{
 const app=await ui();try{
  app.click('#receive');app.pick('#receipt-search','Ana');app.click('#add-receipt-client');app.pick('[name=newName]','Ana Pérez');app.pick('[name=newSecondName]','Luis Torres');app.pick('[name=newCode]','DOS-PERSONAS');app.pick('[name=responsible]',app.responsible);app.click(`[data-document-type="${app.state.catalogs.types[0].id}"]`);app.submit();
  await app.waitFor(()=>!app.doc.querySelector('#modal')!.hasAttribute('open'));const customer=app.state.clients.find((c:any)=>c.name==='Ana Pérez y Luis Torres');assert.ok(customer);assert.deepEqual(customer.personNames,['Ana Pérez','Luis Torres']);
  const card=[...app.doc.querySelectorAll('.card')].find(card=>card.querySelector('.card-contract-code')!.textContent==='DOS-PERSONAS')!;assert.equal(card.querySelector('.card-customer-name')!.textContent,'Ana Pérez y Luis Torres');assert.ok(card.querySelector('.card-client-row use[href="#i-cliente"]'));assert.equal(card.querySelector('.card-document-quantity')!.textContent,'Cant: —');
  app.pick('#search','Luis');assert.match(app.doc.querySelector('#search-clients')!.textContent!,/Ana Pérez y Luis Torres/);
 }finally{app.dom.window.close();}
});


test('DOM: formularios de cliente ordenan código y nombres sin poner códigos como personas',async()=>{
 const app=await ui();try{
  const order=(selectors:string[])=>{const elements=selectors.map(selector=>app.doc.querySelector(selector)!);for(let i=1;i<elements.length;i++)assert.ok(elements[i-1].compareDocumentPosition(elements[i])&app.w.Node.DOCUMENT_POSITION_FOLLOWING);};
  app.click('#receive');app.pick('#receipt-search','Henry');app.click('#add-receipt-client');order(['[name=newCode]','[name=newName]','[name=newSecondName]']);
  app.click('#close');app.click('[data-view=admin]');app.click('#new-client');order(['#form [name=code]','#form [name=name]','#form [name=secondName]']);
  app.click('#close');app.state.clients[0].namePending=true;app.click('[data-view=history]');app.click('#refresh');await app.waitFor(()=>app.doc.querySelector('.card-customer-name')!.textContent==='Nombre por completar');app.click('[data-view=admin]');app.click(`[data-edit-client="${app.state.clients[0].id}"]`);order(['[name=clientCodes]','#form [name=name]','#form [name=secondName]']);
  assert.equal((app.doc.querySelector('[name=clientCodes]') as HTMLInputElement).readOnly,true);assert.equal((app.doc.querySelector('#form [name=name]') as HTMLInputElement).value,'');
 }finally{app.dom.window.close();}
});


test('DOM: Administración selecciona cliente por nombre o código y coincide con las tarjetas',async()=>{
 const app=await ui();try{
  app.click('[data-view=admin]');app.pick('#admin-client-search','0001');assert.equal(app.doc.querySelectorAll('#admin-client-options [role=option]').length,1);app.click('#admin-client-options [role=option]');
  const visible=[...app.doc.querySelectorAll('[data-admin-client]')].filter((row:any)=>!row.hidden);assert.equal(visible.length,1);assert.equal(visible[0].getAttribute('data-admin-client'),app.state.clients[0].id);
  app.click(`[data-edit-client="${app.state.clients[0].id}"]`);app.pick('#form [name=name]','Ana');app.pick('#form [name=secondName]','Luis');app.submit();await app.waitFor(()=>!app.doc.querySelector('#modal')!.hasAttribute('open'));
  assert.equal((app.doc.querySelector('#admin-client-search') as HTMLInputElement).value,'Ana y Luis');assert.match(app.doc.querySelector('[data-admin-client] .admin-person-names')!.textContent!,/Ana y Luis/);
  app.click('[data-view=history]');const card=app.doc.querySelector('.card')!;assert.equal(card.querySelectorAll('.card-customer-name .person-name').length,2);assert.equal(card.querySelector('.card-customer-name')!.textContent,'Ana y Luis');
  assert.ok(card.querySelector('.card-contract-code')!.compareDocumentPosition(card.querySelector('.card-customer-name')!)&app.w.Node.DOCUMENT_POSITION_FOLLOWING);
 }finally{app.dom.window.close();}
});
