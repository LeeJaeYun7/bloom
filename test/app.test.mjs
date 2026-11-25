import { test } from 'node:test';
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
  class FormData { constructor(form){this.entries=[];for(const element of form.querySelectorAll('input,textarea,select')){if(!element.name||element.hasAttribute('disabled'))continue;let value=element.value;if(element.localName==='select'){const option=element.querySelector('option[selected]')||element.querySelector('option');value=option?.getAttribute('value')??option?.textContent;}this.entries.push([element.name,value??'']);}}get(key){return this.entries.find(x=>x[0]===key)?.[1]??null}[Symbol.iterator](){return this.entries[Symbol.iterator]()}}
  const dialog=document.querySelector('#modal');dialog.showModal=()=>{};dialog.close=()=>{};
  const saved=[];let db={revision:0,state:null};const requests=[];let failAI=false;let instagram={connected,account:connected?{id:'1234',username:'my_brand'}:null,loginAvailable:ready,serviceReady:ready};let posts=[];
  const fetch=async(url,options={})=>{
    const input=options.body?JSON.parse(options.body):null;requests.push({url,input});
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
  vm.runInContext(await readFile(new URL('../app.js',import.meta.url),'utf8'),context);
  const flush=async()=>{for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve))};await flush();
  const click=async selector=>{const el=document.querySelector(selector);assert.ok(el,selector);await el.onclick();await flush()};
  const submit=async selector=>{const el=document.querySelector(selector);await el.onsubmit({preventDefault(){},target:el});await flush()};
  const fill=(selector,value)=>{document.querySelector(selector).value=value};
  return {document,context,click,submit,fill,flush,saved,requests,downloads,setFailAI:value=>{failAI=value},getState:()=>db.state,navigations};
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
