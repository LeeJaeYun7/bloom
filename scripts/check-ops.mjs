import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createOperatorConfig } from '../operator-config.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir=process.env.BLOOM_DATA_DIR||path.join(root,'.bloom');
try{
  await mkdir(dir,{recursive:true});
  const config=await createOperatorConfig(dir);
  const report=config.describe();
  console.log('Bloom 운영 설정 검사 (설정값 형식만 검사, Secret 값은 출력하지 않음)');
  for(const check of report.checks)console.log(`${check.valid?'OK':'필요'}  ${check.name}${check.valid?'':' — '+check.error}`);
  if(report.callbackUrl)console.log('Meta Redirect URI: '+report.callbackUrl);
  console.log(report.ready?'설정값 준비 완료. HTTPS 연결과 Meta 로그인·게시를 직접 검증해주세요.':'http://localhost:'+(process.env.PORT||4174)+'/admin 에서 누락된 설정을 저장하세요.');
  process.exitCode=report.ready?0:1;
}catch(error){console.error(error.message);process.exitCode=1}
