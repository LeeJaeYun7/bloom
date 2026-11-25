import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createInstagram } from '../instagram.mjs';

const image='data:image/jpeg;base64,'+Buffer.from([255,216,255,224,0,0,255,217]).toString('base64');
const workspace={creatives:[{id:'creative-1',name:'가방 광고',channel:'Instagram',format:'이미지 광고'}]};
const operator={INSTAGRAM_APP_ID:'123456',INSTAGRAM_APP_SECRET:'app-secret-fixture',INSTAGRAM_PUBLIC_ORIGIN:'https://auth.bloom.test',CLOUDINARY_CLOUD_NAME:'bloom-test',CLOUDINARY_API_KEY:'12345',CLOUDINARY_API_SECRET:'test-secret'};
const scopes='instagram_business_basic,instagram_business_content_publish';
function oauthFixture(url){
  if(String(url)==='https://api.instagram.com/oauth/access_token')return Response.json({data:[{access_token:'short-test-token',permissions:scopes}]});
  if(String(url).startsWith('https://graph.instagram.com/access_token?'))return Response.json({access_token:'ig-test-token',expires_in:60*86400});
  return null;
}
async function login(service){const request=service.beginAuthorization();return service.finishAuthorization({state:new URL(request.location).searchParams.get('state'),binding:request.binding,code:'code-fixture'})}
const waitFor=async(fn)=>{for(let i=0;i<100;i++){const result=fn();if(result)return result;await new Promise(resolve=>setTimeout(resolve,5))}throw Error('Job did not settle')};

test('Instagram publishes rendered JPEG exactly once, records permalink, keeps credentials private',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'bloom-instagram-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const originalFetch=globalThis.fetch; t.after(()=>{globalThis.fetch=originalFetch});
  const calls=[];let published=false;
  globalThis.fetch=async(url,options)=>{
    calls.push({url:String(url),options});const oauth=oauthFixture(url);if(oauth)return oauth;
    if(String(url).startsWith('https://api.cloudinary.com/')){
      const form=options.body;assert.equal(form.get('file'),image);assert.equal(form.get('api_key'),'12345');
      assert.equal(form.get('signature'),createHash('sha256').update(`timestamp=${form.get('timestamp')}test-secret`).digest('hex'));
      return Response.json({secure_url:'https://res.cloudinary.com/bloom-test/image/upload/abc.jpg',format:'jpg'});
    }
    assert.equal(options.headers.Authorization,'Bearer ig-test-token');
    if(String(url).includes('/me?'))return Response.json({user_id:'1234',username:'bloom_owner',account_type:'BUSINESS'});
    if(String(url).endsWith('/1234/media')){const data=JSON.parse(options.body);assert.equal(data.caption,'새 가방 출시');assert.match(data.image_url,/^https:\/\/res.cloudinary.com/);return Response.json({id:'5678'})}
    if(String(url).includes('/5678?'))return Response.json({status_code:published?'PUBLISHED':'FINISHED'});
    if(String(url).endsWith('/1234/media_publish')){
      assert.equal(JSON.parse(options.body).creation_id,'5678');
      published=true;return Response.json({id:'9999'});
    }
    if(String(url).includes('/9999?'))return Response.json({permalink:'https://www.instagram.com/p/test-post/'});
    throw Error('Unexpected Instagram call '+url);
  };
  const service=await createInstagram(dir,{env:operator});t.after(()=>service.close());assert.equal(service.status().connected,false);
  await login(service);assert.equal(service.status().account.username,'bloom_owner');
  const input={creativeId:'creative-1',accountId:'1234',requestId:'request-1234567890',caption:'새 가방 출시',image};
  await assert.rejects(service.createPost({...input,accountId:'999'},workspace),/대상 계정/);
  await assert.rejects(service.createPost({...input,image:'data:image/png;base64,YWJj'},workspace),/JPEG/);
  await assert.rejects(service.createPost({...input,caption:'가'.repeat(2201)},workspace),/2,200/);
  await assert.rejects(service.createPost(input,{creatives:[{...workspace.creatives[0],format:'15초 스토리보드'}]}),/이미지 광고/);
  const [first,duplicate]=await Promise.all([service.createPost(input,workspace),service.createPost(input,workspace)]);assert.equal(first.id,duplicate.id);
  await waitFor(()=>service.list()[0].permalink);assert.equal(service.list()[0].status,'published');
  assert.equal(calls.filter(call=>call.url.endsWith('/media_publish')).length,1);
  const sameImage=await service.createPost({...input,requestId:'another-request-123456'},workspace);assert.equal(sameImage.id,first.id);
  const disk=await readFile(path.join(dir,'instagram-posts.json'),'utf8');assert.equal(disk.includes('ig-test-token'),false);assert.equal(disk.includes('test-secret'),false);assert.equal(disk.includes('data:image'),false);
  const restarted=await createInstagram(dir,{env:operator});t.after(()=>restarted.close());assert.equal(restarted.list()[0].status,'published');assert.equal(restarted.status().connected,true);
  await service.disconnect();assert.equal(service.status().connected,false);assert.equal(service.status().hostingConfigured,true);

});

test('lost publish response is reconciled without reposting; restart never replays a request',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'bloom-instagram-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch});let publishCalls=0,received=false;
  globalThis.fetch=async(url)=>{
    const oauth=oauthFixture(url);if(oauth)return oauth;url=String(url);
    if(url.startsWith('https://api.cloudinary.com/'))return Response.json({secure_url:'https://res.cloudinary.com/bloom-test/image/upload/abc.jpg',format:'jpg'});
    if(url.includes('/me?'))return Response.json({data:[{user_id:'1234',username:'owner',account_type:'Media_Creator'}]});
    if(url.endsWith('/1234/media'))return Response.json({id:'5678'});
    if(url.includes('/5678?'))return Response.json({status_code:received?'PUBLISHED':'FINISHED'});
    if(url.endsWith('/media_publish')){publishCalls++;received=true;throw Error('lost response')}
    throw Error('Unexpected URL');
  };
  const service=await createInstagram(dir,{env:operator});t.after(()=>service.close());await login(service);
  const input={creativeId:'creative-1',accountId:'1234',requestId:'uncertain-1234567890',caption:'새 가방 출시',image};
  const job=await service.createPost(input,workspace);await waitFor(()=>job.status==='uncertain');
  assert.equal((await service.createPost(input,workspace)).id,job.id);assert.equal(publishCalls,1);
  const restored=await createInstagram(dir,{env:operator});t.after(()=>restored.close());await login(restored);await restored.reconcile(job.id);assert.equal(restored.list()[0].status,'published');assert.equal(publishCalls,1);
});

test('OAuth verifies browser state, required permissions, and professional account before replacing a connection',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'bloom-instagram-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch});
  let permissions=scopes,accountType='Business',exchanges=0;
  globalThis.fetch=async(url)=>{
    if(String(url)==='https://api.instagram.com/oauth/access_token'){exchanges++;return Response.json({access_token:'short',permissions})}
    const oauth=oauthFixture(url);if(oauth)return oauth;
    return Response.json({user_id:'1234',username:'owner',account_type:accountType});
  };
  const service=await createInstagram(dir,{env:operator});t.after(()=>service.close());
  const auth=service.beginAuthorization(),url=new URL(auth.location),state=url.searchParams.get('state');
  assert.equal(url.origin,'https://www.instagram.com');assert.equal(url.searchParams.get('scope'),scopes);assert.equal(url.searchParams.get('redirect_uri'),'https://auth.bloom.test/auth/instagram/callback');
  assert.equal(auth.location.includes('app-secret'),false);
  await assert.rejects(service.finishAuthorization({state,binding:'wrong',code:'fixture'}),/만료/);assert.equal(exchanges,0);
  await service.finishAuthorization({state,binding:auth.binding,code:'fixture'});assert.equal(service.status().connected,true);
  await assert.rejects(service.finishAuthorization({state,binding:auth.binding,code:'fixture'}),/만료/);assert.equal(exchanges,1);
  permissions='instagram_business_basic';await assert.rejects(login(service),/권한/);assert.equal(service.status().account.username,'owner');
  permissions=scopes;accountType='PERSONAL';await assert.rejects(login(service),/비즈니스/);assert.equal(service.status().connected,true);
  const cancelled=service.beginAuthorization();await assert.rejects(service.finishAuthorization({state:new URL(cancelled.location).searchParams.get('state'),binding:cancelled.binding,denied:true}),/취소/);
  assert.equal(service.status().connected,true);
  const encrypted=await readFile(path.join(dir,'instagram-connection.enc'),'utf8');assert.equal(encrypted.includes('ig-test-token'),false);assert.equal(encrypted.includes('owner'),false);
});

test('automatic refresh renews persisted grant and cannot restore a disconnected account',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'bloom-instagram-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch});
  let clock=Date.now(),refreshes=0,waitRefresh=null;
  globalThis.fetch=async(url)=>{
    if(String(url).includes('/refresh_access_token?')){refreshes++;if(waitRefresh)await waitRefresh;return Response.json({access_token:'refreshed-test-token',expires_in:60*86400})}
    const oauth=oauthFixture(url);if(oauth)return oauth;
    return Response.json({user_id:'1234',username:'owner',account_type:'Business'});
  };
  const service=await createInstagram(dir,{env:operator,now:()=>clock});t.after(()=>service.close());await login(service);
  const firstExpiry=service.status().expiresAt;clock+=55*86400000;
  await Promise.all([service.refreshConnection(),service.refreshConnection()]);assert.equal(refreshes,1);assert.notEqual(service.status().expiresAt,firstExpiry);
  const restored=await createInstagram(dir,{env:operator,now:()=>clock});t.after(()=>restored.close());assert.equal(restored.status().expiresAt,service.status().expiresAt);
  clock+=55*86400000;let release;waitRefresh=new Promise(resolve=>{release=resolve});const refresh=service.refreshConnection();await service.disconnect();release();await refresh;
  assert.equal(service.status().connected,false);await assert.rejects(readFile(path.join(dir,'instagram-connection.enc')),error=>error.code==='ENOENT');
});

test('expired authorization is rejected and missing operator setup never exposes a fake login',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'bloom-instagram-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const unconfigured=await createInstagram(dir,{env:{}});t.after(()=>unconfigured.close());assert.equal(unconfigured.status().loginAvailable,false);assert.throws(()=>unconfigured.beginAuthorization(),/준비/);
  let clock=Date.now();const configured=await createInstagram(dir,{env:operator,now:()=>clock});t.after(()=>configured.close());const handoff=configured.createLoginHandoff();clock+=61000;assert.throws(()=>configured.consumeLoginHandoff(new URL(handoff.url).searchParams.get('ticket')),/만료/);const auth=configured.beginAuthorization();clock+=11*60*1000;
  await assert.rejects(configured.finishAuthorization({state:new URL(auth.location).searchParams.get('state'),binding:auth.binding,code:'fixture'}),/만료/);
});
