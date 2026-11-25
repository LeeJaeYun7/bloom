import ffmpegStatic from 'ffmpeg-static';
import {resolveCreativeImage} from './media-assets.mjs';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, link, copyFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const fail=(status,message)=>Object.assign(new Error(message),{status});
const active=new Set(['queued','rendering']);
export function validateVideoPlan(plan){
  if(!plan||!['9:16','1:1'].includes(plan.aspect)||!Array.isArray(plan.scenes)||plan.scenes.length!==3)throw fail(400,'영상 비율과 3개 장면을 확인해주세요.');
  for(const scene of plan.scenes)if(!scene||typeof scene.title!=='string'||!scene.title.trim()||[...scene.title].length>42||typeof scene.body!=='string'||[...scene.body].length>60||/[\x00-\x08\x0b-\x1f]/.test(scene.title+scene.body))throw fail(400,'장면 제목은 1~42자, 보조 문구는 60자 이하로 입력해주세요.');
  const duration=plan.duration??15,style=plan.style??'warm',motion=plan.motion??'gentle';
  if(!Number.isInteger(duration)||duration<6||duration>30||!['warm','bold','minimal'].includes(style)||!['gentle','dynamic','still'].includes(motion))throw fail(400,'영상은 6~30초이며 지원하는 분위기와 움직임을 선택해주세요.');
  return {aspect:plan.aspect,duration,style,motion,scenes:plan.scenes.map(scene=>({title:scene.title.trim(),body:scene.body.trim()}))};
}
function wrap(text,limit,maxLines){
  const lines=[];
  for(const paragraph of text.replace(/\r/g,'').split('\n')){let line='',width=0;for(const char of paragraph){const weight=/[\u0000-\u007f]/.test(char)?.6:1;if(width+weight>limit&&line){lines.push(line);line='';width=0}line+=char;width+=weight}lines.push(line)}
  if(lines.length>maxLines){lines.length=maxLines;lines[maxLines-1]=lines[maxLines-1].slice(0,-1)+'…'}return lines.join('\n');
}
function audioFormat(bytes){
  if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE')return 'wav';
  if(bytes.toString('ascii',0,4)==='OggS')return 'ogg';
  if(bytes.toString('ascii',4,8)==='ftyp')return 'mov';
  if(bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])))return 'matroska';
  if(bytes[0]===0xff&&(bytes[1]&0xf6)===0xf0)return 'aac';
  if(bytes.toString('ascii',0,3)==='ID3'||(bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0))return 'mp3';
  throw fail(400,'MP3, WAV, M4A, AAC, OGG 또는 WebM 오디오 파일을 선택해주세요.');
}
function command(binary,args,{cwd,onProgress,duration=15}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(binary,args,{cwd,stdio:['ignore','pipe','pipe'],windowsHide:true});let stderr='',stdout='';
    const timer=setTimeout(()=>{child.kill('SIGKILL')},180000);
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-10000)});
    child.stdout.on('data',chunk=>{stdout+=chunk;const records=stdout.split('\n');stdout=records.pop();for(const record of records){const match=record.match(/^out_time_us=(\d+)/);if(match)onProgress?.(Math.min(99,Math.floor(Number(match[1])/(duration*10000))))}});
    child.on('error',error=>{clearTimeout(timer);reject(error)});
    child.on('close',code=>{clearTimeout(timer);if(code===0)resolve(stderr);else reject(Object.assign(Error('FFmpeg 렌더링 실패'),{details:stderr,code}))});
  });
}
export async function createVideoService(dataDir,options={}){
  const directory=path.join(dataDir,'videos');await mkdir(directory,{recursive:true});
  const index=path.join(dataDir,'video-jobs.json');
  const binary=options.binary||process.env.FFMPEG_PATH||ffmpegStatic;
  const font=options.font||process.env.BLOOM_VIDEO_FONT||path.join(root,'assets/fonts/NotoSansKR.ttf');
  let available=true;
  try{await access(binary);await access(font)}catch{available=false}
  let jobs=[];try{jobs=JSON.parse(await readFile(index,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error}
  for(const job of jobs)if(active.has(job.status)){job.status='failed';job.error='서버가 재시작되어 영상 제작이 중단되었습니다. 다시 제작해주세요.';await rm(path.join(directory,job.id),{recursive:true,force:true})}
  let queue=Promise.resolve(),working=false,closed=false;const waiting=[];
  const exclusive=fn=>{const task=queue.catch(()=>{}).then(fn);queue=task;return task};
  async function save(){await writeFile(index+'.tmp',JSON.stringify(jobs),{mode:0o600});await rename(index+'.tmp',index)}
  await save();
  const publicJob=job=>({...job,fileUrl:job.status==='ready'?`/api/videos/${job.id}/file`:null,posterUrl:job.status==='ready'?`/api/videos/${job.id}/poster`:null});
  async function update(job,changes){return exclusive(async()=>{Object.assign(job,changes,{updatedAt:new Date().toISOString()});await save()})}
  async function render(job,input){
    const folder=path.join(directory,job.id);
    try{
      await update(job,{status:'rendering',progress:0});await mkdir(folder,{recursive:true});
      await writeFile(path.join(folder,'photo.'+input.photoType),input.photo,{mode:0o600});
      try{await link(font,path.join(folder,'font.ttf'))}catch{await copyFile(font,path.join(folder,'font.ttf'))}
      await writeFile(path.join(folder,'brand.txt'),wrap(input.brand,25,1),{mode:0o600});
      for(let i=0;i<3;i++){
        await writeFile(path.join(folder,`title${i}.txt`),wrap(job.plan.scenes[i].title,12,4),{mode:0o600});
        await writeFile(path.join(folder,`body${i}.txt`),wrap(job.plan.scenes[i].body,21,3),{mode:0o600});
      }
      const duration=job.plan.duration||15,frames=duration*10,sceneSeconds=duration/3,amount=job.plan.motion==='dynamic'?.28:.105;
      const width=720,height=job.plan.aspect==='9:16'?1280:720;
      const titleY=height===1280?510:210,bodyY=height===1280?900:515;
      const zoom=job.plan.motion==='still'?Array(3).fill("z='1':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'"):[`z='1+${amount}*on/${frames-1}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'`,`z='${1+amount}':x='(iw-iw/zoom)*on/${frames-1}':y='(ih-ih/zoom)/2'`,`z='${1+amount}-${amount}*on/${frames-1}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'`];
      const shade=job.plan.style==='bold'?.52:job.plan.style==='minimal'?.3:.38;
      const titleSize=job.plan.style==='bold'?54:job.plan.style==='minimal'?44:48;
      const grading=job.plan.style==='warm'?'eq=saturation=1.08:gamma_r=1.04:gamma_b=0.96,':'';
      const filters=[`[0:v]scale=${width*2}:${height*2}:force_original_aspect_ratio=increase,crop=${width*2}:${height*2},setsar=1,split=3[a][b][c]`];
      for(let i=0;i<3;i++)filters.push(`[${'abc'[i]}]${grading}zoompan=${zoom[i]}:d=${frames}:s=${width}x${height}:fps=30,drawbox=x=0:y=0:w=iw:h=ih:color=black@${shade}:t=fill,drawbox=x=48:y=${height-130}:w=90:h=5:color=${input.color}:t=fill,drawtext=fontfile=font.ttf:textfile=brand.txt:expansion=none:fontsize=24:fontcolor=white:x=48:y=${height-96},drawtext=fontfile=font.ttf:textfile=title${i}.txt:expansion=none:fontsize=${titleSize}:fontcolor=white:line_spacing=9:x=48:y=${titleY},drawtext=fontfile=font.ttf:textfile=body${i}.txt:expansion=none:fontsize=27:fontcolor=white:line_spacing=8:x=48:y=${bodyY},fade=t=in:st=0:d=0.25,fade=t=out:st=${sceneSeconds-.25}:d=0.25,setpts=PTS-STARTPTS[v${i}]`);
      filters.push('[v0][v1][v2]concat=n=3:v=1:a=0,format=yuv420p[v]');
      const args=['-hide_banner','-loglevel','error','-nostdin','-y','-protocol_whitelist','file,pipe','-f','image2','-i','photo.'+input.photoType];
      if(input.audio){await writeFile(path.join(folder,'audio.bin'),input.audio,{mode:0o600});args.push('-protocol_whitelist','file,pipe','-f',input.audioType,'-i','audio.bin');filters.push(`[1:a]aresample=48000,apad,atrim=duration=${duration},afade=t=in:st=0:d=0.2,afade=t=out:st=${duration-.7}:d=0.7[audio]`)}
      await writeFile(path.join(folder,'filters.txt'),filters.join(';'),{mode:0o600});
      args.push('-filter_complex_script','filters.txt','-map','[v]');if(input.audio)args.push('-map','[audio]','-c:a','aac','-b:a','128k');
      args.push('-c:v','libx264','-preset','veryfast','-crf','22','-threads','2','-filter_complex_threads','1','-t',String(duration),'-r','30','-movflags','+faststart','-progress','pipe:1','output.part.mp4');
      await command(binary,args,{cwd:folder,duration,onProgress:progress=>{job.progress=progress}});
      await rename(path.join(folder,'output.part.mp4'),path.join(folder,'output.mp4'));
      await command(binary,['-hide_banner','-loglevel','error','-nostdin','-y','-ss','1','-i','output.mp4','-frames:v','1','-update','1','poster.jpg'],{cwd:folder});
      for(const name of ['photo.'+input.photoType,'audio.bin','font.ttf','filters.txt','brand.txt',...Array.from({length:3},(_,i)=>`title${i}.txt`),...Array.from({length:3},(_,i)=>`body${i}.txt`)])await rm(path.join(folder,name),{force:true});
      await update(job,{status:'ready',progress:100,error:null});
    }catch(error){await rm(folder,{recursive:true,force:true}).catch(()=>{});await update(job,{status:'failed',error:input.audio?'영상 제작에 실패했습니다. 사진과 오디오 파일이 정상인지 확인해주세요.':'영상 제작에 실패했습니다. 제품 사진을 다시 선택하고 시도해주세요.'}).catch(()=>{});if(options.onError)options.onError(error)}
  }
  async function drain(){if(working||closed)return;working=true;try{while(waiting.length&&!closed){const next=waiting.shift();await render(next.job,next.input)}}finally{working=false}}
  function prepare(input,workspace){
    if(!available)throw fail(503,'영상 렌더러를 사용할 수 없습니다. npm ci로 FFmpeg를 설치해주세요.');
    const creative=workspace?.creatives.find(item=>item.id===input.creativeId);
    if(!creative)throw fail(400,'광고 작업을 먼저 저장해주세요.');
    const image=resolveCreativeImage(workspace,creative);
    if(!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image))throw fail(400,'영상에 사용할 제품 사진을 업로드해주세요.');
    const photo=Buffer.from(image.split(',')[1],'base64');if(!photo.length||photo.length>6*1024*1024)throw fail(400,'제품 사진 크기를 확인해주세요.');
    const plan=validateVideoPlan(input.plan);let audio=null,audioType=null;
    if(input.audio){if(typeof input.audio!=='string'||input.audio.length>7*1024*1024||!/^data:(audio\/[a-zA-Z0-9.+-]+|application\/octet-stream);base64,[A-Za-z0-9+/=]+$/.test(input.audio))throw fail(400,'5MB 이하 오디오 파일을 선택해주세요.');audio=Buffer.from(input.audio.split(',')[1],'base64');if(!audio.length||audio.length>5*1024*1024)throw fail(400,'오디오 파일은 최대 5MB입니다.');audioType=audioFormat(audio)}
    const color=creative.color||workspace.brand.color;
    const fingerprint=createHash('sha256').update(JSON.stringify({renderer:'photo-ad-v4',creativeId:creative.id,plan,brand:creative.brand,color})).update(photo).update(audio||'').digest('hex');
    return {creative,plan,fingerprint,input:{photo,photoType:image.match(/^data:image\/(jpeg|png|webp)/)[1].replace('jpeg','jpg'),audio,audioType,brand:creative.brand,color:/^#[0-9a-f]{6}$/i.test(color)?color:'#7355df'}};
  }
  async function enqueue(inputs,workspace){
    const prepared=inputs.map(input=>prepare(input,workspace));
    return exclusive(async()=>{
      const existing=prepared.map(item=>jobs.find(job=>job.fingerprint===item.fingerprint&&job.status!=='failed'));
      if(jobs.filter(job=>active.has(job.status)).length+existing.filter(item=>!item).length>10)throw fail(429,'영상 대기열이 가득 찼습니다. 진행 중인 작업이 끝나면 다시 시도해주세요. 기획은 저장되어 있습니다.');
      const fresh=[];
      const output=prepared.map((item,i)=>{
        if(existing[i])return existing[i];
        const {creative,plan,fingerprint}=item;
        const job={id:randomUUID(),creativeId:creative.id,batchId:creative.batchId||null,name:creative.name,brand:creative.brand,color:creative.color||workspace.brand.color,imageVersion:creative.imageVersion||null,plan,fingerprint,hasAudio:!!item.input.audio,status:'queued',progress:0,duration:plan.duration,width:720,height:plan.aspect==='9:16'?1280:720,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
        fresh.push({job,input:item.input});return job;
      });
      jobs.unshift(...fresh.map(item=>item.job));
      try{await save()}catch(error){const ids=new Set(fresh.map(item=>item.job.id));jobs=jobs.filter(job=>!ids.has(job.id));throw error}
      waiting.push(...fresh);queueMicrotask(()=>{void drain()});return output.map(publicJob);
    });
  }
  async function create(input,workspace){return (await enqueue([input],workspace))[0]}
  async function createBatch(input,workspace){
    if(!Array.isArray(input.creativeIds)||input.creativeIds.length<1||input.creativeIds.length>5||new Set(input.creativeIds).size!==input.creativeIds.length)throw fail(400,'일괄 제작할 시안 1~5개를 선택해주세요.');
    const inputs=input.creativeIds.map(id=>{const creative=workspace?.creatives.find(item=>item.id===id);if(!creative)throw fail(400,'저장된 시안을 찾을 수 없습니다.');return {creativeId:id,plan:creative.videoDraft}});
    return {jobs:await enqueue(inputs,workspace)};
  }
  return {status:()=>({available,duration:15,minDuration:6,maxDuration:30,aspects:['9:16','1:1']}),create,createBatch,list:()=>jobs.slice(0,100).map(publicJob),file(id,poster=false){const job=jobs.find(item=>item.id===id);if(!job||job.status!=='ready')throw fail(404,'완성된 영상을 찾을 수 없습니다.');return path.join(directory,job.id,poster?'poster.jpg':'output.mp4')},close(){closed=true}};
}
