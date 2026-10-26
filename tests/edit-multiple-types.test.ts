import {test} from 'node:test';import assert from 'node:assert/strict';
import {initial,operate,id,balances} from '../src/domain.ts';
function fixture(){const s:any=initial();operate(s,{kind:'client',key:id(),data:{name:'Ana',code:'001'}});operate(s,{kind:'receive',key:id(),data:{codeId:s.codes[0].id,date:'2026-08-26',responsible:s.catalogs.responsible[0].id,blocks:[{typeId:s.catalogs.types[0].id,description:'Original',quantity:10,storage:'Folder'}]}});return s;}
test('Editar selecciona dos tipos y conserva cantidades, movimientos y reintentos sin duplicar',()=>{
 const s=fixture(),b=s.blocks[0];operate(s,{kind:'move',key:id(),data:{date:'2026-08-27',action:'Traslado',responsible:s.catalogs.responsible[0].id,lines:[{blockId:b.id,from:'Comercial',fromStorage:'Folder',to:'Operativo',quantity:3}]}});
 const input={kind:'editBlock',key:id(),data:{id:b.id,description:b.description,notes:'Nota común',storage:'Folder',responsible:s.catalogs.responsible[0].id,documentTypes:[{typeId:b.typeId,quantity:10},{typeId:s.catalogs.types[1].id,quantity:2}]}};operate(s,input,'Ada');assert.equal(s.blocks.length,2);assert.deepEqual(balances(s,b.id).map(x=>x.quantity),[7,3]);assert.deepEqual(balances(s,s.blocks[1].id),[{place:'Comercial',storage:'Folder',quantity:2}]);assert.equal(s.events[0].lines.length,2);assert.equal(s.events[1].lines.length,1);assert.equal(operate(s,input).duplicate,true);assert.equal(s.blocks.length,2);
});
test('Añadir tipo a saldo importado conserva su ubicación sin inventar traslados',()=>{
 const s=fixture(),b=s.blocks[0];s.events=[];b.openingBalance={place:'Operativo',storage:'',quantity:null};b.sourceImport={rowHash:'source'};
 operate(s,{kind:'editBlock',key:id(),data:{id:b.id,description:b.description,documentTypes:[{typeId:b.typeId,quantity:''},{typeId:s.catalogs.types[1].id,quantity:5}]}});assert.equal(s.events.length,0);assert.equal(s.blocks.length,2);assert.deepEqual(balances(s,s.blocks[1].id),[{place:'Operativo',storage:'',quantity:5}]);
});
test('Edición múltiple rechaza cantidades y tipos duplicados antes de cambiar documentos',()=>{
 const s=fixture(),b=s.blocks[0];const before=JSON.stringify(s.blocks);
 for(const types of [[{typeId:b.typeId,quantity:-1}],[],[{typeId:b.typeId,quantity:1},{typeId:b.typeId,quantity:2}]])assert.throws(()=>operate(s,{kind:'editBlock',key:id(),data:{id:b.id,description:b.description,documentTypes:types}}));
 assert.equal(JSON.stringify(s.blocks),before);
});
