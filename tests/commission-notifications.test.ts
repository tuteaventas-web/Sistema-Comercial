import {test} from 'node:test';
import assert from 'node:assert/strict';
import {commissionEditNotifications,handleGoals} from '../src/goals.ts';
import {commissionChanges,renderGoals} from '../public/goals.js';
const before={id:'record-1',revision:1,date:'2026-10-01',code:'CLIENTE-1',service:'tesis-completa',contractType:'Cliente',notes:'Original',activities:{closing:{username:'ada',name:'Ada'},signature:null,registration:null}};
const after={...before,revision:2,notes:'Corregido'};
function fixture(){return {records:[after],targets:{},requests:{},audit:[{id:'edit-1',at:'2026-11-18T15:00:00Z',kind:'record',account:'Ada (ada)',actorRole:'advisor',before,after},{id:'admin-edit',kind:'record',actorRole:'admin',account:'administrador',before,after},{id:'creation',kind:'record',actorRole:'advisor',account:'Ada (ada)',before:null,after}]};}
function database(data:any){return {query:async(sql:string)=>({rows:sql.includes('advisor_accounts')?[]:[{data}]}),connect:async()=>({query:async(sql:string)=>({rows:sql.includes('SELECT')?[{data}]:[]}),release(){}})};}
async function request(data:any,role:string,method='GET',input?:any){let result:any;await handleGoals({method} as any,new URL('http://test/api/goals?month=2026-10'),database(data) as any,{role,account:role==='admin'?'administrador':'Ada (ada)'},async()=>Buffer.from(JSON.stringify(input)),(status,value)=>{result={status,value};});return result;}
test('only advisor edits notify; administrator sees modifications across months',async()=>{const data=fixture();assert.equal(commissionEditNotifications(data).length,1);const response=await request(data,'admin');assert.equal(response.value.notifications[0].id,'edit-1');assert.equal(response.value.notifications[0].before.notes,'Original');assert.equal(response.value.notifications[0].after.notes,'Corregido');});
test('advisors do not receive administrative notifications or review access',async()=>{const data=fixture();assert.equal(Object.hasOwn((await request(data,'advisor')).value,'notifications'),false);assert.equal((await request(data,'advisor','POST',{kind:'reviewEdits',key:'review-key-1',data:{ids:['edit-1']}})).status,403);assert.equal(commissionEditNotifications(data)[0].reviewedAt,null);});
test('review persists and retries do not duplicate edits',async()=>{const data=fixture();const input={kind:'reviewEdits',key:'review-key-1',data:{ids:['edit-1']}};assert.equal((await request(data,'admin','POST',input)).status,200);assert.ok(commissionEditNotifications(data)[0].reviewedAt);assert.equal((await request(data,'admin','POST',input)).status,200);assert.equal(data.audit.length,3);});
test('legacy edits remain visible; creations and admin changes stay excluded',()=>{const data=fixture();delete (data.audit[0] as any).id;delete (data.audit[0] as any).actorRole;assert.equal(commissionEditNotifications(data)[0].id,'2026-11-18T15:00:00Z:record-1:2');});
test('change details identify before and after fields and responsible advisor',()=>{assert.deepEqual(commissionChanges(before,after),[{label:'Observaciones',before:'Original',after:'Corregido'}]);const changed={...after,activities:{...after.activities,closing:{username:'eve',name:'Evelyn'}}};assert.ok(commissionChanges(before,changed).some(change=>change.label==='Cierre de venta'&&change.before==='Ada'&&change.after==='Evelyn'));});

test('administrator interface shows escaped notifications and review button; advisor interface hides them',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const escape=(value:any)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 for(const admin of [true,false]){
  const button:any={dataset:{reviewGoalEdit:'edit-1'}};const nodes=new Map();
  const root:any={isConnected:true,innerHTML:'',querySelector:(key:string)=>{if(!nodes.has(key))nodes.set(key,{});return nodes.get(key);},querySelectorAll:(key:string)=>key==='[data-review-goal-edit]'&&admin?[button]:[]};
  const screen:any={innerHTML:'',firstElementChild:root};const calls:any[]=[];const payload={records:[],targets:{},accounts:[],notifications:[{...commissionEditNotifications(fixture())[0],account:'<script>alert(1)</script>'}]};
  await renderGoals({screen,admin,canEdit:true,codes:[],api:async(path:string,input:any)=>{calls.push({path,input});return payload;},esc:escape,form(){},field(){return '';},openLogin(){}});
  if(admin){assert.match(root.innerHTML,/1 modificación pendiente de revisión/);assert.match(root.innerHTML,/&lt;script&gt;/);assert.ok(!root.innerHTML.includes('<script>'));assert.match(root.innerHTML,/Original/);assert.match(root.innerHTML,/Corregido/);assert.equal(typeof button.onclick,'function');await button.onclick();assert.equal(calls[1].input.kind,'reviewEdits');assert.deepEqual(calls[1].input.data.ids,['edit-1']);}
  else assert.ok(!root.innerHTML.includes('goals-edit-notifications'));
  root.isConnected=false;
 }
});
