import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initial,operate,id,balances} from '../src/domain.ts';
test('Editar cliente vincula código y nombres en una operación y conserva los documentos',()=>{
 const s:any=initial();operate(s,{kind:'client',key:id(),data:{name:'Ana',code:'001'}});operate(s,{kind:'client',key:id(),data:{name:'Ficha anterior',code:'002'}});
 operate(s,{kind:'receive',key:id(),data:{date:'2026-10-26',codeId:s.codes[1].id,responsible:s.catalogs.responsible[0].id,blocks:[{typeId:s.catalogs.types[0].id,description:'Original',quantity:3,storage:'Folder'}]}});
 const originalCode=s.blocks[0].codeId,customer=s.clients[0];const key=id();const input={kind:'editClient',key,data:{id:customer.id,name:'Ana corregida',secondName:'Luis',linkCode:'002',confirmLink:true,expectedRevision:0,expectedCodeRevision:0}};
 operate(s,input,'Ada');assert.equal(customer.name,'Ana corregida y Luis');assert.equal(s.codes[1].clientId,customer.id);assert.equal(s.blocks[0].codeId,originalCode);assert.deepEqual(balances(s,s.blocks[0].id),[{place:'Comercial',storage:'Folder',quantity:3}]);assert.equal(operate(s,input).duplicate,true);
});
test('Vinculación desde editar exige confirmación y rechaza versiones desactualizadas',()=>{
 const s:any=initial();operate(s,{kind:'client',key:id(),data:{name:'Ana',code:'001'}});const before=JSON.stringify(s.codes);
 assert.throws(()=>operate(s,{kind:'editClient',key:id(),data:{id:s.clients[0].id,name:'Ana',linkCode:'002'}}),/confirme/);assert.equal(JSON.stringify(s.codes),before);
 assert.throws(()=>operate(s,{kind:'editClient',key:id(),data:{id:s.clients[0].id,name:'Ana',linkCode:'002',confirmLink:true,expectedRevision:99}}),/cambió/);assert.equal(JSON.stringify(s.codes),before);
});
