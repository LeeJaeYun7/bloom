import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseHTML} from 'linkedom';
import {createOperatorConfig} from '../operator-config.mjs';

test('operator screen saves config, previews callback, and clears secret inputs after saving',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'bloom-admin-ui-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const config=await createOperatorConfig(dir,{});
  const {document}=parseHTML(await readFile(new URL('../admin.html',import.meta.url),'utf8'));
  const form=document.querySelector('form');form.elements=Object.fromEntries([...form.querySelectorAll('input[name]')].map(input=>[input.name,input]));
  class FormData{constructor(form){this.entries=[...form.querySelectorAll('input[name]')].map(input=>[input.name,input.value])}[Symbol.iterator](){return this.entries[Symbol.iterator]()}}
  let applied,clipboard;
  const context=vm.createContext({document,FormData,URL,navigator:{clipboard:{writeText:async text=>{clipboard=text}}},fetch:async(_url,options)=>{
    try{return Response.json(options?.body?await config.update(JSON.parse(options.body),next=>{applied=next}):config.describe())}
    catch(error){return Response.json({error:error.message},{status:error.status||500})}
  }});
  vm.runInContext(await readFile(new URL('../admin.js',import.meta.url),'utf8'),context);
  for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(form.hidden,false,document.querySelector('#errors').textContent);assert.match(document.querySelector('#readiness').textContent,/설정값이 필요/);
  const values={INSTAGRAM_APP_ID:'1234567',INSTAGRAM_APP_SECRET:'app-secret-fixture',INSTAGRAM_PUBLIC_ORIGIN:'https://auth.bloom.test',INSTAGRAM_API_VERSION:'v27.0',CLOUDINARY_CLOUD_NAME:'my-cloud',CLOUDINARY_API_KEY:'12345',CLOUDINARY_API_SECRET:'cloud-secret-fixture'};
  for(const [name,value]of Object.entries(values))form.elements[name].value=value;
  form.elements.INSTAGRAM_PUBLIC_ORIGIN.oninput();assert.equal(document.querySelector('#callback-url').textContent,'https://auth.bloom.test/auth/instagram/callback');
  await document.querySelector('#copy-callback').onclick();assert.equal(clipboard,'https://auth.bloom.test/auth/instagram/callback');
  await form.onsubmit({preventDefault(){}});assert.equal(applied.INSTAGRAM_APP_SECRET,'app-secret-fixture');assert.equal(form.elements.INSTAGRAM_APP_SECRET.value,'');assert.match(form.elements.INSTAGRAM_APP_SECRET.placeholder,/저장됨/);assert.equal(document.querySelector('#readiness').classList.contains('ready'),true);
  await form.onsubmit({preventDefault(){}});assert.equal(applied.INSTAGRAM_APP_SECRET,'app-secret-fixture','blank secret field retains the stored value');
  form.elements.INSTAGRAM_PUBLIC_ORIGIN.value='https://auth.bloom.test/wrong-path';await form.onsubmit({preventDefault(){}});assert.match(document.querySelector('#errors').textContent,/형식/);assert.equal(config.describe().callbackUrl,'https://auth.bloom.test/auth/instagram/callback');
});
