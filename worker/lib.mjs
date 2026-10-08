/*
 * SMI-V Plus — ตรรกะกลางของ Cloudflare Worker (publish proxy + ยืนยันตัวตน + แยกชั้นข้อมูล)
 *
 * หลักการสำคัญ (ตอบโจทย์ "คนที่เข้าได้ข้อมูลจริงไปติดตาม แต่สาธารณะต้องไม่ได้"):
 *   1) ข้อมูลสาธารณะ (docs/data.json บน GitHub Pages) = สรุป/ตัวชี้วัด + รายชื่อที่ปิดบังชื่อ-เลขบัตร
 *      การปิดบังทำที่ Worker (ฝั่งเซิร์ฟเวอร์) เท่านั้น — client ส่งข้อมูลเต็มมา แล้ว Worker เป็นคนตัดทอน
 *      ก่อนเขียนขึ้น GitHub จึงไม่มีทางที่ข้อมูลเต็มจะหลุดขึ้น repo ได้เพราะ client พลาด
 *   2) ข้อมูลเต็ม (cid 13 หลัก + ชื่อ-สกุลจริง) เก็บในพื้นที่ส่วนตัว (R2/KV) อ่านได้เฉพาะผู้ที่ล็อกอิน
 *      ผ่าน /login และถูกจำกัดอำเภอตามสิทธิ์ของผู้ใช้
 *   3) ไฟล์นี้เป็น pure ESM ไม่พึ่ง API ของ Cloudflare ตอน import → เทสต์ใน Node ได้ตรง ๆ
 *      (ดู test/worker.test.mjs: ยิง fetch handler จริงด้วย fetchImpl ปลอม)
 */

export const WORKER_VERSION = '2.0.0';

export const MAX_PATIENTS = 20000;                 // เพดานจำนวนผู้ป่วยต่อครั้งที่เผยแพร่
export const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;  // เพดานขนาด payload กันการยิงขยะเข้า GitHub API
export const TOKEN_TTL_SECONDS = 8 * 60 * 60;      // อายุ token 8 ชั่วโมง (1 วันทำงาน)
export const PBKDF2_ITERATIONS = 100000; // เพดานของ WebCrypto บน Cloudflare Workers (เกินนี้ deriveBits โยน error)
export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_SECONDS = 15 * 60;

export const PII_CURRENT_KEY = 'pii/current.json';
export const PII_HISTORY_PREFIX = 'pii/history/';
export const PII_HISTORY_INDEX_KEY = 'pii/history/index.json';
export const PII_HISTORY_KEEP = 20;

// allowlist ของฟิลด์ที่อนุญาตให้เผยแพร่สาธารณะ — ฟิลด์ที่ไม่อยู่ในลิสต์จะไม่ถูกเขียนขึ้น GitHub เลย
// cid ถูกตัดออกจากข้อมูลสาธารณะทั้งหมด ส่วน name/lname ถูกปิดบัง (ดู toPublicPatient)
export const PUBLIC_PATIENT_FIELDS = [
  'hoscode', 'hosname', 'pid', 'cid', 'name', 'lname', 'birth', 'sex', 'chw_addr', 'tambon', 'ampur',
  'first_date_serv', 'date_serv_raw', 'diagcode_raw', 'b03x_raw', 'follow_last', 'fiscal_year_be',
  'smiv_code_count', 'has_repeat_violence', 'age_at_fy_end', 'total_visits',
];

// ---------- base64url / utf8 ----------
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBinary(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return out;
}

export function utf8ToBytes(str) { return encoder.encode(str); }
export function bytesToUtf8(bytes) { return decoder.decode(bytes); }

export function bytesToB64Url(bytes) {
  return btoa(bytesToBinary(bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64UrlToBytes(str) {
  const padded = String(str).replace(/[-]/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
export function b64UrlEncodeString(str) { return bytesToB64Url(utf8ToBytes(str)); }
export function b64UrlDecodeToString(str) { return bytesToUtf8(b64UrlToBytes(str)); }

// ---------- สุ่มค่า ----------
export function randomBytes(n) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}
export function randomB64Url(n = 24) { return bytesToB64Url(randomBytes(n)); }

// ---------- HMAC-SHA256 (ใช้กับ token เซสชัน) ----------
async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', utf8ToBytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}
async function hmacSign(secret, dataStr) {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, utf8ToBytes(dataStr));
  return bytesToB64Url(new Uint8Array(sig));
}
// เทียบแบบ constant-time (กันการวัดเวลาการเทียบ signature/site key)
export function timingSafeEqualStr(a, b) {
  const ab = utf8ToBytes(String(a));
  const bb = utf8ToBytes(String(b));
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

// ---------- รหัสผ่าน (PBKDF2-SHA256, เก็บเฉพาะ hash+salt) ----------
export async function hashPassword(password, { iterations = PBKDF2_ITERATIONS, salt } = {}) {
  const saltBytes = salt ? b64UrlToBytes(salt) : randomBytes(16);
  const baseKey = await crypto.subtle.importKey('raw', utf8ToBytes(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' }, baseKey, 256
  );
  return `pbkdf2-sha256$${iterations}$${bytesToB64Url(saltBytes)}$${bytesToB64Url(new Uint8Array(bits))}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations < 1000 || iterations > PBKDF2_ITERATIONS) return false;
  const candidate = await hashPassword(password, { iterations, salt: parts[2] });
  return timingSafeEqualStr(candidate.split('$')[3], parts[3]);
}

// ---------- token เซสชัน (payload + HMAC — ตรวจได้โดยไม่ต้องมี KV) ----------
export async function signToken(payload, secret, { ttlSeconds = TOKEN_TTL_SECONDS, nowMs = Date.now() } = {}) {
  const nowSec = Math.floor(nowMs / 1000);
  const body = { ...payload, iat: nowSec, exp: nowSec + ttlSeconds };
  const data = b64UrlEncodeString(JSON.stringify(body));
  const sig = await hmacSign(secret, data);
  return `v1.${data}.${sig}`;
}

export async function verifyToken(token, secret, { nowMs = Date.now() } = {}) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const expected = await hmacSign(secret, parts[1]);
  if (!timingSafeEqualStr(expected, parts[2])) return null;
  let body;
  try { body = JSON.parse(b64UrlDecodeToString(parts[1])); } catch (e) { return null; }
  if (!body || typeof body.exp !== 'number' || body.exp * 1000 <= nowMs) return null;
  return body;
}


// ---------- ปิดบังข้อมูลส่วนบุคคล (ทำฝั่งเซิร์ฟเวอร์เท่านั้น) ----------
export function maskName(value) {
  const s = String(value || '').trim();
  return s ? `${s.slice(0, 1)}***` : '';
}

export function toPublicPatient(patient) {
  const out = {};
  for (const field of PUBLIC_PATIENT_FIELDS) {
    if (field === 'cid') continue; // ไม่เผยแพร่แม้แต่แบบปิดบางส่วน — ผู้ที่ต้องใช้ติดตามดูจากระบบที่ล็อกอิน
    if (field === 'name' || field === 'lname') { out[field] = maskName(patient[field]); continue; }
    // วันเกิดเต็ม + ตำบล + เพศ ระบุตัวบุคคลได้ → สาธารณะเห็นแค่ปีเกิด (หน้าเว็บใช้ birth แค่เช็คว่ามีค่า; อายุใช้ age_at_fy_end)
    if (field === 'birth') { if (patient.birth) out.birth = String(patient.birth).slice(0, 4); continue; }
    if (Object.prototype.hasOwnProperty.call(patient, field)) out[field] = patient[field];
  }
  return out;
}

export function toPublicPayload(payload) {
  const patients = Array.isArray(payload.patients) ? payload.patients : [];
  return {
    patients: patients.map(toPublicPatient),
    population: payload.population && typeof payload.population === 'object' ? payload.population : {},
    settings: payload.settings && typeof payload.settings === 'object' ? payload.settings : {},
    publishedAt: payload.publishedAt,
  };
}

// ตรวจว่า payload ปลอดภัยพอจะส่งเข้า GitHub API + เก็บลงพื้นที่ส่วนตัว
export function validatePublishPayload(payload, { maxPatients = MAX_PATIENTS, maxBytes = MAX_PAYLOAD_BYTES } = {}) {
  if (!payload || typeof payload !== 'object') return { ok: false, error: 'payload ต้องเป็น object' };
  if (!Array.isArray(payload.patients)) return { ok: false, error: 'payload ต้องมี patients[]' };
  if (!payload.publishedAt || typeof payload.publishedAt !== 'string') return { ok: false, error: 'payload ต้องมี publishedAt (ISO string)' };
  if (payload.patients.length > maxPatients) return { ok: false, error: `จำนวนผู้ป่วยเกินเพดาน (${payload.patients.length} > ${maxPatients})` };
  const size = utf8ToBytes(JSON.stringify(payload)).length;
  if (size > maxBytes) return { ok: false, error: `payload ใหญ่เกินเพดาน (${size} bytes > ${maxBytes})` };
  for (const p of payload.patients) {
    if (!p || typeof p !== 'object') return { ok: false, error: 'patients[] ต้องเป็น object' };
    if (!p.hoscode || !p.pid) return { ok: false, error: 'ผู้ป่วยทุกคนต้องมี hoscode และ pid' };
    if (!Number.isFinite(Number(p.fiscal_year_be))) return { ok: false, error: `ผู้ป่วย ${p.pid}: fiscal_year_be ไม่ใช่ตัวเลข` };
  }
  return { ok: true, size, count: payload.patients.length };
}

// ---------- จำกัดขอบเขตตามสิทธิ์ผู้ใช้ ----------
export function scopePatientsForUser(patients, user) {
  const list = Array.isArray(patients) ? patients : [];
  if (!user) return [];
  if (user.role === 'admin') return list;
  if (!user.ampur) return []; // viewer ที่ไม่ได้กำหนดอำเภอ = ไม่เห็นข้อมูลจริง (fail closed)
  return list.filter(p => p.ampur === user.ampur);
}

export function sanitizeUser(user) {
  if (!user) return null;
  return {
    username: user.username,
    displayName: user.display_name || user.displayName || user.username,
    role: user.role === 'admin' ? 'admin' : 'viewer',
    ampur: user.role === 'admin' ? null : (user.ampur || null),
  };
}

// env.AUTH_USERS = JSON array: [{username, password_hash, role, ampur, display_name}]
export function parseAuthUsers(raw) {
  if (!raw) return [];
  let list;
  try { list = JSON.parse(raw); } catch (e) { throw new Error('AUTH_USERS ไม่ใช่ JSON ที่ถูกต้อง'); }
  if (!Array.isArray(list)) throw new Error('AUTH_USERS ต้องเป็น JSON array');
  return list
    .filter(u => u && u.username && u.password_hash)
    .map(u => ({ ...u, role: u.role === 'admin' ? 'admin' : 'viewer' }));
}

// ---------- throttle การล็อกอิน (KV ถ้ามี ไม่งั้นจำใน isolate) ----------
export function createLoginThrottle(store) {
  const memory = new Map();
  const useMemory = !store;
  async function read(key) {
    if (useMemory) {
      const hit = memory.get(key);
      if (!hit) return null;
      if (hit.expiresAt && hit.expiresAt <= Date.now()) { memory.delete(key); return null; }
      return hit.value;
    }
    const raw = await store.get(key);
    if (raw === null || raw === undefined) return null;
    try { return JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw)); } catch (e) { return null; }
  }
  async function write(key, value, ttlSeconds) {
    if (useMemory) { memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 }); return; }
    await store.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
  }
  return {
    async status(key) {
      const state = (await read(key)) || { fails: 0, lockedUntil: 0 };
      const retryAfterSeconds = state.lockedUntil > Date.now() ? Math.ceil((state.lockedUntil - Date.now()) / 1000) : 0;
      return { fails: state.fails || 0, retryAfterSeconds };
    },
    async fail(key) {
      const state = (await read(key)) || { fails: 0, lockedUntil: 0 };
      const fails = (state.fails || 0) + 1;
      const locked = fails >= LOGIN_MAX_ATTEMPTS;
      const next = { fails: locked ? 0 : fails, lockedUntil: locked ? Date.now() + LOGIN_LOCKOUT_SECONDS * 1000 : 0 };
      await write(key, next, LOGIN_LOCKOUT_SECONDS);
      return { fails, locked, retryAfterSeconds: locked ? LOGIN_LOCKOUT_SECONDS : 0 };
    },
    async reset(key) { await write(key, { fails: 0, lockedUntil: 0 }, 60); },
  };
}


// ---------- พื้นที่เก็บข้อมูลส่วนบุคคล (เลือก R2 ก่อน ถ้าไม่มีใช้ KV) ----------
export function storageFor(env) {
  if (!env) return null;
  if (env.PII_BUCKET) return { kind: 'r2', binding: env.PII_BUCKET };
  if (env.PII_KV) return { kind: 'kv', binding: env.PII_KV };
  return null;
}

export const STORAGE_MISSING_MESSAGE =
  'ยังไม่ได้ตั้งค่าพื้นที่เก็บข้อมูลส่วนบุคคล (R2 bucket หรือ KV namespace) — ดูวิธีตั้งค่าใน worker/README.md แล้ว deploy ใหม่';

export async function storeGet(storage, key) {
  if (!storage) return null;
  let raw = null;
  if (storage.kind === 'r2') {
    const obj = await storage.binding.get(key);
    raw = obj ? await obj.text() : null;
  } else {
    raw = await storage.binding.get(key);
  }
  if (raw === null || raw === undefined || raw === '') return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

export async function storePut(storage, key, value) {
  if (!storage) throw new Error(STORAGE_MISSING_MESSAGE);
  const body = JSON.stringify(value);
  if (storage.kind === 'r2') await storage.binding.put(key, body, { httpMetadata: { contentType: 'application/json' } });
  else await storage.binding.put(key, body);
}

export async function storeDelete(storage, key) {
  if (!storage) return;
  await storage.binding.delete(key);
}

export async function storeList(storage, prefix) {
  if (!storage) return [];
  if (storage.kind === 'r2') {
    const res = await storage.binding.list({ prefix });
    return (res.objects || []).map(o => o.key);
  }
  const res = await storage.binding.list({ prefix });
  return (res.keys || []).map(k => k.name);
}

// ---------- Audit log (PDPA): ใครเข้าถึงข้อมูลจริงเมื่อไร ----------
// เก็บ 1 key ต่อ 1 เหตุการณ์ (ไม่ต้อง read-modify-write จึงไม่ชนกัน) แบ่ง prefix รายวันเพื่อ list ตามช่วงวันได้
// ห้ามใส่ cid/ชื่อผู้ป่วยลงใน log — เก็บเฉพาะผู้ใช้ อำเภอ จำนวนแถว และ IP
export const AUDIT_PREFIX = 'audit/';
export const AUDIT_MAX_DAYS = 31;
export const AUDIT_MAX_ITEMS = 500;
const AUDIT_FIELDS = ['action', 'username', 'role', 'ampur', 'ok', 'status', 'count', 'ip', 'detail'];

export function auditDay(ms) { return new Date(ms).toISOString().slice(0, 10); }

export function buildAuditEntry(fields, ms) {
  const entry = { at: new Date(ms).toISOString() };
  for (const k of AUDIT_FIELDS) {
    if (fields[k] === undefined || fields[k] === null) continue;
    entry[k] = typeof fields[k] === 'string' ? fields[k].slice(0, 200) : fields[k];
  }
  return entry;
}

export async function writeAudit(storage, fields, ms) {
  if (!storage) return null;
  const entry = buildAuditEntry(fields, ms);
  const key = `${AUDIT_PREFIX}${auditDay(ms)}/${entry.at}-${randomB64Url(6)}`;
  try { await storePut(storage, key, entry); } catch (e) { return null; } // log พังต้องไม่ทำให้ระบบหลักพัง
  return key;
}

export async function readAudit(storage, { days = 7, nowMs = Date.now(), limit = AUDIT_MAX_ITEMS } = {}) {
  const n = Math.min(Math.max(1, Math.floor(Number(days) || 7)), AUDIT_MAX_DAYS);
  const keys = [];
  for (let i = 0; i < n && keys.length < limit; i++) {
    const day = auditDay(nowMs - i * 86400000);
    const dayKeys = (await storeList(storage, `${AUDIT_PREFIX}${day}/`)).sort().reverse();
    keys.push(...dayKeys.slice(0, limit - keys.length));
  }
  const items = await Promise.all(keys.map(k => storeGet(storage, k)));
  return items.filter(Boolean);
}

// ---------- การติดตามผู้ป่วยรายคน (ข้อมูลส่วนตัว อยู่ใน Worker เท่านั้น) ----------
// key: followup/<ampur>/<hoscode>-<pid> → { hoscode, pid, ampur, entries: [{at, by, status, note, nextDate}] }
// ampur มาจากข้อมูลผู้ป่วยฝั่ง server เสมอ (ไม่เชื่อ client) → list ตาม prefix อำเภอได้ และกันเขียนข้ามอำเภอ
export const FOLLOWUP_PREFIX = 'followup/';
export const FOLLOWUP_STATUSES = ['visited', 'phone', 'not_found', 'refused', 'referred', 'stable', 'closed'];
export const FOLLOWUP_NOTE_MAX = 500;
export const FOLLOWUP_MAX_ENTRIES = 50;
const ID_PART = /^[0-9A-Za-z]{1,20}$/;

export function followupKey(ampur, hoscode, pid) {
  return `${FOLLOWUP_PREFIX}${ampur}/${hoscode}-${pid}`;
}

export function validateFollowupInput(body, { nowMs = Date.now() } = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const hoscode = String(b.hoscode || '');
  const pid = String(b.pid || '');
  if (!ID_PART.test(hoscode) || !ID_PART.test(pid)) return { ok: false, error: 'hoscode/pid ไม่ถูกต้อง' };
  if (!FOLLOWUP_STATUSES.includes(b.status)) return { ok: false, error: 'สถานะการติดตามไม่ถูกต้อง' };
  const note = String(b.note || '').trim();
  if (note.length > FOLLOWUP_NOTE_MAX) return { ok: false, error: `บันทึกยาวเกิน ${FOLLOWUP_NOTE_MAX} ตัวอักษร` };
  let nextDate = null;
  if (b.nextDate) {
    nextDate = String(b.nextDate);
    const t = Date.parse(`${nextDate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate) || !Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== nextDate) return { ok: false, error: 'วันนัดถัดไปต้องเป็นรูปแบบ YYYY-MM-DD' };
    if (t > nowMs + 366 * 86400000) return { ok: false, error: 'วันนัดถัดไปต้องไม่เกิน 1 ปี' };
  }
  return { ok: true, value: { hoscode, pid, status: b.status, note, nextDate } };
}

export function summarizeFollowup(record) {
  const entries = Array.isArray(record && record.entries) ? record.entries : [];
  const last = entries[entries.length - 1] || null;
  return {
    hoscode: record.hoscode, pid: record.pid, ampur: record.ampur,
    count: entries.length,
    lastAt: last ? last.at : null, lastStatus: last ? last.status : null, lastBy: last ? last.by : null,
    nextDate: last ? last.nextDate : null,
  };
}

// ---------- แจ้งเตือนผู้ป่วยเกินนัดทาง LINE (Cron) ----------
// LINE เป็นบริการภายนอก → ข้อความมีแค่ "จำนวน" ต่ออำเภอ/หน่วยบริการ ห้ามมีชื่อ/cid/pid
// env.LINE_TARGETS = JSON {"01": "<groupId อำเภอ 01>", "*": "<userId/groupId ผู้ดูแลจังหวัด>"}
export function bangkokDate(ms) { return new Date(ms + 7 * 3600000).toISOString().slice(0, 10); }

export function collectOverdue(records, patients, todayIso) {
  const hosname = new Map((patients || []).map(p => [`${p.hoscode}`, p.hosname || p.hoscode]));
  const current = new Set((patients || []).map(p => `${p.hoscode}-${p.pid}`));
  const byAmpur = {};
  for (const r of records) {
    if (!r) continue;
    const s = summarizeFollowup(r);
    if (!s.nextDate || s.lastStatus === 'closed' || s.nextDate >= todayIso) continue;
    if (!current.has(`${s.hoscode}-${s.pid}`)) continue; // ไม่อยู่ในข้อมูลปัจจุบันแล้ว
    const a = (byAmpur[s.ampur] ||= { total: 0, byHos: {} });
    a.total++;
    const h = hosname.get(`${s.hoscode}`) || s.hoscode;
    a.byHos[h] = (a.byHos[h] || 0) + 1;
  }
  return byAmpur;
}

export function overdueMessage(label, group, todayIso, siteUrl) {
  const lines = Object.entries(group.byHos).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([h, n]) => `• ${h}: ${n} คน`);
  return [`SMI-V Plus ${todayIso}`, `${label}: ผู้ป่วยเกินวันนัดติดตาม ${group.total} คน`, ...lines,
    `ดูรายชื่อ (ต้องเข้าสู่ระบบ): ${siteUrl}`].join('\n').slice(0, 4900);
}

export function parseLineTargets(raw) {
  if (!raw) return {};
  try {
    const t = JSON.parse(raw);
    return t && typeof t === 'object' && !Array.isArray(t) ? t : {};
  } catch (e) { return {}; }
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown-ip';
}


// ---------- GitHub Contents API + ตัวจัดการ request ----------
const GH_API = 'https://api.github.com';
const GH_OWNER = 'thering999';
const GH_REPO = 'smiv_plus';
const GH_PATH = 'docs/data.json';
const GH_HISTORY_INDEX_PATH = 'docs/history/index.json';
const GH_HISTORY_KEEP = 15;
const DEFAULT_ALLOWED_ORIGINS = ['https://thering999.github.io', 'http://localhost:8080', 'http://127.0.0.1:8080'];

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'smiv-plus-worker',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export function createWorkerHandler({ fetchImpl, nowMs = () => Date.now() } = {}) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  const throttles = new Map();

  async function ghGetFile(path, token) {
    const res = await doFetch(`${GH_API}/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`, { headers: ghHeaders(token) });
    if (res.status === 404) return { sha: null, json: null };
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const err = new Error(`read ${path} failed (${res.status}): ${String(detail).slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    const j = await res.json();
    const raw = String(j.content || '').replace(/\s+/g, '');
    let json = null;
    try { json = raw ? JSON.parse(b64UrlDecodeToString(raw)) : null; } catch (e) { json = null; }
    return { sha: j.sha, json };
  }

  async function ghPutFile(path, obj, sha, token, message) {
    const content = bytesToB64Url(utf8ToBytes(JSON.stringify(obj)));
    const res = await doFetch(`${GH_API}/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`, {
      method: 'PUT',
      headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content, sha: sha || undefined }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const e = new Error(err.message || `write ${path} failed (${res.status})`);
      e.status = res.status;
      throw e;
    }
  }

  async function ghDeleteFile(path, sha, token, message) {
    const res = await doFetch(`${GH_API}/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`, {
      method: 'DELETE',
      headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sha }),
    });
    if (!res.ok && res.status !== 404) {
      const err = await res.json().catch(() => ({}));
      const e = new Error(err.message || `delete ${path} failed (${res.status})`);
      e.status = res.status;
      throw e;
    }
  }

  async function writeFileWithRetry(path, obj, token, message, attempt = 0) {
    const current = await ghGetFile(path, token);
    try {
      await ghPutFile(path, obj, current.sha, token, message);
    } catch (err) {
      if (err.status === 409 && attempt < 2) return writeFileWithRetry(path, obj, token, message, attempt + 1);
      throw err;
    }
  }


  // เขียน "สำเนาที่ปิดบังข้อมูลส่วนบุคคลแล้ว" ขึ้น GitHub (สาธารณะ) — ฟังก์ชันนี้ไม่เคยรับข้อมูลเต็มจากที่อื่นเลย
  async function publishPublicCopy(publicPayload, token, messageBase) {
    await writeFileWithRetry(GH_PATH, publicPayload, token, messageBase);
    const snapshotPath = `docs/history/${String(publicPayload.publishedAt).replace(/[:.]/g, '-')}.json`;
    await writeFileWithRetry(snapshotPath, publicPayload, token, `history snapshot — ${messageBase}`);
    const idx = await ghGetFile(GH_HISTORY_INDEX_PATH, token);
    let list = Array.isArray(idx.json) ? idx.json : [];
    const entry = {
      file: snapshotPath,
      publishedAt: publicPayload.publishedAt,
      patientCount: publicPayload.patients.length,
      fiscalYear: (publicPayload.settings && publicPayload.settings.current_fiscal_year_be) || null,
    };
    list.push(entry);
    let dropped = [];
    if (list.length > GH_HISTORY_KEEP) {
      dropped = list.slice(0, list.length - GH_HISTORY_KEEP);
      list = list.slice(list.length - GH_HISTORY_KEEP);
    }
    await writeFileWithRetry(GH_HISTORY_INDEX_PATH, list, token, `update history index (${list.length} รายการ)`);
    for (const old of dropped) {
      try {
        const snap = await ghGetFile(old.file, token);
        if (snap.sha) await ghDeleteFile(old.file, snap.sha, token, `prune old history snapshot: ${old.file}`);
      } catch (e) { /* ไม่ critical — เก็บ orphan ไว้ดีกว่า publish ล้มเหลว */ }
    }
    return entry;
  }

  // เก็บข้อมูลเต็มลงพื้นที่ส่วนตัว + เก็บบันทึกประวัติไว้กู้คืนได้
  async function storePrivateCopy(storage, payload) {
    await storePut(storage, PII_CURRENT_KEY, payload);
    const snapshotKey = `${PII_HISTORY_PREFIX}${String(payload.publishedAt).replace(/[:.]/g, '-')}.json`;
    await storePut(storage, snapshotKey, payload);
    const idx = await storeGet(storage, PII_HISTORY_INDEX_KEY);
    let list = Array.isArray(idx) ? idx : [];
    list.push({ file: snapshotKey, publishedAt: payload.publishedAt, patientCount: payload.patients.length });
    let pruned = [];
    if (list.length > PII_HISTORY_KEEP) {
      pruned = list.slice(0, list.length - PII_HISTORY_KEEP);
      list = list.slice(list.length - PII_HISTORY_KEEP);
    }
    await storePut(storage, PII_HISTORY_INDEX_KEY, list);
    for (const old of pruned) { try { await storeDelete(storage, old.file); } catch (e) { /* ignore */ } }
    return snapshotKey;
  }

  function allowedOrigins(env) {
    const raw = env && env.ALLOWED_ORIGINS;
    if (!raw) return DEFAULT_ALLOWED_ORIGINS;
    return String(raw).split(',').map(s => s.trim()).filter(Boolean);
  }

  function corsHeaders(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = allowedOrigins(env);
    const allowOrigin = allowed.includes('*') ? '*' : (allowed.includes(origin) ? origin : allowed[0]);
    return {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Site-Key, Authorization',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    };
  }

  function json(request, env, obj, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(obj), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(request, env), ...extraHeaders },
    });
  }

  function throttleFor(env) {
    const key = (env && env.LOGIN_KV) || 'memory';
    if (!throttles.has(key)) throttles.set(key, createLoginThrottle(env && env.LOGIN_KV));
    return throttles.get(key);
  }

  async function requireUser(request, env, roles = ['admin', 'viewer']) {
    const header = request.headers.get('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token || !env.SESSION_SECRET) return { ok: false, status: 401, error: 'ต้องเข้าสู่ระบบก่อน' };
    const body = await verifyToken(token, env.SESSION_SECRET, { nowMs: nowMs() });
    if (!body) return { ok: false, status: 401, error: 'เซสชันหมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่' };
    // อ่านสิทธิ์ล่าสุดจาก AUTH_USERS ทุก request: ลบผู้ใช้/เปลี่ยน role/อำเภอ มีผลทันที ไม่ต้องรอ token หมดอายุ
    let users;
    try { users = parseAuthUsers(env.AUTH_USERS); } catch (e) { return { ok: false, status: 500, error: e.message }; }
    const user = sanitizeUser(users.find(u => String(u.username).toLowerCase() === String(body.username || '').toLowerCase()));
    if (!user) return { ok: false, status: 401, error: 'บัญชีนี้ถูกปิดใช้งานแล้ว กรุณาเข้าสู่ระบบใหม่' };
    if (!roles.includes(user.role)) return { ok: false, status: 403, error: 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้' };
    return { ok: true, user };
  }


  async function handleLogin(request, env) {
    if (!env.SESSION_SECRET) return json(request, env, { error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า SESSION_SECRET' }, 500);
    let body;
    try { body = await request.json(); } catch (e) { return json(request, env, { error: 'invalid JSON body' }, 400); }
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!username || !password) return json(request, env, { error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' }, 400);

    const ip = clientIp(request);
    const throttle = throttleFor(env);
    const ipKey = `login:ip:${ip}`;
    const userKey = `login:user:${username.toLowerCase()}`;
    for (const key of [ipKey, userKey]) {
      const state = await throttle.status(key);
      if (state.retryAfterSeconds > 0) {
        return json(request, env, {
          error: `ลองผิดหลายครั้งเกินไป กรุณารออีกประมาณ ${Math.ceil(state.retryAfterSeconds / 60)} นาที`,
          retryAfterSeconds: state.retryAfterSeconds,
        }, 429);
      }
    }

    let users;
    try { users = parseAuthUsers(env.AUTH_USERS); } catch (err) { return json(request, env, { error: err.message }, 500); }
    const record = users.find(u => String(u.username).toLowerCase() === username.toLowerCase());
    // ไม่มีผู้ใช้นี้ก็ยังคำนวณ PBKDF2 เท่ากัน (hash หลอก) เพื่อไม่ให้วัดเวลาเดาได้ว่ามีชื่อผู้ใช้นี้หรือไม่
    const passwordOk = record
      ? await verifyPassword(password, record.password_hash)
      : (await hashPassword(password), false);

    if (!passwordOk) {
      // ยังคำนวณ PBKDF2 ไปแล้วเท่ากันทั้งกรณีมี/ไม่มีผู้ใช้ เพื่อไม่ให้วัดเวลาเดาได้ว่ามีชื่อผู้ใช้นี้หรือไม่
      const ipFail = await throttle.fail(ipKey);
      const userFail = await throttle.fail(userKey);
      const retryAfterSeconds = Math.max(ipFail.retryAfterSeconds, userFail.retryAfterSeconds);
      const remaining = Math.max(0, LOGIN_MAX_ATTEMPTS - Math.max(ipFail.fails, userFail.fails));
      await writeAudit(storageFor(env), { action: 'login', username, ok: false, status: retryAfterSeconds ? 429 : 401, ip }, nowMs());
      return json(request, env, {
        error: retryAfterSeconds
          ? 'ล็อกชั่วคราวจากการล็อกอินผิดหลายครั้ง กรุณารอสักครู่'
          : `ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง (เหลือ ${remaining} ครั้งก่อนถูกล็อกชั่วคราว)`,
        retryAfterSeconds,
      }, retryAfterSeconds ? 429 : 401);
    }

    await throttle.reset(ipKey);
    await throttle.reset(userKey);
    const user = sanitizeUser(record);
    await writeAudit(storageFor(env), { action: 'login', username: user.username, role: user.role, ampur: user.ampur, ok: true, status: 200, ip }, nowMs());
    const token = await signToken(
      { username: user.username, displayName: user.displayName, role: user.role, ampur: user.ampur },
      env.SESSION_SECRET,
      { ttlSeconds: TOKEN_TTL_SECONDS, nowMs: nowMs() }
    );
    return json(request, env, { ok: true, token, expiresIn: TOKEN_TTL_SECONDS, user }, 200, { 'Cache-Control': 'no-store' });
  }

  async function handlePatientData(request, env) {
    const auth = await requireUser(request, env);
    if (!auth.ok) return json(request, env, { error: auth.error }, auth.status);
    const storage = storageFor(env);
    if (!storage) return json(request, env, { error: STORAGE_MISSING_MESSAGE }, 503);
    const full = await storeGet(storage, PII_CURRENT_KEY);
    if (!full || !Array.isArray(full.patients)) return json(request, env, { error: 'ยังไม่มีข้อมูลที่เผยแพร่ในระบบ' }, 404);
    const patients = scopePatientsForUser(full.patients, auth.user);
    await writeAudit(storage, {
      action: 'patient-data', username: auth.user.username, role: auth.user.role, ampur: auth.user.ampur,
      ok: true, status: 200, count: patients.length, ip: clientIp(request),
    }, nowMs());
    return json(request, env, {
      ok: true,
      patients,
      population: full.population || {},
      settings: full.settings || {},
      publishedAt: full.publishedAt || null,
      scope: {
        username: auth.user.username,
        displayName: auth.user.displayName,
        role: auth.user.role,
        ampur: auth.user.ampur,
        patientCount: patients.length,
        totalCount: full.patients.length,
      },
    }, 200, { 'Cache-Control': 'no-store' });
  }


  async function handlePublish(request, env) {
    const { GH_TOKEN, SITE_KEY } = env;
    if (SITE_KEY && !timingSafeEqualStr(request.headers.get('X-Site-Key') || '', SITE_KEY)) {
      return json(request, env, { error: 'unauthorized (site key ไม่ถูกต้อง)' }, 401);
    }
    const auth = await requireUser(request, env, ['admin']);
    if (!auth.ok) return json(request, env, { error: auth.error }, auth.status);
    if (!GH_TOKEN) return json(request, env, { error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า GH_TOKEN' }, 500);
    const storage = storageFor(env);
    if (!storage) return json(request, env, { error: STORAGE_MISSING_MESSAGE }, 500);

    const raw = await request.text();
    if (utf8ToBytes(raw).length > MAX_PAYLOAD_BYTES) {
      return json(request, env, { error: `payload ใหญ่เกินเพดาน ${MAX_PAYLOAD_BYTES} bytes` }, 413);
    }
    let payload;
    try { payload = JSON.parse(raw); } catch (e) { return json(request, env, { error: 'invalid JSON body' }, 400); }

    const check = validatePublishPayload(payload);
    if (!check.ok) return json(request, env, { error: check.error }, 400);

    try {
      const messageBase = `publish data.json (${payload.patients.length} คน, ปิดบังข้อมูลส่วนบุคคลแล้ว) — ${new Date(nowMs()).toLocaleString('th-TH')}`;
      // 1) ข้อมูลเต็ม → พื้นที่ส่วนตัว (อ่านได้เฉพาะผู้ที่ล็อกอิน)
      const snapshotKey = await storePrivateCopy(storage, payload);
      // 2) ข้อมูลที่ปิดบังแล้ว → GitHub (สาธารณะ)
      const publicPayload = toPublicPayload(payload);
      const entry = await publishPublicCopy(publicPayload, GH_TOKEN, messageBase);
      await writeAudit(storage, {
        action: 'publish', username: auth.user.username, role: auth.user.role,
        ok: true, status: 200, count: publicPayload.patients.length, ip: clientIp(request),
      }, nowMs());
      return json(request, env, {
        ok: true,
        patientCount: publicPayload.patients.length,
        publicHistoryFile: entry.file,
        privateSnapshotFile: snapshotKey,
        publishedBy: auth.user.username,
      });
    } catch (err) {
      return json(request, env, { error: err.message || String(err) }, 502);
    }
  }

  async function handleDeleteHistory(request, env, payload) {
    const { GH_TOKEN } = env;
    if (!GH_TOKEN) return json(request, env, { error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า GH_TOKEN' }, 500);
    const file = String(payload.file || '');
    if (!file.startsWith('docs/history/') || file.includes('..')) return json(request, env, { error: 'invalid file path' }, 400);
    const idx = await ghGetFile(GH_HISTORY_INDEX_PATH, GH_TOKEN);
    const list = (Array.isArray(idx.json) ? idx.json : []).filter(e => e.file !== file);
    await writeFileWithRetry(GH_HISTORY_INDEX_PATH, list, GH_TOKEN, `delete history entry: ${file}`);
    const snap = await ghGetFile(file, GH_TOKEN);
    if (snap.sha) await ghDeleteFile(file, snap.sha, GH_TOKEN, `delete history snapshot: ${file}`);
    return json(request, env, { ok: true, remaining: list.length });
  }

  // GET /followups → สรุปล่าสุดของทุกคนในขอบเขตผู้ใช้ · GET /followups?hoscode=&pid= → ประวัติเต็มของคนนั้น
  async function handleFollowupList(request, env, url) {
    const auth = await requireUser(request, env);
    if (!auth.ok) return json(request, env, { error: auth.error }, auth.status);
    const storage = storageFor(env);
    if (!storage) return json(request, env, { error: STORAGE_MISSING_MESSAGE }, 503);
    const { user } = auth;
    const scopeAll = user.role === 'admin';
    if (!scopeAll && !user.ampur) return json(request, env, { ok: true, items: [] }, 200, { 'Cache-Control': 'no-store' });

    const hoscode = url.searchParams.get('hoscode');
    const pid = url.searchParams.get('pid');
    if (hoscode || pid) {
      if (!ID_PART.test(hoscode || '') || !ID_PART.test(pid || '')) return json(request, env, { error: 'hoscode/pid ไม่ถูกต้อง' }, 400);
      const prefix = scopeAll ? FOLLOWUP_PREFIX : `${FOLLOWUP_PREFIX}${user.ampur}/`;
      const key = (await storeList(storage, prefix)).find(k => k.endsWith(`/${hoscode}-${pid}`));
      const record = key ? await storeGet(storage, key) : null;
      return json(request, env, { ok: true, entries: record && Array.isArray(record.entries) ? record.entries : [] }, 200, { 'Cache-Control': 'no-store' });
    }

    const prefix = scopeAll ? FOLLOWUP_PREFIX : `${FOLLOWUP_PREFIX}${user.ampur}/`;
    const keys = await storeList(storage, prefix);
    const records = await Promise.all(keys.map(k => storeGet(storage, k)));
    const items = records.filter(Boolean).map(summarizeFollowup);
    return json(request, env, { ok: true, items }, 200, { 'Cache-Control': 'no-store' });
  }

  async function handleFollowupAdd(request, env) {
    const auth = await requireUser(request, env);
    if (!auth.ok) return json(request, env, { error: auth.error }, auth.status);
    const storage = storageFor(env);
    if (!storage) return json(request, env, { error: STORAGE_MISSING_MESSAGE }, 503);
    let body;
    try { body = await request.json(); } catch (e) { return json(request, env, { error: 'invalid JSON body' }, 400); }
    const check = validateFollowupInput(body, { nowMs: nowMs() });
    if (!check.ok) return json(request, env, { error: check.error }, 400);
    const { hoscode, pid, status, note, nextDate } = check.value;

    // อ้างอิงผู้ป่วยจากข้อมูลจริงฝั่ง server เพื่อหาอำเภอ แล้วตรวจสิทธิ์อำเภอ
    const full = await storeGet(storage, PII_CURRENT_KEY);
    const patients = full && Array.isArray(full.patients) ? full.patients : [];
    const target = patients.find(p => String(p.hoscode) === hoscode && String(p.pid) === pid);
    if (!target) return json(request, env, { error: 'ไม่พบผู้ป่วยรายนี้ในข้อมูลปัจจุบัน' }, 404);
    const ampur = String(target.ampur || '');
    if (!ID_PART.test(ampur)) return json(request, env, { error: 'ข้อมูลอำเภอของผู้ป่วยไม่ถูกต้อง' }, 422);
    if (scopePatientsForUser([target], auth.user).length === 0) {
      return json(request, env, { error: 'บัญชีนี้ไม่มีสิทธิ์บันทึกการติดตามผู้ป่วยนอกอำเภอที่รับผิดชอบ' }, 403);
    }

    const key = followupKey(ampur, hoscode, pid);
    const record = (await storeGet(storage, key)) || { hoscode, pid, ampur, entries: [] };
    const entry = { at: new Date(nowMs()).toISOString(), by: auth.user.username, status, note, nextDate };
    record.entries = [...(Array.isArray(record.entries) ? record.entries : []), entry].slice(-FOLLOWUP_MAX_ENTRIES);
    await storePut(storage, key, record);
    await writeAudit(storage, {
      action: 'followup', username: auth.user.username, role: auth.user.role, ampur,
      ok: true, status: 200, detail: `${hoscode}-${pid}:${status}`, ip: clientIp(request),
    }, nowMs());
    return json(request, env, { ok: true, entry, summary: summarizeFollowup(record) });
  }

  async function runOverdueNotify(env, { dryRun = false } = {}) {
    const storage = storageFor(env);
    if (!storage) return { ok: false, error: STORAGE_MISSING_MESSAGE };
    const targets = parseLineTargets(env.LINE_TARGETS);
    const today = bangkokDate(nowMs());
    const full = await storeGet(storage, PII_CURRENT_KEY);
    const keys = await storeList(storage, FOLLOWUP_PREFIX);
    const records = await Promise.all(keys.map(k => storeGet(storage, k)));
    const byAmpur = collectOverdue(records, full && full.patients, today);
    const siteUrl = env.SITE_URL || 'https://thering999.github.io/smiv_plus/';

    const messages = [];
    for (const [ampur, group] of Object.entries(byAmpur)) {
      if (targets[ampur]) messages.push({ to: targets[ampur], text: overdueMessage(`อำเภอ ${ampur}`, group, today, siteUrl) });
    }
    if (targets['*'] && Object.keys(byAmpur).length) {
      const total = Object.values(byAmpur).reduce((n, g) => n + g.total, 0);
      const byHos = Object.fromEntries(Object.entries(byAmpur).map(([a, g]) => [`อำเภอ ${a}`, g.total]));
      messages.push({ to: targets['*'], text: overdueMessage('ทั้งจังหวัด', { total, byHos }, today, siteUrl) });
    }

    const summary = Object.fromEntries(Object.entries(byAmpur).map(([a, g]) => [a, g.total]));
    if (dryRun || !env.LINE_CHANNEL_TOKEN) return { ok: true, dryRun: true, today, summary, messages };

    let sent = 0;
    const errors = [];
    for (const m of messages) {
      const res = await doFetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LINE_CHANNEL_TOKEN}` },
        body: JSON.stringify({ to: m.to, messages: [{ type: 'text', text: m.text }] }),
      });
      if (res.ok) sent++; else errors.push(res.status);
    }
    await writeAudit(storage, { action: 'line-overdue', username: 'cron', ok: errors.length === 0, count: sent, detail: JSON.stringify(summary) }, nowMs());
    return { ok: errors.length === 0, today, summary, sent, errors };
  }

  async function handleNotifyOverdue(request, env) {
    const auth = await requireUser(request, env, ['admin']);
    if (!auth.ok) return json(request, env, { error: auth.error }, auth.status);
    let body = {};
    try { body = await request.json(); } catch (e) { body = {}; }
    const result = await runOverdueNotify(env, { dryRun: body.dryRun !== false });
    // ไม่คืน groupId ปลายทางให้ client
    const { messages, ...rest } = result;
    return json(request, env, { ...rest, preview: (messages || []).map(m => m.text) }, result.ok ? 200 : 502);
  }

  async function handleAudit(request, env, url) {
    const auth = await requireUser(request, env, ['admin']);
    if (!auth.ok) return json(request, env, { error: auth.error }, auth.status);
    const storage = storageFor(env);
    if (!storage) return json(request, env, { error: STORAGE_MISSING_MESSAGE }, 503);
    const items = await readAudit(storage, { days: url.searchParams.get('days'), nowMs: nowMs() });
    return json(request, env, { ok: true, items }, 200, { 'Cache-Control': 'no-store' });
  }

  async function handleFullHistory(request, env, payload) {
    const storage = storageFor(env);
    if (!storage) return json(request, env, { error: STORAGE_MISSING_MESSAGE }, 503);

    if (payload.action === 'restore_full_history') {
      const file = String(payload.file || '');
      if (!file.startsWith(PII_HISTORY_PREFIX) || file.includes('..')) return json(request, env, { error: 'invalid file path' }, 400);
      const snapshot = await storeGet(storage, file);
      if (!snapshot || !Array.isArray(snapshot.patients)) return json(request, env, { error: 'ไม่พบข้อมูลย้อนหลังรายการนี้' }, 404);
      const restored = {
        patients: snapshot.patients,
        population: snapshot.population || {},
        settings: snapshot.settings || {},
        publishedAt: new Date(nowMs()).toISOString(),
      };
      await storePrivateCopy(storage, restored);
      const publicPayload = toPublicPayload(restored);
      const entry = await publishPublicCopy(
        publicPayload, env.GH_TOKEN,
        `restore data.json from ${file} (${restored.patients.length} คน, ปิดบังข้อมูลส่วนบุคคลแล้ว)`
      );
      await writeAudit(storage, { action: 'restore', ok: true, status: 200, count: publicPayload.patients.length, detail: file, ip: clientIp(request) }, nowMs());
      return json(request, env, { ok: true, restoredFrom: file, patientCount: publicPayload.patients.length, publicHistoryFile: entry.file });
    }

    const list = (await storeGet(storage, PII_HISTORY_INDEX_KEY)) || [];
    return json(request, env, { ok: true, items: Array.isArray(list) ? list : [] }, 200, { 'Cache-Control': 'no-store' });
  }


  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, '') || '/';

      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders(request, env) });
      }

      if (request.method === 'GET' && path === '/health') {
        const storage = storageFor(env);
        return json(request, env, {
          ok: true,
          version: WORKER_VERSION,
          piiStorage: storage ? storage.kind : null,
          github: !!env.GH_TOKEN,
          auth: !!(env.AUTH_USERS && env.SESSION_SECRET),
        });
      }

      if (request.method === 'POST' && path === '/login') {
        return handleLogin(request, env);
      }

      if ((request.method === 'POST' || request.method === 'GET') && path === '/patient-data') {
        return handlePatientData(request, env);
      }

      if (request.method === 'GET' && path === '/followups') {
        return handleFollowupList(request, env, url);
      }

      if (request.method === 'POST' && path === '/followups') {
        return handleFollowupAdd(request, env);
      }

      if (request.method === 'POST' && path === '/notify-overdue') {
        return handleNotifyOverdue(request, env);
      }

      if (request.method === 'GET' && path === '/audit') {
        return handleAudit(request, env, url);
      }

      if (request.method === 'POST' && (path === '/' || path === '/publish')) {
        // กัน payload ยักษ์ตั้งแต่แรก (ก่อน JSON.parse) ด้วย header Content-Length ถ้ามี
        const declared = Number(request.headers.get('Content-Length') || 0);
        if (Number.isFinite(declared) && declared > MAX_PAYLOAD_BYTES) {
          return json(request, env, { error: `payload ใหญ่เกินเพดาน ${MAX_PAYLOAD_BYTES} bytes` }, 413);
        }
        let body = null;
        try { body = await request.clone().json(); } catch (e) { body = null; }
        const action = body && body.action;

        if (action === 'delete_history') {
          const auth = await requireUser(request, env, ['admin']);
          if (!auth.ok) return json(request, env, { error: auth.error }, auth.status);
          try {
            return await handleDeleteHistory(request, env, body);
          } catch (err) {
            return json(request, env, { error: err.message || String(err) }, 502);
          }
        }

        if (action === 'full_history' || action === 'restore_full_history') {
          const auth = await requireUser(request, env, ['admin']);
          if (!auth.ok) return json(request, env, { error: auth.error }, auth.status);
          try {
            return await handleFullHistory(request, env, body || {});
          } catch (err) {
            return json(request, env, { error: err.message || String(err) }, 502);
          }
        }

        return handlePublish(request, env);
      }

      return json(request, env, { error: 'not found' }, 404);
    },

    // Cron Trigger (wrangler.toml [triggers]) → แจ้งผู้ป่วยเกินนัดทาง LINE
    async scheduled(event, env, ctx) {
      const job = runOverdueNotify(env).catch(() => null);
      if (ctx && ctx.waitUntil) ctx.waitUntil(job); else await job;
    },
  };
}

