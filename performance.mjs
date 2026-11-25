import {randomUUID} from 'node:crypto';
const fail=message=>Object.assign(new Error(message),{status:400});
const text=(v,max=500)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const money=v=>Number.isFinite(v)&&v>=0&&v<=1e12;
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const actions=['hold','iterate','review_pause','review_scale'];
const todayAt=now=>new Date(now).toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'});
export const emptyPerformance=()=>({experiments:[],observations:[],decisions:[],forecasts:[],imports:[]});
export function validatePerformance(p,state){
  if(p===undefined)return;
  if(!p||['experiments','observations','decisions','forecasts','imports'].some(k=>!Array.isArray(p[k])))throw fail('성과 기록 형식을 확인해주세요.');
  if(p.experiments.length>500||p.observations.length>20000||p.decisions.length>2000||p.forecasts.length>500||p.imports.length>2000)throw fail('성과 기록 저장 한도를 초과했습니다.');
  const ids=new Set();
  for(const e of p.experiments){
    if(!e||!text(e.id,100)||ids.has(e.id)||!text(e.name,100)||!text(e.brand,60)||!text(e.product)||!text(e.audience)||!text(e.attribution,200)||!['Instagram','Facebook','YouTube'].includes(e.channel)||e.currency!=='KRW'||!money(e.maxSpend)||e.maxSpend<=0||!money(e.targetCpa)||e.targetCpa<=0||!Number.isFinite(e.marginRate)||e.marginRate<=0||e.marginRate>1||!date(e.startDate)||!date(e.endDate)||e.startDate>e.endDate||!text(e.landingUrl,2000))throw fail('실험 목표와 집행 조건을 확인해주세요.');
    try{if(!['http:','https:'].includes(new URL(e.landingUrl).protocol))throw Error()}catch{throw fail('랜딩페이지는 http 또는 https 주소로 입력해주세요.')}
    if(!Array.isArray(e.arms)||e.arms.length<1||e.arms.length>5||new Set(e.arms.map(a=>a.creativeId)).size!==e.arms.length||e.arms.some(a=>!state.creatives.some(c=>c.id===a.creativeId)||!a.snapshot||a.snapshot.brand!==e.brand||!text(a.hypothesis,1000)))throw fail('실험에 사용할 광고와 가설을 확인해주세요.');
    ids.add(e.id);
  }
  const keys=new Set();
  for(const o of p.observations){
    const e=p.experiments.find(e=>e.id===o.experimentId),key=[o.experimentId,o.creativeId,o.date].join('|');
    if(!e||!e.arms.some(a=>a.creativeId===o.creativeId)||!date(o.date)||o.date<e.startDate||o.date>e.endDate||keys.has(key)||!['spend','revenue','refunds'].every(k=>money(o[k]))||!['impressions','clicks','purchases'].every(k=>Number.isSafeInteger(o[k])&&o[k]>=0&&o[k]<=1e10)||o.clicks>o.impressions||o.purchases>o.clicks||o.refunds>o.revenue||!text(o.source,200))throw fail('성과 행의 광고·기간·금액·전환 수를 확인해주세요. 구매는 클릭 후 구매 수로 입력합니다.');
    keys.add(key);
  }
  if(p.decisions.some(d=>!ids.has(d.experimentId)||!actions.includes(d.action)||!text(d.note,2000)))throw fail('성과 의사결정 기록을 확인해주세요.');
  if(p.forecasts.some(f=>!ids.has(f.experimentId)||!f.baseline||!Number.isFinite(f.baseline.cvr)||!Array.isArray(f.evidence)))throw fail('성과 추정 기록을 확인해주세요.');
}
export function totals(rows){const out={spend:0,impressions:0,clicks:0,purchases:0,revenue:0,refunds:0};for(const row of rows)for(const k in out)out[k]+=row[k];return {...out,netRevenue:out.revenue-out.refunds,ctr:out.impressions?out.clicks/out.impressions:null,cvr:out.clicks?out.purchases/out.clicks:null,cpa:out.purchases?out.spend/out.purchases:null,roas:out.spend?(out.revenue-out.refunds)/out.spend:null};}
// Wilson score interval for a binomial proportion; this is not a future-performance prediction interval.
// https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm
export function wilson(k,n){if(!n)return null;const z=1.959963984540054,p=k/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;return [Math.max(0,c-h),Math.min(1,c+h)];}
function metrics(rows,e){const t=totals(rows);return {...t,contribution:t.netRevenue*e.marginRate-t.spend,cvrInterval:wilson(t.purchases,t.clicks),budgetRemaining:Math.max(0,e.maxSpend-t.spend)};}
function suggestion(m,e){
  if(m.spend>=e.maxSpend)return {action:'review_pause',reason:'설정한 실험 총예산에 도달했습니다. 추가 지출 전 집행 상태를 검토하세요.'};
  if(m.clicks<100||m.purchases<10)return {action:'hold',reason:'판단 표본이 부족합니다. 예산 잔액과 전환 집계 지연을 확인하고 추가 관측을 검토하세요.'};
  if(m.contribution<=0||m.cpa>e.targetCpa)return {action:'iterate',reason:'현재 기록의 기여이익 또는 목표 CPA가 기준에 미달합니다. 소재·오퍼·랜딩페이지를 나누어 재실험하세요.'};
  return {action:'review_scale',reason:'현재 기록은 목표 CPA와 기여이익 기준을 충족합니다. 집계 지연과 다른 조건을 검토한 뒤 제한적인 확대 실험을 고려하세요.'};
}
function comparable(a,b){return ['brand','product','audience','channel','landingUrl','attribution','currency'].every(k=>a[k]===b[k]);}
export function forecastCandidate(p,e,now=new Date().toISOString()){
  if(p.observations.some(o=>o.experimentId===e.id))return {available:false,reason:'성과가 등록된 실험에는 사전 추정을 새로 만들 수 없습니다. 다음 실험을 등록하세요.'};
  if(e.startDate<todayAt(now))return {available:false,reason:'사전 추정은 오늘 또는 이후에 시작하는 실험에 저장할 수 있습니다.'};
  const cohort=p.experiments.filter(other=>other.id!==e.id&&comparable(other,e)&&other.endDate<e.startDate&&other.endDate<todayAt(now));
  const eligible=new Set(cohort.map(x=>x.id));const rows=p.observations.filter(o=>eligible.has(o.experimentId));const t=totals(rows),observedExperiments=new Set(rows.map(o=>o.experimentId)).size;
  if(observedExperiments<3||t.clicks<100||t.purchases<10||t.spend<=0)return {available:false,reason:'동일 브랜드·상품·타깃·채널·랜딩·기여 기준의 종료된 실험 3개, 클릭 100회, 구매 10건 이상이 필요합니다.',sample:{experiments:observedExperiments,clicks:t.clicks,purchases:t.purchases}};
  const cpc=t.spend/t.clicks,aov=t.netRevenue/t.purchases,cvrInterval=wilson(t.purchases,t.clicks),clicks=e.maxSpend/cpc;
  return {available:true,method:'historical-cohort-v1',asOf:now,baseline:{...t,cpc,aov,cvrInterval,experiments:observedExperiments},scenario:{budget:e.maxSpend,expectedPurchases:clicks*t.cvr,purchasesRange:cvrInterval.map(v=>v*clicks),expectedCpa:cpc/t.cvr,expectedRoas:t.cvr*aov/cpc,contributionRange:cvrInterval.map(v=>v*clicks*aov*e.marginRate-e.maxSpend)},evidence:rows.map(o=>structuredClone(o)),assumptions:'동일 조건의 과거 평균 CPC·환불 반영 객단가가 유지된다는 가정입니다. 전환율의 Wilson 95% 통계 범위를 적용한 시나리오이며 미래 성과 보장이나 예측구간이 아닙니다. 소재 간 우열·광고의 증분 효과는 추정하지 않습니다.'};
}
export function performanceReport(state,now=new Date().toISOString()){
  const p=state?.performance||emptyPerformance();
  return {experiments:p.experiments.map(e=>{
    const rows=p.observations.filter(o=>o.experimentId===e.id),m=metrics(rows,e),forecasts=p.forecasts.filter(f=>f.experimentId===e.id),forecast=forecasts.at(-1)||null;
    return {...e,metrics:m,suggestion:suggestion(m,e),arms:e.arms.map(a=>({...a,metrics:metrics(rows.filter(o=>o.creativeId===a.creativeId),e)})),rows:rows.length,forecast,forecastCandidate:forecast?null:forecastCandidate(p,e,now),validation:forecast&&m.clicks?{observedCvr:m.cvr,expectedCvr:forecast.baseline.cvr,absoluteError:Math.abs(m.cvr-forecast.baseline.cvr),withinHistoricalInterval:m.cvr>=forecast.baseline.cvrInterval[0]&&m.cvr<=forecast.baseline.cvrInterval[1],note:'사전 저장한 기준선과 실제 전환율의 비교입니다. 단일 실험의 일치는 예측 정확성 검증을 대신하지 않습니다.'}:null,decisions:p.decisions.filter(d=>d.experimentId===e.id)};
  }),observationCount:p.observations.length};
}
export function parsePerformanceCsv(csv){
  if(typeof csv!=='string'||csv.length>2e6)throw fail('CSV 파일은 2MB 이하로 입력해주세요.');
  const rows=[];let row=[],cell='',quoted=false;
  const source=csv.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
  for(let i=0;i<source.length;i++){const c=source[i];if(c==='"'){if(quoted&&source[i+1]==='"'){cell+='"';i++}else if(!cell||quoted){if(quoted&&source[i+1]&&!['\n',','].includes(source[i+1]))throw fail('CSV 닫는 따옴표 뒤에는 구분자가 필요합니다.');quoted=!quoted;}else throw fail('CSV 따옴표 형식을 확인해주세요.')}else if(!quoted&&(c===','||c==='\n')){row.push(cell);cell='';if(c==='\n'){if(row.some(v=>v.trim()))rows.push(row);row=[]}}else cell+=c;}
  if(quoted)throw fail('CSV 따옴표가 닫히지 않았습니다.');row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
  const header=rows.shift()?.map(v=>v.trim());const expected=['creativeId','date','spend','impressions','clicks','purchases','revenue','refunds'];
  if(!header||header.length!==expected.length||new Set(header).size!==expected.length||expected.some(k=>!header.includes(k)))throw fail('CSV 열은 creativeId,date,spend,impressions,clicks,purchases,revenue,refunds 입니다.');
  if(!rows.length||rows.length>1000)throw fail('CSV에는 1~1,000개의 성과 행을 넣어주세요.');
  return rows.map((cells,index)=>{if(cells.length!==header.length)throw fail(`CSV ${index+2}행의 열 수를 확인해주세요.`);return Object.fromEntries(header.map((k,i)=>{const v=cells[i].trim();if(!v)throw fail(`CSV ${index+2}행의 빈 값을 확인해주세요.`);return [k,['creativeId','date'].includes(k)?v:Number(v)]}));});
}
export function mutatePerformance(state,action,input,now=new Date().toISOString()){
  if(!state)throw fail('먼저 작업을 저장해주세요.');const next=structuredClone(state),p=next.performance??=emptyPerformance();
  if(action==='experiments'){
    const ids=input.creativeIds;if(!Array.isArray(ids)||ids.length<1||ids.length>5||new Set(ids).size!==ids.length)throw fail('광고를 1~5개 선택해주세요.');
    const creatives=ids.map(id=>next.creatives.find(c=>c.id===id));if(creatives.some(c=>!c))throw fail('광고를 찾을 수 없습니다.');
    if(p.experiments.some(e=>e.startDate<=input.endDate&&e.endDate>=input.startDate&&e.arms.some(a=>ids.includes(a.creativeId))))throw fail('같은 광고의 실험 기간이 겹칩니다. 소재 버전 또는 실험 기간을 분리해주세요.');
    const brand=creatives[0].brand;if(creatives.some(c=>c.brand!==brand||c.channel!==input.channel))throw fail('같은 브랜드와 채널의 광고를 선택해주세요.');
    const arms=creatives.map(c=>({creativeId:c.id,hypothesis:c.batchHypothesis||input.hypothesis,snapshot:Object.fromEntries(['brand','name','headline','caption','script','batchAngle','batchHypothesis','videoDraft','imageVersion','format','latestVideoJobId'].filter(k=>c[k]!==undefined).map(k=>[k,structuredClone(c[k])]))}));
    p.experiments.unshift({id:randomUUID(),name:input.name,brand,product:input.product,audience:input.audience,channel:input.channel,landingUrl:input.landingUrl,attribution:input.attribution,currency:'KRW',marginRate:input.marginRate,targetCpa:input.targetCpa,maxSpend:input.maxSpend,startDate:input.startDate,endDate:input.endDate,arms,createdAt:now});
  }else{
    const e=p.experiments.find(e=>e.id===input.experimentId);if(!e)throw fail('실험을 찾을 수 없습니다.');
    if(action==='observations'){
      if(!text(input.source,200))throw fail('데이터 출처와 기여 기준을 입력해주세요.');const rows=input.csv!==undefined?parsePerformanceCsv(input.csv):input.rows;
      if(!Array.isArray(rows)||!rows.length||rows.length>1000)throw fail('성과 행을 1~1,000개 입력해주세요.');
      const seen=new Set(),replaced=[];let updated=0;
      for(const row of rows){const key=[row.creativeId,row.date].join('|');if(seen.has(key))throw fail('한 요청에 같은 광고·날짜를 두 번 넣을 수 없습니다.');seen.add(key);if(!date(row.date)||row.date>todayAt(now))throw fail('성과 날짜는 오늘까지 입력할 수 있습니다.');
        const old=p.observations.findIndex(o=>o.experimentId===e.id&&o.creativeId===row.creativeId&&o.date===row.date);const value={id:old<0?randomUUID():p.observations[old].id,experimentId:e.id,...Object.fromEntries(['creativeId','date','spend','impressions','clicks','purchases','revenue','refunds'].map(k=>[k,row[k]])),source:input.source,recordedAt:now};if(old<0)p.observations.push(value);else{replaced.push(p.observations[old]);p.observations[old]=value;updated++;}}
      p.imports.push({id:randomUUID(),experimentId:e.id,at:now,source:input.source,rows:rows.length,updated,replaced});
    }else if(action==='decisions'){
      if(!actions.includes(input.action)||!text(input.note,2000))throw fail('다음 행동과 근거를 입력해주세요.');
      const report=performanceReport(next,now).experiments.find(x=>x.id===e.id);
      p.decisions.push({id:randomUUID(),experimentId:e.id,action:input.action,note:input.note,at:now,evidence:{metrics:report.metrics,suggestion:report.suggestion},execution:'recorded_only'});
    }else if(action==='forecasts'){
      if(p.forecasts.some(f=>f.experimentId===e.id))throw fail('사전 추정은 실험당 한 번 저장합니다.');
      const candidate=forecastCandidate(p,e,now);if(!candidate.available)throw fail(candidate.reason);p.forecasts.push({id:randomUUID(),experimentId:e.id,...candidate});
    }else throw fail('지원하지 않는 성과 작업입니다.');
  }
  validatePerformance(p,next);return next;
}
export function performanceLearning(state,creative,product){
  const report=performanceReport(state);return report.experiments.filter(e=>e.brand===creative?.brand&&(e.arms.some(a=>a.creativeId===creative.id)||(product&&e.product===product))).slice(0,5).map(e=>({name:e.name,product:e.product,conditions:{audience:e.audience,channel:e.channel,landingUrl:e.landingUrl,attribution:e.attribution,marginRate:e.marginRate},metrics:e.metrics,arms:e.arms.map(a=>({headline:a.snapshot.headline,angle:a.snapshot.batchAngle,hypothesis:a.hypothesis,metrics:a.metrics})),suggestion:e.suggestion,decisions:e.decisions.slice(-3),limitations:'수동 등록한 관측 성과이며 인과 효과나 통계적 승자를 검증한 결과가 아니다.'}));
}
