// Reglas compartidas por la consulta y la descarga Excel.
function validateRange(q) {
  for (const key of ['start', 'end']) {
    const value = q.get(key);
    if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) !== value)) {
      throw Error('Fecha de filtro inválida');
    }
  }
  if (q.get('start') && q.get('end') && q.get('start') > q.get('end')) throw Error('El rango de fechas está invertido');
}

/** @param {any} s @param {URLSearchParams} q @param {boolean} history @returns {any[]} */
export function filterBlocks(s, q, history = false) {
  validateRange(q);
  const search = (q.get('q') || '').trim().toLocaleLowerCase('es');
  const events = s.events.filter(e => !e.deleted);
  const codes = new Map(s.codes.map(c => [c.id,c]));
  const clients = new Map(s.clients.map(c => [c.id,c]));
  const clientCodes = new Map();
  for (const c of s.codes) { if (!clientCodes.has(c.clientId)) clientCodes.set(c.clientId,[]); clientCodes.get(c.clientId).push(c); }
  const byBlock = new Map();
  for (const e of events) for (const blockId of new Set(e.lines.map(l => l.blockId))) { if (!byBlock.has(blockId)) byBlock.set(blockId,[]); byBlock.get(blockId).push(e); }
  const lastMovement = new Map();
  for (const event of events) for (const blockId of new Set(event.lines.filter(line=>!line.deleted).map(line=>line.blockId))) {
    const previous=lastMovement.get(blockId);
    if (!previous || String(event.date||'').localeCompare(String(previous.date||''))>0 || (event.date===previous.date && String(event.at||'').localeCompare(String(previous.at||''))>0)) lastMovement.set(blockId,event);
  }
  const movementDate = b => String(lastMovement.get(b.id)?.date || b.date || '');
  const movementTime = b => String(lastMovement.get(b.id)?.at || '');
  const registration = b => String(b.createdAt || (byBlock.get(b.id)||[]).find(e=>e.action==='Recepción'&&e.lines.some(l=>!l.deleted&&l.blockId===b.id))?.at || b.date || '');
  return s.blocks.filter(b => !b.deleted).map(b => ({ ...b, balances: b.balances || [] })).filter(b => {
    const code = codes.get(b.codeId);
    const ownEvents = (byBlock.get(b.id) || []);
    const identities = [code];
    if (history) for (const e of ownEvents) for (const l of e.lines.filter(l => l.blockId === b.id)) identities.push(codes.get(l.codeId || b.codeId));
    const identityMatches = identities.some(c => c && (!q.get('client') || c.clientId === q.get('client')) && (!search || clients.get(c.clientId)?.name.toLocaleLowerCase('es').includes(search) || (clientCodes.get(c.clientId) || []).some(x => x.code.toLocaleLowerCase('es').includes(search))));
    if (!identityMatches || q.get('type') && b.typeId !== q.get('type')) return false;
    if (!history && q.get('code') && b.codeId !== q.get('code')) return false;
    if ((q.get('place') || q.get('storage')) && !b.balances.some(x => (!q.get('place') || x.place === q.get('place')) && (!q.get('storage') || x.storage === q.get('storage')))) return false;
    if (!history) {
      if ((q.get('start')||q.get('end'))&&!b.date) return false;
      if (q.get('start') && b.date < q.get('start') || q.get('end') && b.date > q.get('end')) return false;
      if ((q.get('responsible') || q.get('action')) && !ownEvents.some(e => (!q.get('responsible') || e.responsible === q.get('responsible')) && (!q.get('action') || e.action === q.get('action')))) return false;
    }
    return true;
  }).sort((a, b) => ((q.get('sort')==='registration'?registration(a).localeCompare(registration(b)):movementDate(a).localeCompare(movementDate(b))||movementTime(a).localeCompare(movementTime(b))) || String(a.date||'').localeCompare(String(b.date||'')) || (a.sourceImport?.row||0)-(b.sourceImport?.row||0) || a.id.localeCompare(b.id)) * (q.get('order') === 'asc' ? 1 : -1));
}

/** @param {any} s @param {URLSearchParams} q @returns {any[]} */
export function filterEvents(s, q) {
  const blocks = filterBlocks(s, q, true);
  const selected = new Map(blocks.map(b => [b.id, b]));
  return s.events.filter(e => !e.deleted && (!q.get('start') || e.date >= q.get('start')) && (!q.get('end') || e.date <= q.get('end')) && (!q.get('responsible') || e.responsible === q.get('responsible')) && (!q.get('action') || e.action === q.get('action'))).map(e => ({ ...e, lines: e.lines.filter(l => !l.deleted && selected.has(l.blockId) && (!q.get('code') || (l.codeId || selected.get(l.blockId).codeId) === q.get('code')) && (!q.get('client') || s.codes.find(c => c.id === (l.codeId || selected.get(l.blockId).codeId))?.clientId === q.get('client'))) })).filter(e => e.lines.length).sort((a, b) => (String(a.date||'').localeCompare(String(b.date||'')) || String(a.at||'').localeCompare(String(b.at||'')) || a.id.localeCompare(b.id)) * (q.get('order') === 'asc' ? 1 : -1));
}
