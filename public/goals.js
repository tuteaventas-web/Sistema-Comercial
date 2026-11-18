import {SERVICES,ACTIVITIES,monthlyMetrics,MICHELIN_CLOSER,recordCommission} from './goal-metrics.js';

let selectedMonth=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit'}).format(new Date()).slice(0,7);
const money=value=>new Intl.NumberFormat('es-PE',{style:'currency',currency:'PEN'}).format(value/100);
const monthName=value=>new Intl.DateTimeFormat('es-PE',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(value+'-01T12:00:00Z'));


export function commissionChanges(before,after){
  const fields=[['date','Fecha'],['code','Código del cliente'],['service','Servicio'],['contractType','Contrato'],['notes','Observaciones'],...ACTIVITIES.map(activity=>[activity.id,activity.name])];
  const value=(record,key)=>ACTIVITIES.some(activity=>activity.id===key)?record.activities?.[key]?.name||'Sin asignar':key==='service'?SERVICES.find(service=>service.id===record.service)?.name||record.service:record[key]||'—';
  return fields.filter(([key])=>JSON.stringify(ACTIVITIES.some(activity=>activity.id===key)?before.activities?.[key]:before[key])!==JSON.stringify(ACTIVITIES.some(activity=>activity.id===key)?after.activities?.[key]:after[key])).map(([key,label])=>({label,before:value(before,key),after:value(after,key)}));
}

export async function renderGoals(context){
  const {screen,api,admin,esc,form,field,openLogin}=context;
  screen.innerHTML='<section id="goals-module" class="goals-module"><p role="status">Cargando metas comerciales…</p></section>';
  const root=screen.firstElementChild;
  if(!context.canEdit){
    root.innerHTML='<div class="panel goals-login"><h2>Metas comerciales</h2><p>Inicia sesión con tu usuario para consultar metas y comisiones.</p><button type="button" id="goals-login" class="primary">Iniciar sesión</button></div>';
    root.querySelector('#goals-login').onclick=openLogin;
    return;
  }
  let data;
  const find=selector=>root.querySelector(selector);

  function recordForm(previous){
    const values=previous||{};
    const advisorOptions=activity=>{
      const existing=values.activities?.[activity.id];
      const people=data.accounts.filter(person=>person.active||person.username===existing?.username);
      if(activity.id==='closing')people.push({...MICHELIN_CLOSER,active:true});
      if(existing&&!people.some(person=>person.username===existing.username))people.push({...existing,active:false});
      return '<option value="">Sin asignar</option>'+people.map(person=>'<option value="'+esc(person.username)+'" '+(existing?.username===person.username?'selected':'')+'>'+esc(person.name)+(person.active?'':' · Inactiva')+'</option>').join('');
    };
    const codeValue=values.code||context.codes.find(code=>code.id===values.codeId)?.code||'';
    const date=values.date||selectedMonth+'-'+(selectedMonth===new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit'}).format(new Date()).slice(0,7)?new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',day:'2-digit'}).format(new Date()):'01');
    form(previous?'Editar comisión':'Registrar comisión',
      field('Fecha','date','date',date)+
      (values.commissionDenial?'<div class="goals-denial-note" role="note"><strong>Comisión denegada</strong><p>'+esc(values.commissionDenial.reason)+'</p></div>':'')+
      field('Código del cliente','code','text',codeValue)+
      '<div class="goals-form-grid"><label>Tipo de servicio *<select name="service" required><option value="">Seleccione</option>'+SERVICES.filter(service=>!service.legacy||values.service===service.id).map(service=>'<option value="'+service.id+'" '+(values.service===service.id?'selected':'')+'>'+service.name+'</option>').join('')+'</select></label><label>Tipo de contrato *<select name="contractType" required>'+['Prospecto','Cliente'].map(type=>'<option '+(values.contractType===type?'selected':'')+'>'+type+'</option>').join('')+'</select></label></div>'+
      '<fieldset class="goals-activities"><legend>Responsable de cada actividad</legend>'+ACTIVITIES.map(activity=>'<label>'+activity.name+'<select name="'+activity.id+'">'+advisorOptions(activity)+'</select></label>').join('')+'</fieldset><p class="hint">Solo Cierre de venta suma al avance de la meta compartida. Firma y Registro generan su comisión correspondiente.</p><div id="goals-calculation" class="goals-calculation" aria-live="polite"></div>'+
      field('Observaciones','notes','text',values.notes||'',false),async(values,key)=>{
        const input=Object.fromEntries(values);
        if(previous){input.id=previous.id;input.revision=previous.revision;}
        await api('goals',{kind:'record',key,data:input});
        selectedMonth=String(input.date).slice(0,7);
        await refresh();
      });
    const editor=document.querySelector('#form');
    const calculate=()=>{
      const service=SERVICES.find(item=>item.id===editor.querySelector('[name=service]').value);
      const total=service?ACTIVITIES.reduce((sum,activity)=>{
        const responsible=editor.querySelector('[name='+activity.id+']').value;
        const freeClosing=activity.id==='closing'&&responsible===MICHELIN_CLOSER.username;
        return sum+(responsible&&!freeClosing?service.rates[activity.id]:0);
      },0):0;
      editor.querySelector('#goals-calculation').textContent=(values.commissionDenial?'Comisión denegada · ':'Comisión del registro · ')+money(values.commissionDenial?0:total);
    };
    editor.querySelectorAll('select').forEach(select=>select.addEventListener('change',calculate));
    calculate();
  }

  function commissionStatusForm(record){
    const denied=!record.commissionDenial;
    form(denied?'Negar comisión':'Restablecer comisión',
      '<p>'+esc(record.code)+' · '+esc(SERVICES.find(service=>service.id===record.service)?.name)+'</p>'+
      (denied?'<p>La comisión de este registro pasará a S/ 0 y el motivo será visible para las asesoras.</p>':'<p>La comisión volverá a calcularse con las tarifas de este registro.</p>')+
      field(denied?'Motivo de la comisión denegada':'Observación','reason','text','',denied),async(values,key)=>{
        await api('goals',{kind:'commissionStatus',key,data:{id:record.id,revision:record.revision,denied,reason:values.get('reason')}});
        await refresh();
      });
  }

  function recordRow(record){
    const denial=record.commissionDenial;
    const editIcon='<svg class="icon" aria-hidden="true"><use href="#i-edit"/></svg>';
    const statusIcon=denial?'<svg class="icon" aria-hidden="true"><use href="#i-check"/></svg>':'<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
    return `<tr class="${denial?'goals-record-denied':''}"><td>${esc(record.date.split('-').reverse().join('/'))}</td><th scope="row">${esc(record.code)}</th><td>${esc(SERVICES.find(service=>service.id===record.service)?.name)}</td><td>${esc(record.contractType)}</td>${ACTIVITIES.map(activity=>'<td>'+esc(record.activities[activity.id]?.name||'—')+'</td>').join('')}<td class="goals-record-amount">${money(recordCommission(record))}${denial?'<small>Denegada</small>':''}</td><td class="goals-notes">${record.notes?'<p>'+esc(record.notes)+'</p>':denial?'':'—'}${denial?'<div class="goals-denial-note"><strong>Comisión denegada</strong><p>'+esc(denial.reason)+'</p></div>':''}</td><td><div class="goals-record-actions">${admin?'<button type="button" class="'+(denial?'':'danger')+'" data-goals-status="'+esc(record.id)+'" title="'+(denial?'Restablecer comisión':'Negar comisión')+'" aria-label="'+(denial?'Restablecer comisión de ':'Negar comisión de ')+esc(record.code)+'">'+statusIcon+'</button>':''}<button type="button" data-goals-edit="${esc(record.id)}" title="Editar comisión" aria-label="Editar comisión de ${esc(record.code)}">${editIcon}</button></div></td></tr>`;
  }

  function notificationsHTML(){
    if(!admin)return '';
    const entries=[...(data.notifications||[])].sort((a,b)=>Number(!!a.reviewedAt)-Number(!!b.reviewedAt)||b.at.localeCompare(a.at));
    const pending=entries.filter(entry=>!entry.reviewedAt).length;
    return '<section class="panel" id="goals-edit-notifications" aria-label="Modificaciones de asesores"><h2>Modificaciones de asesores</h2><p role="status" aria-live="polite">'+(pending?pending+' '+(pending===1?'modificación pendiente de revisión':'modificaciones pendientes de revisión'):'Sin modificaciones pendientes de revisión')+'</p>'+entries.map(entry=>'<details class="line" data-goal-notification="'+esc(entry.id)+'"><summary>'+(!entry.reviewedAt?'Pendiente · ':'Revisada · ')+esc(entry.after.code)+' · '+esc(entry.account)+' · '+esc(new Date(entry.at).toLocaleString('es-PE',{timeZone:'America/Lima'}))+'</summary><div class="goals-table-scroll"><table class="goals-table"><thead><tr><th>Campo</th><th>Antes</th><th>Después</th></tr></thead><tbody>'+commissionChanges(entry.before,entry.after).map(change=>'<tr><th scope="row">'+esc(change.label)+'</th><td>'+esc(change.before)+'</td><td>'+esc(change.after)+'</td></tr>').join('')+'</tbody></table></div>'+(!entry.reviewedAt?'<button type="button" data-review-goal-edit="'+esc(entry.id)+'">Marcar como revisada</button>':'')+'</details>').join('')+'</section>';
  }

  function draw(){
    const target=data.targets[selectedMonth]??8;
    const active=data.accounts.filter(person=>person.active);
    const summary=monthlyMetrics(data.records,selectedMonth,target,active);
    const records=data.records.filter(record=>record.date.startsWith(selectedMonth+'-')).sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
    const year=selectedMonth.slice(0,4);
    const months=Array.from({length:12},(_,index)=>{
      const month=year+'-'+String(index+1).padStart(2,'0');
      return {month,...monthlyMetrics(data.records,month,data.targets[month]??8)};
    });
    root.innerHTML=`<div class="goals-toolbar"><label>Mes de consulta<input id="goals-month" type="month" value="${selectedMonth}" required></label><div class="goals-toolbar-actions"><button type="button" id="goals-refresh">Actualizar</button>${admin?'<button type="button" id="goals-target">Modificar meta</button>':''}<button type="button" id="goals-new" class="primary">+ Registrar comisión</button></div></div>
      ${notificationsHTML()}
      <section class="panel goals-overview"><div class="goals-progress"><div class="goals-progress-heading"><div><span class="goals-eyebrow">META COMPARTIDA · ${esc(monthName(selectedMonth))}</span><h2>${summary.sales} <small>de ${target} ventas cerradas</small></h2></div><strong class="goals-percentage">${summary.percentage}%</strong></div><progress max="${target}" value="${Math.min(summary.sales,target)}" aria-label="Avance de la meta mensual compartida"></progress><p>${summary.sales>=target?'Meta cumplida':(target-summary.sales)+' ventas pendientes'} · Participan todas las asesoras activas.</p></div><aside class="goals-advisor-commissions"><h2>Comisiones del mes por asesora</h2><dl>${summary.people.filter(person=>person.username!=='external:michelin'&&person.total>0).map(person=>`<div><dt>${esc(person.name)}</dt><dd>${money(person.total)}</dd></div>`).join('')||'<div><dt>Sin comisiones en este mes</dt><dd>—</dd></div>'}</dl></aside></section>
      ${admin?`<section class="panel"><h2>Resumen mensual por asesora</h2><div class="goals-table-scroll" tabindex="0" role="region" aria-label="Comisiones por asesora"><table class="goals-table"><thead><tr><th>Asesora</th><th>Cierre</th><th>Firma</th><th>Registro</th><th>Total del mes</th><th>Ventas cerradas</th></tr></thead><tbody>${summary.people.map(person=>`<tr><th scope="row">${esc(person.name)}</th><td>${money(person.closing)}</td><td>${money(person.signature)}</td><td>${money(person.registration)}</td><td><strong>${money(person.total)}</strong></td><td>${person.sales}</td></tr>`).join('')}<tr class="goals-total"><th scope="row">Total del equipo</th>${ACTIVITIES.map(activity=>'<td>'+money(summary.people.reduce((sum,person)=>sum+person[activity.id],0))+'</td>').join('')}<td>${money(summary.total)}</td><td>${summary.sales}</td></tr></tbody></table></div></section>`:""}
      <section class="panel"><h2>Registro de comisiones</h2><p class="hint">${records.length} ${records.length===1?'registro':'registros'} en ${esc(monthName(selectedMonth))}.</p><div class="goals-table-scroll" tabindex="0" role="region" aria-label="Registro mensual de comisiones"><table class="goals-table"><thead><tr><th>Fecha</th><th>Cliente / código</th><th>Servicio</th><th>Contrato</th>${ACTIVITIES.map(activity=>'<th>'+activity.name+'</th>').join('')}<th>Comisión</th><th>Observaciones</th><th><span class="sr-only">Acciones</span></th></tr></thead><tbody>${records.length?records.map(recordRow).join(''):'<tr><td colspan="10" class="goals-empty">Aún no hay registros en este mes.</td></tr>'}</tbody></table></div></section>
      <section class="panel"><h2>Estadísticas mensuales · ${year}</h2><p class="hint">${admin?'Ventas cerradas, cumplimiento y comisiones de los doce meses.':'Avance del equipo en los doce meses.'}</p><div class="goals-month-chart ${admin?"":"is-advisor"}">${months.map(item=>`<button type="button" data-goals-month="${item.month}" class="goals-month-bar ${item.month===selectedMonth?'is-selected':''}" aria-label="${esc(monthName(item.month))}, ${item.sales} de ${item.target} ventas, ${item.percentage}%"><span>${esc(monthName(item.month).split(' ')[0])}</span><span class="goals-chart-track"><span style="width:${Math.min(item.percentage,100)}%"></span></span><strong>${item.sales}/${item.target}</strong>${admin?'<small>'+money(item.total)+'</small>':''}</button>`).join('')}</div></section>
      <details class="panel goals-rates"><summary>Tabla de tarifas de comisión</summary><div class="goals-table-scroll"><table class="goals-table"><thead><tr><th>Actividad</th>${SERVICES.filter(service=>!service.legacy).map(service=>'<th>'+service.name+'</th>').join('')}</tr></thead><tbody>${ACTIVITIES.map(activity=>'<tr><th>'+activity.name+'</th>'+SERVICES.filter(service=>!service.legacy).map(service=>'<td>'+money(service.rates[activity.id])+'</td>').join('')+'</tr>').join('')}<tr class="goals-total"><th>Total</th>${SERVICES.filter(service=>!service.legacy).map(service=>'<td>'+money(Object.values(service.rates).reduce((sum,value)=>sum+value,0))+'</td>').join('')}</tr></tbody></table></div></details>`;
    root.querySelectorAll('[data-review-goal-edit]').forEach(button=>button.onclick=async()=>{
      button.disabled=true;
      try{await api('goals',{kind:'reviewEdits',key:globalThis.crypto.randomUUID(),data:{ids:[button.dataset.reviewGoalEdit]}});await refresh();}
      catch(error){button.disabled=false;const message=document.createElement('p');message.setAttribute('role','alert');message.textContent=error.message;button.after(message);}
    });
    find('#goals-month').onchange=event=>{if(event.target.validity.valid&&event.target.value){selectedMonth=event.target.value;refresh();}};
    find('#goals-refresh').onclick=refresh;
    find('#goals-new').onclick=()=>recordForm();
    root.querySelectorAll('[data-goals-edit]').forEach(button=>button.onclick=()=>recordForm(data.records.find(record=>record.id===button.dataset.goalsEdit)));
    root.querySelectorAll('[data-goals-status]').forEach(button=>button.onclick=()=>commissionStatusForm(data.records.find(record=>record.id===button.dataset.goalsStatus)));
    root.querySelectorAll('[data-goals-month]').forEach(button=>button.onclick=()=>{selectedMonth=button.dataset.goalsMonth;draw();});
    if(admin)find('#goals-target').onclick=()=>form('Modificar meta mensual',field('Meta compartida del equipo','quantity','number',target)+'<p class="hint">Se aplicará a '+esc(monthName(selectedMonth))+'.</p>',async(values,key)=>{
      await api('goals',{kind:'target',key,data:{month:selectedMonth,quantity:Number(values.get('quantity')),previous:target}});
      await refresh();
    });
  }

  let generation=0,refreshTimer;
  function poll(){if(!root.isConnected)return;if(document.querySelector('#modal[open]')){refreshTimer=setTimeout(poll,30000);return;}refresh();}
  async function refresh(){
    clearTimeout(refreshTimer);
    const ticket=++generation;
    try{
      const result=await api('goals?month='+encodeURIComponent(selectedMonth));
      if(!root.isConnected||ticket!==generation)return;
      const expanded=new Set([...root.querySelectorAll('[data-goal-notification][open]')].map(item=>item.dataset.goalNotification));
      data=result;draw();
      root.querySelectorAll('[data-goal-notification]').forEach(item=>{item.open=expanded.has(item.dataset.goalNotification);});
    }catch(error){
      if(!root.isConnected||ticket!==generation)return;
      root.innerHTML='<div class="panel"><p role="alert">'+esc(error.message)+'</p><button type="button" id="goals-retry">Volver a intentar</button></div>';
      find('#goals-retry').onclick=refresh;
    }finally{
      if(admin&&root.isConnected&&ticket===generation)refreshTimer=setTimeout(poll,30000);
    }
  }
  await refresh();
}
