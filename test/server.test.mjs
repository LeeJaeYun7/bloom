import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import http from 'node:http';

async function freePort() { const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }
test('server saves actual work, rejects stale writes, and uses the AI contract', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'bloom-test-')); const port = await freePort();
  let child;
  async function launch() {
    child = spawn(process.execPath, ['--import', './test/fixtures/openai.mjs', 'server.mjs'], { env: { ...process.env, PORT: String(port), BLOOM_DATA_DIR: dataDir, OPENAI_API_KEY: '', INSTAGRAM_APP_ID:'12345',INSTAGRAM_APP_SECRET:'http-secret-fixture',INSTAGRAM_PUBLIC_ORIGIN:'https://auth.bloom.test',CLOUDINARY_CLOUD_NAME:'test',CLOUDINARY_API_KEY:'key-fixture',CLOUDINARY_API_SECRET:'secret-fixture' }, stdio: ['ignore','pipe','pipe'] });
    await Promise.race([once(child.stdout,'data'), once(child,'exit').then(() => { throw Error('Server exited'); })]);
  }
  async function stop() { const exit = once(child,'exit'); child.kill(); await exit; }
  t.after(async () => { if (child?.exitCode === null) await stop(); await rm(dataDir,{recursive:true,force:true}); });
  await launch();
  const base = `http://127.0.0.1:${port}`;
  const request = (url, value, method='POST', headers={}) => fetch(base+url,{method:value===undefined?'GET':method,headers:{'Content-Type':'application/json',...headers},...(value===undefined?{}:{body:JSON.stringify(value)})});
  const authFetch=(url,headers={})=>new Promise((resolve,reject)=>{const req=http.get(base+url,{headers:{Host:'auth.bloom.test',...headers}},res=>{res.resume();resolve({status:res.statusCode,headers:new Headers(Object.fromEntries(Object.entries(res.headers).map(([key,value])=>[key,Array.isArray(value)?value.join(','):value])))})});req.on('error',reject)});
  assert.equal((await authFetch('/api/state')).status,403,'public host cannot access the workspace');
  assert.equal((await authFetch('/auth/instagram/start')).headers.get('location'),`http://localhost:${port}/?instagram=invalid#instagram`,'public start requires a handoff from the local app');
  assert.equal((await request('/api/instagram/connect',{})).status,404,'manual credential endpoint removed');
  assert.equal((await request('/api/instagram/login',{},'POST',{Origin:'https://evil.example'})).status,403);
  const adminPage=await request('/admin');assert.equal(adminPage.status,200);assert.match(adminPage.headers.get('content-type'),/text\/html/);
  assert.equal((await authFetch('/admin')).status,403);assert.equal((await authFetch('/api/admin/config')).status,403);
  const admin=await (await request('/api/admin/config')).json();assert.equal(admin.ready,true);assert.equal(JSON.stringify(admin).includes('http-secret-fixture'),false);
  assert.equal((await request('/api/admin/config',{revision:admin.revision,values:{INSTAGRAM_APP_SECRET:'',CLOUDINARY_API_SECRET:''}},'PUT',{Origin:'https://evil.example'})).status,403);
  const savedConfig=await request('/api/admin/config',{revision:admin.revision,values:{INSTAGRAM_APP_SECRET:'',CLOUDINARY_API_SECRET:''}},'PUT');assert.equal(savedConfig.status,200);
  const configRevision=(await savedConfig.json()).revision;assert.notEqual(configRevision,admin.revision);
  assert.equal((await request('/api/admin/config',{revision:admin.revision,values:{}},'PUT')).status,409);
  const handoff=await (await request('/api/instagram/login',{})).json();
  const started=await authFetch(new URL(handoff.url).pathname+new URL(handoff.url).search);
  const reused=await authFetch(new URL(handoff.url).pathname+new URL(handoff.url).search);assert.match(reused.headers.get('location'),/instagram=invalid/);
  const authorize=new URL(started.headers.get('location'));assert.equal(authorize.origin,'https://www.instagram.com');
  const cookie=started.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Lax/);
  const authPath='/auth/instagram/callback?state='+authorize.searchParams.get('state')+'&code=fixture';
  const complete=await authFetch(authPath,{Cookie:cookie.split(';')[0]});assert.equal(complete.headers.get('location'),`http://localhost:${port}/?instagram=connected#instagram`);
  assert.match(complete.headers.get('set-cookie'),/Max-Age=0/);assert.equal((await (await request('/api/instagram/status')).json()).account.username,'http_owner');
  const replay=await authFetch(authPath,{Cookie:cookie.split(';')[0]});assert.match(replay.headers.get('location'),/instagram=invalid/);
  const connectionText=await readFile(path.join(dataDir,'instagram-connection.enc'),'utf8');assert.equal(connectionText.includes('long-instagram-fixture'),false);
  const state = { brand:{name:'테스트 브랜드',description:'새로운 제품',url:'',color:'#123456',tone:'전문적인'},creatives:[{id:'c1',brand:'테스트 브랜드',name:'제품 광고',headline:'제품의 매력',caption:'지금 만나보세요',script:'게시물 본문',prompt:'제품 소개',channel:'Instagram',format:'이미지 광고',variant:0}], campaigns:[] };
  const input = {brand:state.brand,prompt:'제품 소개',channel:'Instagram',format:'이미지 광고'};
  assert.equal((await request('/api/creative',input)).status,503);
  assert.deepEqual(await (await request('/api/state')).json(),{revision:0,state:null});
  assert.equal((await request('/api/state',{state,revision:0},'PUT')).status,200);
  assert.equal((await request('/api/state',{state,revision:0},'PUT')).status,409);
  assert.equal((await request('/api/state',{state:{...state,creatives:[{}]},revision:1},'PUT')).status,400);
  assert.equal((await request('/api/state',{state,revision:1},'PUT', {Origin:'https://evil.example'})).status,403);
  const writes=await Promise.all([request('/api/state',{state,revision:1},'PUT'), request('/api/state',{state,revision:1},'PUT')]);
  assert.deepEqual(writes.map(x=>x.status).sort(),[200,409]);
  for(const url of ['/.bloom/workspace.json','/server.mjs','/.env','/package.json'])assert.equal((await request(url)).status,404);
  assert.equal((await request('/api/settings',{apiKey:'sk-test-invalid',model:'gpt-4.1-mini'})).status,502);
  assert.equal((await (await request('/api/status')).json()).configured,false);
  assert.equal((await request('/api/settings',{apiKey:'sk-test-valid',model:'gpt-4.1-mini'})).status,200);
  assert.equal((await request('/api/settings',{apiKey:'sk-test-invalid',model:'gpt-4.1-mini'})).status,502);
  assert.equal((await request('/api/creative',input)).status,200,'failed replacement keeps working key');
  const creative=await (await request('/api/creative',input)).json();assert.equal(creative.headline,'테스트 브랜드의 새로운 시작');
  const edited=await (await request('/api/creative',{...input,existing:creative,message:'더 구체적으로'})).json();assert.equal(edited.headline,'수정: 더 구체적으로');
  assert.equal((await request('/api/creative',{...input,prompt:'quota'})).status,502);
  assert.equal((await request('/api/creative',{...input,prompt:'incomplete'})).status,502);
  assert.equal((await request('/api/creative',{prompt:'missing brand'})).status,400);
  const disk=JSON.parse(await readFile(path.join(dataDir,'workspace.json'),'utf8'));assert.deepEqual(disk.state,state);assert.equal(JSON.stringify(disk).includes('sk-test'),false);
  await stop();await launch();assert.deepEqual((await (await request('/api/state')).json()).state,state);assert.equal((await (await request('/api/status')).json()).configured,false);
  assert.equal((await (await request('/api/videos/status')).json()).available,true);
  const photo='data:image/jpeg;base64,'+(await readFile(new URL('../assets/coffee.jpg',import.meta.url))).toString('base64');
  const workspace=await (await request('/api/state')).json();workspace.state.creatives[0].image=photo;
  assert.equal((await request('/api/state',workspace,'PUT')).status,200);
  assert.equal((await request('/api/video-plan',{creativeId:'c1',aspect:'9:16'})).status,503);
  await request('/api/settings',{apiKey:'sk-test-valid',model:'gpt-4.1-mini'});
  const planResponse=await request('/api/video-plan',{creativeId:'c1',aspect:'9:16'});assert.equal(planResponse.status,200);const plan=await planResponse.json();assert.equal(plan.scenes.length,3);
  const renderResponse=await request('/api/videos',{creativeId:'c1',plan});assert.equal(renderResponse.status,202);const videoJob=await renderResponse.json();
  let video;for(let i=0;i<200;i++){video=(await (await request('/api/videos')).json()).find(item=>item.id===videoJob.id);if(['ready','failed'].includes(video.status))break;await new Promise(resolve=>setTimeout(resolve,100))}
  assert.equal(video.status,'ready',video.error);
  const mediaUrl='/api/videos/'+video.id+'/file';const partial=await fetch(base+mediaUrl,{headers:{Range:'bytes=0-31'}});assert.equal(partial.status,206);assert.equal(partial.headers.get('content-type'),'video/mp4');assert.equal((await partial.arrayBuffer()).byteLength,32);assert.match(partial.headers.get('content-range'),/^bytes 0-31\//);
  assert.equal((await fetch(base+mediaUrl,{headers:{Range:'bytes=999999999999-'}})).status,416);
  const download=await request(mediaUrl+'?download=1');assert.match(download.headers.get('content-disposition'),/attachment/);await download.arrayBuffer();
  assert.equal((await authFetch(mediaUrl)).status,403);assert.equal((await request('/api/videos/'+video.id+'/poster')).status,200);

  const chatWorkspace=await (await request('/api/state')).json();chatWorkspace.state.creatives[0].conversation=[{role:'user',text:'20대 직장인 타깃의 라떼 광고'},{role:'assistant',text:'따뜻한 분위기로 기획하겠습니다.'}];chatWorkspace.state.creatives[0].directorBrief={product:'오트 라떼',audience:'20대 직장인',tone:'따뜻함',goal:'제품 소개'};
  assert.equal((await request('/api/state',chatWorkspace,'PUT')).status,200);
  const directorResponse=await request('/api/director',{creativeId:'c1',message:'10초로 줄여줘',audioAvailable:false});assert.equal(directorResponse.status,200);const directed=await directorResponse.json();assert.equal(directed.plan.duration,10);assert.equal(directed.brief.audience,'20대 직장인');assert.equal(directed.action,'render');
  assert.equal((await request('/api/director',{creativeId:'missing',message:'만들어줘'})).status,400);
  const batchWorkspace=await (await request('/api/state')).json();batchWorkspace.state.assets=[{id:'shared-photo',data:photo}];
  assert.equal((await request('/api/state',batchWorkspace,'PUT')).status,200);
  const plannedBatch=await request('/api/batch-plan',{assetId:'shared-photo',creativeId:'c1',product:'오트 라떼',goal:'제품 소개',audience:'20대 직장인',duration:6,count:5,aspect:'1:1'});assert.equal(plannedBatch.status,200);const variants=(await plannedBatch.json()).variants;assert.equal(variants.length,5);
  const batchState=await (await request('/api/state')).json();const records=variants.map((item,i)=>({...batchState.state.creatives[0],id:'http-variant-'+i,name:item.name,headline:item.headline,caption:item.caption,script:item.script,color:batchState.state.brand.color,image:'',imageRef:'shared-photo',imageVersion:'shared-photo',videoDraft:item.plan,batchId:'http-batch',batchIndex:i,batchAngle:item.angle,batchHypothesis:item.hypothesis}));batchState.state.creatives.push(...records);
  assert.equal((await request('/api/state',batchState,'PUT')).status,200);
  const beforeBatch=(await (await request('/api/videos')).json()).length;
  assert.equal((await request('/api/videos/batch',{creativeIds:[records[0].id,'missing']})).status,400);assert.equal((await (await request('/api/videos')).json()).length,beforeBatch,'invalid batch does not partly enqueue');
  const batchResponse=await request('/api/videos/batch',{creativeIds:records.map(item=>item.id)});assert.equal(batchResponse.status,202);const batchJobs=(await batchResponse.json()).jobs;assert.equal(batchJobs.length,5);assert.equal(new Set(batchJobs.map(job=>job.creativeId)).size,5);
  const repeated=await (await request('/api/videos/batch',{creativeIds:records.map(item=>item.id)})).json();assert.deepEqual(repeated.jobs.map(job=>job.id),batchJobs.map(job=>job.id),'repeated request reuses the same jobs');
  let finished=[];for(let i=0;i<250;i++){finished=(await (await request('/api/videos')).json()).filter(job=>job.batchId==='http-batch');if(finished.every(job=>['ready','failed'].includes(job.status)))break;await new Promise(resolve=>setTimeout(resolve,100))}
  assert.equal(finished.filter(job=>job.status==='ready').length,5,JSON.stringify(finished.map(job=>({status:job.status,error:job.error}))));
  for(const job of finished){const file=await fetch(base+job.fileUrl,{headers:{Range:'bytes=0-15'}});assert.equal(file.status,206);assert.equal(Buffer.from(await file.arrayBuffer()).subarray(4,8).toString(),'ftyp');assert.equal(job.duration,6)}
  assert.equal((await request('/api/director',{creativeId:records[2].id,message:'10초로 줄여줘'})).status,200,'asset-backed variant can continue in chat');
  let perfWorkspace=await (await request('/api/state')).json();
  const experimentInput={revision:perfWorkspace.revision,name:'실제 성과 비교',product:'오트 라떼',audience:'20대 직장인',channel:'Instagram',landingUrl:'https://example.com/latte',attribution:'7일 클릭',marginRate:.5,targetCpa:10000,maxSpend:100000,startDate:'2026-01-01',endDate:'2026-01-31',creativeIds:['c1'],hypothesis:'첫 장면 메시지를 시험한다'};
  const createdExperiment=await request('/api/performance/experiments',experimentInput);assert.equal(createdExperiment.status,200);let perf=await createdExperiment.json();const experimentId=perf.report.experiments[0].id;
  assert.equal((await request('/api/performance/experiments',experimentInput)).status,409,'stale mutation cannot overwrite performance records');
  const imported=await request('/api/performance/observations',{revision:perf.revision,experimentId,source:'Meta CSV',csv:'creativeId,date,spend,impressions,clicks,purchases,revenue,refunds\nc1,2026-01-02,20000,10000,200,20,100000,10000'});assert.equal(imported.status,200);perf=await imported.json();assert.equal(perf.report.experiments[0].metrics.contribution,25000);
  const badImport=await request('/api/performance/observations',{revision:perf.revision,experimentId,source:'invalid',rows:[{creativeId:'c1',date:'2026-01-03',spend:100,impressions:1,clicks:2,purchases:0,revenue:0,refunds:0}]});assert.equal(badImport.status,400);
  const afterBad=await (await request('/api/state')).json();assert.equal(afterBad.revision,perf.revision);assert.equal(afterBad.state.performance.observations.length,1,'failed import is atomic');
  const recorded=await request('/api/performance/decisions',{revision:perf.revision,experimentId,action:'iterate',note:'다음 광고는 다른 첫 장면으로 시험'});assert.equal(recorded.status,200);perf=await recorded.json();assert.equal(perf.state.performance.decisions[0].execution,'recorded_only');
  const tampered=structuredClone(perf.state);tampered.performance.observations[0].spend=0;assert.equal((await request('/api/state',{revision:perf.revision,state:tampered},'PUT')).status,400,'workspace saves cannot silently rewrite performance evidence');
  assert.equal((await request('/api/performance/forecasts',{revision:perf.revision,experimentId})).status,400,'no fabricated forecast for observed experiments');
  const perfReport=await (await request('/api/performance')).json();assert.equal(perfReport.experiments[0].decisions.length,1);
  const restore=await (await request('/api/state')).json();await stop();await launch();assert.deepEqual((await (await request('/api/state')).json()).state.creatives[0].conversation,restore.state.creatives[0].conversation);assert.deepEqual((await (await request('/api/state')).json()).state.performance,restore.state.performance,'performance evidence survives restart');

});
