import {test} from 'node:test';
import assert from 'node:assert/strict';
import {monthlyMetrics} from '../public/goal-metrics.js';
const advisor={username:'evelyn',name:'Evelyn'};
const record=(date:string,commissionDenial:{reason:string}|null=null)=>({date,commissionDenial,activities:{closing:advisor as typeof advisor|null,signature:advisor,registration:advisor},rates:{closing:1500,signature:500,registration:1000}});

test('October shared goal excludes denied commissions from sales and advisor totals',()=>{
  const records=[record('2026-10-01'),record('2026-10-02'),record('2026-10-03'),record('2026-10-04',{reason:'Rechazada por Administración'}),record('2026-11-01')];
  const result=monthlyMetrics(records,'2026-10',8,[advisor]);
  assert.equal(result.sales,3);
  assert.equal(result.percentage,37.5);
  assert.equal(result.total,9000);
  assert.deepEqual(result.people,[{...advisor,sales:3,closing:4500,signature:1500,registration:3000,total:9000}]);
  records[3].commissionDenial=null;
  assert.equal(monthlyMetrics(records,'2026-10').sales,4);
  assert.equal(monthlyMetrics(records,'2026-11').sales,1);
});

test('denied-only month has no progress and keeps account summaries at zero',()=>{
  const result=monthlyMetrics([record('2026-10-04',{reason:'Rechazada'})],'2026-10',8,[advisor]);
  assert.equal(result.sales,0);
  assert.equal(result.percentage,0);
  assert.equal(result.total,0);
  assert.equal(result.people[0].sales,0);
  assert.equal(result.people[0].total,0);
});

test('signature and registration without a closing do not increase the goal',()=>{
  const entry=record('2026-10-01');entry.activities.closing=null;
  const result=monthlyMetrics([entry],'2026-10',8,[advisor]);
  assert.equal(result.sales,0);
  assert.equal(result.total,1500);
});
