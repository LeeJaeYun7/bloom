'use strict';
const icons={home:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',campaign:'<path d="m3 10 13-5v14L3 14zM16 9h3a3 3 0 0 1 0 6h-3M5 15l2 6h4l-2-5"/>',folder:'<path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9H3z"/>',brand:'<path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5"/>',plus:'<path d="M12 5v14M5 12h14"/>',bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',chevron:'<path d="m9 5 7 7-7 7"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',check:'<path d="m5 12 4 4L19 6"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',chart:'<path d="M4 4v16h16M8 14l4-5 4 3 5-7"/>',eye:'<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7"/><circle cx="12" cy="12" r="3"/>',menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',help:'<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3M12 17h.01"/>',pause:'<path d="M8 5v14M16 5v14"/>'};
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]||icons.spark}</svg>`;
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const initial={brand:{name:'내 브랜드',url:'',description:'브랜드 소개를 입력해주세요.',color:'#7355df',tone:'따뜻하고 감성적인'},creatives:[],campaigns:[]};
let state=structuredClone(initial);
let revision=0, connection={configured:false,model:'gpt-4.1-mini'}, saving=Promise.resolve(), saveError=null;
let view=['home','studio','campaigns','library','brand','instagram'].includes(location.hash.slice(1))?location.hash.slice(1):'home';
let current=null, variant=0, generating=false, messages=[], toastTimer, draft=null;
const names={home:'워크스페이스',studio:'AI 스튜디오',campaigns:'캠페인',library:'크리에이티브',brand:'브랜드 키트',instagram:'Instagram'};
async function api(url, data, method='POST') {
  let response;
  try { response=await fetch(url,{method:data===undefined?'GET':method,headers:data===undefined?{}:{'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})}); }
  catch { throw Error('서버 연결이 끊겼습니다. npm start로 서버를 실행해주세요.'); }
  let result;try {result=await response.json()}catch{throw Error('새 Bloom 서버로 접속해주세요: http://localhost:4174')}
  if(!response.ok)throw Error(result.error||'요청을 처리하지 못했습니다.');return result;
}
function persist(){
  const snapshot=structuredClone(state);
  saving=saving.then(async()=>{
    if(saveError)throw saveError;
    const result=await api('/api/state',{state:snapshot,revision},'PUT');revision=result.revision;
  }).catch(error=>{saveError=error;toast('저장 실패: '+error.message);document.querySelector('#save-status')?.replaceChildren('저장 실패 · 작업 백업 필요');});
  return saving;
}
async function saved(){await saving;if(saveError)throw saveError;}
function captureDraft(){captureEditor();const form=document.querySelector('#create-form');if(form)draft={...draft,...Object.fromEntries(new FormData(form))};}
function captureEditor(){
  const form=document.querySelector('#edit-form');if(!form||!current||generating)return;
  const data=Object.fromEntries(new FormData(form));
  if(data.name?.trim()&&data.headline?.trim()&&Object.keys(data).some(key=>data[key]!==current[key])){
    Object.assign(current,data);saveCreative();
  }
}
function fieldValue(name,fallback=''){return draft?.[name]??current?.[name]??fallback;}
function toast(text){const el=document.querySelector('#toast');el.textContent=text;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3500)}
function go(next){if(generating){toast('AI 작업이 끝난 뒤 이동해주세요.');return}captureDraft();view=next;location.hash=next;render();window.scrollTo(0,0);if(next==='instagram')refreshInstagram().then(()=>{if(view==='instagram')render()}).catch(error=>toast(error.message))}
function nav(key,symbol,label){return `<button class="nav ${view===key?'active':''}" data-view="${key}" ${view===key?'aria-current="page"':''}>${icon(symbol)}${label}${key==='studio'?'<em>AI</em>':''}</button>`}
function wrapText(text,maxWidth,size,maxLines=5){
  const ctx=document.createElement('canvas').getContext('2d');ctx.font=`700 ${size}px sans-serif`;
  const lines=[];
  for(const paragraph of String(text).split('\n')){let line='';for(const character of paragraph){if(ctx.measureText(line+character).width>maxWidth&&line){lines.push(line);line=''}line+=character;}lines.push(line);}
  if(lines.length>maxLines){lines.length=maxLines;lines[maxLines-1]=lines[maxLines-1].slice(0,-1)+'…'}return lines;
}
function artwork(item={},type=0){
  const color=item.color||state.brand.color;
  const photo=/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(item.image||'')?item.image:null;
  const center=type===1, x=center?540:80, anchor=center?'middle':'start';
  const headline=wrapText(item.headline||'브랜드의 다음 이야기를\n여기에 담아보세요.',920,76,5);
  const caption=wrapText(item.caption||'',920,30,3);
  const start=type===2?220:660-(headline.length-1)*48;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080"><rect width="1080" height="1080" fill="${esc(color)}"/>${photo?`<image href="${photo}" width="1080" height="1080" preserveAspectRatio="xMidYMid slice"/><rect width="1080" height="1080" fill="${center?esc(color):'#000000'}" opacity="${center?'.72':'.42'}"/>`:''}<g fill="white" font-family="sans-serif" text-anchor="${anchor}"><text x="${x}" y="120" font-size="32" letter-spacing="4">${esc((item.brand||state.brand.name).slice(0,50))}</text>${headline.map((line,i)=>`<text x="${x}" y="${start+i*94}" font-size="76" font-weight="700">${esc(line)}</text>`).join('')}${caption.map((line,i)=>`<text x="${x}" y="${884+i*42}" font-size="30">${esc(line)}</text>`).join('')}</g></svg>`;
}
function art(item={},type=0,large=false){return `<div class="art workart ${large?'studioart':''}"><img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(artwork(item,type))}" alt="${esc(item.headline||'광고 미리보기')}"></div>`}
function creativeCard(item,index){return `<button class="creative" data-creative="${esc(item.id||'sample-'+index)}">${art(item,item.variant??index%3)}<div class="creativeinfo"><b>${esc(item.name||['일상의 작은 리추얼','잠깐의 여유, 한 잔의 행복','당신의 오후를 바꾸는 커피'][index%3])}</b><small>${esc(item.channel||'Instagram')} · 저장됨</small></div></button>`}
function home(){return `<div class="heading"><div><div class="eyebrow">YOUR MARKETING, IN BLOOM</div><h1>좋은 아이디어가 자랄 시간이에요.</h1><p class="sub">${esc(state.brand.name)}의 다음 이야기를 함께 만들어볼까요?</p></div><button class="btn" data-view="brand">${icon('brand')}브랜드 관리</button></div><section class="hero"><div class="herocopy"><div class="eyebrow">MEET YOUR AI CREATIVE PARTNER</div><h2>아이디어 한 줄이,<br>다음 캠페인의 시작.</h2><p>기획부터 카피, 크리에이티브까지.<br>브랜드를 이해하는 AI와 함께 만들어보세요.</p><button class="btn primary" data-view="studio">${icon('spark')}새 광고 만들기</button></div><div class="herovisual" aria-hidden="true"><div class="orbit"></div><div class="orbit two"></div><div class="floating f1"><img src="assets/coffee.jpg" alt=""><b>Your daily little ritual.</b><small>YOUR NEXT CREATIVE</small></div><div class="floating f2">MAKE SOMETHING<span>worth a pause.</span>Made for your brand.</div><div class="floating f3"><i>✓</i> 새로운 아이디어가 준비됐어요 ${icon('spark')}</div></div></section><div class="sectionhead"><h2>마케팅 한눈에 보기</h2><span class="textbtn">현재 작업 현황</span></div><div class="stats">${[['저장한 작업',String(state.creatives.length),'크리에이티브','folder'],['캠페인 초안',String(state.campaigns.length),'게시 전 준비','campaign'],['AI 연결',connection.configured?'연결됨':'설정 필요',connection.model,'spark'],['작업 저장','서버 파일','이 컴퓨터','check']].map(([label,value,change,symbol])=>`<div class="stat"><div class="statlabel">${label}${icon(symbol)}</div><strong>${value}</strong><small><span class="positive">${change}</span></small></div>`).join('')}</div><div class="gridbottom"><section><div class="sectionhead"><h2>최근 크리에이티브</h2><button class="textbtn" data-view="library">모두 보기</button></div><div class="creativegrid">${state.creatives.length?state.creatives.slice(0,3).map(creativeCard).join(''):'<p class="sub">새 광고 만들기로 첫 작업을 시작하세요.</p>'}</div></section><section><div class="sectionhead"><h2>에이전트 노트</h2><span class="tag">아이디어</span></div><div class="card feed">${[['spark','브랜드의 다음 이야기를 찾아보세요','따뜻한 일상, 새로운 메뉴, 브랜드의 철학. 어떤 이야기든 좋아요.'],['chart','다양한 메시지를 비교해보세요','같은 제품도 다른 헤드라인으로 테스트하면 새로운 반응을 발견할 수 있어요.'],['check','게시 전, 마지막 확인도 잊지 마세요','캠페인을 저장한 뒤 카피와 예산을 검토하세요.']].map(([symbol,title,body])=>`<div class="feeditem"><div class="feedicon">${icon(symbol)}</div><div><b>${title}</b><p>${body}</p></div></div>`).join('')}</div></section></div><div class="footerhint">${icon('help')}원고와 이미지를 직접 편집하고 PNG·SVG로 저장하세요. Instagram 메뉴에서 계정을 연결하고 게시할 수 있습니다.</div>`}
function studio(){return `<div class="heading"><div><div class="eyebrow">FROM IDEA TO CREATIVE</div><h1>상상을 광고로 만들어보세요.</h1><p class="sub">브랜드의 이야기를 들려주면, 첫 번째 시안을 함께 준비할게요.</p></div></div><div class="studio"><form id="create-form" class="card panel"><div class="previewheader"><h2>무엇을 만들까요?</h2>${icon('spark')}</div><label class="field">브랜드<input name="brand" ${generating?'readonly':''} value="${esc(fieldValue('brand',state.brand.name))}" required maxlength="60"></label><label class="field">광고 아이디어<textarea name="prompt" ${generating?'readonly':''} required maxlength="1000" placeholder="어떤 제품을, 누구에게 알리고 싶으신가요?">${esc(fieldValue('prompt',''))}</textarea></label><div class="chips"><button type="button" class="chip" data-prompt="신제품의 매력을 소개하는 감성적인 광고. 새로운 경험을 선물하세요.">신제품 소개</button><button type="button" class="chip" data-prompt="실제 제공하는 할인 혜택과 기간을 여기에 입력해주세요. 확인된 혜택을 강조하는 프로모션 광고를 작성해줘.">할인 프로모션</button><button type="button" class="chip" data-prompt="우리 브랜드가 일상에 전하는 작은 행복. 편안하고 진솔한 브랜드 스토리를 전해줘.">브랜드 스토리</button></div><div class="row"><label class="field">채널<select name="channel" ${generating?'disabled':''}>${['Instagram','YouTube','Facebook'].map(channel=>`<option ${fieldValue('channel')===channel?'selected':''}>${channel}</option>`).join('')}</select></label><label class="field">포맷<select name="format" ${generating?'disabled':''}>${['이미지 광고','15초 스토리보드'].map(format=>`<option ${fieldValue('format')===format?'selected':''}>${format}</option>`).join('')}</select></label></div><label class="field">제품 사진<input name="photo" type="file" accept="image/png,image/jpeg,image/webp" ${generating?'disabled':''}><small>PNG · JPG · WebP / 최대 10MB</small></label><button type="button" class="btn wide" id="manual-create" ${generating?'disabled':''}>직접 작성 시작</button><button class="btn primary wide" ${generating?'disabled':''}>${icon('spark')}${generating?'광고 시안을 준비하고 있어요…':'광고 시안 만들기'}</button><div class="notice">${connection.configured?'연결된 AI가 브랜드와 요청을 바탕으로 원고를 작성합니다.':'AI 연결 설정에서 API 키를 연결해주세요. 직접 작성과 파일 저장은 바로 사용할 수 있습니다.'}</div></form><section class="card panel"><div class="previewheader"><h2>크리에이티브 미리보기</h2><div class="row"><button class="btn primary" id="instagram-publish" ${!current||generating||current.channel!=='Instagram'||current.format!=='이미지 광고'?'disabled':''}>Instagram 게시</button><button class="btn" id="export-copy" ${!current?'disabled':''}>원고 저장</button><button class="btn" id="export-png" ${!current?'disabled':''}>PNG 저장</button><button class="btn" id="export" ${!current?'disabled':''}>${icon('download')}SVG 저장</button><button class="btn primary" id="save-campaign" ${!current||generating?'disabled':''}>캠페인 저장</button></div></div><div class="previewcanvas">${art(current||{image:draft?.image||''},variant,true)}</div><div class="scenechips">${['감성적인 순간','브랜드 컬러','강렬한 메시지'].map((text,index)=>`<button data-variant="${index}" class="${variant===index?'selected':''}" aria-pressed="${variant===index}">${text}</button>`).join('')}</div>${current?`<div class="script"><b>${current.format==='15초 스토리보드'?'15초 스토리보드':'카피 제안'}</b><br>${esc(current.script)}</div><form id="edit-form" class="editor"><label class="field">작업 이름<input name="name" required maxlength="200" value="${esc(current.name)}"></label><label class="field">헤드라인<textarea name="headline" required maxlength="500">${esc(current.headline)}</textarea></label><label class="field">보조 문구<textarea name="caption" maxlength="500">${esc(current.caption)}</textarea></label><label class="field">${current.format==='15초 스토리보드'?'스토리보드':'게시물 본문'}<textarea name="script" maxlength="16000">${esc(current.script)}</textarea></label><button class="btn" ${generating?'disabled':''}>수정 내용 저장</button></form>`:'<p class="sub">왼쪽에서 아이디어를 입력하면 브랜드에 맞춘 시안이 여기에 나타나요.</p>'}<div id="messages">${messages.map(message=>`<div class="message ${message.role==='user'?'user':''}">${esc(message.text)}</div>`).join('')}</div><form id="chat-form" class="chatbar"><input aria-label="수정 요청" name="message" placeholder="예: 헤드라인을 더 짧게 / 할인 강조 / 더 따뜻하게" required maxlength="300" ${!current||generating?'disabled':''}><button class="btn primary" ${!current||generating?'disabled':''}>${generating?'작성 중…':'AI 수정'}</button></form></section></div>`}
function campaigns(){return `<div class="heading"><div><div class="eyebrow">CAMPAIGN DRAFTS</div><h1>캠페인 초안</h1><p class="sub">원고와 일 예산을 정리하고 제작 파일을 준비하세요.</p></div><button class="btn primary" data-view="studio">새 광고 만들기</button></div><div class="card campaigns"><table><thead><tr><th>캠페인 이름</th><th>채널</th><th>일 예산</th><th>관리</th></tr></thead><tbody>${state.campaigns.map(c=>`<tr><td><b>${esc(c.name)}</b><small>게시 전 초안</small></td><td>${esc(c.channel)}</td><td>₩${Number(c.budget).toLocaleString('ko-KR')}</td><td><button class="btn" data-creative="${esc(c.creativeId||'')}">원고 열기</button> <button class="textbtn" data-budget="${esc(c.id)}">예산 수정</button></td></tr>`).join('')||'<tr><td colspan="4">광고 작업에서 캠페인 저장을 누르면 여기에 표시됩니다.</td></tr>'}</tbody></table></div><p class="sub">Instagram 피드 게시는 스튜디오에서 진행하세요. 유료 광고 집행은 포함되지 않습니다.</p>`}
function library(){return `<div class="heading"><div><div class="eyebrow">YOUR CREATIVE COLLECTION</div><h1>크리에이티브 라이브러리</h1><p class="sub">브랜드를 위해 만든 아이디어를 한곳에서 만나보세요.</p></div><button class="btn primary" data-view="studio">${icon('plus')}새 광고 만들기</button></div>${state.creatives.length?`<div class="savedlist"><div class="creativegrid">${state.creatives.map(creativeCard).join('')}</div></div>`:'<div class="card empty">아직 저장한 크리에이티브가 없어요.<br><p class="sub">AI 스튜디오에서 첫 번째 광고 시안을 만들어보세요.</p><button class="btn primary" data-view="studio">첫 광고 만들기</button></div>'}`}
function brand(){return `<div class="heading"><div><div class="eyebrow">CONSISTENTLY, UNIQUELY YOU</div><h1>브랜드 키트</h1><p class="sub">브랜드 이름·소개·색상·톤을 다음 광고 작업에 반영합니다.</p></div></div><div class="brandgrid"><form id="brand-form" class="card panel"><label class="field">브랜드 이름<input name="name" required maxlength="60" value="${esc(state.brand.name)}"></label><label class="field">웹사이트<input name="url" type="url" value="${esc(state.brand.url)}" placeholder="https://yourbrand.com"></label><label class="field">브랜드 소개<textarea name="description" required maxlength="600">${esc(state.brand.description)}</textarea></label><div class="row"><label class="field">대표 색상<input class="colorinput" name="color" type="color" value="${esc(state.brand.color)}"></label><label class="field">브랜드 톤<select name="tone">${['따뜻하고 감성적인','명확하고 전문적인','대담하고 활기찬'].map(tone=>`<option ${state.brand.tone===tone?'selected':''}>${tone}</option>`).join('')}</select></label></div><button class="btn primary wide">브랜드 저장하기</button></form><section class="card panel"><h2 style="margin-bottom:22px">브랜드 프리뷰</h2><div id="brand-preview" class="swatch" style="background:${esc(state.brand.color)}">${esc(state.brand.name)}</div><p class="sub" id="brand-description">${esc(state.brand.description)}</p><div class="notice">브랜드 이름, 색상과 톤을 광고 시안에 반영합니다. 웹사이트 URL은 기록용이며 자동 분석하지 않습니다.</div></section></div>`}
function render(){clearTimeout(instagramTimer);document.querySelector('#app').innerHTML=`<div class="shell"><aside class="sidebar"><a href="#home" class="logo" aria-label="Bloom 홈"><span class="flower">✳</span>bloom<span style="color:#a28bdf">.</span></a><button class="workspace" data-view="brand"><span class="avatar">${esc(state.brand.name[0]||'B')}</span><span>${esc(state.brand.name)}<small>내 워크스페이스</small></span></button><div class="navlabel">WORKSPACE</div>${nav('home','home','홈')}${nav('studio','spark','AI 스튜디오')}${nav('campaigns','campaign','캠페인')}${nav('library','folder','크리에이티브')}${nav('brand','brand','브랜드 키트')}${nav('instagram','campaign','Instagram')}<div class="bottom"><div class="trial">아이디어를 실제 작업으로.<p>브랜드의 다음 챕터를<br>Bloom과 함께 만들어보세요.</p><div class="meter"><span></span></div><small>BLOOM WORKSPACE · v0.2</small></div><button class="nav" id="help">${icon('help')}사용 안내</button><div class="profile"><span class="avatar" style="background:#34313e;color:#c9b8eb">T</span><span>내 작업 공간<small>Personal workspace</small></span></div></div></aside><main class="main"><header class="topbar"><div class="breadcrumb"><button class="mobilemenu iconbutton" id="menu" aria-label="메뉴 열기">${icon('menu')}</button><span>워크스페이스</span>${icon('chevron')}<b>${names[view]}</b></div><div class="topactions"><span class="demo" id="save-status" role="status">${saveError?'저장 실패 · 작업 백업 필요':'서버 저장'}</span><button class="btn" id="settings">${connection.configured?'AI 연결됨':'AI 연결 설정'}</button><button class="textbtn" id="backup">작업 백업</button><button class="iconbutton" id="notifications" aria-label="알림">${icon('bell')}</button><span class="avatar" style="border-radius:50%;width:30px;height:30px;font-size:12px;background:#eee9f8;color:#8970ae">T</span></div></header><div class="content">${({home,studio,campaigns,library,brand,instagram:instagramView})[view]()}</div></main></div>`;bind()}
function download(filename,body,type){const url=URL.createObjectURL(new Blob([body],{type}));const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function saveCreative(){state.creatives=state.creatives.filter(item=>item.id!==current.id);state.creatives.unshift(structuredClone(current));return persist()}
function modal(content){const dialog=document.querySelector('#modal');dialog.innerHTML=content;dialog.showModal();dialog.querySelector('[data-close]')?.addEventListener('click',()=>dialog.close())}
function campaignModal(existing){modal(`<h2>${existing?'일 예산 수정':'캠페인으로 저장'}</h2><form id="campaign-form">${!existing?`<label class="field">캠페인 이름<input name="name" required maxlength="200" value="${esc(current.name)}"></label>`:''}<label class="field">일 예산 (원)<input name="budget" type="number" min="1000" max="10000000" step="1000" required value="${existing?.budget||30000}"></label><div class="notice">검토 대기 상태로 저장됩니다. 실제 광고가 게시되거나 결제되지 않습니다.</div><div class="row"><button type="button" class="btn" data-close>취소</button><button class="btn primary">저장</button></div></form>`);document.querySelector('#campaign-form').onsubmit=async event=>{event.preventDefault();const data=new FormData(event.target);if(existing){existing.budget=Number(data.get('budget'))}else{state.campaigns.unshift({id:crypto.randomUUID(),name:data.get('name').trim(),channel:current.channel,budget:Number(data.get('budget')),status:'paused',creativeId:current.id})}await persist();try{await saved();document.querySelector('#modal').close();toast('캠페인 초안을 저장했습니다.');go('campaigns')}catch(error){toast(error.message)}}}
function bind(){bindInstagram();document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>go(button.dataset.view));document.querySelector('#menu').onclick=()=>document.querySelector('.sidebar').classList.toggle('open');document.querySelector('#settings').onclick=settingsModal;
document.querySelector('#backup').onclick=()=>{captureEditor();download('bloom-workspace.json',JSON.stringify(state,null,2),'application/json')};
document.querySelector('#help').onclick=()=>modal('<h2>Bloom 사용 안내</h2><p class="sub">브랜드 키트를 설정한 다음 광고 아이디어와 제품 사진을 입력하세요. AI 연결 후 원고 생성·수정을 사용할 수 있습니다. 직접 작성은 연결 없이 가능합니다.</p><p class="sub">작업 내용은 이 컴퓨터의 서버 파일에 저장됩니다. PNG와 SVG는 광고 이미지, 작업 백업은 전체 원본 데이터입니다. 15초 스토리보드는 영상 제작용 원고입니다. Instagram 메뉴에서 계정을 연결하면 이미지 피드에 게시할 수 있습니다. 영상 렌더링은 제공하지 않습니다.</p><button class="btn primary wide" data-close>확인</button>');document.querySelector('#notifications').onclick=()=>toast('새 알림이 없습니다. 저장된 캠페인은 캠페인 메뉴에서 확인하세요.');
document.querySelectorAll('[data-creative]').forEach(button=>button.onclick=()=>{captureDraft();if(generating)return;current=structuredClone(state.creatives.find(item=>item.id===button.dataset.creative)||null);draft=null;messages=[];variant=current?.variant??0;view='studio';location.hash='studio';render()});
document.querySelectorAll('[data-prompt]').forEach(button=>button.onclick=()=>{document.querySelector('[name=prompt]').value=button.dataset.prompt;captureDraft()});
document.querySelectorAll('[data-variant]').forEach(button=>button.onclick=()=>{if(generating)return;captureDraft();variant=Number(button.dataset.variant);if(current){current.variant=variant;saveCreative()}render()});
const form=document.querySelector('#create-form');
if(form){
  form.oninput=captureDraft;
  form.querySelector('[name=photo]').onchange=async event=>{
    const file=event.target.files[0];if(!file)return;
    try{
      if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>10*1024*1024)throw Error('10MB 이하의 PNG, JPG, WebP 사진을 선택해주세요.');
      const source=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('사진을 읽지 못했습니다.'));reader.readAsDataURL(file)});
      const image=await loadImage(source);const scale=Math.min(1,1600/Math.max(image.width,image.height));
      const canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);
      canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
      captureDraft();draft.image=canvas.toDataURL('image/jpeg',.88);
      if(current){current.image=draft.image;await saveCreative();await saved();}
      render();toast('제품 사진을 반영했습니다.');
    }catch(error){toast(error.message)}
  };
  document.querySelector('#manual-create').onclick=async()=>{
    captureDraft();const data={...draft};
    if(!data.brand?.trim()){toast('브랜드 이름을 입력해주세요.');return}
    current={id:crypto.randomUUID(),brand:data.brand.trim(),prompt:data.prompt||'',channel:data.channel,format:data.format,name:data.brand+' 광고',headline:'헤드라인을 입력해주세요.',caption:'',script:'',image:data.image||current?.image||'',color:state.brand.color,variant:0};
    variant=0;draft=null;messages=[];await saveCreative();render();try{await saved();toast('직접 편집할 작업을 만들었습니다.')}catch(error){toast(error.message)}
  };
  form.onsubmit=async event=>{
    event.preventDefault();captureDraft();const data={...draft};
    if(!data.prompt?.trim()||!data.brand?.trim()){toast('브랜드와 광고 아이디어를 입력해주세요.');return}
    if(!connection.configured){settingsModal();return}
    const photo=data.image||current?.image||'';generating=true;render();
    try{
      const result=await api('/api/creative',{brand:{...state.brand,name:data.brand},prompt:data.prompt,channel:data.channel,format:data.format});
      current={...result,id:crypto.randomUUID(),brand:data.brand,prompt:data.prompt,channel:data.channel,format:data.format,image:photo,color:state.brand.color,variant:0};
      variant=0;draft=null;messages=[{role:'assistant',text:'광고 원고를 작성했습니다. 문구를 직접 편집하거나 AI에 수정을 요청하세요.'}];
      await saveCreative();await saved();toast('새 광고를 저장했습니다.');
    }catch(error){toast(error.message)}finally{generating=false;render()}
  };
}
const edit=document.querySelector('#edit-form');if(edit){edit.oninput=()=>{const data=Object.fromEntries(new FormData(edit));document.querySelector('.previewcanvas').innerHTML=art({...current,...data},variant,true)};edit.onchange=captureEditor;}if(edit)edit.onsubmit=async event=>{
  event.preventDefault();const data=Object.fromEntries(new FormData(edit));
  if(!data.headline.trim()||!data.name.trim()){toast('작업 이름과 헤드라인을 입력해주세요.');return}
  captureDraft();Object.assign(current,data);await saveCreative();render();try{await saved();toast('수정 내용을 저장했습니다.')}catch(error){toast(error.message)}
};
const chat=document.querySelector('#chat-form');if(chat)chat.onsubmit=async event=>{
  event.preventDefault();const text=new FormData(chat).get('message').trim();if(!text||!current||generating)return;
  if(!connection.configured){settingsModal();return}
  captureDraft();const existing=structuredClone(current);generating=true;render();
  try{
    const result=await api('/api/creative',{brand:{...state.brand,name:existing.brand},prompt:existing.prompt||'현재 광고를 수정합니다.',channel:existing.channel,format:existing.format,existing:{name:existing.name,headline:existing.headline,caption:existing.caption,script:existing.script},message:text});
    Object.assign(current,result);messages.push({role:'user',text},{role:'assistant',text:'수정 요청을 반영했습니다.'});
    await saveCreative();await saved();toast('AI 수정 내용을 저장했습니다.');
  }catch(error){toast(error.message)}finally{generating=false;render()}
};
const copy=document.querySelector('#export-copy');if(copy)copy.onclick=()=>{captureEditor();if(current)download('bloom-copy.txt',[current.name,current.headline,current.caption,current.script].join('\n\n'),'text/plain;charset=utf-8')};
const exportButton=document.querySelector('#export');if(exportButton)exportButton.onclick=()=>{captureEditor();if(current)download('bloom-creative.svg',artwork(current,variant),'image/svg+xml')};
const png=document.querySelector('#export-png');if(png)png.onclick=async()=>{
  captureEditor();if(!current)return;
  try{await document.fonts.ready;const img=await loadImage('data:image/svg+xml;charset=utf-8,'+encodeURIComponent(artwork(current,variant)));
    const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1080;canvas.getContext('2d').drawImage(img,0,0);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('PNG 생성에 실패했습니다.');
    download('bloom-creative.png',blob,'image/png');toast('1080×1080 PNG를 저장했습니다.');
  }catch(error){toast(error.message)}
};
const save=document.querySelector('#save-campaign');if(save)save.onclick=()=>{captureEditor();campaignModal()};document.querySelectorAll('[data-budget]').forEach(button=>button.onclick=()=>campaignModal(state.campaigns.find(item=>item.id===button.dataset.budget)));
const brandForm=document.querySelector('#brand-form');if(brandForm){brandForm.oninput=()=>{const data=new FormData(brandForm);document.querySelector('#brand-preview').style.background=data.get('color');document.querySelector('#brand-preview').textContent=data.get('name');document.querySelector('#brand-description').textContent=data.get('description')};brandForm.onsubmit=async event=>{event.preventDefault();const data=new FormData(brandForm);if(!data.get('name').trim()||!data.get('description').trim()){toast('브랜드 이름과 소개를 입력해주세요.');return}state.brand=Object.fromEntries(data);state.brand.name=state.brand.name.trim();await persist();render();try{await saved();toast('브랜드 키트를 저장했습니다.')}catch(error){toast(error.message)}}}}
function loadImage(source){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('이미지를 읽지 못했습니다.'));image.src=source})}
function settingsModal(){
  modal(`<h2>AI 연결 설정</h2><p class="sub">OpenAI API 키로 연결합니다. 원고 생성·수정 시 브랜드 정보와 요청 문구가 OpenAI로 전송되며, 연결한 API 프로젝트에 사용료가 청구됩니다. 사진은 원고 요청에 전송하지 않습니다.</p><form id="settings-form"><label class="field">API 키<input name="apiKey" type="password" autocomplete="off" placeholder="${connection.configured?'연결된 키 유지 (변경할 때만 입력)':'sk-…'}" ${connection.configured?'':'required'}></label><label class="field">모델<input name="model" required value="${esc(connection.model)}"></label><p class="sub">키는 서버 메모리에만 유지합니다. 서버 재시작 후 다시 연결하거나 OPENAI_API_KEY 환경 변수를 사용하세요.</p><p id="connection-error" role="alert"></p><div class="row"><button class="btn" type="button" data-close>닫기</button><button class="btn primary">연결 확인</button></div></form>`);
  const form=document.querySelector('#settings-form');form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('.primary');button.disabled=true;button.textContent='연결 확인 중…';try{connection=await api('/api/settings',Object.fromEntries(new FormData(form)));document.querySelector('#modal').close();captureDraft();render();toast('AI 연결을 확인했습니다.')}catch(error){document.querySelector('#connection-error').textContent=error.message}finally{button.disabled=false;button.textContent='연결 확인'}};
}
const instagramLabels={queued:'게시 준비 중',uploading:'이미지 업로드 중',processing:'Instagram 이미지 처리 중',publishing:'게시 중',published:'게시 완료',failed:'게시 실패',uncertain:'게시 여부 확인 필요'};
let instagramConnection={connected:false,account:null,loginAvailable:false,serviceReady:false}, instagramPosts=[], instagramTimer;
const instagramNotices={connected:'Instagram 계정을 연결했습니다. 광고를 준비하고 게시해보세요.',cancelled:'Instagram 연결을 취소했습니다. 원할 때 다시 연결할 수 있습니다.',invalid:'연결 요청을 확인하지 못했습니다. 비즈니스·크리에이터 계정으로 다시 연결해주세요.',permissions:'계정 확인과 게시 권한을 모두 허용해주세요.',failed:'Instagram 연결을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.',unavailable:'Instagram 연결 서비스를 준비 중입니다. 잠시 후 다시 시도해주세요.'};
let instagramNotice='';
function instagramView(){
  const connected=instagramConnection.connected;
  const account=instagramConnection.account;
  return `<div class="heading"><div><div class="eyebrow">INSTAGRAM PUBLISHING</div><h1>Instagram</h1><p class="sub">계정을 연결하고 완성한 광고를 피드에 게시하세요.</p></div><button class="btn" id="instagram-refresh">상태 새로고침</button></div>${instagramNotice?`<p class="notice" role="status">${esc(instagramNotice)}</p>`:''}<div class="brandgrid"><section class="card panel instagram-account"><div class="instagram-symbol">◎</div><h2>${connected?'@'+esc(account.username):instagramConnection.reconnectRequired?'Instagram에 다시 연결해주세요':'Instagram과 연결하세요'}</h2><p class="sub">${connected?'게시할 계정이 연결되어 있습니다. 이미지와 캡션을 확인한 뒤 게시할 수 있습니다.':'Instagram에서 로그인하고 계정 확인과 게시 권한을 허용하면 연결됩니다.'}</p><button class="btn primary" id="instagram-login" ${!instagramConnection.loginAvailable?'disabled':''}>${connected?'다른 계정 연결':'Instagram으로 '+(instagramConnection.reconnectRequired?'다시 연결':'로그인')}</button>${connected?'<button class="btn" id="instagram-disconnect">연결 해제</button>':''}${!instagramConnection.serviceReady?'<p class="sub" role="status">Instagram 연결 서비스를 준비 중입니다. 준비가 끝나면 이 버튼으로 연결할 수 있습니다.</p>':''}<p class="sub">비즈니스 또는 크리에이터 계정으로 연결할 수 있습니다.</p></section><section class="card panel"><h2>광고에서 게시까지</h2><ol class="setupsteps"><li><b>계정 연결</b><br>Instagram에서 로그인하고 권한을 허용하세요.</li><li><b>광고 준비</b><br>스튜디오에서 사진과 문구를 완성하세요.</li><li><b>확인 후 게시</b><br>Instagram 게시를 누르고 대상 계정·이미지·캡션을 확인하세요.</li></ol><button class="btn" data-view="studio">광고 만들기</button></section></div><div class="sectionhead"><h2>게시 기록</h2></div><div id="instagram-posts">${instagramPostList()}</div>`;
}
function instagramPostList(){return instagramPosts.length?instagramPosts.map(job=>`<article class="card panel postrecord"><div><b>${esc(job.name)}</b><p class="sub">@${esc(job.account.username)} · ${esc(new Date(job.createdAt).toLocaleString('ko-KR'))}</p><p class="poststatus" role="status">${instagramLabels[job.status]||esc(job.status)}</p>${job.error?`<p class="posterror">${esc(job.error)}</p>`:''}${job.mediaId?`<p class="sub">게시물 ID: ${esc(job.mediaId)}</p>`:''}${job.permalink?`<a class="btn" href="${esc(job.permalink)}" target="_blank" rel="noopener noreferrer">게시물 열기</a>`:''}${job.status==='uncertain'?`<button class="btn" data-instagram-check="${esc(job.id)}">게시 상태 확인</button>`:''}</div><p class="postcaption">${esc(job.caption)}</p></article>`).join(''):'<div class="card empty">아직 게시한 기록이 없습니다.</div>'}
async function refreshInstagram(){
  const [status,posts]=await Promise.all([api('/api/instagram/status'),api('/api/instagram/posts')]);
  instagramConnection=status;instagramPosts=posts;
}
function pollInstagram(){
  clearTimeout(instagramTimer);
  if(view!=='instagram'||!instagramPosts.some(job=>['queued','uploading','processing','publishing'].includes(job.status)))return;
  instagramTimer=setTimeout(async()=>{try{await refreshInstagram();if(view==='instagram'){document.querySelector('#instagram-posts').innerHTML=instagramPostList();bindInstagramChecks();pollInstagram()}}catch(error){toast(error.message)}},3000);
}
function bindInstagramChecks(){document.querySelectorAll('[data-instagram-check]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{await api(`/api/instagram/posts/${button.dataset.instagramCheck}/check`,{});await refreshInstagram();render()}catch(error){toast(error.message);button.disabled=false}})}
function bindInstagram(){
  const refresh=document.querySelector('#instagram-refresh');if(refresh)refresh.onclick=async()=>{try{await refreshInstagram();render()}catch(error){toast(error.message)}};
  const login=document.querySelector('#instagram-login');if(login)login.onclick=async()=>{captureDraft();login.disabled=true;try{await saved();try{sessionStorage.setItem('bloom.oauth-return',JSON.stringify({creativeId:current?.id,draft:draft?{brand:draft.brand,prompt:draft.prompt,channel:draft.channel,format:draft.format}:null}))}catch{}const result=await api('/api/instagram/login',{});location.assign(result.url)}catch(error){toast(error.message);login.disabled=false}};
  const disconnect=document.querySelector('#instagram-disconnect');if(disconnect)disconnect.onclick=async()=>{try{instagramConnection=await api('/api/instagram/disconnect',{});render();toast('연결을 해제했습니다. 이미 접수한 게시 요청은 계속 처리됩니다.')}catch(error){toast(error.message)}};
  const publish=document.querySelector('#instagram-publish');if(publish)publish.onclick=instagramPublishModal;
  bindInstagramChecks();pollInstagram();
}
async function instagramPublishModal(){
  captureEditor();if(!current||generating)return;
  const creative=structuredClone(current);
  if(creative.channel!=='Instagram'||creative.format!=='이미지 광고'){toast('Instagram 이미지 광고 작업을 선택해주세요.');return}
  const button=document.querySelector('#instagram-publish');button.disabled=true;
  try{
    await saved();await refreshInstagram();
    if(!instagramConnection.connected||!instagramConnection.serviceReady){go('instagram');toast('Instagram 계정을 먼저 연결해주세요.');return}
    await document.fonts.ready;
    const image=await loadImage('data:image/svg+xml;charset=utf-8,'+encodeURIComponent(artwork(creative,creative.variant)));
    const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1080;canvas.getContext('2d').drawImage(image,0,0);
    const jpeg=canvas.toDataURL('image/jpeg',.92);
    const account=structuredClone(instagramConnection.account), requestId=crypto.randomUUID();
    modal(`<h2>Instagram에 게시</h2><p class="sub">게시 계정: <b>@${esc(account.username)}</b> · 피드 이미지 1장</p><img class="publishpreview" src="${jpeg}" alt="게시할 완성 이미지"><form id="instagram-publish-form"><label class="field">캡션<textarea name="caption" maxlength="2200" rows="6">${esc(creative.script||[creative.headline,creative.caption].filter(Boolean).join('\n\n'))}</textarea></label><p class="sub">게시를 누르면 완성 이미지가 게시용 공개 주소에 업로드되고 이미지와 캡션이 위 Instagram 계정의 피드에 게시됩니다.</p><p id="instagram-publish-error" role="alert"></p><div class="row"><button type="button" class="btn" data-close>취소</button><button class="btn primary">@${esc(account.username)}에 지금 게시</button></div></form>`);
    document.querySelector('#instagram-publish-form').onsubmit=async event=>{
      event.preventDefault();const form=event.target, submit=form.querySelector('.primary');submit.disabled=true;submit.textContent='게시 요청 중…';
      try{
        const job=await api('/api/instagram/posts',{requestId,creativeId:creative.id,accountId:account.id,image:jpeg,caption:new FormData(form).get('caption')});
        document.querySelector('#modal').close();await refreshInstagram();go('instagram');toast(job.status==='published'?'이미 게시한 이미지입니다. 게시 기록을 확인해주세요.':'게시 요청을 접수했습니다. 아래에서 진행 상태를 확인하세요.');
      }catch(error){document.querySelector('#instagram-publish-error').textContent=error.message;submit.disabled=false;submit.textContent='게시 요청 다시 확인'}
    };
  }catch(error){toast(error.message)}finally{if(button.isConnected)button.disabled=false}
}

async function start(){
  document.querySelector('#app').innerHTML='<p class="startup">작업 공간을 불러오는 중…</p>';
  try{
    const outcome=new URLSearchParams(location.search||'').get('instagram');
    if(instagramNotices[outcome]){instagramNotice=instagramNotices[outcome];view='instagram';window.history?.replaceState(null,'',location.pathname+'#instagram')}
    const [workspace,status]=await Promise.all([api('/api/state'),api('/api/status')]);revision=workspace.revision;connection=status;await refreshInstagram();
    if(workspace.state)state=workspace.state;
    else{
      let legacy;try{legacy=JSON.parse(localStorage.getItem('bloom.v1'))}catch{}
      if(legacy?.brand&&Array.isArray(legacy.creatives)&&Array.isArray(legacy.campaigns)){
        state=legacy;state.campaigns=state.campaigns.filter(c=>!c.sample&&c.id!=='autopilot-proposal'&&state.creatives.some(item=>item.id===c.creativeId));
        state.creatives=state.creatives.map(c=>({...c,color:state.brand.color}));state.autopilot=false;
      }
      await persist();await saved();
    }
    if(outcome){try{const pending=JSON.parse(sessionStorage.getItem('bloom.oauth-return'));if(pending){current=structuredClone(state.creatives.find(item=>item.id===pending.creativeId)||null);variant=current?.variant||0;draft=pending.draft;sessionStorage.removeItem('bloom.oauth-return')}}catch{}}
    render();
  }catch(error){document.querySelector('#app').innerHTML=`<div class="startup"><h1>작업 공간에 연결하지 못했습니다.</h1><p>${esc(error.message)}</p><p>터미널에서 npm start를 실행한 뒤 <a href="http://localhost:4174">Bloom 열기</a></p><button class="btn" onclick="location.reload()">다시 시도</button></div>`}
}
window.addEventListener('hashchange',()=>{const next=location.hash.slice(1);if(generating){location.hash=view;return}if(names[next]&&next!==view){captureDraft();view=next;render()}});start();
