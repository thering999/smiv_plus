/* eslint-disable no-console */
/*
 * สร้าง/จัดการรายชื่อผู้ใช้ของ Worker (เก็บเป็น hash PBKDF2 เท่านั้น ไม่เก็บรหัสผ่านจริง)
 *
 * ใช้:
 *   node worker/hash-password.mjs add <username> <admin|viewer> <ampur|-> <password> [ชื่อที่แสดง]
 *   node worker/hash-password.mjs rm  <username>
 *   node worker/hash-password.mjs list
 *   node worker/hash-password.mjs print          → พิมพ์ JSON สำหรับ `wrangler secret put AUTH_USERS`
 *
 * ไฟล์เก็บรายชื่อ: worker/users.local.json (อยู่ใน .gitignore — ห้าม commit)
 * ampur = รหัสอำเภอ 2 หลัก (01-07) เพื่อจำกัดผู้ใช้ให้เห็นเฉพาะอำเภอนั้น, ใช้ "-" กับ admin (เห็นทุกอำเภอ)
 *   viewer ต้องระบุอำเภอเสมอ — viewer ที่ใส่ "-" จะไม่เห็นข้อมูลผู้ป่วยจริงเลย
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from './lib.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const usersFile = path.join(dir, 'users.local.json');

function readUsers() {
  if (!fs.existsSync(usersFile)) return [];
  try {
    const list = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch (e) { return []; }
}
function writeUsers(list) {
  fs.writeFileSync(usersFile, JSON.stringify(list, null, 2) + '\n', 'utf8');
}

const [cmd, ...args] = process.argv.slice(2);

if (!cmd) {
  console.log('usage:');
  console.log('  node worker/hash-password.mjs add <username> <admin|viewer> <ampur|-> <password> [ชื่อที่แสดง]');
  console.log('  node worker/hash-password.mjs rm <username>');
  console.log('  node worker/hash-password.mjs list');
  console.log('  node worker/hash-password.mjs print');
  process.exit(1);
}

if (cmd === 'add') {
  const [username, role, ampur, password, displayName] = args;
  if (!username || !role || !ampur || !password) {
    console.error('ต้องระบุ: <username> <admin|viewer> <ampur|-> <password> [ชื่อที่แสดง]');
    process.exit(1);
  }
  if (role !== 'admin' && role !== 'viewer') {
    console.error('role ต้องเป็น admin หรือ viewer');
    process.exit(1);
  }
  if (String(password).length < 10) {
    console.error('รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร (ระบบนี้ใช้แทนการจำกัดสิทธิ์จริง จึงต้องยาวพอ)');
    process.exit(1);
  }
  const ampurValue = ampur === '-' || ampur === '' ? null : ampur;
  if (ampurValue && !/^\d{2}$/.test(ampurValue)) {
    console.error('ampur ต้องเป็นรหัสอำเภอ 2 หลัก (เช่น 01) หรือ "-"');
    process.exit(1);
  }
  const list = readUsers().filter(u => u.username !== username);
  const passwordHash = await hashPassword(password);
  list.push({ username, password_hash: passwordHash, role, ampur: ampurValue, display_name: displayName || username });
  writeUsers(list);
  console.log(`เพิ่ม/อัปเดตผู้ใช้ '${username}' (${role}${ampurValue ? `, อำเภอ ${ampurValue}` : ''}) แล้ว — เก็บใน ${path.relative(process.cwd(), usersFile)}`);
  console.log('ต่อไป: node worker/hash-password.mjs print  แล้วนำค่าที่ได้ไปตั้ง secret AUTH_USERS');
} else if (cmd === 'rm') {
  const [username] = args;
  if (!username) { console.error('ต้องระบุ username'); process.exit(1); }
  const list = readUsers().filter(u => u.username !== username);
  writeUsers(list);
  console.log(`ลบผู้ใช้ '${username}' แล้ว (เหลือ ${list.length} คน) — อย่าลืม print แล้วตั้ง secret AUTH_USERS ใหม่`);
} else if (cmd === 'list') {
  const list = readUsers();
  if (!list.length) { console.log('ยังไม่มีผู้ใช้ในไฟล์นี้'); process.exit(0); }
  for (const u of list) console.log(`${u.username}\t${u.role}\t${u.ampur || '(ทุกอำเภอ)'}\t${u.display_name}`);
} else if (cmd === 'print') {
  const list = readUsers();
  if (!list.length) { console.error('ยังไม่มีผู้ใช้ — รัน add ก่อน'); process.exit(1); }
  console.log(JSON.stringify(list));
} else {
  console.error(`ไม่รู้จักคำสั่ง '${cmd}'`);
  process.exit(1);
}
