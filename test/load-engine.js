// โหลด docs/app.js (สคริปต์สำหรับเบราว์เซอร์) เข้า Node ผ่าน vm sandbox ที่มี window ปลอมๆ
// ใช้ได้เพราะ app.js เป็น IIFE ที่ไม่พึ่ง DOM จริง (แตะแค่ window.smivEngine ตอนท้าย)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadEngine() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'docs', 'app.js'), 'utf8');
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  new vm.Script(src, { filename: 'app.js' }).runInContext(sandbox);
  return sandbox.window.smivEngine;
}

module.exports = { loadEngine };
