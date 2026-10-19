// Entrada para Vercel: reutiliza el mismo servidor HTTP sin abrir un puerto propio.
import type http from 'node:http';
process.env.APP_NO_LISTEN='1';
const {server}=await import('./server.ts');
export default function handler(req:http.IncomingMessage,res:http.ServerResponse){server.emit('request',req,res);}
