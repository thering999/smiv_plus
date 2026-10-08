/*
 * เทสต์ของ Cloudflare Worker (publish proxy + ยืนยันตัวตน + แยกชั้นข้อมูลสาธารณะ/ส่วนตัว)
 * รัน: npm test   (รวมอยู่ในชุด regression test ของโปรเจกต์)
 *
 * จุดที่ต้องรับประกันด้วยเทสต์ (เพราะเป็นเรื่องข้อมูลผู้ป่วย):
 *  - ข้อมูลที่เขียนขึ้น GitHub ต้องไม่มีเลขบัตรประชาชน 13 หลัก และชื่อ-สกุลจริง
 *  - ข้อมูลเต็มต้องอ่านได้เฉพาะผู้ถือ token ที่ยังไม่หมดอายุ และถูกจำกัดอำเภอตามสิทธิ์
 *  - publish/delete_history/restore ต้องเป็น admin เท่านั้น
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword, verifyPassword, signToken, verifyToken,
  toPublicPayload, validatePublishPayload, scopePatientsForUser, sanitizeUser,
  createLoginThrottle, createWorkerHandler, storageFor,
  PII_CURRENT_KEY, PII_HISTORY_PREFIX, MAX_PATIENTS,
  AUDIT_PREFIX, writeAudit, readAudit, validateFollowupInput, collectOverdue,
} from '../worker/lib.mjs';

// ---------- ตัวช่วย ----------
function makeKv() {
  const map = new Map();
  return {
    _map: map,
    async get(key) { return map.has(key) ? map.get(key) : null; },
    async put(key, value) { map.set(key, value); },
    async delete(key) { map.delete(key); },
    async list(opts = {}) {
      const prefix = opts.prefix || '';
      return { keys: [...map.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true };
    },
  };
}

function makeGithubStub() {
  const files = new Map();
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    const path = String(url).replace(/^.*\/contents\//, '');
    calls.push({ path, method });
    if (method === 'GET') {
      if (!files.has(path)) return { status: 404, ok: false, json: async () => ({}), text: async () => 'not found' };
      return {
        status: 200, ok: true, text: async () => '',
        json: async () => ({ sha: `sha:${path}`, content: Buffer.from(files.get(path), 'utf8').toString('base64') }),
      };
    }
    if (method === 'PUT') {
      const body = JSON.parse(init.body);
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body.content)) return { status: 422, ok: false, json: async () => ({ message: 'content is not valid Base64' }), text: async () => '' };
      files.set(path, Buffer.from(String(body.content).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
      return { status: 200, ok: true, json: async () => ({ ok: true }), text: async () => '' };
    }
    if (method === 'DELETE') { files.delete(path); return { status: 200, ok: true, json: async () => ({}), text: async () => '' }; }
    return { status: 500, ok: false, json: async () => ({}), text: async () => 'unexpected method' };
  };
  return { fetchImpl, files, calls };
}

function patient(overrides = {}) {
  return {
    hoscode: '10712', hosname: 'โรงพยาบาลมุกดาหาร', pid: '203392', cid: '1234567890123',
    name: 'สมชาย', lname: 'ใจดี', birth: '1988-04-09', sex: 1, chw_addr: '49', tambon: '05', ampur: '01',
    first_date_serv: '2025-01-23', date_serv_raw: '2025-01-23', diagcode_raw: 'F29', b03x_raw: '1B031',
    follow_last: '2025-01-23', fiscal_year_be: 2568, smiv_code_count: 1, has_repeat_violence: false,
    age_at_fy_end: 37, total_visits: 1,
    ...overrides,
  };
}

function makeEnv(overrides = {}) {
  const kv = makeKv();
  return {
    GH_TOKEN: 'gh-token-test', SESSION_SECRET: 'session-secret-test', SITE_KEY: 'site-key-test',
    AUTH_USERS: JSON.stringify([
      { username: 'admin', password_hash: '', role: 'admin', ampur: null, display_name: 'ผู้ดูแลระบบ' },
      { username: 'muk01', password_hash: '', role: 'viewer', ampur: '01', display_name: 'เจ้าหน้าที่อำเภอเมือง' },
    ]),
    PII_KV: kv, LOGIN_KV: kv,
    ALLOWED_ORIGINS: 'https://thering999.github.io',
    _kv: kv,
    ...overrides,
  };
}

// hash ต้นทุนต่ำสำหรับเทสต์ (production ใช้ 150,000 รอบ)
async function envWithPasswords(passwords = { admin: 'admin-pass-1234', muk01: 'muk01-pass-1234' }, envOverrides = {}) {
  const env = makeEnv(envOverrides);
  const users = JSON.parse(env.AUTH_USERS);
  for (const u of users) u.password_hash = await hashPassword(passwords[u.username], { iterations: 1000 });
  env.AUTH_USERS = JSON.stringify(users);
  return env;
}

function req(path, { method = 'POST', body, token, siteKey, origin = 'https://thering999.github.io', ip = '203.0.113.9' } = {}) {
  const headers = { Origin: origin, 'CF-Connecting-IP': ip };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (siteKey) headers['X-Site-Key'] = siteKey;
  return new Request(`https://smiv.test${path}`, {
    method, headers,
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
}

async function loginAs(handler, env, username, password) {
  const res = await handler.fetch(req('/login', { body: { username, password } }), env);
  return { status: res.status, body: await res.json() };
}


// ---------- 1) รหัสผ่าน ----------
test('hashPassword/verifyPassword: รหัสถูกต้องผ่าน รหัสผิดไม่ผ่าน และไม่เก็บรหัสจริงในสตริง', async () => {
  const stored = await hashPassword('supersecret123', { iterations: 1000 });
  assert.match(stored, /^pbkdf2-sha256\$1000\$/);
  assert.ok(!stored.includes('supersecret123'));
  assert.equal(await verifyPassword('supersecret123', stored), true);
  assert.equal(await verifyPassword('supersecret124', stored), false);
  assert.equal(await verifyPassword('', stored), false);
  assert.equal(await verifyPassword('x', 'plaintext'), false);
  assert.equal(await verifyPassword('x', 'pbkdf2-sha256$abc$def$ghi'), false);
});

test('hashPassword: salt ต่างกันในแต่ละครั้ง → hash ต่างกันแต่ตรวจรหัสเดิมผ่านทั้งคู่', async () => {
  const a = await hashPassword('samepass1234', { iterations: 1000 });
  const b = await hashPassword('samepass1234', { iterations: 1000 });
  assert.notEqual(a, b);
  assert.equal(await verifyPassword('samepass1234', a), true);
  assert.equal(await verifyPassword('samepass1234', b), true);
});

// ---------- 2) token ----------
test('signToken/verifyToken: token ถูกต้องใช้ได้ / แก้ payload / คนละ secret / หมดอายุ ต้องไม่ผ่าน', async () => {
  const secret = 's3cret';
  const now = Date.now();
  const token = await signToken({ username: 'admin', role: 'admin' }, secret, { ttlSeconds: 60, nowMs: now });
  const ok = await verifyToken(token, secret, { nowMs: now + 1000 });
  assert.equal(ok.username, 'admin');
  assert.equal(ok.role, 'admin');

  const [v, , sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ username: 'attacker', role: 'admin', exp: 9999999999 })).toString('base64url');
  assert.equal(await verifyToken(`${v}.${forged}.${sig}`, secret, { nowMs: now }), null);
  assert.equal(await verifyToken(token, 'other-secret', { nowMs: now }), null);
  assert.equal(await verifyToken(token, secret, { nowMs: now + 61 * 1000 }), null);
  assert.equal(await verifyToken('garbage', secret, { nowMs: now }), null);
});


// ---------- 3) masking (หัวใจของเรื่องนี้) ----------
test('toPublicPayload: ไม่มีเลขบัตรประชาชนและชื่อจริงเหลืออยู่ใน payload สาธารณะเลย', () => {
  const payload = {
    patients: [patient(), patient({ pid: '454130', cid: '9876543210987', name: 'สมหญิง', lname: 'รักดี', ampur: '02' })],
    population: { 2568: { '01': { name: 'เมืองมุกดาหาร', pop15_60: 1000, deceased: 0 } } },
    settings: { smi_prevalence_pct: 4.37, current_fiscal_year_be: 2568 },
    publishedAt: '2026-09-29T00:00:00.000Z',
  };
  const masked = toPublicPayload(payload);
  const text = JSON.stringify(masked);
  assert.ok(!text.includes('1234567890123'), 'ต้องไม่มี cid เต็มในข้อมูลสาธารณะ');
  assert.ok(!text.includes('9876543210987'));
  assert.ok(!/\d{13}/.test(text), 'ต้องไม่มีตัวเลข 13 หลักโผล่ในไฟล์สาธารณะ');
  assert.ok(!text.includes('สมชาย') && !text.includes('ใจดี') && !text.includes('สมหญิง') && !text.includes('รักดี'));
  assert.equal(masked.patients[0].name, 'ส***');
  assert.equal(masked.patients[0].lname, 'ใ***');
  assert.equal('cid' in masked.patients[0], false);
  assert.equal(masked.patients[0].pid, '203392');
  assert.equal(masked.patients[0].has_repeat_violence, false);
  assert.equal(masked.patients[1].ampur, '02');
  assert.deepEqual(masked.population, payload.population);
  assert.deepEqual(masked.settings, payload.settings);
  assert.equal(masked.publishedAt, payload.publishedAt);
});

test('toPublicPayload: ฟิลด์ใหม่ที่ไม่อยู่ใน allowlist ต้องไม่ถูกเผยแพร่ (กันหลุดโดยไม่ตั้งใจ)', () => {
  const masked = toPublicPayload({ patients: [patient({ phone: '0812345678', address: '123 หมู่ 4', note: 'ความลับ' })], publishedAt: 'x' });
  const text = JSON.stringify(masked);
  assert.ok(!text.includes('0812345678'));
  assert.ok(!text.includes('123 หมู่ 4'));
  assert.ok(!text.includes('ความลับ'));
});

// ---------- 4) validate payload ----------
test('validatePublishPayload: ตรวจโครงสร้าง/เพดานจำนวน/เพดานขนาด', () => {
  const good = { patients: [patient()], publishedAt: '2026-09-29T00:00:00.000Z' };
  assert.equal(validatePublishPayload(good).ok, true);
  assert.equal(validatePublishPayload(null).ok, false);
  assert.equal(validatePublishPayload({ publishedAt: 'x' }).ok, false);
  assert.equal(validatePublishPayload({ patients: [] }).ok, false);
  assert.equal(validatePublishPayload({ patients: [], publishedAt: 'x' }).ok, true);
  assert.equal(validatePublishPayload({ patients: [{ hoscode: 'H', fiscal_year_be: 1 }], publishedAt: 'x' }).ok, false);
  assert.equal(validatePublishPayload({ patients: [{ hoscode: 'H', pid: 'P', fiscal_year_be: 'nope' }], publishedAt: 'x' }).ok, false);
  const many = { patients: Array.from({ length: MAX_PATIENTS + 1 }, () => patient()), publishedAt: 'x' };
  assert.equal(validatePublishPayload(many, { maxBytes: Infinity }).ok, false);
  assert.equal(validatePublishPayload(good, { maxBytes: 10 }).ok, false);
});

// ---------- 5) จำกัดขอบเขตตามสิทธิ์ ----------
test('scopePatientsForUser: admin เห็นทั้งหมด · ผู้ใช้มี ampur เห็นเฉพาะอำเภอนั้น · ไม่มีสิทธิ์เห็นศูนย์', () => {
  const patients = [patient({ ampur: '01' }), patient({ pid: '2', ampur: '02' }), patient({ pid: '3', ampur: '01' })];
  assert.equal(scopePatientsForUser(patients, { role: 'admin', ampur: null }).length, 3);
  assert.equal(scopePatientsForUser(patients, { role: 'viewer', ampur: '01' }).length, 2);
  assert.equal(scopePatientsForUser(patients, { role: 'viewer', ampur: '07' }).length, 0);
  assert.equal(scopePatientsForUser(patients, { role: 'viewer', ampur: null }).length, 0);
  assert.equal(scopePatientsForUser(patients, null).length, 0);
});

test('sanitizeUser: admin ถูกล้าง ampur เสมอ (ไม่ถูกจำกัดพื้นที่) และ role แปลกๆ ถือเป็น viewer', () => {
  assert.deepEqual(sanitizeUser({ username: 'a', role: 'admin', ampur: '01', display_name: 'A' }), { username: 'a', displayName: 'A', role: 'admin', ampur: null });
  assert.equal(sanitizeUser({ username: 'b', role: 'hacker' }).role, 'viewer');
  assert.equal(sanitizeUser(null), null);
});

// ---------- 6) throttle + storage ----------
test('createLoginThrottle: ผิดครบ 5 ครั้งล็อก แล้วปลดล็อกเมื่อ reset', async () => {
  const throttle = createLoginThrottle(makeKv());
  for (let i = 1; i <= 4; i++) assert.equal((await throttle.fail('k')).locked, false);
  assert.equal((await throttle.fail('k')).locked, true);
  assert.ok((await throttle.status('k')).retryAfterSeconds > 0, 'ต้องมีเวลารอก่อนลองใหม่');
  await throttle.reset('k');
  assert.equal((await throttle.status('k')).retryAfterSeconds, 0);
});

test('storageFor: เลือก R2 ก่อน KV และคืน null เมื่อยังไม่ได้ผูก binding', () => {
  assert.equal(storageFor({}), null);
  assert.equal(storageFor({ PII_KV: {} }).kind, 'kv');
  assert.equal(storageFor({ PII_KV: {}, PII_BUCKET: {} }).kind, 'r2');
});

// ---------- 7) ยิง endpoint จริงผ่าน fetch handler (fetchImpl ปลอม ไม่ต่อเน็ต) ----------
test('GET /health: เปิดเผยแค่สถานะการตั้งค่า ไม่มีความลับ', async () => {
  const handler = createWorkerHandler();
  const env = await envWithPasswords();
  const res = await handler.fetch(req('/health', { method: 'GET', body: undefined }), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.piiStorage, 'kv');
  assert.equal(body.github, true);
  assert.equal(body.auth, true);
  assert.ok(!JSON.stringify(body).includes('session-secret-test'));
});

test('POST /login: รหัสถูกต้องได้ token + role/ampur, รหัสผิดได้ 401 และผิดครบ 5 ครั้งได้ 429', async () => {
  const handler = createWorkerHandler();
  const env = await envWithPasswords();

  const ok = await loginAs(handler, env, 'muk01', 'muk01-pass-1234');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.role, 'viewer');
  assert.equal(ok.body.user.ampur, '01');
  const payload = await verifyToken(ok.body.token, env.SESSION_SECRET);
  assert.equal(payload.username, 'muk01');

  const wrong = await loginAs(handler, env, 'muk01', 'not-the-password');
  assert.equal(wrong.status, 401);

  for (let i = 0; i < 4; i++) await loginAs(handler, env, 'muk01', 'not-the-password');
  const locked = await loginAs(handler, env, 'muk01', 'not-the-password');
  assert.equal(locked.status, 429);
  assert.ok(locked.body.retryAfterSeconds > 0);

  // แม้รหัสถูก ก็ยังถูกล็อกอยู่ (กันการเดารหัสด้วยการยิงถี่)
  const lockedEvenWithCorrect = await loginAs(handler, env, 'muk01', 'muk01-pass-1234');
  assert.equal(lockedEvenWithCorrect.status, 429);
});

test('POST /patient-data: ไม่มี token = 401, token ปลอม = 401, admin เห็นข้อมูลจริงพร้อม cid เต็ม', async () => {
  const gh = makeGithubStub();
  const handler = createWorkerHandler({ fetchImpl: gh.fetchImpl });
  const env = await envWithPasswords();
  const payload = { patients: [patient(), patient({ pid: '454130', ampur: '02', cid: '9876543210987' })], population: {}, settings: {}, publishedAt: '2026-09-29T00:00:00.000Z' };

  const noToken = await handler.fetch(req('/patient-data', { body: {} }), env);
  assert.equal(noToken.status, 401);

  const fakeToken = await handler.fetch(req('/patient-data', { body: {}, token: 'v1.aaa.bbb' }), env);
  assert.equal(fakeToken.status, 401);

  const admin = await loginAs(handler, env, 'admin', 'admin-pass-1234');
  const publish = await handler.fetch(req('/', { body: payload, token: admin.body.token, siteKey: 'site-key-test' }), env);
  assert.equal(publish.status, 200, JSON.stringify(await publish.clone().json()));

  const full = await handler.fetch(req('/patient-data', { body: {}, token: admin.body.token }), env);
  assert.equal(full.status, 200);
  const fullBody = await full.json();
  assert.equal(fullBody.patients.length, 2);
  assert.equal(fullBody.patients[0].cid, '1234567890123', 'ข้อมูลจริงต้องมี cid เต็มสำหรับใช้ติดตาม');
  assert.equal(fullBody.patients[0].name, 'สมชาย');
  assert.equal(fullBody.scope.role, 'admin');
  assert.equal(fullBody.scope.patientCount, 2);
  assert.equal(full.headers.get('Cache-Control'), 'no-store');
});

test('POST /patient-data: ผู้ใช้ที่ถูกจำกัดอำเภอ เห็นเฉพาะผู้ป่วยอำเภอของตัวเอง', async () => {
  const gh = makeGithubStub();
  const handler = createWorkerHandler({ fetchImpl: gh.fetchImpl });
  const env = await envWithPasswords();
  const admin = await loginAs(handler, env, 'admin', 'admin-pass-1234');
  const payload = { patients: [patient({ ampur: '01' }), patient({ pid: '454130', ampur: '02' })], population: {}, settings: {}, publishedAt: '2026-09-29T00:00:00.000Z' };
  await handler.fetch(req('/', { body: payload, token: admin.body.token, siteKey: 'site-key-test' }), env);
  const staff = await loginAs(handler, env, 'muk01', 'muk01-pass-1234');
  const res = await handler.fetch(req('/patient-data', { body: {}, token: staff.body.token }), env);
  const body = await res.json();
  assert.equal(body.patients.length, 1, 'ผู้ใช้ที่จำกัดอำเภอต้องเห็นเฉพาะอำเภอตัวเอง');
  assert.equal(body.patients[0].ampur, '01');
  assert.equal(body.patients[0].cid, '1234567890123', 'ต้องเห็นเลขบัตรประชาชนเต็มเพื่อใช้ติดตาม');
  assert.equal(body.scope.totalCount, 2, 'ต้องบอกว่ามีทั้งหมดกี่คนเพื่อให้รู้ว่าถูกจำกัดสิทธิ์อยู่');
});


test('publish: เขียนขึ้น GitHub เฉพาะข้อมูลที่ปิดบังแล้ว (ไม่มี cid/ชื่อจริง) แต่เก็บข้อมูลเต็มไว้ในพื้นที่ส่วนตัว', async () => {
  const gh = makeGithubStub();
  const handler = createWorkerHandler({ fetchImpl: gh.fetchImpl });
  const env = await envWithPasswords();
  const admin = await loginAs(handler, env, 'admin', 'admin-pass-1234');
  const payload = {
    patients: [patient(), patient({ pid: '454130', ampur: '02', cid: '9876543210987', name: 'สมหญิง', lname: 'รักดี' })],
    population: { 2568: { '01': { name: 'เมืองมุกดาหาร', pop15_60: 236984, deceased: 3 } } },
    settings: { current_fiscal_year_be: 2568 },
    publishedAt: '2026-09-29T00:00:00.000Z',
  };
  const res = await handler.fetch(req('/', { body: payload, token: admin.body.token, siteKey: 'site-key-test' }), env);
  assert.equal(res.status, 200);
  const result = await res.json();
  assert.equal(result.patientCount, 2);

  const published = gh.files.get('docs/data.json');
  assert.ok(published, 'ต้องเขียน docs/data.json');
  assert.ok(!published.includes('1234567890123'), 'ห้ามมี cid เต็มในไฟล์ที่ขึ้น GitHub');
  assert.ok(!published.includes('9876543210987'));
  assert.ok(!/\d{13}/.test(published), 'ห้ามมีเลข 13 หลักในไฟล์ที่ขึ้น GitHub');
  assert.ok(!published.includes('สมชาย') && !published.includes('ใจดี'));
  assert.ok(published.includes('ส***'), 'ชื่อต้องถูกปิดบัง');
  assert.ok(published.includes('236984'), 'ข้อมูลประชากร (ไม่ใช่ข้อมูลรายบุคคล) ต้องยังอยู่ครบ');
  assert.ok(gh.files.has('docs/history/index.json'));
  assert.ok(gh.files.has('docs/history/2026-09-29T00-00-00-000Z.json'), 'ต้องเก็บสำเนาประวัติข้อมูลที่ปิดบังแล้ว');

  const privateCopy = JSON.parse(env._kv._map.get(PII_CURRENT_KEY));
  assert.equal(privateCopy.patients[0].cid, '1234567890123', 'ข้อมูลเต็มต้องถูกเก็บไว้ในพื้นที่ส่วนตัว');
  assert.equal(privateCopy.patients[0].name, 'สมชาย');
  assert.ok(env._kv._map.has(`${PII_HISTORY_PREFIX}2026-09-29T00-00-00-000Z.json`));
});

test('publish: ต้องเป็น admin + ต้องมี site key + payload ต้องผ่านการตรวจ', async () => {
  const gh = makeGithubStub();
  const handler = createWorkerHandler({ fetchImpl: gh.fetchImpl });
  const env = await envWithPasswords();
  const payload = { patients: [patient()], population: {}, settings: {}, publishedAt: '2026-09-29T00:00:00.000Z' };

  // ไม่มี token
  assert.equal((await handler.fetch(req('/', { body: payload, siteKey: 'site-key-test' }), env)).status, 401);
  // site key ผิด
  const admin = await loginAs(handler, env, 'admin', 'admin-pass-1234');
  assert.equal((await handler.fetch(req('/', { body: payload, token: admin.body.token, siteKey: 'wrong' }), env)).status, 401);
  // viewer เผยแพร่ไม่ได้ (403)
  const staff = await loginAs(handler, env, 'muk01', 'muk01-pass-1234');
  assert.equal((await handler.fetch(req('/', { body: payload, token: staff.body.token, siteKey: 'site-key-test' }), env)).status, 403);
  // payload ผิดโครงสร้าง
  const bad = await handler.fetch(req('/', { body: { patients: 'nope', publishedAt: 'x' }, token: admin.body.token, siteKey: 'site-key-test' }), env);
  assert.equal(bad.status, 400);
  // payload ใหญ่เกินเพดาน
  const huge = await handler.fetch(req('/', { body: 'x'.repeat(9 * 1024 * 1024), token: admin.body.token, siteKey: 'site-key-test' }), env);
  assert.equal(huge.status, 413);
  // ไม่มีไฟล์ถูกเขียนเลยเมื่อทุกอย่างล้มเหลว
  assert.equal(gh.files.size, 0);
});

test('publish: ยังไม่ตั้งค่าพื้นที่เก็บข้อมูลส่วนตัว → ปฏิเสธพร้อมข้อความบอกวิธีแก้ (ไม่เขียนขึ้น GitHub)', async () => {
  const gh = makeGithubStub();
  const handler = createWorkerHandler({ fetchImpl: gh.fetchImpl });
  const env = await envWithPasswords({ admin: 'admin-pass-1234' }, { PII_KV: undefined });
  const admin = await loginAs(handler, env, 'admin', 'admin-pass-1234');
  const res = await handler.fetch(req('/', { body: { patients: [patient()], population: {}, settings: {}, publishedAt: 'x' }, token: admin.body.token, siteKey: 'site-key-test' }), env);
  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /worker\/README\.md/);
  assert.equal(gh.files.size, 0, 'ต้องไม่เขียนข้อมูลขึ้น GitHub ถ้าเก็บข้อมูลเต็มไม่ได้');
});

test('full_history/restore_full_history: admin ดูรายการประวัติข้อมูลจริงได้ และกู้คืนได้ (ผู้ใช้อื่นโดน 403)', async () => {
  const gh = makeGithubStub();
  const handler = createWorkerHandler({ fetchImpl: gh.fetchImpl });
  const env = await envWithPasswords();
  const admin = await loginAs(handler, env, 'admin', 'admin-pass-1234');
  const first = { patients: [patient({ name: 'สมชาย' })], population: {}, settings: {}, publishedAt: '2026-09-01T00:00:00.000Z' };
  const second = { patients: [patient({ pid: '999', name: 'สมปอง', cid: '1111111111111' })], population: {}, settings: {}, publishedAt: '2026-09-02T00:00:00.000Z' };
  await handler.fetch(req('/', { body: first, token: admin.body.token, siteKey: 'site-key-test' }), env);
  await handler.fetch(req('/', { body: second, token: admin.body.token, siteKey: 'site-key-test' }), env);

  const list = await handler.fetch(req('/', { body: { action: 'full_history' }, token: admin.body.token }), env);
  const items = (await list.json()).items;
  assert.equal(items.length, 2);
  assert.ok(items[0].file.startsWith(PII_HISTORY_PREFIX));

  const staff = await loginAs(handler, env, 'muk01', 'muk01-pass-1234');
  assert.equal((await handler.fetch(req('/', { body: { action: 'full_history' }, token: staff.body.token }), env)).status, 403);

  const restore = await handler.fetch(req('/', { body: { action: 'restore_full_history', file: items[0].file }, token: admin.body.token }), env);
  assert.equal(restore.status, 200);
  const restored = JSON.parse(env._kv._map.get(PII_CURRENT_KEY));
  assert.equal(restored.patients[0].name, 'สมชาย', 'ต้องกู้คืนข้อมูลเต็มจาก snapshot เก่า');
  const githubNow = gh.files.get('docs/data.json');
  assert.ok(!githubNow.includes('สมชาย'), 'ไฟล์สาธารณะหลังกู้คืนต้องยังปิดบังชื่ออยู่');
  assert.ok(!/\d{13}/.test(githubNow));
});

test('CORS: preflight อนุญาต Authorization และไม่สะท้อน origin ที่ไม่อยู่ใน allowlist', async () => {
  const handler = createWorkerHandler();
  const env = await envWithPasswords();
  const okOrigin = await handler.fetch(new Request('https://smiv.test/login', { method: 'OPTIONS', headers: { Origin: 'https://thering999.github.io' } }), env);
  assert.equal(okOrigin.status, 204);
  assert.equal(okOrigin.headers.get('Access-Control-Allow-Origin'), 'https://thering999.github.io');
  assert.match(okOrigin.headers.get('Access-Control-Allow-Headers'), /Authorization/);

  const badOrigin = await handler.fetch(new Request('https://smiv.test/login', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' }), env);
  assert.notEqual(badOrigin.headers.get('Access-Control-Allow-Origin'), 'https://evil.example');
});

test('route แปลกๆ ต้องได้ 404 ไม่ใช่ 500', async () => {
  const handler = createWorkerHandler();
  const env = await envWithPasswords();
  const res = await handler.fetch(req('/unknown', { body: {} }), env);
  assert.equal(res.status, 404);
});


test('delete_history: admin ลบได้ (ลบทั้ง index และไฟล์ snapshot) · viewer โดน 403 · path นอก docs/history โดน 400', async () => {
  const gh = makeGithubStub();
  const handler = createWorkerHandler({ fetchImpl: gh.fetchImpl });
  const env = await envWithPasswords();
  const admin = await loginAs(handler, env, 'admin', 'admin-pass-1234');
  await handler.fetch(req('/', { body: { patients: [patient()], population: {}, settings: {}, publishedAt: '2026-09-29T00:00:00.000Z' }, token: admin.body.token, siteKey: 'site-key-test' }), env);
  assert.ok(gh.files.has('docs/history/2026-09-29T00-00-00-000Z.json'));

  const staff = await loginAs(handler, env, 'muk01', 'muk01-pass-1234');
  assert.equal((await handler.fetch(req('/', { body: { action: 'delete_history', file: 'docs/history/2026-09-29T00-00-00-000Z.json' }, token: staff.body.token }), env)).status, 403);

  const badPath = await handler.fetch(req('/', { body: { action: 'delete_history', file: 'docs/data.json' }, token: admin.body.token }), env);
  assert.equal(badPath.status, 400);

  const del = await handler.fetch(req('/', { body: { action: 'delete_history', file: 'docs/history/2026-09-29T00-00-00-000Z.json' }, token: admin.body.token }), env);
  assert.equal(del.status, 200);
  assert.equal(gh.files.has('docs/history/2026-09-29T00-00-00-000Z.json'), false);
  assert.deepEqual(JSON.parse(gh.files.get('docs/history/index.json')), []);
});



// ---------- Audit log ----------
test('audit: login/patient-data ถูกบันทึก ไม่มี cid/ชื่อจริงใน log, admin อ่านได้ viewer อ่านไม่ได้', async () => {
  const env = await envWithPasswords();
  const handler = createWorkerHandler();
  await env._kv.put(PII_CURRENT_KEY, JSON.stringify({ patients: [patient(), patient({ cid: '9999999999999', ampur: '02' })] }));

  await loginAs(handler, env, 'muk01', 'wrong-password');
  const viewer = await loginAs(handler, env, 'muk01', 'muk01-pass-1234');
  const pd = await handler.fetch(req('/patient-data', { token: viewer.body.token }), env);
  assert.equal(pd.status, 200);

  const raw = [...env._kv._map.entries()].filter(([k]) => k.startsWith(AUDIT_PREFIX)).map(([, v]) => String(v)).join('\n');
  assert.ok(!raw.includes('1234567890123') && !raw.includes('สมชาย'), 'audit ต้องไม่มี PII ผู้ป่วย');

  const denied = await handler.fetch(req('/audit', { method: 'GET', token: viewer.body.token }), env);
  assert.equal(denied.status, 403);

  const admin = await loginAs(handler, env, 'admin', 'admin-pass-1234');
  const res = await handler.fetch(req('/audit?days=1', { method: 'GET', token: admin.body.token }), env);
  assert.equal(res.status, 200);
  const { items } = await res.json();
  const actions = items.map(i => `${i.action}:${i.username}:${i.ok}`);
  assert.ok(actions.includes('login:muk01:false'));
  assert.ok(actions.includes('login:muk01:true'));
  const access = items.find(i => i.action === 'patient-data');
  assert.equal(access.count, 1);
  assert.equal(access.ampur, '01');

  const anon = await handler.fetch(req('/audit', { method: 'GET' }), env);
  assert.equal(anon.status, 401);
});

test('readAudit: จำกัดจำนวนวันและจำนวนรายการ เรียงใหม่สุดก่อน', async () => {
  const kv = makeKv();
  const storage = { kind: 'kv', binding: kv };
  const now = Date.parse('2026-10-08T12:00:00Z');
  for (let i = 0; i < 5; i++) await writeAudit(storage, { action: 'x', count: i }, now - i * 1000);
  await writeAudit(storage, { action: 'old' }, now - 40 * 86400000);
  const items = await readAudit(storage, { days: 999, nowMs: now, limit: 3 });
  assert.deepEqual(items.map(i => i.count), [0, 1, 2]);
  assert.equal((await readAudit(storage, { days: 999, nowMs: now })).some(i => i.action === 'old'), false);
});

test('requireUser: ลบผู้ใช้/เปลี่ยนอำเภอใน AUTH_USERS มีผลทันทีกับ token เดิม', async () => {
  const env = await envWithPasswords();
  const handler = createWorkerHandler();
  await env._kv.put(PII_CURRENT_KEY, JSON.stringify({ patients: [patient(), patient({ cid: '9999999999999', ampur: '02' })] }));
  const viewer = await loginAs(handler, env, 'muk01', 'muk01-pass-1234');
  const fetchPd = async () => handler.fetch(req('/patient-data', { token: viewer.body.token }), env);

  const users = JSON.parse(env.AUTH_USERS);
  users.find(u => u.username === 'muk01').ampur = '02';
  env.AUTH_USERS = JSON.stringify(users);
  const moved = await (await fetchPd()).json();
  assert.deepEqual(moved.patients.map(p => p.ampur), ['02']);

  env.AUTH_USERS = JSON.stringify(users.filter(u => u.username !== 'muk01'));
  assert.equal((await fetchPd()).status, 401);
});


// ---------- การติดตามผู้ป่วย ----------
async function followupSetup() {
  const env = await envWithPasswords();
  const handler = createWorkerHandler();
  await env._kv.put(PII_CURRENT_KEY, JSON.stringify({ patients: [
    patient({ hoscode: '10712', pid: '1', ampur: '01' }),
    patient({ hoscode: '10712', pid: '2', ampur: '02', cid: '9999999999999' }),
  ] }));
  const viewer = (await loginAs(handler, env, 'muk01', 'muk01-pass-1234')).body.token;
  const admin = (await loginAs(handler, env, 'admin', 'admin-pass-1234')).body.token;
  const add = (token, body) => handler.fetch(req('/followups', { token, body }), env);
  const list = (token, qs = '') => handler.fetch(req(`/followups${qs}`, { method: 'GET', token }), env);
  return { env, add, list, viewer, admin };
}

test('followup: viewer บันทึก/อ่านได้เฉพาะอำเภอตัวเอง, ampur มาจาก server ไม่ใช่ client', async () => {
  const { env, add, list, viewer, admin } = await followupSetup();
  const ok = await add(viewer, { hoscode: '10712', pid: '1', status: 'visited', note: 'เยี่ยมบ้าน', nextDate: '2026-11-01', ampur: '99' });
  assert.equal(ok.status, 200);
  assert.ok(env._kv._map.has('followup/01/10712-1'), 'key ต้องใช้อำเภอจากข้อมูล server');

  const cross = await add(viewer, { hoscode: '10712', pid: '2', status: 'visited' });
  assert.equal(cross.status, 403);
  assert.equal((await add(viewer, { hoscode: '10712', pid: '404', status: 'visited' })).status, 404);
  assert.equal((await add(admin, { hoscode: '10712', pid: '2', status: 'phone' })).status, 200);

  const mine = await (await list(viewer)).json();
  assert.deepEqual(mine.items.map(i => i.pid), ['1']);
  assert.equal(mine.items[0].nextDate, '2026-11-01');
  assert.equal(mine.items[0].lastBy, 'muk01');
  const all = await (await list(admin)).json();
  assert.equal(all.items.length, 2);

  const detailOther = await (await list(viewer, '?hoscode=10712&pid=2')).json();
  assert.deepEqual(detailOther.entries, [], 'viewer ห้ามอ่านประวัติคนต่างอำเภอ');
  const detail = await (await list(viewer, '?hoscode=10712&pid=1')).json();
  assert.equal(detail.entries[0].note, 'เยี่ยมบ้าน');

  assert.equal((await list(undefined)).status, 401);
  assert.equal((await add(undefined, { hoscode: '10712', pid: '1', status: 'visited' })).status, 401);
});

test('validateFollowupInput: ปฏิเสธ status/วันที่/id/บันทึกที่ไม่ถูกต้อง', () => {
  const now = Date.parse('2026-10-08T00:00:00Z');
  const base = { hoscode: '10712', pid: '1', status: 'visited' };
  assert.equal(validateFollowupInput(base, { nowMs: now }).ok, true);
  assert.equal(validateFollowupInput({ ...base, status: 'x' }, { nowMs: now }).ok, false);
  assert.equal(validateFollowupInput({ ...base, pid: '../a' }, { nowMs: now }).ok, false);
  assert.equal(validateFollowupInput({ ...base, nextDate: '2026-13-45' }, { nowMs: now }).ok, false);
  assert.equal(validateFollowupInput({ ...base, nextDate: '2030-01-01' }, { nowMs: now }).ok, false);
  assert.equal(validateFollowupInput({ ...base, note: 'x'.repeat(501) }, { nowMs: now }).ok, false);
});


// ---------- แจ้งเกินนัดทาง LINE ----------
test('collectOverdue: นับเฉพาะเลยนัด ไม่ปิดเคส และยังอยู่ในข้อมูลปัจจุบัน', () => {
  const patients = [patient({ pid: '1', ampur: '01' }), patient({ pid: '2', ampur: '01' }), patient({ pid: '3', ampur: '02' })];
  const rec = (pid, ampur, status, nextDate) => ({ hoscode: '10712', pid, ampur, entries: [{ at: 'x', status, nextDate }] });
  const out = collectOverdue([
    rec('1', '01', 'visited', '2026-10-01'),
    rec('2', '01', 'closed', '2026-10-01'),
    rec('3', '02', 'visited', '2026-10-08'),
    rec('9', '01', 'visited', '2026-10-01'),
  ], patients, '2026-10-08');
  assert.deepEqual(Object.keys(out), ['01']);
  assert.equal(out['01'].total, 1);
});

test('notify-overdue + cron: ส่ง LINE ต่ออำเภอ/จังหวัด ข้อความไม่มี PII, admin เท่านั้น', async () => {
  const lineCalls = [];
  const fetchImpl = async (url, init) => { lineCalls.push({ url: String(url), body: JSON.parse(init.body), auth: init.headers.Authorization }); return { ok: true, status: 200, json: async () => ({}) }; };
  const env = await envWithPasswords({ admin: 'admin-pass-1234', muk01: 'muk01-pass-1234' }, {
    LINE_CHANNEL_TOKEN: 'line-token', LINE_TARGETS: JSON.stringify({ '01': 'Cgroup01', '*': 'Cprov' }),
  });
  const handler = createWorkerHandler({ fetchImpl, nowMs: () => Date.parse('2026-10-08T02:00:00Z') });
  await env._kv.put(PII_CURRENT_KEY, JSON.stringify({ patients: [patient({ pid: '1', ampur: '01' })] }));
  await env._kv.put('followup/01/10712-1', JSON.stringify({ hoscode: '10712', pid: '1', ampur: '01', entries: [{ at: 'x', status: 'visited', nextDate: '2026-10-01' }] }));

  const viewer = (await loginAs(handler, env, 'muk01', 'muk01-pass-1234')).body.token;
  assert.equal((await handler.fetch(req('/notify-overdue', { token: viewer, body: {} }), env)).status, 403);

  const admin = (await loginAs(handler, env, 'admin', 'admin-pass-1234')).body.token;
  const dry = await (await handler.fetch(req('/notify-overdue', { token: admin, body: {} }), env)).json();
  assert.equal(dry.dryRun, true);
  assert.deepEqual(dry.summary, { '01': 1 });
  assert.ok(!JSON.stringify(dry).includes('Cgroup01'), 'ไม่คืน groupId ให้ client');
  assert.equal(lineCalls.length, 0);

  await handler.scheduled({}, env, null);
  assert.deepEqual(lineCalls.map(c => c.body.to).sort(), ['Cgroup01', 'Cprov']);
  assert.equal(lineCalls[0].auth, 'Bearer line-token');
  const text = lineCalls.map(c => c.body.messages[0].text).join('\n');
  assert.ok(text.includes('เกินวันนัดติดตาม 1 คน'));
  assert.ok(!text.includes('1234567890123') && !text.includes('สมชาย') && !text.includes('ใจดี'), 'LINE ต้องไม่มี PII');
});

test('toPublicPatient: วันเกิดสาธารณะเหลือแค่ปี', () => {
  const out = toPublicPayload({ patients: [patient({ birth: '1988-04-09' })] }).patients[0];
  assert.equal(out.birth, '1988');
  assert.equal('cid' in out, false);
});

test('validatePublishPayload: ปฏิเสธข้อมูลที่ปิดบังแล้ว (กันเผยแพร่ data.json สาธารณะทับข้อมูลจริง)', () => {
  const at = '2026-10-08T00:00:00Z';
  const masked = toPublicPayload({ patients: [patient(), patient({ pid: '2' })] });
  assert.equal(validatePublishPayload({ ...masked, publishedAt: at }).ok, false);
  assert.equal(validatePublishPayload({ patients: [patient(), patient({ pid: '2' })], publishedAt: at }).ok, true);
});

test('validatePublishPayload: ไฟล์ HDC ที่ปิดบังมาบางส่วน (cid มี ****, ชื่อยาว) ยังเผยแพร่ได้', () => {
  const hdc = [patient({ cid: '123456789****', name: 'สมเ***', lname: 'บุปผ*****' }), patient({ pid: '2', cid: '987654321****', name: 'วิ***', lname: 'รัตนะ*****' })];
  assert.equal(validatePublishPayload({ patients: hdc, publishedAt: '2026-10-08T00:00:00Z' }).ok, true);
});

test('scopePatientsForUser: viewer อำเภอ 01 ไม่เห็นผู้ป่วยอำเภอ 01 ของจังหวัดอื่น', () => {
  const list = [patient({ pid: '1', chw_addr: '49', ampur: '01' }), patient({ pid: '2', chw_addr: '34', ampur: '01' })];
  assert.deepEqual(scopePatientsForUser(list, { role: 'viewer', ampur: '01' }).map(p => p.pid), ['1']);
  assert.equal(scopePatientsForUser(list, { role: 'admin', ampur: null }).length, 2);
});

test('followup: ผู้ป่วยนอกจังหวัดเก็บแยกถัง ไม่โผล่ในรายการของ viewer อำเภอรหัสเดียวกัน', async () => {
  const env = await envWithPasswords();
  const handler = createWorkerHandler();
  await env._kv.put(PII_CURRENT_KEY, JSON.stringify({ patients: [patient({ pid: '7', chw_addr: '34', ampur: '01' })] }));
  const admin = (await loginAs(handler, env, 'admin', 'admin-pass-1234')).body.token;
  const viewer = (await loginAs(handler, env, 'muk01', 'muk01-pass-1234')).body.token;
  assert.equal((await handler.fetch(req('/followups', { token: admin, body: { hoscode: '10712', pid: '7', status: 'phone' } }), env)).status, 200);
  assert.ok(env._kv._map.has('followup/out34/10712-7'));
  assert.equal((await handler.fetch(req('/followups', { token: viewer, body: { hoscode: '10712', pid: '7', status: 'phone' } }), env)).status, 403);
  const list = await (await handler.fetch(req('/followups', { method: 'GET', token: viewer }), env)).json();
  assert.equal(list.items.length, 0);
});

test('followup ?full=1: แนบประวัติ (ไม่มี note) และยังจำกัดตามอำเภอ', async () => {
  const { add, list, viewer, admin } = await followupSetup();
  await add(viewer, { hoscode: '10712', pid: '1', status: 'visited', note: 'ข้อความลับ' });
  await add(admin, { hoscode: '10712', pid: '2', status: 'phone' });
  const mine = await (await list(viewer, '?full=1')).json();
  assert.equal(mine.items.length, 1);
  assert.equal(mine.items[0].entries.length, 1);
  assert.equal(mine.items[0].entries[0].note, undefined);
  assert.equal((await (await list(admin, '?full=1')).json()).items.length, 2);
});
