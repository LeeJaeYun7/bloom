import {test} from 'node:test';
import assert from 'node:assert/strict';
import {directCreative} from '../director.mjs';
const creative={id:'x',brand:'Bloom',name:'광고',headline:'한 잔의 여유',caption:'오트 라떼',script:'기획안',channel:'Instagram',image:'data:image/jpeg;base64,YWJj',directorBrief:{product:'오트 라떼',audience:'20대 직장인',tone:'따뜻함',goal:'제품 소개'},conversation:[{role:'user',text:'20대 직장인을 위한 라떼 광고'},{role:'assistant',text:'따뜻한 광고로 기획하겠습니다.'}],executions:[{tool:'render_video',status:'ready',jobId:'actual-job',at:'2026-11-25'}]};
const result={reply:'기존 타깃을 유지하고 10초로 수정했습니다.',action:'render',ready:true,audio:'mute',brief:creative.directorBrief,creative:{brand:'Bloom',name:'광고',headline:'짧은 여유',caption:'라떼',script:'수정된 기획',channel:'Instagram'},plan:{aspect:'9:16',duration:10,style:'minimal',motion:'still',scenes:[{title:'짧은 여유',body:'라떼 한 잔'},{title:'일상의 한 순간',body:'따뜻하게'},{title:'지금 만나보세요',body:'자세히 알아보기'}]}};
function response(value){return{output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]}}
test('director receives prior dialogue, latest tool result, and a separate vision image input',async()=>{
  let request;const output=await directCreative({creative,brand:{name:'Bloom'},message:'10초로 줄이고 무음으로 해줘',lastVideo:{status:'failed',plan:{duration:15},error:'오디오 파일 오류'},audioAvailable:true,learning:[{name:'관측 실험',metrics:{contribution:25000},decisions:[{note:'첫 장면 변경'}]}],model:'test-model',callModel:async(endpoint,input)=>{assert.equal(endpoint,'responses');request=input;return response(result)}});
  const context=JSON.parse(request.input[0].content[0].text);assert.equal(context.performanceLearning[0].decisions[0].note,'첫 장면 변경');assert.equal(context.history[0].text,creative.conversation[0].text);assert.equal(context.brief.audience,'20대 직장인');assert.equal(context.executions[0].jobId,'actual-job');assert.equal(context.lastVideo.error,'오디오 파일 오류');assert.equal(request.input[0].content[1].type,'input_image');assert.equal(request.input[0].content[1].image_url,creative.image);assert.equal(context.creative.image,undefined);assert.equal(request.store,false);
  assert.equal(output.plan.duration,10);assert.equal(output.plan.motion,'still');assert.equal(output.audio,'mute');assert.equal(creative.headline,'한 잔의 여유','model parsing does not mutate saved work');
});
test('director does not authorize rendering without a photo and rejects invalid generated plans',async()=>{
  const output=await directCreative({creative:{...creative,image:''},brand:{},message:'만들어줘',callModel:async()=>response(result)});assert.equal(output.action,'update');assert.match(output.reply,/제품 사진/);
  await assert.rejects(directCreative({creative,brand:{},message:'60초로',callModel:async()=>response({...result,plan:{...result.plan,duration:60}})}),/기획/);
  await assert.rejects(directCreative({creative,brand:{},message:'고쳐줘',callModel:async()=>({output:[]})}),/응답/);
  await assert.rejects(directCreative({creative,brand:{},message:' ',callModel:async()=>response(result)}),/제작 요청/);
});
