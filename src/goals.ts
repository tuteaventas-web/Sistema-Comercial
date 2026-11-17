import type http from 'node:http';
import type {Pool} from 'pg';
import {createHash,randomUUID} from 'node:crypto';
import {SERVICES,ACTIVITIES,MICHELIN_CLOSER} from '../public/goal-metrics.js';

type Viewer={role:string,account:string,username?:string};
type Advisor={username:string,name:string,active:boolean};

export function prepareGoalRecord(input:any, codes:any[], advisors:Advisor[], viewer:Viewer, previous?:any){
  if(previous&&input.revision!==previous.revision)throw Error('El registro cambió. Actualiza la consulta antes de editar.');
  const date=String(input.date||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw Error('Fecha inválida');
  const selectedCode=codes.find(item=>item.id===input.codeId);
  const code=input.code===undefined
    ? selectedCode?.code||(previous?.codeId===input.codeId?previous?.code:'')
    : typeof input.code==='string'?input.code.trim():'';
  if(!code||code.length>200||/[\u0000-\u001f\u007f]/.test(code))throw Error('Escribe un código de cliente de hasta 200 caracteres');
  const codeId=codes.find(item=>item.code===code)?.id||null;
  const service=SERVICES.find(item=>item.id===input.service);
  if(!service)throw Error('Selecciona un tipo de servicio');
  if(!['Prospecto','Cliente'].includes(input.contractType))throw Error('Selecciona el tipo de contrato');
  const activities:Record<string,any>={};
  for(const activity of ACTIVITIES){
    const username=String(input[activity.id]||'');
    if(!username){activities[activity.id]=null;continue;}
    if(activity.id==='closing'&&username===MICHELIN_CLOSER.username){activities.closing={...MICHELIN_CLOSER};continue;}
    const person=advisors.find(item=>item.username===username&&item.active);
    const original=previous?.activities[activity.id];
    if(!person&&original?.username!==username)throw Error('Selecciona una asesora activa para '+activity.name.toLowerCase());
    activities[activity.id]=person?{username:person.username,name:person.name}:original;
  }
  if(!Object.values(activities).some(Boolean))throw Error('Asigna al menos una actividad');
  const notes=String(input.notes||'').trim();
  if(notes.length>2000)throw Error('La observación admite hasta 2000 caracteres');
  return {
    id:previous?.id||randomUUID(), revision:(previous?.revision||0)+1,
    date,codeId,code,service:service.id,contractType:input.contractType,
    activities,rates:{...service.rates,closing:activities.closing?.username===MICHELIN_CLOSER.username?0:service.rates.closing},notes,
    commissionDenial:previous?.commissionDenial||null,
    createdBy:previous?.createdBy||(viewer.role==='admin'?'administrador':viewer.username),
    createdAt:previous?.createdAt||new Date().toISOString(),
    updatedBy:viewer.account,updatedAt:new Date().toISOString()
  };
}

export async function handleGoals(
  req:http.IncomingMessage,url:URL,pool:Pool|null,viewer:Viewer|undefined,
  readBody:()=>Promise<Buffer>,send:(status:number,value:any)=>void
){
  if(!viewer||!['admin','advisor'].includes(viewer.role)){send(403,{error:'Inicia sesión para consultar Metas comerciales'});return;}
  if(!pool)throw Error('Base de datos no configurada');
  if(req.method==='GET'){
    const month=url.searchParams.get('month')||'';
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Selecciona un mes válido');
    const year=month.slice(0,4);
    const [result,accounts]=await Promise.all([
      pool.query('SELECT data FROM commercial_goals WHERE id=1'),
      pool.query('SELECT username,name,active FROM advisor_accounts ORDER BY name')
    ]);
    const data=result.rows[0].data;
    send(200,{records:data.records.filter((item:any)=>item.date.startsWith(year+'-')),targets:data.targets,accounts:accounts.rows});
    return;
  }
  if(req.method!=='POST'){send(405,{error:'Método no permitido'});return;}
  const input=JSON.parse((await readBody()).toString());
  if(!['record','target','commissionStatus'].includes(input.kind))throw Error('Operación inválida');
  if(typeof input.key!=='string'||input.key.length<8||input.key.length>100)throw Error('Identificador de operación inválido');
  if(input.kind==='target'&&viewer.role!=='admin'){send(403,{error:'Solo el administrador puede modificar la meta'});return;}
  if(input.kind==='commissionStatus'&&viewer.role!=='admin'){send(403,{error:'Solo el administrador puede negar o restablecer una comisión'});return;}
  const digest=createHash('sha256').update(JSON.stringify({kind:input.kind,data:input.data,actor:viewer.account})).digest('hex');
  const db=await pool.connect();
  try{
    await db.query('BEGIN');
    const data=(await db.query('SELECT data FROM commercial_goals WHERE id=1 FOR UPDATE')).rows[0].data;
    if(data.requests[input.key]){
      if(data.requests[input.key]!==digest)throw Error('La operación ya fue utilizada con otros datos');
      await db.query('ROLLBACK');send(200,{ok:true});return;
    }
    const payload=input.data||{};
    let before:any,after:any;
    if(input.kind==='target'){
      if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(payload.month)||!Number.isSafeInteger(payload.quantity)||payload.quantity<1||payload.quantity>10000)throw Error('Indica un mes y una meta entera mayor a cero');
      before=data.targets[payload.month]??8;
      if(payload.previous!==before)throw Error('La meta cambió. Actualiza la consulta.');
      data.targets[payload.month]=payload.quantity;
      after=payload.quantity;
    }else if(input.kind==='commissionStatus'){
      const previous=data.records.find((item:any)=>item.id===payload.id);
      if(!previous)throw Error('Registro inexistente');
      if(payload.revision!==previous.revision)throw Error('El registro cambió. Actualiza la consulta.');
      if(typeof payload.denied!=='boolean')throw Error('Estado de comisión inválido');
      const reason=String(payload.reason||'').trim();
      if((payload.denied&&!reason)||reason.length>2000)throw Error('Indica el motivo de la comisión denegada (máximo 2000 caracteres)');
      const at=new Date().toISOString();
      before=previous;
      after={...previous,revision:previous.revision+1,commissionDenial:payload.denied?{reason,account:viewer.account,at}:null,updatedBy:viewer.account,updatedAt:at};
      data.records[data.records.indexOf(previous)]=after;
    }else{
      const previous=payload.id?data.records.find((item:any)=>item.id===payload.id):undefined;
      if(payload.id&&!previous)throw Error('Registro inexistente');
      const [files,accounts]=await Promise.all([db.query('SELECT data FROM app_state WHERE id=1'),db.query('SELECT username,name,active FROM advisor_accounts')]);
      after=prepareGoalRecord(payload,files.rows[0].data.codes,accounts.rows,viewer,previous);
      before=previous||null;
      if(previous)data.records[data.records.indexOf(previous)]=after;
      else data.records.push(after);
    }
    data.audit.push({at:new Date().toISOString(),account:viewer.account,kind:input.kind,month:payload.month||after.date.slice(0,7),before,after});
    data.requests[input.key]=digest;
    await db.query('UPDATE commercial_goals SET data=$1 WHERE id=1',[JSON.stringify(data)]);
    await db.query('COMMIT');send(200,{ok:true});
  }catch(error){await db.query('ROLLBACK');throw error;}
  finally{db.release();}
}
