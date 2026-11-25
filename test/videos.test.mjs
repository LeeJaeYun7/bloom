import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import {createVideoService} from '../videos.mjs';
const plan={aspect:'9:16',scenes:[{title:"작은 여유: 오늘's 20%",body:'한글 자막을 포함한 광고 영상'},{title:'제품을 만나는 시간',body:'내 취향으로 즐기는 한 잔'},{title:'다음 이야기를 시작하세요',body:'지금 자세히 알아보기'}]};
function wav(){const samples=48000,buffer=Buffer.alloc(44+samples*2);buffer.write('RIFF');buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(48000,24);buffer.writeUInt32LE(96000,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(samples*2,40);for(let i=0;i<samples;i++)buffer.writeInt16LE(Math.round(Math.sin(i*440*2*Math.PI/48000)*2000),44+i*2);return buffer}
async function settle(service,id){for(let i=0;i<300;i++){const job=service.list().find(item=>item.id===id);if(['ready','failed'].includes(job.status))return job;await new Promise(resolve=>setTimeout(resolve,100))}throw Error('Video render timed out')}
test('real FFmpeg renders 15-second portrait and 10-second square revisions with optional audio',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'bloom-real-video-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const errors=[];const service=await createVideoService(dir,{onError:error=>errors.push(error.details||error.message)});t.after(()=>service.close());assert.equal(service.status().available,true);
  const image='data:image/jpeg;base64,'+(await readFile(new URL('../assets/coffee.jpg',import.meta.url))).toString('base64');
  const workspace={brand:{color:'#7355df'},creatives:[{id:'creative-video',brand:'Bloom 영상',name:'실제 영상 테스트',image}]};
  const input={creativeId:'creative-video',plan};const first=await service.create(input,workspace);const duplicate=await service.create(input,workspace);assert.equal(first.id,duplicate.id);
  const portrait=await settle(service,first.id);assert.equal(portrait.status,'ready',errors.join('\n'));
  const file=service.file(first.id);const decode=spawnSync(ffmpeg,['-hide_banner','-i',file,'-vf',"select='eq(n,30)+eq(n,60)+eq(n,180)+eq(n,330)'",'-vsync','0','-f','framemd5','pipe:1'],{encoding:'utf8'});
  assert.equal(decode.status,0,decode.stderr);assert.match(decode.stderr,/Duration: 00:00:15\.00/);assert.match(decode.stderr,/h264.*720x1280/);assert.equal(decode.stderr.includes('Audio:'),false);
  const hashes=decode.stdout.split('\n').filter(line=>line.startsWith('0,')).map(line=>line.split(',').at(-1).trim());assert.equal(hashes.length,4);assert.equal(new Set(hashes).size,4,'zoom/pan and scene text change actual decoded frames');
  assert.deepEqual((await readdir(path.dirname(file))).sort(),['output.mp4','poster.jpg']);
  const withAudio=await service.create({...input,plan:{...plan,aspect:'1:1',duration:10,style:'bold',motion:'dynamic'},audio:'data:audio/wav;base64,'+wav().toString('base64')},workspace);
  const square=await settle(service,withAudio.id);assert.equal(square.status,'ready',errors.join('\n'));assert.equal(square.hasAudio,true);
  const decodeSquare=spawnSync(ffmpeg,['-hide_banner','-i',service.file(withAudio.id),'-f','null','-'],{encoding:'utf8'});assert.equal(decodeSquare.status,0,decodeSquare.stderr);assert.match(decodeSquare.stderr,/h264.*720x720/);assert.match(decodeSquare.stderr,/Audio: aac/);assert.match(decodeSquare.stderr,/Duration: 00:00:10\.00/);
  const restored=await createVideoService(dir);t.after(()=>restored.close());assert.equal(restored.list().filter(job=>job.status==='ready').length,2);assert.equal((await readFile(restored.file(first.id))).subarray(4,8).toString(),'ftyp');
});
test('video rendering validates plans, rejects playlist audio, and reports missing renderer',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'bloom-video-invalid-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const service=await createVideoService(dir);t.after(()=>service.close());const workspace={brand:{color:'#7355df'},creatives:[{id:'x',brand:'Brand',name:'Ad',image:'data:image/jpeg;base64,YWJj'}]};
  await assert.rejects(service.create({creativeId:'x',plan:{aspect:'16:9',scenes:[]}},workspace),/3개 장면/);
  await assert.rejects(service.create({creativeId:'x',plan,audio:'data:audio/mpeg;base64,'+Buffer.from('#EXTM3U\nhttps://example.com/secret').toString('base64')},workspace),/오디오 파일/);
  await assert.rejects(service.create({creativeId:'missing',plan},workspace),/먼저 저장/);
  const job=await service.create({creativeId:'x',plan},workspace);assert.equal((await settle(service,job.id)).status,'failed');assert.throws(()=>service.file(job.id),/완성된 영상/);
  const missing=await createVideoService(dir,{binary:'/not-installed/ffmpeg'});t.after(()=>missing.close());assert.equal(missing.status().available,false);await assert.rejects(missing.create({creativeId:'x',plan},workspace),/렌더러/);
});
