import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
const directory=new URL('../.local/',import.meta.url),path=new URL('advisor-credentials.key',directory);
function key(create:boolean){
 // Hosted deployments have no persistent disk; the key comes from the environment instead of .local/.
 if(process.env.ADVISOR_CREDENTIALS_KEY){const value=Buffer.from(process.env.ADVISOR_CREDENTIALS_KEY,'base64');if(value.length!==32)throw Error('ADVISOR_CREDENTIALS_KEY debe tener 32 bytes en base64');return value;}
 if(!existsSync(path)){if(!create)throw Error('No se encontró la clave local de credenciales');mkdirSync(directory,{recursive:true});try{writeFileSync(path,randomBytes(32),{flag:'wx',mode:0o600});}catch(error){if((error as any).code!=='EEXIST')throw error;}}
 const value=readFileSync(path);if(value.length!==32)throw Error('Clave local de credenciales inválida');return value;
}
export function encryptCredential(password:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(true),iv);const encrypted=Buffer.concat([cipher.update(password,'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),encrypted].map(value=>value.toString('base64')).join('.');}
export function decryptCredential(value:string){const [iv,tag,data]=value.split('.').map(part=>Buffer.from(part,'base64'));const cipher=createDecipheriv('aes-256-gcm',key(false),iv);cipher.setAuthTag(tag);return Buffer.concat([cipher.update(data),cipher.final()]).toString('utf8');}
