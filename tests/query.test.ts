import {test} from 'node:test';import assert from 'node:assert/strict';
import {initial,operate,balances,id} from '../src/domain.ts';import {filterBlocks,filterEvents} from '../public/query.js';
function setup(){const s:any=initial();const run=(kind:string,data:any,key=id())=>operate(s,{kind,data,key});run('client',{name:'Cliente original',code:'0001-A'});run('client',{name:'Cliente corregido',code:'0002-B'});const responsible=s.catalogs.responsible[1].id;const result=run('receive',{date:'2026-10-14',codeId:s.codes[0].id,responsible,blocks:[{typeId:s.catalogs.types[0].id,description:'Bloque A',quantity:300,storage:'Folder'},{typeId:s.catalogs.types[1].id,description:'Bloque B',quantity:10}]});const blockId=s.blocks[0].id;run('move',{action:'Traslado',date:'2026-10-15',responsible,lines:[{blockId,from:'Comercial',fromStorage:'Folder',to:'Operativo',quantity:100}]});const project=()=>({...s,blocks:s.blocks.map((b:any)=>({...b,balances:balances(s,b.id)}))});return {s,run,result,blockId,responsible,project};}

test('Historial busca códigos originales después de corregir el código del bloque',()=>{
 const f=setup();f.run('editBlock',{id:f.blockId,description:'Bloque corregido',codeId:f.s.codes[1].id,reason:'Error de contrato'});
 const q=new URLSearchParams({q:'0001-A',code:f.s.codes[0].id});const events=filterEvents(f.project(),q);assert.ok(events.some(e=>e.lines.some((l:any)=>l.blockId===f.blockId)));assert.ok(events.flatMap(e=>e.lines).every((l:any)=>l.codeId===f.s.codes[0].id));assert.equal(filterBlocks(f.project(),q).some(b=>b.id===f.blockId),false);
});
test('Situación actual y movimiento histórico aplican fechas distintas',()=>{
 const f=setup(),q=new URLSearchParams({start:'2026-10-15',end:'2026-10-15'});assert.equal(filterBlocks(f.project(),q).length,0);const events=filterEvents(f.project(),q);assert.equal(events.length,1);assert.equal(events[0].action,'Traslado');assert.throws(()=>filterEvents(f.project(),new URLSearchParams({start:'2026-02-31'})));assert.throws(()=>filterEvents(f.project(),new URLSearchParams({start:'2026-10-15',end:'2026-10-14'})));
});
test('Ubicación y almacenamiento actuales deben corresponder al mismo saldo',()=>{
 const f=setup();assert.equal(filterBlocks(f.project(),new URLSearchParams({place:'Operativo',storage:'Folder'})).length,0);assert.equal(filterBlocks(f.project(),new URLSearchParams({place:'Comercial',storage:'Folder'})).length,1);
});
test('Filtrar historial por tipo no mezcla líneas de una recepción compartida',()=>{
 const f=setup();const events=filterEvents(f.project(),new URLSearchParams({type:f.s.catalogs.types[0].id,action:'Recepción'}));assert.equal(events.length,1);assert.equal(events[0].lines.length,1);assert.equal(events[0].lines[0].blockId,f.blockId);assert.equal(f.s.events[0].lines.length,2);
});
test('Idempotencia devuelve el ID exacto para reimprimir y baja lógica conserva líneas',()=>{
 const f=setup();const key=id();const data={date:'2026-10-15',codeId:f.s.codes[0].id,responsible:f.responsible,blocks:[{typeId:f.s.catalogs.types[0].id,description:'Nuevo',quantity:4}]};const first=f.run('receive',data,key);const second=f.run('receive',data,key);assert.ok(first.eventId);assert.equal(second.eventId,first.eventId);assert.equal(second.duplicate,true);
 const neighbor=f.s.blocks[1];f.run('deleteBlock',{id:neighbor.id,reason:'Prueba de eliminación'});assert.equal(f.s.events[0].lines.find((l:any)=>l.blockId===neighbor.id).deleted,true);const reception=filterEvents(f.project(),new URLSearchParams({action:'Recepción'})).find(e=>e.id===f.s.events[0].id);assert.equal(reception?.lines.length,1);f.run('eventCorrection',{id:f.s.events[0].id,reason:'Corrección posterior',lines:[{...f.s.events[0].lines[0],quantity:250}]});assert.equal(balances(f.s,f.blockId)[0].quantity,150);
});

test('Último movimiento primero: hora desempata movimientos del mismo día',()=>{
 const f=setup();for(const event of f.s.events)event.at='2026-10-15T09:00:00.000Z';
 f.run('receive',{date:'2026-10-15',codeId:f.s.codes[0].id,responsible:f.responsible,blocks:[{typeId:f.s.catalogs.types[0].id,description:'Último registro de hoy',quantity:1}]});f.s.events.at(-1).at='2026-10-15T17:00:00.000Z';
 const records=filterBlocks(f.project(),new URLSearchParams());assert.equal(records[0].description,'Último registro de hoy');assert.notEqual(filterBlocks(f.project(),new URLSearchParams({order:'asc'}))[0].description,'Último registro de hoy');
 const events=filterEvents(f.project(),new URLSearchParams());assert.equal(events.filter(e=>e.action==='Recepción')[0].id,f.s.events.at(-1).id);
});

test('Tarjetas ordenan fecha efectiva del último movimiento e ignoran registros tardíos y movimientos eliminados',()=>{
 const f=setup();f.run('receive',{date:'2026-10-01',codeId:f.s.codes[0].id,responsible:f.responsible,blocks:[{typeId:f.s.catalogs.types[0].id,description:'Registrado hoy con fecha antigua',quantity:1}]});f.s.events.at(-1).at='2030-01-01T10:00:00.000Z';
 f.run('move',{action:'Traslado',date:'2026-10-16',responsible:f.responsible,lines:[{blockId:f.blockId,from:'Comercial',fromStorage:'Folder',to:'Operativo',quantity:20}]});
 const ignored={...structuredClone(f.s.events.at(-1)),id:id(),date:'2026-10-17',lines:[{...f.s.events.at(-1).lines[0],blockId:f.s.blocks[1].id,deleted:true}]};f.s.events.push(ignored);
 const result=filterBlocks(f.project(),new URLSearchParams());assert.equal(result[0].id,f.blockId);assert.equal(result.at(-1).description,'Registrado hoy con fecha antigua');assert.equal(filterBlocks(f.project(),new URLSearchParams({order:'asc'}))[0].description,'Registrado hoy con fecha antigua');
 assert.equal(filterBlocks(f.project(),new URLSearchParams({sort:'registration'}))[0].description,'Registrado hoy con fecha antigua');
});
