/*
 * SMI-V Plus publish/auth proxy — entry point ของ Cloudflare Worker
 *
 * ตรรกะทั้งหมดอยู่ใน ./lib.mjs (แยกออกมาเพื่อให้เทสต์ใน Node ได้จริง: ดู test/worker.test.mjs)
 * deploy:  cd worker && npx wrangler deploy     (secret/binding ทั้งหมดดู worker/README.md)
 *
 * หน้าที่ของ Worker นี้:
 *   POST /login          → ตรวจชื่อผู้ใช้/รหัสผ่าน (PBKDF2) คืน token เซ็น HMAC (8 ชม.)
 *   POST /patient-data   → คืนข้อมูลผู้ป่วย *ตัวจริง* (cid 13 หลัก) เฉพาะผู้ถือ token ที่ยังไม่หมดอายุ
 *                          และถูกจำกัดอำเภอตามสิทธิ์ของผู้ใช้ (admin = ทั้งหมด)
 *   POST / (publish)     → รับข้อมูลเต็มจาก admin → เก็บข้อมูลเต็มไว้ในพื้นที่ส่วนตัว (R2/KV)
 *                          แล้วเขียน "สำเนาที่ปิดบังข้อมูลส่วนบุคคลแล้ว" ขึ้น GitHub Pages เท่านั้น
 *   POST / (delete_history | full_history | restore_full_history) → จัดการประวัติ (admin)
 *   GET/POST /followups  → บันทึก/อ่านการติดตามผู้ป่วยรายคน (จำกัดอำเภอ)
 *   GET  /audit          → บันทึกการเข้าถึงข้อมูล (admin)
 *   POST /notify-overdue → แจ้งผู้ป่วยเกินนัดทาง LINE (admin, dry-run เป็นค่าเริ่มต้น) + Cron ทุกเช้า
 *   GET  /health         → สถานะการตั้งค่า (ไม่มีความลับ) ใช้เฝ้าระวังระบบ
 */
import { createWorkerHandler } from './lib.mjs';

export default createWorkerHandler();
