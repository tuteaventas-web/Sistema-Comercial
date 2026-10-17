// Public projection of correction audit: never expose full snapshots to advisors.
export function editHistory(state:any,visible:Set<string>){
 const result:any[]=[];
 for(const audit of state.audit||[]){
  if(!['eventCorrection','editBlock'].includes(audit.kind))continue;
  for(const blockId of visible){
   const beforeBlock=audit.before?.blocks?.find((b:any)=>b.id===blockId),afterBlock=audit.after?.blocks?.find((b:any)=>b.id===blockId);
   const beforeEvents=(audit.before?.events||[]).filter((e:any)=>e.lines.some((l:any)=>l.blockId===blockId));
   const changes=beforeEvents.flatMap((before:any)=>{
    const after=audit.after?.events?.find((e:any)=>e.id===before.id);
    if(!after||JSON.stringify(before)===JSON.stringify(after))return [];
    const oldLine=before.lines.find((l:any)=>l.blockId===blockId),line=after.lines.find((l:any)=>l.blockId===blockId);
    if(!line)return [];
    return [{eventId:before.id,before:{date:before.date,place:oldLine.to,storage:oldLine.storage||''},after:{date:after.date,place:line.to,storage:line.storage||''}}];
   });
   if(!changes.length&&audit.kind==='editBlock'&&beforeBlock&&afterBlock&&JSON.stringify(beforeBlock)!==JSON.stringify(afterBlock))changes.push({eventId:null,before:{date:beforeBlock.date,place:beforeBlock.openingBalance?.place||'',storage:beforeBlock.openingBalance?.storage||''},after:{date:afterBlock.date,place:afterBlock.openingBalance?.place||'',storage:afterBlock.openingBalance?.storage||''}});
   for(const change of changes)result.push({id:audit.id,blockId,at:audit.at,account:audit.account||'Usuario no registrado',kind:audit.kind,...change});
  }
 }
 return result;
}
