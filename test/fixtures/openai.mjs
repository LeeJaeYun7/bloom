// Contract fixture: intercept only OpenAI; local HTTP requests remain real.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  if(String(url)==='https://api.instagram.com/oauth/access_token')return Response.json({data:[{access_token:'short-instagram-fixture',permissions:'instagram_business_basic,instagram_business_content_publish'}]});
  if(String(url).startsWith('https://graph.instagram.com/access_token?'))return Response.json({access_token:'long-instagram-fixture',expires_in:5184000});
  if(String(url).startsWith('https://graph.instagram.com/')&&String(url).includes('/me?'))return Response.json({user_id:'1234',username:'http_owner',account_type:'Business'});
  if (!String(url).startsWith('https://api.openai.com/v1/')) return realFetch(url, options);
  if (options.headers.Authorization !== 'Bearer sk-test-valid') return Response.json({ error: {} }, { status: 401 });
  if (String(url).includes('/models/')) return Response.json({ id: 'gpt-4.1-mini' });
  const request = JSON.parse(options.body);
  if (request.store !== false || request.text.format.type !== 'json_schema' || !request.text.format.strict) throw Error('Invalid Responses API contract');
  if(request.text.format.name==='batch_video_plans'){
    const input=JSON.parse(request.input[0].content.find(item=>item.type==='input_text').text);
    const variants=Array.from({length:input.count},(_,i)=>({angle:'광고 관점 '+(i+1),hypothesis:'서로 다른 제품 메시지 가설 '+(i+1),name:'일괄 시안 '+(i+1),headline:'제품의 매력 '+(i+1),caption:'제품 소개',script:'시안별 원고 '+(i+1),style:['warm','bold','minimal'][i%3],motion:['gentle','dynamic','still'][i%3],scenes:[{title:'새로운 도입 '+(i+1),body:'제품의 매력'},{title:'브랜드 이야기 '+(i+1),body:'선택의 이유'},{title:'지금 만나보세요',body:'자세히 알아보기'}]}));
    return Response.json({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({variants})}]}]});
  }
  if(request.text.format.name==='creative_director'){
    const input=JSON.parse(request.input[0].content.find(item=>item.type==='input_text').text);
    const duration=input.message.includes('10초')?10:15;
    const result={reply:'기존 타깃을 유지하고 영상 기획을 반영했습니다.',action:'render',ready:true,audio:'keep',brief:{product:'오트 라떼',audience:input.brief.audience||'20대 직장인',tone:'따뜻함',goal:'제품 소개'},creative:{brand:input.creative.brand,name:'대화형 광고',headline:'한 잔의 여유',caption:'내 취향의 라떼',script:'기존 광고를 바탕으로 기획',channel:'Instagram'},plan:{aspect:'9:16',duration,style:'warm',motion:'gentle',scenes:[{title:'오늘의 여유',body:'오트 라떼'},{title:'내 취향의 시간',body:'함께하는 한 잔'},{title:'지금 만나보세요',body:'자세히 알아보기'}]}};
    return Response.json({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]});
  }
  const input = JSON.parse(request.input);
  if (input.prompt === 'quota') return Response.json({ error: {} }, { status: 429 });
  if (input.prompt === 'incomplete') return Response.json({ output: [] });
  if(request.text.format.name==='video_plan'){if(JSON.stringify(input).includes('data:image'))throw Error('Product photo leaked into text request');return Response.json({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({scenes:[{title:'도입 장면',body:'제품의 이야기'},{title:'제품 소개',body:'브랜드의 매력'},{title:'행동 유도',body:'지금 만나보세요'}]})}]}]})}
  const result = { name: `${input.brand.name} 광고`, headline: input.message ? `수정: ${input.message}` : `${input.brand.name}의 새로운 시작`, caption: '제품의 매력을 만나보세요.', script: '게시물 본문과 행동 유도 문구' };
  return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }] });
};
