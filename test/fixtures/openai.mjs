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
  const input = JSON.parse(request.input);
  if (input.prompt === 'quota') return Response.json({ error: {} }, { status: 429 });
  if (input.prompt === 'incomplete') return Response.json({ output: [] });
  const result = { name: `${input.brand.name} 광고`, headline: input.message ? `수정: ${input.message}` : `${input.brand.name}의 새로운 시작`, caption: '제품의 매력을 만나보세요.', script: '게시물 본문과 행동 유도 문구' };
  return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }] });
};
