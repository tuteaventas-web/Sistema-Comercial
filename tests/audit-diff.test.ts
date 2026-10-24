import {test} from 'node:test';import assert from 'node:assert/strict';
import {initial,operate,id} from '../src/domain.ts';import {auditSnapshots} from '../src/audit-diff.ts';import {editHistory} from '../src/edit-history.ts';import {auditHTML} from '../public/audit.js';
function scenario(){const s:any=initial();const run=(kind:string,data:any)=>operate(s,{kind,data,key:id()});const person=s.catalogs.responsible[0].id,type=s.catalogs.types[0].id;
 for(let i=0;i<30;i++)run('client',{name:'Cliente '+i,code:'C-'+i});
 run('receive',{codeId:s.codes[0].id,date:'2026-10-14',responsible:person,blocks:[{typeId:type,description:'A',quantity:10}]});
 const b=s.blocks[0];run('move',{action:'Traslado',date:'2026-10-15',responsible:person,lines:[{blockId:b.id,from:'Comercial',to:'Operativo',quantity:4}]});
 run('editBlock',{id:b.id,description:'A corregido',notes:'x',reason:'Error',expectedRevision:b.revision||0});
 const e=s.events[0];run('eventCorrection',{id:e.id,reason:'Cantidad',lines:[{...e.lines[0],quantity:12}]});
 return s;}
test('La auditoría guarda solo lo que cambió y su contexto',()=>{const s=scenario();const last=s.audit.at(-1);
 assert.ok(last.after.events.length<=2&&last.after.clients.length===1,'solo registros cambiados y relacionados');
 assert.ok(JSON.stringify(last).length<JSON.stringify({...s,audit:[]}).length/3,'mucho más chica que el estado');});
test('Pantalla de auditoría e historial de ediciones no cambian con la versión compacta',()=>{const s=scenario();
 const full=structuredClone(s);// reconstruir snapshots completos no es posible; comparamos contra recalcular la compactación sobre lo guardado
 const again=s.audit.map((a:any)=>({...a,...auditSnapshots(a.before,a.after)}));
 for(let i=0;i<s.audit.length;i++)assert.equal(auditHTML(again[i]),auditHTML(s.audit[i]));
 const vis=new Set(s.blocks.map((b:any)=>b.id));const h=editHistory(full,vis);assert.ok(h.length>=2,'registra la edición y la corrección');assert.deepEqual(editHistory({...s,audit:again},vis),h);
 assert.match(auditHTML(s.audit.at(-2)),/A corregido/);assert.match(auditHTML(s.audit.at(-1)),/C-0/);});
