/*
 * Integration test: ต่อ "โค้ดฝั่งเว็บจริง" (docs/ui.js ใน vm sandbox) เข้ากับ "Worker จริง" (worker/lib.mjs)
 * ผ่าน fetch handler ตัวจริง — พิสูจน์ว่าสัญญา (contract) สองฝั่งตรงกันตลอด flow:
 *   ล็อกอิน → ได้ข้อมูลผู้ป่วยตัวจริง (cid เต็ม) → เผยแพร่ → GitHub ได้เฉพาะสำเนาที่ปิดบังแล้ว → ออกจากระบบ → กลับโหมดสาธารณะ
 * ไม่ต่อเน็ตจริง: GitHub API ถูกแทนด้วย fetchImpl ปลอม, data.json ของ Pages ถูกแทนด้วย canned response
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createWorkerHandler, hashPassword, PII_CURRENT_KEY } from '../worker/lib.mjs';

const require = createRequire(import.meta.url);
const { loadUi } = require('./load-ui.js');

// อ่าน SITE_KEY ที่ client ใช้จริงจาก docs/ui.js (ไม่ hardcode ซ้ำ — ถ้าใครเปลี่ยนที่ client แล้วลืมตั้ง secret Worker จะเห็นได้จากเทสต์นี้)
const CLIENT_SITE_KEY = (() => {
  const src = require('node:fs').readFileSync(new URL('../docs/ui.js', import.meta.url), 'utf8');
  const m = /PUBLISH_SITE_KEY = '([^']+)'/.exec(src);
  if (!m) throw new Error('อ่าน PUBLISH_SITE_KEY จาก docs/ui.js ไม่ได้');
  return m[1];
})();

function makeKv() {
  const map = new Map();
  return {
    _map: map,
    async get(k) { return map.has(k) ? map.get(k) : null; },
    async put(k, v) { map.set(k, v); },
    async delete(k) { map.delete(k); },
    async list() { return { keys: [...map.keys()].map(name => ({ name })), list_complete: true }; },
  };
}

function makeGithubStub() {
  const files = new Map();
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    const path = String(url).replace(/^.*\/contents\//, '');
    if (method === 'GET') {
      if (!files.has(path)) return { status: 404, ok: false, json: async () => ({}), text: async () => 'nf' };
      return { status: 200, ok: true, text: async () => '', json: async () => ({ sha: `sha:${path}`, content: Buffer.from(files.get(path), 'utf8').toString('base64') }) };
    }
    if (method === 'PUT') {
      files.set(path, Buffer.from(JSON.parse(init.body).content.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
      return { status: 200, ok: true, json: async () => ({}), text: async () => '' };
    }
    files.delete(path);
    return { status: 200, ok: true, json: async () => ({}), text: async () => '' };
  };
  return { fetchImpl, files };
}

async function makeEnv() {
  const kv = makeKv();
  const users = [
    { username: 'admin', password_hash: await hashPassword('admin-pass-1234', { iterations: 1000 }), role: 'admin', ampur: null, display_name: 'ผู้ดูแลระบบ' },
  ];
  return {
    GH_TOKEN: 'gh', SESSION_SECRET: 'secret', SITE_KEY: CLIENT_SITE_KEY, AUTH_USERS: JSON.stringify(users),
    PII_KV: kv, LOGIN_KV: kv, _kv: kv,
  };
}

const PUBLIC_JSON = {
  patients: [{
    hoscode: '10712', hosname: 'โรงพยาบาลมุกดาหาร', pid: '203392', name: 'ส***', lname: 'ใ***', birth: '1988-04-09',
    sex: 1, chw_addr: '49', tambon: '05', ampur: '01', first_date_serv: '2025-01-23', date_serv_raw: '2025-01-23',
    diagcode_raw: 'F29', b03x_raw: '1B031', follow_last: null, fiscal_year_be: 2568, smiv_code_count: 1,
    has_repeat_violence: false, age_at_fy_end: 37, total_visits: 1,
  }],
  population: {}, settings: { smi_prevalence_pct: 4.37, smiv_ratio_pct: 11.92, max_age_included: 60, current_fiscal_year_be: 2568 },
  publishedAt: '2026-09-01T00:00:00.000Z',
};

const REAL_PATIENTS = [{
  hoscode: '10712', hosname: 'โรงพยาบาลมุกดาหาร', pid: '203392', cid: '1480500106171', name: 'สมชาย', lname: 'ใจดี',
  birth: '1988-04-09', sex: 1, chw_addr: '49', tambon: '05', ampur: '01', first_date_serv: '2025-01-23',
  date_serv_raw: '2025-01-23', diagcode_raw: 'F29', b03x_raw: '1B031', follow_last: null, fiscal_year_be: 2568,
  smiv_code_count: 1, has_repeat_violence: false, age_at_fy_end: 37, total_visits: 1,
}];

// จำลองว่า "เคยมีข้อมูลที่เผยแพร่ไว้แล้ว" (ตามสภาพจริงตอนมีข้อมูลในระบบ) — ยิงผ่าน publish ของ Worker จริง
async function seedPublishedData(handler, env) {
  const loginRes = await handler.fetch(new Request('https://smiv.test/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.7' },
    body: JSON.stringify({ username: 'admin', password: 'admin-pass-1234' }),
  }), env);
  const { token } = await loginRes.json();
  const publishRes = await handler.fetch(new Request('https://smiv.test/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Site-Key': CLIENT_SITE_KEY, Authorization: `Bearer ${token}`, 'CF-Connecting-IP': '198.51.100.7' },
    body: JSON.stringify({ patients: REAL_PATIENTS, population: {}, settings: { current_fiscal_year_be: 2568 }, publishedAt: '2026-09-01T00:00:00.000Z' }),
  }), env);
  if (publishRes.status !== 200) throw new Error('seed ไม่สำเร็จ: ' + publishRes.status);
}

async function makeSandbox() {
  const gh = makeGithubStub();
  const env = await makeEnv();
  const handler = createWorkerHandler({ fetchImpl: gh.fetchImpl });
  const sandbox = loadUi();
  const routes = [];
  sandbox.fetch = async (url, init) => {
    const href = String(url);
    routes.push(href);
    if (href.includes('data.json')) return new Response(JSON.stringify(PUBLIC_JSON), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const res = await handler.fetch(new Request(href, init), env);
    if (!res.ok && process.env.SMIV_DEBUG) {
      const body = await res.clone().text().catch(() => '');
      console.error('[debug] worker ตอบ', res.status, href, body.slice(0, 300));
    }
    return res;
  };
  return { sandbox, handler, env, gh, routes };
}

test('E2E: สาธารณะเห็นแค่ข้อมูลปิดบัง → ล็อกอินได้ข้อมูลจริง → เผยแพร่แล้ว GitHub ได้สำเนาปิดบัง → ออกจากระบบกลับโหมดสาธารณะ', async () => {
  const { sandbox, env, gh, handler, routes } = await makeSandbox();
  await seedPublishedData(handler, env);

  // 1) โหมดสาธารณะ (ยังไม่ล็อกอิน) — เหมือนตอน init() ของหน้าเว็บ
  await sandbox.loadPublished();
  sandbox.renderAuthState();
  sandbox.render();
  assert.equal(sandbox.window.smivEngine.state.patients[0].cid, undefined, 'ข้อมูลสาธารณะต้องไม่มี cid');
  assert.equal(sandbox.elements.get('#authLoginBox').hidden, false, 'ต้องขึ้นการ์ดล็อกอิน');
  assert.equal(sandbox.elements.get('#publishGithubBtn').disabled, true, 'ยังไม่ล็อกอินต้องกดเผยแพร่ไม่ได้');

  // 2) ล็อกอินผ่านฟอร์มจริงของหน้าเว็บ → Worker จริงออก token แลกข้อมูลจริง
  sandbox.document.getElementById('authUsername').value = 'admin';
  sandbox.document.getElementById('authPassword').value = 'admin-pass-1234';
  await sandbox.submitLogin({ preventDefault() {} });
  assert.equal(sandbox.elements.get('#authBanner').hidden, false, 'ต้องสลับไปแบนเนอร์โหมดข้อมูลจริง');
  assert.equal(sandbox.elements.get('#authLoginBox').hidden, true);
  assert.equal(sandbox.window.smivEngine.state.patients[0].cid, '1480500106171', 'โหมดข้อมูลจริงต้องได้ cid เต็ม');
  assert.ok(routes.some(u => u.endsWith('/login')), 'ต้องยิงไปที่ /login');
  assert.ok(routes.some(u => u.endsWith('/patient-data')), 'ต้องยิงไปที่ /patient-data');
  assert.equal(sandbox.elements.get('#publishGithubBtn').disabled, false, 'admin ล็อกอินแล้วกดเผยแพร่ได้');

  // 3) เผยแพร่ (admin) → Worker เก็บข้อมูลจริงไว้ส่วนตัว + เขียน GitHub เฉพาะสำเนาที่ปิดบังแล้ว
  await sandbox.publishToGithub();
  const publishStatus = sandbox.document.getElementById('githubPublishStatus').textContent;
  assert.match(publishStatus, /เผยแพร่สำเร็จ/, `สถานะที่ได้: ${publishStatus}`);
  const published = gh.files.get('docs/data.json');
  assert.ok(published, 'ต้องเขียน docs/data.json');
  assert.ok(!published.includes('1480500106171'), 'ห้ามมีเลขบัตรประชาชนในไฟล์ที่ขึ้น GitHub');
  assert.ok(!/\d{13}/.test(published), 'ห้ามมีตัวเลข 13 หลักในไฟล์ที่ขึ้น GitHub');
  assert.ok(!published.includes('สมชาย') && !published.includes('ใจดี'), 'ห้ามมีชื่อ-สกุลจริงในไฟล์ที่ขึ้น GitHub');
  const stored = JSON.parse(env._kv._map.get(PII_CURRENT_KEY));
  assert.equal(stored.patients[0].cid, '1480500106171', 'ข้อมูลจริงต้องอยู่ในพื้นที่ส่วนตัวของ Worker');

  // 4) ออกจากระบบ → กลับไปเห็นข้อมูลสาธารณะ (ปิดบังแล้ว)
  sandbox.logoutUser();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(sandbox.elements.get('#authLoginBox').hidden, false, 'กลับมาแสดงการ์ดล็อกอิน');
  assert.equal(sandbox.elements.get('#publishGithubBtn').disabled, true, 'ปุ่มเผยแพร่ต้องใช้ไม่ได้เมื่อออกจากระบบ');
  assert.equal(sandbox.window.smivEngine.state.patients[0].cid, undefined, 'ต้องกลับมาใช้ข้อมูลที่ปิดบังแล้ว');
});

test('E2E: รหัสผ่านผิดต้องไม่ได้ข้อมูลจริง และต้องมีข้อความแจ้งเตือน', async () => {
  const { sandbox } = await makeSandbox();
  sandbox.renderAuthState();
  sandbox.document.getElementById('authUsername').value = 'admin';
  sandbox.document.getElementById('authPassword').value = 'wrong-password';
  await sandbox.submitLogin({ preventDefault() {} });
  assert.equal(sandbox.elements.get('#authBanner').hidden, true, 'ต้องยังไม่เข้าสู่ระบบ');
  assert.match(sandbox.elements.get('#authStatus').textContent, /ไม่ถูกต้อง/);
});

