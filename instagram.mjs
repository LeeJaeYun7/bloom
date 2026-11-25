import { createHash, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { inspectConfig } from './operator-config.mjs';

const fail = (status, message) => Object.assign(new Error(message), { status });
const active = new Set(['queued', 'uploading', 'processing', 'publishing']);

export async function createInstagram(dataDir, options = {}) {
  const env = options.env || process.env;
  const now = options.now || Date.now;
  let version = env.INSTAGRAM_API_VERSION || 'v27.0';
  if (!/^v\d+\.\d+$/.test(version)) throw Error('INSTAGRAM_API_VERSION 형식을 확인해주세요.');
  const file = path.join(dataDir, 'instagram-posts.json');
  let token = '', account = null, expiresAt = 0, refreshedAt = 0, reconnectRequired = false;
  let cloud = { name: env.CLOUDINARY_CLOUD_NAME || '', key: env.CLOUDINARY_API_KEY || '', secret: env.CLOUDINARY_API_SECRET || '' };
  let appId = env.INSTAGRAM_APP_ID || '', appSecret = env.INSTAGRAM_APP_SECRET || '';
  let publicOrigin = '';
  try {
    const url = new URL(env.INSTAGRAM_PUBLIC_ORIGIN);
    if (url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) publicOrigin = url.origin;
  } catch {}
  let callback = publicOrigin ? publicOrigin + '/auth/instagram/callback' : '';
  let hostingConfigured = !!(cloud.name && cloud.key && cloud.secret);
  let oauthConfigured = inspectConfig(env).ready;
  const pending = new Map(), handoffs = new Map();
  let generation = 0, refreshing = null;
  const grantFile = path.join(dataDir, 'instagram-connection.enc');
  let encryptionKey;
  if (env.BLOOM_TOKEN_ENCRYPTION_KEY) {
    encryptionKey = Buffer.from(env.BLOOM_TOKEN_ENCRYPTION_KEY, 'base64');
    if (encryptionKey.length !== 32) throw Error('BLOOM_TOKEN_ENCRYPTION_KEY는 Base64로 인코딩한 32바이트 키여야 합니다.');
  } else {
    const keyFile = path.join(dataDir, 'instagram-connection.key');
    try { encryptionKey = await readFile(keyFile); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const candidate = randomBytes(32);
      try { await writeFile(keyFile, candidate, { mode: 0o600, flag: 'wx' }); encryptionKey = candidate; }
      catch (error) { if (error.code !== 'EEXIST') throw error; encryptionKey = await readFile(keyFile); }
    }
    if (encryptionKey.length !== 32) throw Error('Instagram 연결 암호화 키 파일을 확인해주세요.');
  }
  try {
    const sealed = JSON.parse(await readFile(grantFile, 'utf8'));
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(sealed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    const grant = JSON.parse(Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString());
    if (typeof grant.token !== 'string' || !/^\d+$/.test(grant.account?.id) || typeof grant.account.username !== 'string' || !Number.isFinite(grant.expiresAt) || !Number.isFinite(grant.refreshedAt)) throw Error('Invalid stored grant');
    ({ token, account, expiresAt, refreshedAt } = grant);
    if(grant.appId && grant.appId !== appId)reconnectRequired=true;
  } catch (error) { if (error.code !== 'ENOENT') reconnectRequired = true; }

  let jobs = [];
  try { jobs = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Never blindly replay a publish when the preceding process stopped mid-request.
  for (const job of jobs) if (active.has(job.status)) {
    job.status = job.status === 'publishing' ? 'uncertain' : 'failed';
    job.error = job.status === 'uncertain' ? '서버가 중단되어 게시 여부를 확인해야 합니다. 상태 확인을 눌러주세요.' : '서버가 중단되어 작업이 멈췄습니다. 다시 게시하려면 새 요청을 보내주세요.';
  }
  let queue = Promise.resolve();
  const exclusive = fn => { const work = queue.catch(() => {}).then(fn); queue = work; return work; };
  async function save() {
    await writeFile(file + '.tmp', JSON.stringify(jobs), { mode: 0o600 });
    await rename(file + '.tmp', file);
  }
  await save();
  async function saveGrant(grant) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(grant), 'utf8'), cipher.final()]);
    await writeFile(grantFile + '.tmp', JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }), { mode: 0o600 });
    await rename(grantFile + '.tmp', grantFile);
  }
  const status = () => ({
    connected: !!account && !!token && expiresAt > now() && !reconnectRequired,
    account, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    reconnectRequired: reconnectRequired || (!!account && expiresAt <= now()),
    loginAvailable: oauthConfigured && hostingConfigured,
    serviceReady: oauthConfigured && hostingConfigured,
    hostingConfigured
  });
  function configure(next) {
    if(appId !== (next.INSTAGRAM_APP_ID || ''))reconnectRequired=!!account;
    version = next.INSTAGRAM_API_VERSION || 'v27.0';
    appId = next.INSTAGRAM_APP_ID || ''; appSecret = next.INSTAGRAM_APP_SECRET || '';
    cloud = { name: next.CLOUDINARY_CLOUD_NAME || '', key: next.CLOUDINARY_API_KEY || '', secret: next.CLOUDINARY_API_SECRET || '' };
    const inspected = inspectConfig(next);
    publicOrigin = inspected.callbackUrl ? new URL(inspected.callbackUrl).origin : '';
    callback = inspected.callbackUrl || '';
    hostingConfigured = !!(cloud.name && cloud.key && cloud.secret);
    oauthConfigured = inspected.ready;
    generation++; pending.clear(); handoffs.clear();
  }
  function createLoginHandoff() {
    if (!status().loginAvailable) throw fail(503, 'Instagram 연결 서비스를 준비 중입니다. 잠시 후 다시 시도해주세요.');
    for (const [key, expiry] of handoffs) if (expiry <= now()) handoffs.delete(key);
    if (handoffs.size >= 100) throw fail(429, '연결 요청이 많습니다. 잠시 후 다시 시도해주세요.');
    const ticket = randomBytes(32).toString('hex'); handoffs.set(ticket, now() + 60000);
    return { url: publicOrigin + '/auth/instagram/start?ticket=' + ticket };
  }
  function consumeLoginHandoff(ticket) {
    const expiry = handoffs.get(ticket); handoffs.delete(ticket);
    if (!expiry || expiry <= now()) throw fail(400, '연결 요청이 만료되었습니다. Bloom에서 다시 연결해주세요.');
    return beginAuthorization();
  }
  function beginAuthorization() {
    if (!oauthConfigured || !hostingConfigured) throw fail(503, 'Instagram 연결 서비스를 준비 중입니다. 잠시 후 다시 시도해주세요.');
    for (const [state, entry] of pending) if (entry.expiresAt <= now()) pending.delete(state);
    if (pending.size >= 100) throw fail(429, '연결 요청이 많습니다. 잠시 후 다시 시도해주세요.');
    const state = randomBytes(32).toString('hex'), binding = randomBytes(32).toString('hex');
    pending.set(state, { bindingHash: createHash('sha256').update(binding).digest(), expiresAt: now() + 10 * 60 * 1000 });
    const url = new URL('https://www.instagram.com/oauth/authorize');
    url.search = new URLSearchParams({ client_id: appId, redirect_uri: callback, response_type: 'code', scope: 'instagram_business_basic,instagram_business_content_publish', state, enable_fb_login: 'false' }).toString();
    return { location: url.href, binding };
  }
  async function external(url, options, service) {
    let response;
    try { response = await fetch(url, { ...options, signal: AbortSignal.timeout(45000) }); }
    catch { throw fail(502, `${service} 응답을 확인하지 못했습니다. 네트워크 상태를 확인해주세요.`); }
    let data; try { data = await response.json(); } catch { throw fail(502, `${service} 응답을 읽지 못했습니다.`); }
    if (!response.ok || data.error || data.error_type) {
      const code = data.error?.code;
      const message = service === 'Instagram' ?
        code === 190 || response.status === 401 ? 'Instagram 토큰이 만료되었거나 유효하지 않습니다. 다시 연결해주세요.' :
        code === 10 || code === 200 || response.status === 403 ? 'Instagram 게시 권한이 필요합니다. 계정을 다시 연결하고 게시 권한을 허용해주세요.' :
        code === 4 || code === 32 || code === 613 || response.status === 429 ? 'Instagram 사용 한도에 도달했습니다. 나중에 다시 시도해주세요.' :
        'Instagram 요청에 실패했습니다. 계정 권한과 이미지 형식을 확인해주세요.' :
        '이미지를 업로드하지 못했습니다. 잠시 후 다시 시도해주세요.';
      const error = fail(502, message);
      if (service === 'Instagram' && (code === 190 || code === 10 || code === 200 || response.status === 401 || response.status === 403)) error.reconnect = true;
      throw error;
    }
    return data;
  }
  async function graph(endpoint, key, payload) {
    try {
      return await external(`https://graph.instagram.com/${version}/${endpoint}`, {
        method: payload ? 'POST' : 'GET', headers: { Authorization: `Bearer ${key}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
        ...(payload ? { body: JSON.stringify(payload) } : {})
      }, 'Instagram');
    } catch (error) {
      if (error.reconnect && key === token) reconnectRequired = true;
      throw error;
    }
  }
  async function identify(key) {
    const response = await graph('me?fields=user_id,username,account_type', key);
    const profile = response.data?.[0] || response;
    const type = String(profile.account_type).toUpperCase();
    if (!/^\d+$/.test(String(profile.user_id)) || typeof profile.username !== 'string' || !['BUSINESS', 'MEDIA_CREATOR', 'CREATOR'].includes(type)) {
      throw fail(400, '비즈니스 또는 크리에이터 Instagram 계정으로 연결해주세요.');
    }
    return { id: String(profile.user_id), username: profile.username, type };
  }
  async function finishAuthorization(input) {
    const state = typeof input.state === 'string' ? input.state : '';
    const entry = pending.get(state);
    const hash = createHash('sha256').update(typeof input.binding === 'string' ? input.binding : '').digest();
    if (!entry || entry.expiresAt <= now() || !timingSafeEqual(entry.bindingHash, hash)) throw fail(400, '연결 요청이 만료되었거나 올바르지 않습니다. Instagram 연결을 다시 눌러주세요.');
    pending.delete(state);
    if (input.denied) throw fail(400, 'Instagram 연결을 취소했습니다.');
    if (typeof input.code !== 'string' || !input.code || input.code.length > 4096) throw fail(400, 'Instagram 인증 코드를 확인하지 못했습니다. 다시 연결해주세요.');
    const attempt = generation;
    const form = new FormData();
    for (const [key, value] of Object.entries({ client_id: appId, client_secret: appSecret, grant_type: 'authorization_code', redirect_uri: callback, code: input.code })) form.set(key, value);
    const response = await external('https://api.instagram.com/oauth/access_token', { method: 'POST', body: form }, 'Instagram');
    const short = response.data?.[0] || response;
    const permissions = Array.isArray(short.permissions) ? short.permissions : typeof short.permissions === 'string' ? short.permissions.split(',').map(item => item.trim()) : [];
    if (!permissions.includes('instagram_business_basic') || !permissions.includes('instagram_business_content_publish')) throw fail(403, '계정 확인과 게시 권한을 모두 허용해야 연결할 수 있습니다. 다시 연결해주세요.');
    if (typeof short.access_token !== 'string' || !short.access_token) throw fail(502, 'Instagram 연결 정보를 받지 못했습니다. 다시 연결해주세요.');
    const exchange = new URL('https://graph.instagram.com/access_token');
    exchange.search = new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: appSecret, access_token: short.access_token }).toString();
    const long = await external(exchange.href, { method: 'GET' }, 'Instagram');
    if (typeof long.access_token !== 'string' || !long.access_token || !Number.isFinite(long.expires_in) || long.expires_in <= 0) throw fail(502, 'Instagram 장기 연결 정보를 받지 못했습니다.');
    const profile = await identify(long.access_token);
    return exclusive(async () => {
      if (generation !== attempt) throw fail(409, '연결 상태가 바뀌었습니다. 다시 연결해주세요.');
      const grant = { appId, token: long.access_token, account: profile, expiresAt: now() + long.expires_in * 1000, refreshedAt: now() };
      await saveGrant(grant);
      ({ token, account, expiresAt, refreshedAt } = grant); reconnectRequired = false; generation++;
      return status();
    });
  }
  async function refreshConnection() {
    if (refreshing) return refreshing;
    if (!token || !account || reconnectRequired || expiresAt <= now()) return;
    if (expiresAt - now() > 7 * 86400000 || now() - refreshedAt < 86400000) return;
    const attempt = generation, currentToken = token;
    refreshing = (async () => {
      try {
        const url = new URL('https://graph.instagram.com/refresh_access_token');
        url.search = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: currentToken }).toString();
        const refreshed = await external(url.href, { method: 'GET' }, 'Instagram');
        if (typeof refreshed.access_token !== 'string' || !refreshed.access_token || !Number.isFinite(refreshed.expires_in) || refreshed.expires_in <= 0) throw fail(502, 'Instagram 연결 갱신에 실패했습니다.');
        await exclusive(async () => {
          if (generation !== attempt) return;
          const grant = { appId, token: refreshed.access_token, account, expiresAt: now() + refreshed.expires_in * 1000, refreshedAt: now() };
          await saveGrant(grant); ({ token, expiresAt, refreshedAt } = grant);
        });
      } catch (error) {
        if (generation === attempt && error.reconnect) reconnectRequired = true;
        throw error;
      } finally { refreshing = null; }
    })();
    return refreshing;
  }
  async function disconnect() {
    await exclusive(async () => {
      await unlink(grantFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
      token = ''; account = null; expiresAt = 0; refreshedAt = 0; reconnectRequired = false; generation++; pending.clear(); handoffs.clear();
    });
    return status();
  }
  async function update(job, changes) {
    return exclusive(async () => { Object.assign(job, changes, { updatedAt: new Date().toISOString() }); await save(); });
  }
  async function upload(image, credentials) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHash('sha256').update(`timestamp=${timestamp}${credentials.secret}`).digest('hex');
    const form = new FormData();
    form.set('file', image); form.set('api_key', credentials.key); form.set('timestamp', timestamp); form.set('signature', signature);
    const result = await external(`https://api.cloudinary.com/v1_1/${credentials.name}/image/upload`, { method: 'POST', body: form }, 'Cloudinary');
    const url = new URL(result.secure_url);
    if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com' || result.format !== 'jpg') throw fail(502, '공개 JPEG 업로드 주소를 확인하지 못했습니다.');
    return url.href;
  }
  async function run(job, image, key, credentials) {
    let publishAttempted = false;
    try {
      await update(job, { status: 'uploading' });
      const imageUrl = await upload(image, credentials);
      await update(job, { imageUrl });
      const container = await graph(`${job.account.id}/media`, key, { image_url: imageUrl, caption: job.caption });
      if (!/^\d+$/.test(String(container.id))) throw fail(502, 'Instagram 게시 준비 ID를 받지 못했습니다.');
      await update(job, { containerId: String(container.id), status: 'processing' });
      let ready = false;
      for (let attempt = 0; attempt < 6; attempt++) {
        const result = await graph(`${job.containerId}?fields=status_code`, key);
        if (result.status_code === 'FINISHED') { ready = true; break; }
        if (['ERROR', 'EXPIRED'].includes(result.status_code)) throw fail(502, 'Instagram에서 이미지 처리를 완료하지 못했습니다.');
        if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 60000));
      }
      if (!ready) throw fail(502, 'Instagram 이미지 처리가 5분 안에 완료되지 않았습니다. 게시하지 않았습니다.');
      await update(job, { status: 'publishing' });
      publishAttempted = true;
      const published = await graph(`${job.account.id}/media_publish`, key, { creation_id: job.containerId });
      if (!/^\d+$/.test(String(published.id))) throw fail(502, '게시 결과 ID를 확인하지 못했습니다.');
      await update(job, { status: 'published', mediaId: String(published.id), error: null });
      try {
        const media = await graph(`${job.mediaId}?fields=permalink`, key);
        const url = new URL(media.permalink);
        if (url.protocol === 'https:' && ['www.instagram.com', 'instagram.com'].includes(url.hostname)) await update(job, { permalink: url.href });
      } catch { /* The media ID already confirms publishing; a permalink failure must not trigger another post. */ }
    } catch (error) {
      try { await update(job, { status: publishAttempted ? 'uncertain' : 'failed', error: error.status ? error.message : '게시 작업을 완료하지 못했습니다. 상태를 확인해주세요.' }); }
      catch { /* Keep the last durable stage; restart recovery will not replay it. */ }
    }
  }
  async function createPost(input, workspace) {
    await refreshConnection().catch(() => {});
    if (!status().connected) throw fail(503, 'Instagram 계정을 다시 연결해주세요.');
    if (input.accountId !== account.id) throw fail(409, '게시 대상 계정이 바뀌었습니다. 계정을 다시 확인해주세요.');
    const creative = workspace?.creatives.find(item => item.id === input.creativeId);
    if (!creative || creative.channel !== 'Instagram' || creative.format !== '이미지 광고') throw fail(400, 'Instagram 이미지 광고 작업을 저장한 뒤 게시해주세요.');
    if (typeof input.caption !== 'string' || [...input.caption].length > 2200) throw fail(400, '캡션은 최대 2,200자입니다.');
    if (typeof input.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(input.requestId)) throw fail(400, '게시 요청 ID를 확인해주세요.');
    if (typeof input.image !== 'string' || input.image.length > 11 * 1024 * 1024 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(input.image)) throw fail(400, '8MB 이하 JPEG 이미지가 필요합니다.');
    const bytes = Buffer.from(input.image.split(',')[1], 'base64');
    if (bytes.length > 8 * 1024 * 1024 || bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) throw fail(400, '올바른 JPEG 이미지를 준비해주세요.');
    const fingerprint = createHash('sha256').update(account.id).update('\0').update(input.caption).update('\0').update(bytes).digest('hex');
    return exclusive(async () => {
      const existing = jobs.find(item => item.id === input.requestId || (item.fingerprint === fingerprint && item.status !== 'failed'));
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw fail(409, '이미 사용한 요청 ID입니다. 게시 창을 다시 열어주세요.');
        return existing;
      }
      if (!cloud.name || !cloud.key || !cloud.secret) throw fail(503, '이미지 호스팅 설정을 확인해주세요.');
      const job = { id: input.requestId, creativeId: creative.id, name: creative.name, account: structuredClone(account), caption: input.caption, fingerprint, status: 'queued', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      jobs.unshift(job); await save();
      // Start after the durable record exists. This work is independent of the HTTP connection.
      const key = token, credentials = { ...cloud };
      queueMicrotask(() => { void run(job, input.image, key, credentials); });
      return job;
    });
  }
  async function reconcile(id) {
    const job = jobs.find(item => item.id === id);
    if (!job) throw fail(404, '게시 기록을 찾을 수 없습니다.');
    if (active.has(job.status) || job.status === 'published' || !job.containerId) return job;
    await refreshConnection().catch(() => {});
    if (!status().connected || account.id !== job.account.id) throw fail(409, '이 게시물의 Instagram 계정을 다시 연결해주세요.');
    const result = await graph(`${job.containerId}?fields=status_code`, token);
    if (result.status_code === 'PUBLISHED') await update(job, { status: 'published', error: null });
    else if (['ERROR', 'EXPIRED'].includes(result.status_code)) await update(job, { status: 'failed', error: 'Instagram에서 게시 실패 또는 만료를 확인했습니다.' });
    // FINISHED may still be an ambiguous media_publish; do not automatically retry it.
    return job;
  }
  const timer = setInterval(() => { void refreshConnection().catch(() => {}); }, 6 * 60 * 60 * 1000);
  timer.unref();
  void refreshConnection().catch(() => {});
  return {
    status, configure, createLoginHandoff, consumeLoginHandoff, beginAuthorization, finishAuthorization, refreshConnection, createPost, reconcile, disconnect,
    get publicOrigin() { return publicOrigin; }, get callback() { return callback; },
    list: () => jobs.slice(0, 100),
    close: () => clearInterval(timer)
  };
}
