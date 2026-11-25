import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planBatch} from '../batch-plans.mjs';
const input={product:'오트 라떼',goal:'제품 소개',audience:'20대 직장인',duration:15,count:5,aspect:'9:16'};
const variants=Array.from({length:5},(_,i)=>({angle:'관점 '+i,hypothesis:'시험할 가설 '+i,name:'광고 '+i,headline:'제목 '+i,caption:'보조 문구',script:'제작 원고',style:['warm','bold','minimal'][i%3],motion:'gentle',scenes:[{title:'도입 '+i,body:'제품 소개'},{title:'메시지 '+i,body:'브랜드의 매력'},{title:'행동 유도',body:'지금 만나보세요'}]}));
const image='data:image/jpeg;base64,YWJj';
const response=value=>({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]});
test('batch planner requests distinct ad hypotheses, keeps duration/aspect fixed and supplies reference context',async()=>{
  let request;const result=await planBatch({input,brand:{name:'Bloom'},image,reference:{headline:'기존 광고',directorBrief:{product:'라떼'}},learning:[{name:'관측 실험',metrics:{contribution:25000}}],model:'test',callModel:async(endpoint,payload)=>{assert.equal(endpoint,'responses');request=payload;return response({variants})}});
  assert.equal(result.variants.length,5);assert.equal(new Set(result.variants.map(item=>item.angle)).size,5);assert.ok(result.variants.every(item=>item.plan.duration===15&&item.plan.aspect==='9:16'));
  const context=JSON.parse(request.input[0].content[0].text);assert.equal(context.performanceLearning[0].metrics.contribution,25000);assert.equal(context.reference.headline,'기존 광고');assert.equal(request.input[0].content[1].image_url,image);assert.equal(request.store,false);
});
test('batch planner rejects duplicate concepts, wrong quantity and invalid requests',async()=>{
  await assert.rejects(planBatch({input:{...input,count:6},image,callModel:async()=>response({variants})}),/수량/);
  await assert.rejects(planBatch({input,image:'',callModel:async()=>response({variants})}),/사진/);
  await assert.rejects(planBatch({input,image,callModel:async()=>response({variants:variants.slice(0,3)})}),/수량/);
  await assert.rejects(planBatch({input,image,callModel:async()=>response({variants:[variants[0],variants[0],...variants.slice(2)]})}),/다른 시안/);
});
