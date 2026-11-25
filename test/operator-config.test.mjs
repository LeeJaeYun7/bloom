import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createOperatorConfig, inspectConfig } from '../dist/operator-config.js';
import { createInstagram } from '../dist/instagram.js';
const values={INSTAGRAM_APP_ID:'1234567',INSTAGRAM_APP_SECRET:'operator-secret-fixture',INSTAGRAM_PUBLIC_ORIGIN:'https://auth.bloom.test',INSTAGRAM_API_VERSION:'v27.0',CLOUDINARY_CLOUD_NAME:'bloom-test',CLOUDINARY_API_KEY:'12345',CLOUDINARY_API_SECRET:'cloud-secret-fixture'};
test('operator config persists encrypted secrets, masks reads, applies without restart and rejects stale updates',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'bloom-operator-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const config=await createOperatorConfig(dir,{}),instagram=await createInstagram(dir,{env:config.environment()});t.after(()=>instagram.close());
  assert.equal(config.describe().ready,false);assert.equal(instagram.status().loginAvailable,false);
  const revision=config.describe().revision;
  const result=await config.update({revision,values},next=>instagram.configure(next));
  assert.equal(result.ready,true);assert.equal(instagram.status().loginAvailable,true);assert.equal(instagram.callback,'https://auth.bloom.test/auth/instagram/callback');
  assert.equal(JSON.stringify(result).includes('operator-secret-fixture'),false);assert.equal(result.values.CLOUDINARY_API_KEY,undefined);assert.equal(result.configuredSecrets.INSTAGRAM_APP_SECRET,true);
  const disk=await readFile(path.join(dir,'operator-config.enc'),'utf8');assert.equal(disk.includes('cloud-secret-fixture'),false);assert.equal(disk.includes('1234567'),false);
  assert.equal((await stat(path.join(dir,'operator-config.enc'))).mode&0o777,0o600);
  const restored=await createOperatorConfig(dir,{});assert.equal(restored.environment().INSTAGRAM_APP_SECRET,'operator-secret-fixture');assert.equal(restored.describe().revision,result.revision);
  await assert.rejects(config.update({revision,values},()=>{}),/새로고침/);
  const changed=await config.update({revision:result.revision,values:{INSTAGRAM_APP_SECRET:'',CLOUDINARY_API_SECRET:'',INSTAGRAM_PUBLIC_ORIGIN:'https://auth.new-bloom.test'}},next=>instagram.configure(next));
  assert.equal(config.environment().INSTAGRAM_APP_SECRET,'operator-secret-fixture');assert.equal(changed.callbackUrl,'https://auth.new-bloom.test/auth/instagram/callback');assert.equal(instagram.publicOrigin,'https://auth.new-bloom.test');
  await assert.rejects(config.update({revision:changed.revision,values:{INSTAGRAM_PUBLIC_ORIGIN:'http://localhost:4174'}},()=>{}),/형식/);
  assert.equal(config.describe().callbackUrl,changed.callbackUrl);
});
test('operator checks reject unusable or unsafe origins and report only field names',()=>{
  for(const origin of ['http://auth.bloom.test','https://user:pass@auth.bloom.test','https://auth.bloom.test/callback','https://auth.bloom.test?key=secret','https://localhost','https://127.0.0.1','https://your-domain.example']){
    assert.equal(inspectConfig({...values,INSTAGRAM_PUBLIC_ORIGIN:origin}).ready,false,origin);
  }
  assert.equal(inspectConfig(values).ready,true);assert.equal(inspectConfig({...values,INSTAGRAM_APP_ID:'abc'}).ready,false);
});
