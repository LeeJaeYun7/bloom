import type {OperatorReport} from './domain.js';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

const fields = ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET', 'INSTAGRAM_PUBLIC_ORIGIN', 'INSTAGRAM_API_VERSION', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
const secrets = new Set(['INSTAGRAM_APP_SECRET', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']);
const fail = (status, message) => Object.assign(new Error(message), { status });
export function inspectConfig(values: NodeJS.ProcessEnv) {
  const checks = fields.map(name => {
    const value = values[name] || (name === 'INSTAGRAM_API_VERSION' ? 'v27.0' : '');
    let valid = !!value;
    if (name === 'INSTAGRAM_APP_ID') valid = /^\d{3,40}$/.test(value);
    if (secrets.has(name)) valid = /^[A-Za-z0-9_.-]{1,500}$/.test(value);
    if (name === 'CLOUDINARY_CLOUD_NAME') valid = /^[A-Za-z0-9_-]{1,100}$/.test(value);
    if (name === 'INSTAGRAM_API_VERSION') valid = /^v\d{1,3}\.\d{1,2}$/.test(value);
    if (name === 'INSTAGRAM_PUBLIC_ORIGIN') {
      try {
        const url = new URL(value);
        const host = url.hostname.toLowerCase();
        valid = url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash &&
          !['localhost', '[::1]'].includes(host) && !/^\d+\.\d+\.\d+\.\d+$/.test(host) && !host.endsWith('.localhost') && host.includes('.') && !host.endsWith('.example');
      } catch { valid = false; }
    }
    return { name, present: !!value, valid, error: valid ? null : value ? '형식을 확인해주세요.' : '설정값이 필요합니다.' };
  });
  const origin = checks.find(item => item.name === 'INSTAGRAM_PUBLIC_ORIGIN').valid ? new URL(values.INSTAGRAM_PUBLIC_ORIGIN).origin : '';
  return { ready: checks.every(item => item.valid), checks, callbackUrl: origin ? origin + '/auth/instagram/callback' : null };
}
export async function createOperatorConfig(dataDir: string, env: NodeJS.ProcessEnv = process.env) {
  const file = path.join(dataDir, 'operator-config.enc');
  const keyFile = path.join(dataDir, 'operator-config.key');
  let key;
  if (env.BLOOM_TOKEN_ENCRYPTION_KEY) {
    key = Buffer.from(env.BLOOM_TOKEN_ENCRYPTION_KEY, 'base64');
    if (key.length !== 32) throw Error('BLOOM_TOKEN_ENCRYPTION_KEY는 Base64로 인코딩한 32바이트 키여야 합니다.');
  } else {
    try { key = await readFile(keyFile); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const candidate = randomBytes(32);
      try { await writeFile(keyFile, candidate, { mode: 0o600, flag: 'wx' }); key = candidate; }
      catch (error) { if (error.code !== 'EEXIST') throw error; key = await readFile(keyFile); }
    }
  }
  if (key.length !== 32) throw Error('운영 설정 암호화 키를 확인해주세요.');
  const base = Object.fromEntries(fields.map(name => [name, env[name] || (name === 'INSTAGRAM_API_VERSION' ? 'v27.0' : '')]));
  let overrides: Record<string,string> = {}, revision = randomBytes(16).toString('hex');
  try {
    const sealed = JSON.parse(await readFile(file, 'utf8'));
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    const decoded = JSON.parse(Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString());
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded) || fields.some(name => decoded[name] !== undefined && typeof decoded[name] !== 'string')) throw Error('Invalid operator config');
    if(typeof sealed.revision==='string')revision=sealed.revision;
    overrides = Object.fromEntries(fields.filter(name => decoded[name] !== undefined).map(name => [name, decoded[name]]));
  } catch (error) { if (error.code !== 'ENOENT') throw Error('운영 설정을 복호화하지 못했습니다. 기존 암호화 키와 설정 파일을 확인해주세요.'); }
  let queue: Promise<unknown> = Promise.resolve();
  const snapshot = () => ({ ...base, ...overrides });
  function describe(): OperatorReport {
    const values = snapshot();
    return { revision, ...inspectConfig(values), values: Object.fromEntries(fields.filter(name => !secrets.has(name)).map(name => [name, values[name]])), configuredSecrets: Object.fromEntries([...secrets].map(name => [name, !!values[name]])) };
  }
  async function update(input: {revision:string;values:Record<string,string>}, apply: (environment:NodeJS.ProcessEnv)=>void) {
    const task = queue.catch(() => {}).then(async () => {
      if (!input || input.revision !== revision) throw fail(409, '다른 운영 설정이 저장되었습니다. 화면을 새로고침해주세요.');
      if (!input.values || typeof input.values !== 'object' || Array.isArray(input.values) || Object.keys(input.values).some(name => !fields.includes(name))) throw fail(400, '지원하지 않는 설정 항목입니다.');
      const next = { ...overrides };
      for (const [name, raw] of Object.entries(input.values)) {
        if (typeof raw !== 'string' || raw.length > 2000) throw fail(400, '설정값 형식을 확인해주세요.');
        const value = raw.trim();
        if (secrets.has(name) && !value) continue; // Blank secret fields retain the existing secret.
        next[name] = value;
      }
      const merged = { ...base, ...next };
      const invalid = inspectConfig(merged).checks.filter(item => item.present && !item.valid);
      if (invalid.length) throw fail(400, invalid.map(item => item.name + ': ' + item.error).join(' '));
      const nextRevision = randomBytes(16).toString('hex');
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(JSON.stringify(next), 'utf8'), cipher.final()]);
      await writeFile(file + '.tmp', JSON.stringify({ revision: nextRevision, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }), { mode: 0o600 });
      await rename(file + '.tmp', file);
      overrides = next; revision = nextRevision;
      apply({ ...env, ...merged });
      return describe();
    });
    queue = task; return task;
  }
  return { environment: () => ({ ...env, ...snapshot() }), describe, update };
}
