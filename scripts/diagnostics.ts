export function postgresStartupMessage(output:string,port:number){
 if(output.includes('could not bind')||output.includes('Address already in use'))return `No se pudo usar el puerto local ${port}: está ocupado. Cierre la instancia local existente antes de iniciar otra y revise .local/postgresql.log. No se intentó detener el proceso que ocupa el puerto.`;
 if(output.includes('postmaster.pid')&&output.includes('already exists'))return 'Otra instancia está utilizando esta base local. Cierre esa instancia antes de iniciar otra. Revise .local/postgresql.log.';
 return 'PostgreSQL terminó antes de estar listo. Revise .local/postgresql.log.';
}
