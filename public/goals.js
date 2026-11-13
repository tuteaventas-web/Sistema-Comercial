import {SERVICES,ACTIVITIES,monthlyMetrics} from './goal-metrics.js';

let selectedMonth=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit'}).format(new Date()).slice(0,7);
const money=value=>new Intl.NumberFormat('es-PE',{style:'currency',currency:'PEN'}).format(value/100);
const monthName=value=>new Intl.DateTimeFormat('es-PE',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(value+'-01T12:00:00Z'));

export async function renderGoals(context){
  const {screen,api,admin,account,esc,form,field,openLogin}=context;
  screen.innerHTML='<section id="goals-module" class="goals-module"><p role="status">Cargando metas comerciales…</p></section>';
  const root=screen.firstElementChild;
  if(!context.canEdit){
    root.innerHTML='<div class="panel goals-login"><h2>Metas comerciales</h2><p>Inicia sesión con tu usuario para consultar metas y comisiones.</p><button type="button" id="goals-login" class="primary">Iniciar sesión</button></div>';
    root.querySelector('#goals-login').onclick=openLogin;
    return;
  }
  let data;
  const find=selector=>root.querySelector(selector);
  const username=(account.match(/\(([^)]+)\)\s*$/)||[])[1];

  function recordForm(previous){
    const values=previous||{};
    const codes=context.codes.map(code=>({id:code.id,label:code.code+' · '+(context.clients.find(person=>person.id===code.clientId)?.name||'')}));
    // Include the stored code if its customer has since been removed from the file catalog.
    if(previous&&!codes.some(code=>code.id===previous.codeId))codes.push({id:previous.codeId,label:previous.code});
    const advisorOptions=activity=>{
      const existing=values.activities?.[activity.id];
      const people=data.accounts.filter(person=>person.active||person.username===existing?.username);
      if(existing&&!people.some(person=>person.username===existing.username))people.push({...existing,active:false});
      return '<option value="">Sin asignar</option>'+people.map(person=>'<option value="'+esc(person.username)+'" '+(existing?.username===person.username?'selected':'')+'>'+esc(person.name)+(person.active?'':' · Inactiva')+'</option>').join('');
    };
    const codeLabel=codes.find(code=>code.id===values.codeId)?.label||'';
    const date=values.date||selectedMonth+'-'+(selectedMonth===new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit'}).format(new Date()).slice(0,7)?new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',day:'2-digit'}).format(new Date()):'01');
    form(previous?'Editar comisión':'Registrar comisión',
      field('Fecha','date','date',date)+
      '<label>Cliente por nombre o código *<input name="customer" list="goal-customer-options" autocomplete="off" required value="'+esc(codeLabel)+'" placeholder="Escribe y selecciona un cliente"><datalist id="goal-customer-options">'+codes.map(code=>'<option value="'+esc(code.label)+'"></option>').join('')+'</datalist></label>'+
      '<div class="goals-form-grid"><label>Tipo de servicio *<select name="service" required><option value="">Seleccione</option>'+SERVICES.map(service=>'<option value="'+service.id+'" '+(values.service===service.id?'selected':'')+'>'+service.name+'</option>').join('')+'</select></label><label>Tipo de contrato *<select name="contractType" required>'+['Prospecto','Cliente'].map(type=>'<option '+(values.contractType===type?'selected':'')+'>'+type+'</option>').join('')+'</select></label></div>'+
      '<fieldset class="goals-activities"><legend>Responsable de cada actividad</legend>'+ACTIVITIES.map(activity=>'<label>'+activity.name+'<select name="'+activity.id+'">'+advisorOptions(activity)+'</select></label>').join('')+'</fieldset><p class="hint">Solo Cierre de venta suma al avance de la meta compartida. Firma y Registro generan su comisión correspondiente.</p><div id="goals-calculation" class="goals-calculation" aria-live="polite"></div>'+
      field('Observaciones','notes','text',values.notes||'',false),async(values,key)=>{
        const code=codes.find(code=>code.label===values.get('customer'));
        if(!code)throw Error('Selecciona un cliente de los resultados por nombre o código');
        const input={...Object.fromEntries(values),codeId:code.id};
        delete input.customer;
        if(previous){input.id=previous.id;input.revision=previous.revision;}
        await api('goals',{kind:'record',key,data:input});
        selectedMonth=String(input.date).slice(0,7);
        await refresh();
      });
    const editor=document.querySelector('#form');
    const calculate=()=>{
      const service=SERVICES.find(item=>item.id===editor.querySelector('[name=service]').value);
      const total=service?ACTIVITIES.reduce((sum,activity)=>sum+(editor.querySelector('[name='+activity.id+']').value?service.rates[activity.id]:0),0):0;
      editor.querySelector('#goals-calculation').textContent='Comisión del registro · '+money(total);
    };
    editor.querySelectorAll('select').forEach(select=>select.addEventListener('change',calculate));
    calculate();
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
      <section class="panel goals-progress"><div class="goals-progress-heading"><div><span class="goals-eyebrow">META COMPARTIDA · ${esc(monthName(selectedMonth))}</span><h2>${summary.sales} <small>de ${target} ventas cerradas</small></h2></div><strong class="goals-percentage">${summary.percentage}%</strong></div><progress max="${target}" value="${Math.min(summary.sales,target)}" aria-label="Avance de la meta mensual compartida"></progress><p>${summary.sales>=target?'Meta cumplida':(target-summary.sales)+' ventas pendientes'} · Participan todas las asesoras activas.</p></section>
      <div class="goals-kpis"><article class="panel"><span>Ventas cerradas</span><strong>${summary.sales}</strong></article><article class="panel"><span>Comisiones del mes</span><strong>${money(summary.total)}</strong></article><article class="panel"><span>Asesoras activas</span><strong>${active.length}</strong></article></div>
      <section class="panel"><h2>Resumen mensual por asesora</h2><div class="goals-table-scroll" tabindex="0" role="region" aria-label="Comisiones por asesora"><table class="goals-table"><thead><tr><th>Asesora</th><th>Cierre</th><th>Firma</th><th>Registro</th><th>Total del mes</th><th>Ventas cerradas</th></tr></thead><tbody>${summary.people.map(person=>`<tr><th scope="row">${esc(person.name)}</th><td>${money(person.closing)}</td><td>${money(person.signature)}</td><td>${money(person.registration)}</td><td><strong>${money(person.total)}</strong></td><td>${person.sales}</td></tr>`).join('')}<tr class="goals-total"><th scope="row">Total del equipo</th>${ACTIVITIES.map(activity=>'<td>'+money(summary.people.reduce((sum,person)=>sum+person[activity.id],0))+'</td>').join('')}<td>${money(summary.total)}</td><td>${summary.sales}</td></tr></tbody></table></div></section>
      <section class="panel"><h2>Registro de comisiones</h2><p class="hint">${records.length} registros en ${esc(monthName(selectedMonth))}.</p><div class="goals-table-scroll" tabindex="0" role="region" aria-label="Registro mensual de comisiones"><table class="goals-table"><thead><tr><th>Fecha</th><th>Cliente / código</th><th>Servicio</th><th>Contrato</th>${ACTIVITIES.map(activity=>'<th>'+activity.name+'</th>').join('')}<th>Comisión</th><th>Observaciones</th><th><span class="sr-only">Acciones</span></th></tr></thead><tbody>${records.length?records.map(record=>`<tr><td>${esc(record.date.split('-').reverse().join('/'))}</td><th scope="row">${esc(record.code)}</th><td>${esc(SERVICES.find(service=>service.id===record.service)?.name)}</td><td>${esc(record.contractType)}</td>${ACTIVITIES.map(activity=>'<td>'+esc(record.activities[activity.id]?.name||'—')+'</td>').join('')}<td>${money(ACTIVITIES.reduce((sum,activity)=>sum+(record.activities[activity.id]?record.rates[activity.id]:0),0))}</td><td class="goals-notes">${esc(record.notes||'—')}</td><td>${admin||record.createdBy===username?'<button type="button" data-goals-edit="'+esc(record.id)+'" aria-label="Editar comisión de '+esc(record.code)+'">Editar</button>':''}</td></tr>`).join(''):'<tr><td colspan="10" class="goals-empty">Aún no hay registros en este mes.</td></tr>'}</tbody></table></div></section>
      <section class="panel"><h2>Estadísticas mensuales · ${year}</h2><p class="hint">Ventas cerradas, cumplimiento y comisiones de los doce meses.</p><div class="goals-month-chart">${months.map(item=>`<button type="button" data-goals-month="${item.month}" class="goals-month-bar ${item.month===selectedMonth?'is-selected':''}" aria-label="${esc(monthName(item.month))}, ${item.sales} de ${item.target} ventas, ${item.percentage}%"><span>${esc(monthName(item.month).split(' ')[0])}</span><span class="goals-chart-track"><span style="width:${Math.min(item.percentage,100)}%"></span></span><strong>${item.sales}/${item.target}</strong><small>${money(item.total)}</small></button>`).join('')}</div></section>
      <details class="panel goals-rates"><summary>Tabla de tarifas de comisión</summary><div class="goals-table-scroll"><table class="goals-table"><thead><tr><th>Actividad</th>${SERVICES.map(service=>'<th>'+service.name+'</th>').join('')}</tr></thead><tbody>${ACTIVITIES.map(activity=>'<tr><th>'+activity.name+'</th>'+SERVICES.map(service=>'<td>'+money(service.rates[activity.id])+'</td>').join('')+'</tr>').join('')}<tr class="goals-total"><th>Total</th>${SERVICES.map(service=>'<td>'+money(Object.values(service.rates).reduce((sum,value)=>sum+value,0))+'</td>').join('')}</tr></tbody></table></div></details>`;
    find('#goals-month').onchange=event=>{if(event.target.validity.valid&&event.target.value){selectedMonth=event.target.value;refresh();}};
    find('#goals-refresh').onclick=refresh;
    find('#goals-new').onclick=()=>recordForm();
    root.querySelectorAll('[data-goals-edit]').forEach(button=>button.onclick=()=>recordForm(data.records.find(record=>record.id===button.dataset.goalsEdit)));
    root.querySelectorAll('[data-goals-month]').forEach(button=>button.onclick=()=>{selectedMonth=button.dataset.goalsMonth;draw();});
    if(admin)find('#goals-target').onclick=()=>form('Modificar meta mensual',field('Meta compartida del equipo','quantity','number',target)+'<p class="hint">Se aplicará a '+esc(monthName(selectedMonth))+'.</p>',async(values,key)=>{
      await api('goals',{kind:'target',key,data:{month:selectedMonth,quantity:Number(values.get('quantity')),previous:target}});
      await refresh();
    });
  }

  let generation=0;
  async function refresh(){
    const ticket=++generation;
    try{
      const result=await api('goals?month='+encodeURIComponent(selectedMonth));
      if(!root.isConnected||ticket!==generation)return;
      data=result;draw();
    }catch(error){
      if(!root.isConnected||ticket!==generation)return;
      root.innerHTML='<div class="panel"><p role="alert">'+esc(error.message)+'</p><button type="button" id="goals-retry">Volver a intentar</button></div>';
      find('#goals-retry').onclick=refresh;
    }
  }
  await refresh();
}
