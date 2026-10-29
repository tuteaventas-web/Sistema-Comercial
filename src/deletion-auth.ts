import {scryptSync,timingSafeEqual} from 'node:crypto';
export function verifyDeletionCredential(row:any,revision:number|undefined,value:any){
 if(!row?.active||row.revision!==revision)throw Error('La cuenta cambiÃ³. Inicia sesiÃ³n nuevamente.');
 const [salt,hash]=String(row.password_hash||'').split(':');const actual=salt?scryptSync(String(value||''),salt,64):Buffer.alloc(0);const stored=hash?Buffer.from(hash,'hex'):Buffer.alloc(1);
 if(actual.length!==stored.length||!timingSafeEqual(actual,stored))throw Error('ContraseÃ±a incorrecta');
}
