import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initial,id,operate,balances,validateState} from '../src/domain.ts';
import {filterBlocks} from '../public/query.js';
function fixture(){const s:any=initial();operate(s,{kind:'client',key:id(),data:{name:'Registro original',code:'001-EXCEL'}});const b={id:id(),codeId:s.codes[0].id,typeId:s.catalogs.types[0].id,description:'Archivo importado',date:null,notes:'Observación original',deleted:false,openingBalance:{place:'Comercial',storage:'Folder',quantity:null},sourceImport:{rowHash:'verified-source'}};s.blocks.push(b);return {s,b};}
test('Saldo inicial conserva cantidad y fecha desconocidas sin inventar movimientos',()=>{const {s,b}=fixture();validateState(s);assert.deepEqual(balances(s,b.id),[{place:'Comercial',storage:'Folder',quantity:null}]);assert.equal(s.events.length,0);const projected={...s,blocks:s.blocks.map((b:any)=>({...b,balances:balances(s,b.id)}))};assert.equal(filterBlocks(projected,new URLSearchParams()).length,1);assert.equal(filterBlocks(projected,new URLSearchParams({end:'2026-10-15'})).length,0);});
test('Saldo inicial permite traslado completo desconocido y valida origen',()=>{const {s,b}=fixture();operate(s,{kind:'move',key:id(),data:{date:'2026-10-15',responsible:s.catalogs.responsible[0].id,action:'Traslado',lines:[{blockId:b.id,from:'Comercial',fromStorage:'Folder',to:'Operativo',quantity:null}]}});assert.deepEqual(balances(s,b.id),[{place:'Operativo',storage:'',quantity:null}]);});
test('Saldo inicial permite baja y recuperación sin exigir una recepción ficticia',()=>{const {s,b}=fixture();operate(s,{kind:'deleteBlock',key:id(),data:{id:b.id,reason:'Duplicado'}});assert.deepEqual(balances(s,b.id),[]);operate(s,{kind:'restoreBlock',key:id(),data:{id:b.id,reason:'Archivo verificado'}});assert.equal(balances(s,b.id).length,1);assert.equal(s.events.length,0);});
test('Saldo inicial rechaza procedencia ausente y almacenamiento incompatible',()=>{const {s,b}=fixture();delete (b as any).sourceImport;assert.throws(()=>validateState(s),/procedencia/);(b as any).sourceImport={rowHash:'source'};b.openingBalance.place='Operativo';assert.throws(()=>validateState(s),/Almacenamiento/);});

test('Consulta ordena archivos con fecha y sin fecha en ambas direcciones',()=>{
 const {s,b}=fixture();const dated={...structuredClone(b),id:id(),date:'2026-10-15'};s.blocks.push(dated);
 const projected={...s,blocks:s.blocks.map((x:any)=>({...x,balances:balances(s,x.id)}))};
 for(const order of ['asc','desc']){const result=filterBlocks(projected,new URLSearchParams({order}));assert.equal(result.length,2);assert.ok(result.some((x:any)=>x.date===null));}
 assert.deepEqual(filterBlocks(projected,new URLSearchParams({start:'2026-10-01',end:'2026-10-31'})).map((x:any)=>x.id),[dated.id]);
});
