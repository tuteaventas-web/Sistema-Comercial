// Auditoría compacta: en lugar de copiar todo el estado antes y después de cada operación,
// conserva solo los registros que cambiaron más los que hacen falta para mostrarlos
// (documentos, contratos y clientes relacionados, y los catálogos completos).
const collections=['clients','codes','blocks','events','legacy'];
export function auditSnapshots(before:any,after:any){
 const changed:Record<string,Set<string>>={};
 for(const key of collections){
  const a=new Map((before?.[key]||[]).map((x:any)=>[x.id,JSON.stringify(x)])),b=new Map((after?.[key]||[]).map((x:any)=>[x.id,JSON.stringify(x)]));
  changed[key]=new Set([...a.keys(),...b.keys()].filter(id=>a.get(id)!==b.get(id)) as string[]);
 }
 const include:Record<string,Set<string>>=Object.fromEntries(collections.map(key=>[key,new Set(changed[key])]));
 const each=(key:string,fn:(x:any)=>void)=>{for(const snap of [before,after])for(const x of snap?.[key]||[])if(include[key].has(x.id))fn(x);};
 each('legacy',x=>{if(x.blockId)include.blocks.add(x.blockId);});
 each('events',e=>{for(const l of e.lines||[]){if(l.blockId)include.blocks.add(l.blockId);if(l.codeId)include.codes.add(l.codeId);}});
 each('blocks',b=>{if(b.codeId)include.codes.add(b.codeId);});
 each('codes',c=>{if(c.clientId)include.clients.add(c.clientId);});
 const pick=(snap:any)=>{
  const out:any={catalogs:snap?.catalogs};
  for(const key of collections)out[key]=(snap?.[key]||[]).filter((x:any)=>include[key].has(x.id));
  for(const key of Object.keys(snap||{}))if(!collections.includes(key)&&key!=='catalogs'&&JSON.stringify(before?.[key])!==JSON.stringify(after?.[key]))out[key]=snap[key];
  return out;
 };
 return {before:pick(before),after:pick(after)};
}
