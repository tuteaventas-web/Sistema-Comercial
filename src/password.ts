import {randomBytes,scryptSync} from 'node:crypto';
import readline from 'node:readline';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
// Entrada oculta sin registrar la contraseña en argumentos ni historial del shell.
process.stdout.write('Nueva contraseña administrativa (mínimo 12 caracteres): ');
if(!process.stdin.isTTY)throw Error('Ejecute desde una terminal interactiva');
process.stdin.setRawMode(true);process.stdin.resume();let password='';
process.stdin.on('data',(chunk:Buffer)=>{for(const ch of chunk.toString()){if(ch==='\u0003')process.exit(1);if(ch==='\r'||ch==='\n'){if(password.length<12){process.stdout.write('\nContraseña demasiado corta. Intente de nuevo: ');password='';continue;}const salt=randomBytes(24).toString('hex');const hash=scryptSync(password,salt,64).toString('hex');let env=existsSync('.env')?readFileSync('.env','utf8'):readFileSync('.env.example','utf8');env=env.replace(/^ADMIN_PASSWORD_HASH=.*$/m,`ADMIN_PASSWORD_HASH=${salt}:${hash}`);writeFileSync('.env',env);process.stdout.write('\nHash guardado en .env.\n');process.exit(0);}else if(ch==='\u007f'||ch==='\b')password=password.slice(0,-1);else password+=ch;}});
