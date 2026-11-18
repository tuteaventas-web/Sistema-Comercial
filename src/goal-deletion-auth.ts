import type {Pool} from 'pg';
import {scryptSync,timingSafeEqual} from 'node:crypto';
type Viewer={role:string,account:string,username?:string,revision?:number};
const attempts=new Map<string,{count:number,at:number}>();
export function verifyGoalDeletionCredential(viewer:Viewer,row:any,adminHash:string,value:any){
  if(viewer.role!=='admin'&&viewer.role!=='advisor')throw Error('Inicia sesión para eliminar una comisión');
  if(viewer.role==='advisor'&&(!row?.active||row.revision!==viewer.revision))throw Error('La cuenta cambió. Inicia sesión nuevamente.');
  const [salt,hash]=String(viewer.role==='admin'?adminHash:row.password_hash||'').split(':');
  const actual=salt?scryptSync(String(value||''),salt,64):Buffer.alloc(0),stored=hash?Buffer.from(hash,'hex'):Buffer.alloc(1);
  if(!actual.length||actual.length!==stored.length||!timingSafeEqual(actual,stored))throw Error('Contraseña o PIN incorrectos');
}
export async function authorizeGoalDeletion(pool:Pool|null,viewer:Viewer|undefined,password:any,adminHash:string){
  if(!viewer||!['admin','advisor'].includes(viewer.role))throw Error('Inicia sesión para eliminar una comisión');
  const identity=viewer.role+':'+(viewer.username||viewer.account);let attempt=attempts.get(identity);
  if(!attempt||Date.now()-attempt.at>900000){attempt={count:0,at:Date.now()};attempts.set(identity,attempt);}
  if(attempt.count>=10)throw Error('Demasiados intentos. Espere 15 minutos.');
  const row=viewer.role==='advisor'?(await pool?.query('SELECT password_hash,active,revision FROM advisor_accounts WHERE username=$1',[viewer.username]))?.rows[0]:null;
  try{verifyGoalDeletionCredential(viewer,row,adminHash,password);}catch(error){attempt.count++;throw error;}
  attempt.count=0;
}
