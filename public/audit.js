const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = value => value ? value.split('-').reverse().join('/') : 'Sin fecha';
const kinds = {deleteBlocks:'Eliminación de bloque completo',deleteClient:'Eliminación de cliente',catalogDelete:'Eliminación de opción de catálogo',catalogReorder:'Orden de catálogo',openingStockImport:'Carga de saldos iniciales desde Excel',cleanupClients:'Eliminación de clientes',cleanupDemo:'Limpieza de datos de prueba',restoreBlock:'Restauración de bloque',restoreEvent:'Restauración de movimiento',client:'Alta de cliente',editClient:'Corrección de cliente',code:'Vinculación o vigencia de contrato',catalog:'Cambio de catálogo',receive:'Ingreso de documentos',move:'Movimiento',editBlock:'Corrección de bloque',eventCorrection:'Corrección o eliminación de movimiento',deleteBlock:'Eliminación de bloque',reopen:'Reapertura',import:'Importación de legados',reconcile:'Conciliación explícita'};
const find = (items, id) => (items || []).find(x => x.id === id);
const catalog = (s, key, id) => find(s.catalogs?.[key], id)?.name || 'Sin especificar';
const contract = (s, id) => {const c=find(s.codes,id);return c?`${c.code} · ${find(s.clients,c.clientId)?.name||'Sin nombre'}`:'Sin especificar';};
function values(s, group, item) {
  if (!item) return {};
  if (group === 'clients') return {Nombre:item.name};
  if (group === 'codes') return {'Código original':item.code,Cliente:find(s.clients,item.clientId)?.name,Vigente:item.current?'Sí':'No','Vigente desde':date(item.validFrom),'Vigente hasta':date(item.validTo)};
  if (group === 'blocks') return {Contrato:contract(s,item.codeId),Tipo:catalog(s,'types',item.typeId),Descripción:item.description,'Fecha de ingreso':date(item.date),Observación:item.notes,Estado:item.deleted?'Eliminado':'Activo'};
  if (group === 'events') return {Acción:item.action,'Fecha efectiva':date(item.date),Responsable:catalog(s,'responsible',item.responsible),'Cuenta que registra':item.account,'Quién entrega':item.deliveredBy,Observación:item.notes,Estado:item.deleted?'Eliminado':'Activo',Detalle:item.lines.map(l=>`${contract(s,l.codeId||find(s.blocks,l.blockId)?.codeId)} · ${find(s.blocks,l.blockId)?.description||'Bloque'} · ${l.quantity===null?'Cantidad desconocida':l.quantity+' unidades'} · ${l.from||'Ingreso'}${l.fromStorage?' / '+l.fromStorage:''} → ${l.to}${l.storage?' / '+l.storage:''}${l.deleted?' · Eliminado':''}`).join('\n')};
  if (group === 'legacy') return {'Datos originales':Object.entries(item.original||{}).map(([k,v])=>`${k}: ${v}`).join('\n'),Estado:item.pending?'Pendiente de conciliación':'Conciliado','Bloque vinculado':find(s.blocks,item.blockId)?.description||'Sin vínculo',Motivo:item.reason||''};
  return {Nombre:item.name,Estado:item.active?'Activo':'Inactivo'};
}
export function auditHTML(entry) {
  const groups={clients:'Clientes',codes:'Contratos',blocks:'Bloques',events:'Movimientos',legacy:'Legados','catalogs.responsible':'Responsables','catalogs.types':'Tipos','catalogs.storage':'Almacenamiento'};
  const changes=[];
  for (const [key,label] of Object.entries(groups)) {
    const list=s=>key.startsWith('catalogs.')?(s.catalogs?.[key.split('.')[1]]||[]):(s[key]||[]);
    const before=list(entry.before||{}),after=list(entry.after||{});
    if(entry.kind==='catalogReorder'&&key.startsWith('catalogs.')&&JSON.stringify(before.map(item=>item.id))!==JSON.stringify(after.map(item=>item.id))){changes.push(`<div class="line"><strong>${label} · Orden</strong><p>Antes: ${before.map(item=>escape(item.name)).join(' → ')}</p><p>Después: ${after.map(item=>escape(item.name)).join(' → ')}</p></div>`);}
    for (const identifier of new Set([...before,...after].map(x=>x.id))) {
      const old=find(before,identifier),next=find(after,identifier);if(JSON.stringify(old)===JSON.stringify(next))continue;
      const a=values(entry.before||{},key,old),b=values(entry.after||{},key,next);
      const rows=[...new Set([...Object.keys(a),...Object.keys(b)])].filter(k=>a[k]!==b[k]).map(k=>`<tr><th scope="row">${escape(k)}</th><td>${escape(a[k]??'No existía')}</td><td>${escape(b[k]??'Sin registro')}</td></tr>`).join('');
      if(rows)changes.push(`<details class="line"><summary>${label} · ${escape(next?.name||old?.name||next?.description||old?.description||next?.code||old?.code||next?.action||old?.action||'Registro')}</summary><div class="audit-table"><table><thead><tr><th>Campo</th><th>Antes</th><th>Después</th></tr></thead><tbody>${rows}</tbody></table></div></details>`);
    }
  }
  return `<details class="line"><summary>${escape(new Date(entry.at).toLocaleString('es-PE',{timeZone:'America/Lima'}))} · ${escape(kinds[entry.kind]||entry.kind)}</summary><p>Cuenta: ${escape(entry.account)} · Motivo: ${escape(entry.reason||'Operación registrada')}</p>${changes.join('')||'<p>No se alteraron datos de negocio.</p>'}</details>`;
}
