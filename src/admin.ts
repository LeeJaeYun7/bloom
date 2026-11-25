'use strict';
let revision: string;
const form=document.querySelector<HTMLFormElement>('#operator-form');
const labels={INSTAGRAM_APP_ID:'Instagram App ID',INSTAGRAM_APP_SECRET:'Instagram App Secret',INSTAGRAM_PUBLIC_ORIGIN:'인증용 HTTPS 주소',INSTAGRAM_API_VERSION:'Graph API 버전',CLOUDINARY_CLOUD_NAME:'Cloud name',CLOUDINARY_API_KEY:'Cloudinary API Key',CLOUDINARY_API_SECRET:'Cloudinary API Secret'};
async function request(values?: Record<string,FormDataEntryValue>){
  const response=await fetch('/api/admin/config',values?{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,values})}:{});
  let result;try{result=await response.json()}catch{throw Error('운영 설정 서버의 응답을 확인해주세요.')}
  if(!response.ok)throw Error(result.error||'운영 설정을 처리하지 못했습니다.');return result;
}
function callbackPreview(){
  const output=document.querySelector<HTMLElement>('#callback-url');let value='';
  try{const url=new URL(form.querySelector<HTMLInputElement>('[name=INSTAGRAM_PUBLIC_ORIGIN]').value.trim());if(url.protocol==='https:'&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash)value=url.origin+'/auth/instagram/callback'}catch{}
  output.textContent=value||'올바른 HTTPS 주소를 입력해주세요.';document.querySelector<HTMLButtonElement>('#copy-callback').disabled=!value;
}
function display(config: import('./domain.js').OperatorReport){
  revision=config.revision;
  for(const [key,value] of Object.entries(config.values))form.querySelector<HTMLInputElement>(`[name="${key}"]`).value=value;
  for(const [key,present] of Object.entries(config.configuredSecrets)){const input=form.querySelector<HTMLInputElement>(`[name="${key}"]`);input.value='';input.placeholder=present?'저장됨 · 변경할 때만 입력':'설정값 입력';}
  const box=document.querySelector<HTMLElement>('#readiness');box.classList.toggle('ready',config.ready);
  box.replaceChildren();const title=document.createElement('b');title.textContent=config.ready?'설정값 저장 완료 · 실제 연결 확인이 필요합니다.':'운영 설정을 입력해주세요.';box.append(title);
  const list=document.createElement('ul');list.className='checks';
  for(const check of config.checks){const li=document.createElement('li');li.textContent=labels[check.name]+': '+(check.valid?'설정됨':check.error);list.append(li);form.querySelector<HTMLInputElement>(`[name="${check.name}"]`).setAttribute('aria-invalid',String(check.present&&!check.valid));}box.append(list);
  form.hidden=false;callbackPreview();
}
async function load(){try{display(await request());document.querySelector<HTMLElement>('#errors').textContent=''}catch(error){document.querySelector<HTMLElement>('#errors').textContent=error.message}}
form.onsubmit=async event=>{
  event.preventDefault();const button=document.querySelector<HTMLButtonElement>('#save');button.disabled=true;button.textContent='저장 중…';
  try{const values=Object.fromEntries(new FormData(form));display(await request(values));document.querySelector<HTMLElement>('#errors').textContent='';const notice=document.createElement('p');notice.className='notice';notice.textContent='서버에 바로 적용했습니다. Meta의 Redirect URI 등록과 실제 로그인을 확인하세요.';document.querySelector<HTMLElement>('#readiness').append(notice)}
  catch(error){document.querySelector<HTMLElement>('#errors').textContent=error.message}finally{button.disabled=false;button.textContent='설정 저장 및 적용'}
};
form.querySelector<HTMLInputElement>('[name=INSTAGRAM_PUBLIC_ORIGIN]').oninput=callbackPreview;
document.querySelector<HTMLButtonElement>('#reload').onclick=load;
document.querySelector<HTMLButtonElement>('#copy-callback').onclick=async()=>{try{await navigator.clipboard.writeText(document.querySelector<HTMLElement>('#callback-url').textContent);document.querySelector<HTMLButtonElement>('#copy-callback').textContent='복사됨'}catch{document.querySelector<HTMLElement>('#errors').textContent='위 Redirect URI를 선택해 복사해주세요.'}};
load();
