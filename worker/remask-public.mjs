/* eslint-disable no-console */
/*
 * ปิดบังไฟล์สาธารณะใน docs/ ซ้ำด้วยกฎเดียวกับ Worker (toPublicPayload)
 * ใช้เมื่อกฎการปิดบังเข้มขึ้น หรือพบไฟล์ที่เผยแพร่ด้วยเวอร์ชันเก่า:
 *   node worker/remask-public.mjs
 * แก้ docs/data.json และ docs/history/*.json (ยกเว้น index.json) ในที่ — ไม่แตะข้อมูลจริงใน KV
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPublicPayload } from './lib.mjs';

const docs = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const files = [path.join(docs, 'data.json'),
  ...fs.readdirSync(path.join(docs, 'history')).filter(f => f.endsWith('.json') && f !== 'index.json').map(f => path.join(docs, 'history', f))];

for (const file of files) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const masked = { ...raw, ...toPublicPayload(raw) };
  fs.writeFileSync(file, JSON.stringify(masked));
  console.log(`${path.relative(docs, file)}: ${masked.patients.length} คน`);
}
