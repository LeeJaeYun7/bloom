import { test } from 'node:test';
import {mutatePerformance,performanceReport} from '../dist/performance.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { parseHTML } from 'linkedom';

async function setup({connected=false,ready=true,outcome=''}={}) {
  const {document,window}=parseHTML('<html><body><div id="app"></div><div id="toast"></div><dialog id="modal"></dialog></body></html>');
  const originalCreate=document.createElement.bind(document);
  document.createElement=(tag)=>tag==='canvas'?{getContext:()=>({font:'',measureText:t=>({width:t.length*65}),drawImage(){}}),width:0,height:0,toDataURL:()=> 'data:image/jpeg;base64,YWJj',toBlob:fn=>fn(new Blob(['PNG fixture'],{type:'image/png'}))}:originalCreate(tag);
  document.fonts={ready:Promise.resolve()};
  class FormData { constructor(form){this.entries=[];for(const element of form.querySelectorAll('input,textarea,select')){if(!element.name||element.hasAttribute('disabled')||(element.type==='checkbox'&&!(element.checked??element.hasAttribute('checked'))))continue;let value=element.value;if(element.localName==='select'){const option=element.querySelector('option[selected]')||element.querySelector('option');value=option?.getAttribute('value')??option?.textContent;}this.entries.push([element.name,value??'']);}}get(key){return this.entries.find(x=>x[0]===key)?.[1]??null}[Symbol.iterator](){return this.entries[Symbol.iterator]()}}
  const dialog=document.querySelector('#modal');dialog.showModal=()=>{};dialog.close=()=>{};
  const saved=[];let db={revision:0,state:null};const requests=[];let failAI=false;let failDirector=false;let failBatch=false;let instagram={connected,account:connected?{id:'1234',username:'my_brand'}:null,loginAvailable:ready,serviceReady:ready};let posts=[],videos=[];
  const fetch=async(url,options={})=>{
    const input=options.body?JSON.parse(options.body):null;requests.push({url,input});
    if(url==='/api/performance')return Response.json(performanceReport(db.state));
    if(url.startsWith('/api/performance/')){try{assert.equal(input.revision,db.revision);db={revision:db.revision+1,state:mutatePerformance(db.state,url.split('/').at(-1),input)};return Response.json({...db,report:performanceReport(db.state)})}catch(error){return Response.json({error:error.message},{status:400})}}
    if(url==='/api/batch-plan'){
      if(failBatch)return Response.json({error:'새 시안 기획 실패'},{status:502});
      return Response.json({variants:Array.from({length:input.count},(_,i)=>({angle:'관점 '+(i+1),hypothesis:'시험할 가설 '+(i+1),name:'시안 '+(i+1),headline:'제목 '+(i+1),caption:'보조 문구',script:'제작 원고 '+(i+1),plan:{aspect:input.aspect,duration:input.duration,style:['warm','bold','minimal'][i%3],motion:'gentle',scenes:[{title:'도입 '+(i+1),body:'제품 소개'},{title:'메시지 '+(i+1),body:'브랜드의 매력'},{title:'행동 유도',body:'지금 만나보세요'}]}}))});
    }
    if(url==='/api/videos/batch'){
      const jobs=input.creativeIds.map(id=>{const item=db.state.creatives.find(entry=>entry.id===id);return {id:'batch-video-'+id,creativeId:id,brand:item.brand,color:item.color,imageVersion:item.imageVersion,plan:item.videoDraft,status:'ready',progress:100,duration:item.videoDraft.duration,width:720,height:1280,hasAudio:false,fileUrl:'/api/videos/'+id+'/file',posterUrl:'/api/videos/'+id+'/poster'}});
      videos=[...jobs,...videos.filter(job=>!input.creativeIds.includes(job.creativeId))];return Response.json({jobs},{status:202});
    }
    if(url==='/api/videos/status')return Response.json({available:true});
    if(url==='/api/videos'&&!input)return Response.json(videos);
    if(url==='/api/videos'){videos=[{id:'video-fixture',creativeId:input.creativeId,brand:db.state.creatives.find(item=>item.id===input.creativeId).brand,color:db.state.creatives.find(item=>item.id===input.creativeId).color||db.state.brand.color,imageVersion:db.state.creatives.find(item=>item.id===input.creativeId).imageVersion||null,status:'ready',progress:100,width:720,height:1280,duration:input.plan.duration||15,plan:input.plan,hasAudio:!!input.audio,fileUrl:'/api/videos/video-fixture/file',posterUrl:'/api/videos/video-fixture/poster'}];return Response.json(videos[0],{status:202});}
    if(url==='/api/director'){
      if(failDirector)return Response.json({error:'AI 연결 실패'},{status:502});
      const duration=input.message.includes('10초')?10:15;
      return Response.json({reply:duration===10?'기존 타깃을 유지하고 10초로 줄였습니다.':'따뜻한 광고를 기획했습니다. 원하는 부분을 이야기해주세요.',action:input.message.includes('만들')||duration===10?'render':'update',ready:true,audio:input.message.includes('무음')?'mute':'keep',brief:{product:'오트 라떼',audience:'20대 직장인',tone:'따뜻함',goal:'제품 소개'},creative:{brand:'Bloom Coffee',name:'라떼 광고',headline:'한 잔의 여유',caption:'내 취향의 라떼',script:'대화로 정리한 원고',channel:'Instagram'},plan:{aspect:'9:16',duration,style:'warm',motion:'gentle',scenes:[{title:'하루의 여유',body:'부드러운 오트 라떼'},{title:'내 취향의 한 잔',body:'일상에 따뜻함을'},{title:'지금 만나보세요',body:'자세히 알아보기'}]}});
    }
    if(url==='/api/video-plan')return Response.json({aspect:input.aspect,scenes:[{title:'AI 도입',body:'제품 소개'},{title:'AI 제품 메시지',body:'브랜드의 매력'},{title:'AI 행동 유도',body:'지금 만나보세요'}]});
    if(url==='/api/instagram/login')return Response.json({url:'https://auth.bloom.test/auth/instagram/start?ticket=test-ticket'});
    if(url==='/api/instagram/status')return Response.json(instagram);
    if(url==='/api/instagram/disconnect'){instagram={connected:false,account:null,serviceReady:true,loginAvailable:true};return Response.json(instagram);}
    if(url==='/api/instagram/posts'&&!input)return Response.json(posts);
    if(url==='/api/instagram/posts'){posts=[{id:input.requestId,account:instagram.account,caption:input.caption,name:'피드 게시물',status:'published',createdAt:new Date().toISOString(),permalink:'https://www.instagram.com/p/test/'}];return Response.json(posts[0],{status:202});}
    if(url==='/api/status')return Response.json({configured:false,model:'gpt-4.1-mini'});
    if(url==='/api/state'&&!input)return Response.json(db);
    if(url==='/api/state'){assert.equal(input.revision,db.revision);db={state:input.state,revision:db.revision+1};saved.push(structuredClone(input.state));return Response.json({revision:db.revision});}
    if(url==='/api/settings')return Response.json({configured:true,model:input.model});
    if(url==='/api/creative')return failAI?Response.json({error:'API 잔액 확인'},{status:502}):Response.json({name:'AI 작업',headline:input.message||'제품을 위한 실제 원고',caption:'제품 소개',script:'원고 본문'});
    throw Error('Unexpected request '+url);
  };
  class Image {width=200;height=100;set src(value){queueMicrotask(()=>this.onload?.())}}
  class FileReader {readAsDataURL(){this.result='data:image/jpeg;base64,YWJj';queueMicrotask(()=>this.onload?.())}}
  const downloads=[],navigations=[];
  const context=vm.createContext({document,window:{addEventListener(){},scrollTo(){}},location:{hash:'',pathname:'/',search:outcome?'?instagram='+outcome:'',assign:url=>navigations.push(url)},localStorage:{getItem:()=>null},URLSearchParams,structuredClone,fetch,FormData,crypto:webcrypto,Response,Blob,Image,FileReader,URL:{createObjectURL:blob=>{downloads.push(blob);return 'blob:fixture'},revokeObjectURL(){}},setTimeout:()=>1,clearTimeout(){},console});
  vm.runInContext(await readFile(new URL('../dist/app.js',import.meta.url),'utf8'),context);
  const flush=async()=>{for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve))};await flush();
  const click=async selector=>{const el=document.querySelector(selector);assert.ok(el,selector);await el.onclick();await flush()};
  const submit=async selector=>{const el=document.querySelector(selector);await el.onsubmit({preventDefault(){},target:el});await flush()};
  const fill=(selector,value)=>{document.querySelector(selector).value=value};
  return {document,context,click,submit,fill,flush,saved,requests,downloads,setFailAI:value=>{failAI=value},setFailDirector:value=>{failDirector=value},setFailBatch:value=>{failBatch=value},getState:()=>db.state,navigations};
}
test('manual creation → edit → PNG/SVG export → reopen → campaign draft',async()=>{
  const app=await setup();const {document,click,fill,submit,getState}=app;
  assert.ok(document.querySelector('#settings'));
  await click('[data-view="studio"]');fill('[name=brand]','실제 제품 브랜드');fill('[name=prompt]','핸드크림 신제품 광고');
  await click('#manual-create');assert.equal(getState().creatives.length,1);
  fill('#edit-form [name=headline]','손끝에 담은 보습');fill('#edit-form [name=caption]','매일의 핸드케어');fill('#edit-form [name=script]','실제 게시물 본문');await submit('#edit-form');
  assert.equal(getState().creatives[0].headline,'손끝에 담은 보습');
  const photo=document.querySelector('[name=photo]');photo.files=[{type:'image/jpeg',size:10}];await photo.onchange({target:photo});await app.flush();
  assert.equal(getState().creatives[0].image,'data:image/jpeg;base64,YWJj');
  fill('#create-form [name=prompt]','입력 중인 아이디어');await click('[data-variant="1"]');assert.equal(document.querySelector('[name=prompt]').value,'입력 중인 아이디어');
  await click('#export');const svg=await app.downloads.at(-1).text();assert.match(svg,/손끝에 담은 보습/);assert.match(svg,/data:image\/jpeg;base64,YWJj/);
  await click('#export-png');assert.equal(app.downloads.at(-1).type,'image/png');
  await click('[data-view="library"]');await click('[data-creative]');assert.equal(document.querySelector('#edit-form [name=headline]').value,'손끝에 담은 보습');
  await click('#save-campaign');fill('#campaign-form [name=name]','핸드크림 캠페인');await submit('#campaign-form');assert.equal(getState().campaigns.length,1);assert.match(document.querySelector('.content').textContent,/핸드크림 캠페인/);
});
test('AI setup → generation → contextual revision; failures preserve existing work',async()=>{
  const app=await setup();const {document,click,fill,submit,getState}=app;
  await click('[data-view="studio"]');fill('[name=prompt]','가죽 가방 신제품 광고');
  await submit('#create-form');assert.ok(document.querySelector('#settings-form'));assert.equal(getState().creatives.length,0);
  fill('#settings-form [name=apiKey]','sk-fixture');await submit('#settings-form');
  await submit('#create-form');assert.equal(getState().creatives[0].headline,'제품을 위한 실제 원고');
  fill('#chat-form [name=message]','여행자에게 어울리는 표현으로');await submit('#chat-form');assert.equal(getState().creatives[0].headline,'여행자에게 어울리는 표현으로');
  const request=app.requests.filter(x=>x.url==='/api/creative').at(-1);assert.equal(request.input.existing.headline,'제품을 위한 실제 원고');assert.equal('image' in request.input,false);
  const before=structuredClone(getState());app.setFailAI(true);fill('#chat-form [name=message]','더 수정');await submit('#chat-form');assert.deepEqual(getState(),before);assert.match(document.querySelector('#toast').textContent,/API 잔액 확인/);
});

test('Instagram previews final image and caption before explicit posting; credentials stay out of workspace',async()=>{
  const app=await setup({connected:true});const {document,click,fill,submit,getState}=app;
  await click('[data-view="instagram"]');assert.match(document.querySelector('.content').textContent,/@my_brand/);
  await click('[data-view="studio"]');await click('#manual-create');fill('#edit-form [name=headline]','새로운 가방');fill('#edit-form [name=script]','여행을 위한 가방');await submit('#edit-form');
  await click('#instagram-publish');assert.equal(app.requests.filter(item=>item.url==='/api/instagram/posts'&&item.input).length,0);
  assert.ok(document.querySelector('#instagram-publish-form'),document.querySelector('#toast').textContent);
  assert.equal(document.querySelector('#instagram-publish-form [name=caption]').value,'여행을 위한 가방');
  assert.match(document.querySelector('.publishpreview').getAttribute('src'),/^data:image\/jpeg/);
  fill('#instagram-publish-form [name=caption]','최종 확인한 게시 캡션');await submit('#instagram-publish-form');
  const post=app.requests.find(item=>item.url==='/api/instagram/posts'&&item.input).input;
  assert.equal(post.caption,'최종 확인한 게시 캡션');assert.equal(post.accountId,'1234');assert.equal(post.creativeId,getState().creatives[0].id);
  assert.equal('accessToken' in post,false);assert.equal(JSON.stringify(getState()).includes('secret-fixture'),false);
  assert.match(document.querySelector('#instagram-posts').textContent,/게시 완료/);assert.ok(document.querySelector('#instagram-posts a[href="https://www.instagram.com/p/test/"]'));
});

test('Instagram user sees one login button and no operator credential fields',async()=>{
  const app=await setup();await app.click('[data-view="instagram"]');
  assert.ok(app.document.querySelector('#instagram-login'));assert.equal(app.document.querySelector('[name=accessToken]'),null);assert.equal(app.document.querySelector('[name=cloudSecret]'),null);
  assert.equal(app.document.querySelector('.content').textContent.includes('Cloudinary'),false);
  await app.click('#instagram-login');assert.deepEqual(app.navigations,['https://auth.bloom.test/auth/instagram/start?ticket=test-ticket']);
  const unavailable=await setup({ready:false});await unavailable.click('[data-view="instagram"]');assert.equal(unavailable.document.querySelector('#instagram-login').hasAttribute('disabled'),true);assert.match(unavailable.document.querySelector('.content').textContent,/준비 중/);
  const cancelled=await setup({outcome:'cancelled'});assert.match(cancelled.document.querySelector('.content').textContent,/연결을 취소/);assert.equal(cancelled.requests.some(request=>request.url==='/api/instagram/posts'&&request.input),false);
});

test('video editor saves three scenes, requests an MP4 and reopens the playable result',async()=>{
  const app=await setup();const {document,click,fill,submit,getState}=app;
  await click('[data-view="studio"]');await click('#manual-create');
  const photo=document.querySelector('[name=photo]');photo.files=[{type:'image/jpeg',size:10}];await photo.onchange({target:photo});await app.flush();
  assert.ok(document.querySelector('#video-form'));
  fill('#video-form [name=title0]','첫 번째 장면');fill('#video-form [name=body0]','제품 소개');fill('#video-form [name=title1]','두 번째 장면');fill('#video-form [name=title2]','브랜드를 만나보세요');
  await submit('#video-form');assert.equal(getState().creatives[0].videoDraft.scenes[0].title,'첫 번째 장면');
  const request=app.requests.find(item=>item.url==='/api/videos'&&item.input);assert.equal(request.input.plan.scenes.length,3);assert.equal(request.input.plan.aspect,'9:16');assert.equal(request.input.creativeId,getState().creatives[0].id);
  assert.ok(document.querySelector('#video-results video[src="/api/videos/video-fixture/file"]'));assert.ok(document.querySelector('#video-results a[download="bloom-ad.mp4"]'));
  await click('[data-view="library"]');await click('[data-creative]');assert.equal(document.querySelector('#video-form [name=title0]').value,'첫 번째 장면');
});

test('conversation first studio updates actual plan, renders on request and resumes context after reopening',async()=>{
  const app=await setup();const {document,click,fill,submit,getState}=app;
  await click('[data-view="studio"]');assert.ok(document.querySelector('#director-form'));assert.equal(document.querySelector('.director-advanced').hasAttribute('open'),false);
  await click('#settings');fill('#settings-form [name=apiKey]','sk-fixture');await submit('#settings-form');
  const photo=document.querySelector('#director-photo');photo.files=[{type:'image/jpeg',size:10}];await photo.onchange({target:photo});await app.flush();
  fill('#director-message','20대 직장인을 위한 따뜻한 라떼 광고를 기획해줘');await submit('#director-form');
  assert.equal(getState().creatives[0].directorBrief.audience,'20대 직장인');assert.equal(getState().creatives[0].conversation.length,2);assert.equal(app.requests.some(item=>item.url==='/api/videos'&&item.input),false);
  fill('#director-message','이 기획대로 영상 만들어줘');await submit('#director-form');assert.ok(document.querySelector('#director-preview video'));assert.equal(getState().creatives[0].executions.at(-1).tool,'render_video');
  fill('#director-message','10초로 줄여줘');await submit('#director-form');assert.equal(getState().creatives[0].videoDraft.duration,10);assert.equal(app.requests.filter(item=>item.url==='/api/videos'&&item.input).at(-1).input.plan.duration,10);
  assert.match(document.querySelector('#director-preview').textContent,/10초/);
  await click('[data-view="library"]');await click('[data-creative]');assert.match(document.querySelector('#director-transcript').textContent,/10초로 줄여줘/);assert.equal(getState().creatives[0].directorBrief.audience,'20대 직장인');
  const before=structuredClone(getState());app.setFailDirector(true);fill('#director-message','마지막 장면을 바꿔줘');await submit('#director-form');assert.match(document.querySelector('.director-chat').textContent,/AI 연결 실패/);assert.equal(document.querySelector('#director-message').value,'마지막 장면을 바꿔줘');assert.deepEqual(getState(),before);
});

test('editor timeline selects scenes, applies real duration/style settings and supports undo/redo',async()=>{
  const app=await setup();const {document,click,fill,submit,getState}=app;
  await click('[data-view="studio"]');assert.ok(document.querySelector('.editor-canvas'));assert.ok(document.querySelector('.editor-chat'));assert.ok(document.querySelector('#editor-timeline'));
  await click('#manual-create');const photo=document.querySelector('[name=photo]');photo.files=[{type:'image/jpeg',size:10}];await photo.onchange({target:photo});await app.flush();
  await click('[data-editor-scene="1"]');fill('#editor-scene-form [name=title]','타임라인에서 수정한 문구');await submit('#editor-scene-form');assert.equal(getState().creatives[0].videoDraft.scenes[1].title,'타임라인에서 수정한 문구');
  await click('#editor-undo');assert.notEqual(getState().creatives[0].videoDraft.scenes[1].title,'타임라인에서 수정한 문구');
  await click('#editor-redo');assert.equal(getState().creatives[0].videoDraft.scenes[1].title,'타임라인에서 수정한 문구');
  await click('[data-editor-tab="settings"]');fill('#editor-scene-form [name=duration]','10');await submit('#editor-scene-form');assert.equal(getState().creatives[0].videoDraft.duration,10);
  await click('#director-render');const request=app.requests.filter(item=>item.url==='/api/videos'&&item.input).at(-1);assert.equal(request.input.plan.duration,10);assert.equal(document.querySelector('.editor-export').getAttribute('href'),'/api/videos/video-fixture/file?download=1');
});

test('five-variant flow shares one photo, creates five videos and opens a selected variant in chat',async()=>{
  const app=await setup();const {document,click,fill,submit,getState}=app;
  await click('[data-view="studio"]');await click('[data-create-mode="batch"]');assert.ok(document.querySelector('#batch-form'));assert.equal(document.querySelector('#director-form'),null);
  await click('#settings');fill('#settings-form [name=apiKey]','sk-fixture');await submit('#settings-form');
  fill('#batch-form [name=product]','오트 라떼 신제품');fill('#batch-form [name=audience]','20대 직장인');fill('#batch-form [name=duration]','15');fill('#batch-form [name=count]','5');
  const photo=document.querySelector('#batch-photo');photo.files=[{type:'image/jpeg',size:10}];await photo.onchange({target:photo});await app.flush();await submit('#batch-form');
  const workspace=getState(),items=workspace.creatives.filter(item=>item.batchId);assert.equal(items.length,5);assert.equal(new Set(items.map(item=>item.batchAngle)).size,5);assert.equal(workspace.assets.length,1);assert.ok(items.every(item=>item.image===''&&item.imageRef===workspace.assets[0].id));
  assert.equal(app.requests.filter(item=>item.url==='/api/videos/batch').at(-1).input.creativeIds.length,5);assert.equal(document.querySelectorAll('.batch-card video').length,5);assert.match(document.querySelector('.batch-summary').textContent,/완료 5/);
  const third=items.find(item=>item.batchIndex===2);await click('[data-batch-open="'+third.id+'"]');assert.ok(document.querySelector('#director-form'));assert.match(document.querySelector('#director-transcript').textContent,/관점 3/);assert.ok(document.querySelector('#editor-player'));
  fill('#director-message','10초로 줄여줘');await submit('#director-form');assert.equal(getState().creatives.find(item=>item.id===third.id).videoDraft.duration,10);assert.equal(getState().creatives.find(item=>item.batchIndex===0).videoDraft.duration,15);
  await click('#director-variations');assert.ok(document.querySelector('#batch-form'));assert.equal(document.querySelector('#batch-form [name=duration]').value,'10');
});
test('failed batch planning preserves existing variants and does not enqueue fake results',async()=>{
  const app=await setup();const {document,click,fill,submit}=app;
  await click('[data-view="studio"]');await click('#settings');fill('#settings-form [name=apiKey]','sk-fixture');await submit('#settings-form');await click('[data-create-mode="batch"]');
  const photo=document.querySelector('#batch-photo');photo.files=[{type:'image/jpeg',size:10}];await photo.onchange({target:photo});await app.flush();fill('#batch-form [name=product]','제품 설명');app.setFailBatch(true);await submit('#batch-form');
  assert.match(document.querySelector('#batch-error').textContent,/기획 실패/);assert.equal(app.getState().creatives.length,0);assert.equal(app.requests.some(item=>item.url==='/api/videos/batch'),false);
});

test('CMO flow plans an experiment, registers real daily results, records a decision and returns to chat',async()=>{
  const app=await setup();const {document,click,fill,submit,getState}=app;
  await click('[data-view="studio"]');fill('[name=brand]','Bloom');fill('[name=prompt]','라떼');await click('#manual-create');
  await click('[data-view="performance"]');assert.match(document.body.textContent,/데이터가 없으면/);
  const fields={name:'첫 구매 실험',product:'oat-latte',audience:'신규 고객',channel:'Instagram',targetCpa:'10000',landingUrl:'https://example.com/latte',attribution:'7일 클릭',maxSpend:'100000',marginPercent:'50',startDate:'2026-01-01',endDate:'2026-01-31',hypothesis:'아침 메시지를 시험한다'};
  for(const [name,value] of Object.entries(fields))if(name!=='channel')fill('#experiment-form [name='+name+']',value);
  document.querySelector('#experiment-form [name=creativeIds]').checked=true;await submit('#experiment-form');assert.equal(getState().performance.experiments.length,1);assert.match(document.body.textContent,/첫 구매 실험/);
  const values={date:'2026-01-02',source:'Meta 보고서',spend:'20000',impressions:'10000',clicks:'200',purchases:'20',revenue:'100000',refunds:'10000'};
  for(const [name,value] of Object.entries(values))fill('#observation-form [name='+name+']',value);await submit('#observation-form');
  assert.equal(getState().performance.observations.length,1);assert.match(document.body.textContent,/₩25,000/);assert.match(document.body.textContent,/Meta 보고서/);
  for(const [name,value] of Object.entries({...values,purchases:'201'}))fill('#observation-form [name='+name+']',value);await submit('#observation-form');assert.equal(getState().performance.observations.length,1);assert.equal(document.querySelector('#observation-form [name=purchases]').value,'201','failed save preserves inputs');
  fill('#performance-decision [name=note]','첫 장면을 바꿔 다음 실험을 만든다');await submit('#performance-decision');assert.equal(getState().performance.decisions.length,1);assert.match(document.body.textContent,/첫 장면을 바꿔/);
  await click('[data-performance-creative]');assert.ok(document.querySelector('#director-form'));assert.equal(getState().performance.experiments[0].arms[0].snapshot.headline,'헤드라인을 입력해주세요.');
});
