import {existsSync,mkdirSync,readFileSync,writeFileSync,unlinkSync,openSync,closeSync} from 'node:fs';
import {resolve,dirname} from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync,spawn} from 'node:child_process';import {randomBytes,scryptSync} from 'node:crypto';import pg from 'pg';
import {postgresStartupMessage} from './diagnostics.ts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');process.chdir(root);const local=resolve(root,'.local');mkdirSync(local,{recursive:true});
const portable=resolve(root,'../../work/postgresql/pgsql/bin');const bin=process.env.PG_BIN||portable;
const data=resolve(local,'pgdata');const ctl=resolve(bin,'pg_ctl.exe');const port=55432;let databaseProcess:ReturnType<typeof spawn>|undefined;
function run(executable:string,args:string[],allowFailure=false){const r=spawnSync(executable,args,{windowsHide:true,encoding:'utf8'});if(r.status!==0&&!allowFailure)throw Error(r.stderr||r.stdout||r.error?.message||'No se pudo ejecutar '+executable);return r;}
async function pgStart(){
 const status=run(ctl,['-D',data,'status'],true);if(status.status===0)return;
 await new Promise<void>((resolveReady,reject)=>{
  const log=openSync(resolve(local,'postgresql.log'),'a');
  const child=spawn(resolve(bin,'postgres.exe'),['-D',data,'-h','127.0.0.1','-p',String(port)],{windowsHide:true,stdio:['ignore',log,'pipe']});closeSync(log);databaseProcess=child;
  let ready=false,output='';const timer=setTimeout(()=>reject(Error('PostgreSQL no respondió en 30 segundos; revise .local/postgresql.log')),30000);
  child.stderr?.on('data',(chunk:Buffer)=>{writeFileSync(resolve(local,'postgresql.log'),chunk,{flag:'a'});output=(output+chunk.toString()).slice(-4096);if(!ready&&output.includes('ready to accept connections')){ready=true;clearTimeout(timer);resolveReady();}});
  child.on('error',error=>{clearTimeout(timer);reject(error);});
  child.on('exit',code=>{clearTimeout(timer);if(!ready)reject(Error(postgresStartupMessage(output,port)));else if(code)console.error('PostgreSQL se detuvo inesperadamente; revise .local/postgresql.log.');});
 });
}
async function setup(){
 if(!existsSync(resolve(bin,'initdb.exe')))throw Error('No se encontraron binarios PostgreSQL. Configure PG_BIN con la carpeta bin de PostgreSQL local.');
 if(!existsSync(resolve(data,'PG_VERSION'))){
  const password=randomBytes(32).toString('hex');const pwfile=resolve(local,'init-password');writeFileSync(pwfile,password,{mode:0o600});
  try{run(resolve(bin,'initdb.exe'),['-D',data,'-U','archivo_bootstrap','--encoding=UTF8','--locale=C','--auth=scram-sha-256','--pwfile='+pwfile]);writeFileSync(resolve(local,'bootstrap.json'),JSON.stringify({password}),{mode:0o600});}finally{if(existsSync(pwfile))unlinkSync(pwfile);}
 }
 await pgStart();
 if(!existsSync('.env')){
  const bootstrap=JSON.parse(readFileSync(resolve(local,'bootstrap.json'),'utf8'));const db=new pg.Client({host:'127.0.0.1',port,user:'archivo_bootstrap',password:bootstrap.password,database:'postgres',connectionTimeoutMillis:10000});await db.connect();
  try{const password=randomBytes(32).toString('hex');const roles=await db.query("SELECT 1 FROM pg_roles WHERE rolname='archivo_app'");if(!roles.rowCount)await db.query(`CREATE ROLE archivo_app LOGIN PASSWORD '${password}'`);else throw Error('El rol ya existe pero falta .env. Recupere su configuración; no se restableció la contraseña.');await db.query('CREATE DATABASE archivo_clientes OWNER archivo_app');
   const admin=randomBytes(18).toString('base64url');const salt=randomBytes(24).toString('hex');const hash=scryptSync(admin,salt,64).toString('hex');writeFileSync('.env',`DATABASE_URL=postgresql://archivo_app:${password}@127.0.0.1:${port}/archivo_clientes\nADMIN_PASSWORD_HASH=${salt}:${hash}\nHOST=127.0.0.1\nPORT=3000\n`,{mode:0o600});writeFileSync(resolve(local,'acceso-inicial.txt'),`Contraseña administrativa inicial: ${admin}\nCambiar con: node src/password.ts\nNo compartir este archivo ni incorporarlo al repositorio.\n`,{mode:0o600});
  }finally{await db.end();}
 }
 console.log('PostgreSQL local listo en 127.0.0.1:55432. Configuración privada en .env. Acceso administrativo inicial en .local/acceso-inicial.txt.');
}
const command=process.argv[2]||'start';
let application:{shutdown:()=>Promise<void>}|undefined;
try {
if(command==='setup'){await setup();if(databaseProcess)run(ctl,['-D',data,'-m','fast','-w','stop']);}
else if(command==='start'){
 await setup();for(const line of readFileSync('.env','utf8').split(/\r?\n/)){const index=line.indexOf('=');if(index>0)process.env[line.slice(0,index)]=line.slice(index+1);}if(process.argv.includes('--demo'))run(process.execPath,['--env-file=.env','src/seed.ts','--demo']);process.env.APP_NO_LISTEN='1';const app=await import('../src/server.ts');application=app;
 await new Promise<void>((resolveReady,reject)=>{app.server.once('error',reject);app.server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>{app.server.removeListener('error',reject);resolveReady();});}).catch(error=>{if((error as any).code==='EADDRINUSE')throw Error(`El puerto de la aplicación ${process.env.PORT||3000} está ocupado. Cierre su instancia anterior o configure otro PORT en .env.`);throw error;});
 console.log(`Aplicación: http://127.0.0.1:${process.env.PORT||3000} · Mantenga esta terminal abierta. Ctrl+C para detener.`);
 let closing=false;const close=async()=>{if(closing)return;closing=true;await app.shutdown();application=undefined;if(databaseProcess)run(ctl,['-D',data,'-m','fast','-w','stop']);};process.on('SIGINT',close);process.on('SIGTERM',close);
 if(process.argv.includes('--check')){if(!app.server.listening)await new Promise<void>(r=>app.server.once('listening',r));try{for(const path of ['/api/session','/api/data','/query.js']){const response=await fetch('http://127.0.0.1:'+(process.env.PORT||3000)+path,{signal:AbortSignal.timeout(10000)});if(response.status!==200)throw Error('Falló la comprobación de arranque: '+path);await response.text();}console.log('Arranque local verificado: sesión, datos persistidos y módulo de filtros (HTTP 200).');}finally{await close();}}
}else if(command==='stop'){
 if(existsSync(resolve(data,'PG_VERSION')))run(ctl,['-D',data,'-m','fast','-w','stop']);console.log('Servicios locales detenidos.');
}else throw Error('Comandos: setup, start, stop');

} catch(error) { if(application)await application.shutdown();if(databaseProcess&&databaseProcess.exitCode===null)run(ctl,['-D',data,'-m','fast','-w','stop'],true);console.error(error instanceof Error?error.message:String(error));process.exitCode=1; }
