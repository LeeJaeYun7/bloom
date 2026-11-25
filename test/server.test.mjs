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
});
