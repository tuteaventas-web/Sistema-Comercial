export const MICHELIN_CLOSER = {username:'external:michelin',name:'Michelin'};
export const SERVICES = [
  {id:'tesis-completa', name:'Tesis completa', rates:{closing:1500, signature:500, registration:1000}},
  {id:'plan-tesis', name:'Plan de tesis', rates:{closing:700, signature:300, registration:500}},
  {id:'informe-final', name:'Informe final', rates:{closing:700, signature:300, registration:500}},
  {id:'plan-informe', name:'Plan / Informe final (registro anterior)', legacy:true, rates:{closing:700, signature:300, registration:500}},
  {id:'tesis-michelin', name:'Tesis Michelin', rates:{closing:0, signature:300, registration:700}}
];
export const ACTIVITIES = [
  {id:'closing', name:'Cierre de venta'},
  {id:'signature', name:'Firma'},
  {id:'registration', name:'Registro'}
];
export function activityCommission(record,activity){
  if(record.commissionDenial||!record.activities[activity])return 0;
  return record.rates[activity];
}
export function recordCommission(record){
  return ACTIVITIES.reduce((total,activity)=>total+activityCommission(record,activity.id),0);
}
export function monthlyMetrics(records, month, target=8, accounts=[]){
  const people=new Map(accounts.map(person=>[person.username,{username:person.username,name:person.name,sales:0,closing:0,signature:0,registration:0,total:0}]));
  let sales=0,total=0;
  for(const record of records.filter(item=>item.date.startsWith(month+'-')&&!item.commissionDenial)){
    if(record.activities.closing)sales++;
    for(const activity of ACTIVITIES){
      const person=record.activities[activity.id];
      if(!person)continue;
      if(!people.has(person.username))people.set(person.username,{username:person.username,name:person.name,sales:0,closing:0,signature:0,registration:0,total:0});
      const summary=people.get(person.username);
      const amount=activityCommission(record,activity.id);
      summary[activity.id]+=amount;
      summary.total+=amount;
      total+=amount;
      if(activity.id==='closing')summary.sales++;
    }
  }
  return {sales,total,target,percentage:Math.round(sales/target*1000)/10,people:[...people.values()]};
}
