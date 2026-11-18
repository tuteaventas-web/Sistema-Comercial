import type http from 'node:http';
import type {Pool} from 'pg';
import {clientEditNotifications} from '../public/audit.js';

export async function handleClientEditNotifications(req:http.IncomingMessage,pool:Pool|null,viewer:{role:string,account:string}|undefined,readBody:()=>Promise<Buffer>,send:(status:number,value:any)=>void){
  if(viewer?.role!=='admin'){send(403,{error:'Acceso administrativo requerido'});return;}
  if(!pool)throw Error('Base de datos no configurada');
  if(req.method==='GET'){
    const data=(await pool.query('SELECT data FROM app_state WHERE id=1')).rows[0].data;
    send(200,{notifications:clientEditNotifications(data.audit)});return;
  }
  if(req.method!=='POST'){send(405,{error:'Método no permitido'});return;}
  const input=JSON.parse((await readBody()).toString());
  if(typeof input.id!=='string'||!input.id||input.id.length>200)throw Error('Selecciona una modificación válida');
  const db=await pool.connect();
  try{
    await db.query('BEGIN');
    const data=(await db.query('SELECT data FROM app_state WHERE id=1 FOR UPDATE')).rows[0].data;
    const entry=clientEditNotifications(data.audit).find((item:any)=>item.id===input.id);
    if(!entry)throw Error('Modificación inexistente');
    if(!entry.clientEditReviewedAt){entry.clientEditReviewedAt=new Date().toISOString();entry.clientEditReviewedBy=viewer.account;
      await db.query('UPDATE app_state SET data=$1,version=version+1 WHERE id=1',[JSON.stringify(data)]);
    }
    await db.query('COMMIT');send(200,{ok:true});
  }catch(error){await db.query('ROLLBACK');throw error;}
  finally{db.release();}
}
