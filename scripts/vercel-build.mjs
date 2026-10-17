// Genera .vercel/output (Build Output API v3): una única función Node que sirve la API y la interfaz.
import {spawnSync} from 'node:child_process';
import {cpSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
const out='.vercel/output',fn=out+'/functions/index.func';
rmSync(out,{recursive:true,force:true});mkdirSync(fn+'/api',{recursive:true});
// esbuild se ejecuta con npx para no alterar las dependencias del uso local.
const banner="import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);";
const result=spawnSync('npx',['-y','esbuild@0.25.12','src/vercel.ts','--bundle','--platform=node','--target=node24','--format=esm','--external:pg-native','--outfile='+fn+'/api/index.mjs'],{stdio:'inherit',shell:process.platform==='win32'});
if(result.status!==0)process.exit(result.status||1);
// exceljs es CommonJS: el paquete ESM necesita un require real para los módulos de Node.
writeFileSync(fn+'/api/index.mjs',banner+'\n'+readFileSync(fn+'/api/index.mjs','utf8'));
// El servidor lee ../public y ../migrations relativo a su propio archivo.
cpSync('public',fn+'/public',{recursive:true});cpSync('migrations',fn+'/migrations',{recursive:true});
writeFileSync(fn+'/package.json',JSON.stringify({type:'module'}));
writeFileSync(fn+'/.vc-config.json',JSON.stringify({runtime:'nodejs24.x',handler:'api/index.mjs',launcherType:'Nodejs',shouldAddHelpers:false,supportsResponseStreaming:true,maxDuration:60}));
writeFileSync(out+'/config.json',JSON.stringify({version:3,routes:[{src:'/(.*)',dest:'/index'}]}));
console.log('Salida de Vercel lista en '+out);
