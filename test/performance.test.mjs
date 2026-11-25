import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mutatePerformance,performanceReport,performanceLearning,parsePerformanceCsv,wilson} from '../performance.mjs';
const now='2026-11-25T01:00:00Z';
const base=()=>({brand:{name:'Bloom'},creatives:[{id:'c1',brand:'Bloom',name:'라떼 광고',headline:'아침의 여유',caption:'라떼',script:'대본',channel:'Instagram',format:'15초 광고 영상',variant:0,imageVersion:'photo-v1'}],campaigns:[]});
const plan={name:'아침 광고 실험',product:'oat-latte',audience:'국내 신규 고객',channel:'Instagram',landingUrl:'https://example.com/latte',attribution:'7일 클릭 / 중복 제거 주문',marginRate:.5,targetCpa:10000,maxSpend:100000,startDate:'2026-11-01',endDate:'2026-11-05',creativeIds:['c1'],hypothesis:'아침 메시지의 구매 전환을 시험한다'};
const row={creativeId:'c1',date:'2026-11-02',spend:20000,impressions:10000,clicks:200,purchases:20,revenue:100000,refunds:10000};
const apply=(state,action,input)=>mutatePerformance(state,action,input,now);
function withResults(){let s=apply(base(),'experiments',plan);return apply(s,'observations',{experimentId:s.performance.experiments[0].id,source:'Meta CSV / 7일 클릭',rows:[row]})}
test('performance snapshots survive creative edits; refunds, contribution, attribution and decisions persist',()=>{
  let s=withResults();const id=s.performance.experiments[0].id;s.creatives[0].headline='수정된 헤드라인';const r=performanceReport(s,now).experiments[0];
  assert.equal(r.arms[0].snapshot.headline,'아침의 여유');assert.equal(r.metrics.netRevenue,90000);assert.equal(r.metrics.contribution,25000);assert.equal(r.metrics.cpa,1000);assert.equal(r.metrics.roas,4.5);assert.equal(r.suggestion.action,'review_scale');
  s=apply(s,'decisions',{experimentId:id,action:'iterate',note:'타깃은 유지하고 첫 자막을 시험한다'});
  s=apply(s,'observations',{experimentId:id,source:'수정 보고서',rows:[{...row,spend:100000}]});
  assert.equal(s.performance.observations.length,1);assert.equal(s.performance.imports.at(-1).updated,1);assert.equal(s.performance.imports.at(-1).replaced[0].spend,20000);assert.equal(s.performance.decisions[0].evidence.metrics.spend,20000);assert.equal(performanceReport(s,now).experiments[0].suggestion.action,'review_pause');
  const learning=performanceLearning(s,s.creatives[0]);assert.equal(learning[0].decisions[0].note,'타깃은 유지하고 첫 자막을 시험한다');assert.equal(performanceLearning(s,{id:'else',brand:'Other'},'oat-latte').length,0);
});
test('CSV import is atomic, updates daily keys and rejects bad dates, duplicates and impossible conversion counts',()=>{
  const s=apply(base(),'experiments',plan),id=s.performance.experiments[0].id;
  assert.throws(()=>apply(s,'experiments',plan),/기간이 겹칩니다/);
  const header='creativeId,date,spend,impressions,clicks,purchases,revenue,refunds';const csv='\uFEFF'+header+'\r\n"c1",2026-11-02,20000,10000,200,20,100000,10000\r\n';
  assert.equal(parsePerformanceCsv(csv)[0].clicks,200);assert.equal(apply(s,'observations',{experimentId:id,source:'CSV',csv}).performance.observations.length,1);
  for(const rows of [[row,{...row,date:'2026-11-03',purchases:201}],[row,row],[{...row,date:'2026-13-01'}],[{...row,date:'2026-12-01'}],[{...row,creativeId:'missing'}],[{...row,refunds:100001}]])assert.throws(()=>apply(s,'observations',{experimentId:id,source:'CSV',rows}));
  assert.equal(s.performance.observations.length,0,'invalid imports do not partly mutate state');
  assert.throws(()=>parsePerformanceCsv(header+'\nc1,2026-11-02,,1,0,0,0,0'),/빈 값/);assert.throws(()=>parsePerformanceCsv('wrong\nx'),/CSV 열/);
});
test('forecast uses only earlier matching experiments, freezes evidence and compares actual results without future leakage',()=>{
  let s=base();
  for(const [start,end,date] of [['01','05','02'],['06','10','07'],['11','15','12']]){s=apply(s,'experiments',{...plan,startDate:'2026-11-'+start,endDate:'2026-11-'+end});s=apply(s,'observations',{experimentId:s.performance.experiments[0].id,source:'과거 보고서',rows:[{...row,date:'2026-11-'+date}]})}
  s=apply(s,'experiments',{...plan,startDate:'2026-11-25',endDate:'2026-11-30'});const id=s.performance.experiments[0].id;
  const candidate=performanceReport(s,now).experiments[0].forecastCandidate;assert.equal(candidate.available,true);assert.equal(candidate.baseline.experiments,3);assert.equal(candidate.baseline.clicks,600);
  s=apply(s,'forecasts',{experimentId:id});assert.equal(s.performance.forecasts[0].baseline.cvr,.1);assert.equal(s.performance.forecasts[0].evidence.length,3);assert.throws(()=>apply(s,'forecasts',{experimentId:id}),/한 번/);
  s=apply(s,'observations',{experimentId:id,source:'새 보고서',rows:[{...row,date:'2026-11-25',purchases:10}]});
  const r=performanceReport(s,now).experiments[0];assert.equal(r.validation.observedCvr,.05);assert.equal(r.validation.absoluteError,.05);assert.equal(r.forecast.baseline.clicks,600);
  s=apply(s,'observations',{experimentId:s.performance.experiments[1].id,source:'과거 수정',rows:[{...row,date:'2026-11-12',purchases:1}]});assert.equal(s.performance.forecasts[0].evidence[2].purchases,20,'recorded forecast does not change when historical reports are corrected');
  s=apply(s,'experiments',{...plan,creativeIds:['c1'],startDate:'2026-12-01',endDate:'2026-12-05',audience:'다른 타깃'});assert.equal(performanceReport(s,now).experiments[0].forecastCandidate.available,false,'different audiences do not share an inferred baseline');
});
test('sparse or observed experiments do not get fabricated predictions; zero conversions stay uncertain',()=>{
  const s=apply(base(),'experiments',{...plan,startDate:'2026-11-25',endDate:'2026-11-30'});const e=s.performance.experiments[0];assert.equal(performanceReport(s,now).experiments[0].forecastCandidate.available,false);assert.throws(()=>apply(s,'forecasts',{experimentId:e.id}),/3개/);
  const observed=apply(s,'observations',{experimentId:e.id,source:'보고서',rows:[{...row,date:'2026-11-25',purchases:0,revenue:0,refunds:0}]});const r=performanceReport(observed,now).experiments[0];assert.equal(r.metrics.cpa,null);assert.equal(r.suggestion.action,'hold');assert.match(r.forecastCandidate.reason,/새로/);assert.equal(wilson(0,0),null);assert.ok(wilson(0,100)[1]>0);assert.ok(wilson(100,100)[0]<1);
});
