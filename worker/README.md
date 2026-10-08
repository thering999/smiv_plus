# SMI-V Plus — Cloudflare Worker (publish proxy + ยืนยันตัวตน + แยกชั้นข้อมูล)

Worker นี้เป็นด่านเดียวที่เขียนข้อมูลขึ้น GitHub และเป็นด่านเดียวที่แจก **ข้อมูลผู้ป่วยตัวจริง**
(เลขบัตรประชาชน 13 หลัก + ชื่อ-สกุลจริง) ให้ผู้ที่ล็อกอินแล้วเท่านั้น ใช้สำหรับงานติดตามรายคน

## แนวคิดการแยกชั้นข้อมูล

| ชั้นข้อมูล | อยู่ที่ไหน | ใครเห็น |
|---|---|---|
| ตัวชี้วัด/ตารางสรุป/รายชื่อผู้ป่วย**ที่ปิดบังชื่อ-เลขบัตรแล้ว** | GitHub `docs/data.json` + `docs/history/*.json` (สาธารณะ เดา URL ได้) | ทุกคน |
| ข้อมูลผู้ป่วยตัวจริง (cid เต็ม, ชื่อ-สกุลจริง) | พื้นที่ส่วนตัวของ Worker: `PII_KV` หรือ `PII_BUCKET` (R2) — **ไม่เคยขึ้น GitHub** | ผู้ที่ล็อกอินเท่านั้น (จำกัดอำเภอตามสิทธิ์) |
| ประวัติข้อมูลจริงไว้กู้คืน | พื้นที่เดียวกัน (`pii/history/...`) | admin เท่านั้น |

การปิดบังทำที่ Worker (ฝั่งเซิร์ฟเวอร์) เสมอ — ต่อให้ client ส่งข้อมูลเต็มมา ข้อมูลที่ขึ้น GitHub
ก็ถูกตัด `cid` ออกและปิดชื่อ-สกุลแล้ว ถ้าไม่มีที่เก็บข้อมูลส่วนตัว ระบบจะ **ปฏิเสธการเผยแพร่** (500)
แทนที่จะเขียนข้อมูลลง GitHub โดยไม่มีที่เก็บข้อมูลจริง

## Endpoint

| Method + path | ต้องมี | ทำอะไร |
|---|---|---|
| `GET /health` | – | สถานะการตั้งค่า (`piiStorage`, `github`, `auth`, `version`) ใช้เฝ้าระวังระบบ |
| `POST /login` | body `{username,password}` | ตรวจรหัสผ่าน (PBKDF2-SHA256 150k รอบ) → คืน token เซ็น HMAC อายุ 8 ชม. |
| `POST /patient-data` | `Authorization: Bearer <token>` | คืนข้อมูลผู้ป่วยตัวจริง (จำกัดอำเภอตามสิทธิ์) |
| `POST /` (publish) | admin token + `X-Site-Key` | เก็บข้อมูลเต็มลงพื้นที่ส่วนตัว + เขียนสำเนาที่ปิดบังแล้วขึ้น GitHub |
| `POST /` `{action:"delete_history", file}` | admin token | ลบสำเนาประวัติสาธารณะ |
| `POST /` `{action:"full_history"}` | admin token | ดูรายการประวัติข้อมูลจริง |
| `POST /` `{action:"restore_full_history", file}` | admin token | กู้คืนข้อมูลจริงชุดนั้นเป็นข้อมูลปัจจุบัน (+ เขียนสำเนาสาธารณะใหม่) |

## ขั้นตอนติดตั้ง (ทำครั้งเดียว)

```bash
cd worker
npx wrangler login

# 1) ที่เก็บข้อมูลผู้ป่วยตัวจริง (เลือกอย่างใดอย่างหนึ่ง — KV ง่ายสุดสำหรับเริ่มต้น)
npx wrangler kv namespace create PII_KV        # copy id ที่ได้ไปเปิดคอมเมนต์ใน wrangler.toml
# หรือแบบไฟล์ในบัคเก็ตส่วนตัว:
# npx wrangler r2 bucket create smiv-pii       # แล้วเปิดคอมเมนต์ [[r2_buckets]]

# 2) ที่เก็บตัวนับการล็อกอินผิด (ไม่ใส่ก็ได้ แต่ถ้าใส่จะล็อกข้าม instance ได้จริง)
npx wrangler kv namespace create LOGIN_KV      # copy id ไปเปิดคอมเมนต์ใน wrangler.toml

# 3) secret
npx wrangler secret put GH_TOKEN        # GitHub fine-grained PAT: Contents Read and write เฉพาะ repo smiv_plus
npx wrangler secret put SESSION_SECRET  # สุ่มยาว: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
npx wrangler secret put SITE_KEY        # ต้องตรงกับ PUBLISH_SITE_KEY ใน docs/ui.js (ค่าเดิมอยู่ใน credentials.local.txt)

# 4) สร้างผู้ใช้ (เก็บเฉพาะ hash — ไม่เก็บรหัสผ่านจริง)
node hash-password.mjs add admin admin - "รหัสผ่านยาวอย่างน้อย10ตัว"
node hash-password.mjs add muk-admin admin 01 "รหัสผ่านผู้ดูแลของอำเภอเมือง"
node hash-password.mjs add muk01 viewer 01 "รหัสผ่านเจ้าหน้าที่อำเภอเมือง"
node hash-password.mjs print           # copy JSON ทั้งก้อนไปตั้ง secret AUTH_USERS
npx wrangler secret put AUTH_USERS     # วาง JSON ที่ print ได้ (PowerShell: node hash-password.mjs print > tmp.txt แล้ว copy จากไฟล์)

# 5) deploy
npx wrangler deploy

# 6) ตรวจว่าตั้งค่าครบ
# เปิด https://smiv-plus-publish.<account>.workers.dev/health
# ต้องเห็น {"ok":true,"piiStorage":"kv","github":true,"auth":true}
```

> `worker/users.local.json` เก็บ hash ของทุกคนในเครื่องคุณ — อยู่ใน `.gitignore` แล้ว ห้าม commit

## ตั้งค่าฝั่งเว็บ (docs/ui.js)

```js
const PUBLISH_WORKER_URL = 'https://smiv-plus-publish.<account>.workers.dev'; // URL ของ Worker ที่ deploy
const PUBLISH_SITE_KEY = '<ค่าเดียวกับ secret SITE_KEY>';
```
เปลี่ยนแล้วต้องขยับเลข `v=` ใน `docs/index.html` และ `CACHE_VERSION` ใน `docs/sw.js` ด้วย

## สิทธิ์ผู้ใช้

- `admin` — เห็นผู้ป่วยทุกอำเภอ · เผยแพร่/ลบ/กู้คืนได้
- `viewer` — เห็นเฉพาะผู้ป่วยในอำเภอที่กำหนด (`ampur` = รหัส 2 หลัก เช่น `01`) · ดูอย่างเดียว (เผยแพร่ไม่ได้)
- ไม่ล็อกอิน — เห็นแค่สำเนาสาธารณะที่ปิดบังชื่อ/เลขบัตรแล้ว


## ความปลอดภัย — สิ่งที่ทำแล้ว และที่ยังไม่ได้ทำ

ทำแล้ว:
- รหัสผ่านเก็บเป็น PBKDF2-SHA256 (salt ต่อคน) ไม่เก็บ plaintext
- token เซ็น HMAC-SHA256 หมดอายุ 8 ชม. ตรวจแบบ constant-time
- throttle ล็อกอินผิด 5 ครั้ง → ล็อก 15 นาที (นับทั้งต่อ IP และต่อชื่อผู้ใช้)
- จ่ายข้อมูลตามสิทธิ์ (admin/viewer + ampur), ตอบด้วย `Cache-Control: no-store`
- allowlist ฟิลด์ที่เผยแพร่สาธารณะ + ปิดบังที่เซิร์ฟเวอร์ + ปฏิเสธถ้าไม่มีที่เก็บข้อมูลส่วนตัว
- CORS จำกัด origin เป็นโดเมนของเว็บระบบนี้

ยังไม่ได้ทำ (ถ้าต้องการแข็งขึ้นอีก):
- **Cloudflare Access (Zero Trust)** ครอบโดเมน/worker เพื่อบังคับล็อกอินองค์กรก่อนถึงหน้าเว็บ — วิธีที่แข็งแรงที่สุดสำหรับข้อมูลสุขภาพ
- rate limit ระดับ edge (ใช้ Rate limiting rules ของ Cloudflare)
- MFA และการผูกกับบัญชีองค์กร (ตอนนี้เป็นรหัสผ่านที่ผู้ดูแลตั้งให้)
- access log รายคนว่าใครเปิดดูข้อมูลผู้ป่วยคนไหน เมื่อไร

residual risk ที่ตั้งใจยอมรับ: `SITE_KEY` อยู่ใน JS สาธารณะ (กันบอทเท่านั้น) — การยืนยันตัวตนจริงอยู่ที่ token
ถ้า token หลุด ผู้ใช้รายนั้นเห็นได้เฉพาะอำเภอของตัวเองจนหมดอายุ (8 ชม.) จึงควรกำหนด `ampur` ให้ทุกบัญชีที่ไม่ใช่ admin

## เก็บกวาดข้อมูลที่เคยขึ้น GitHub แล้ว (สำคัญ)

ไฟล์ข้อมูลผู้ป่วยที่เคย commit ไว้ (`docs/exchange_file_*.xlsx`) ยังอยู่ใน git history แม้ลบไฟล์ออกแล้ว
ต้องล้างประวัติ + revoke token เก่า:

```bash
git rm --cached docs/exchange_file_4852067_1.xlsx docs/exchange_file_4852413_1.xlsx docs/exchange_file_4852442_1.xlsx
pip install git-filter-repo
git filter-repo --invert-paths --path-glob 'docs/exchange_file*'
git push --force-with-lease origin main
```

- สำเนาสาธารณะเก่าใน `docs/history/*.json` (มีวันเกิดเต็ม + ชื่อ-สกุลที่ปิดบางส่วน) จะถูกเขียนทับด้วยชุดใหม่ที่ปิดบังแล้วเมื่อเผยแพร่ครั้งถัดไป
- revoke GitHub PAT เก่าแล้วสร้างใหม่ + rotate รหัสผ่านผู้ใช้ทุกบัญชี
- พิจารณาแจ้งเหตุละเมิดข้อมูลส่วนบุคคล (PDPA ม.37) ตามขั้นตอนของหน่วยงาน

## แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุ/วิธีแก้ |
|---|---|
| `/health` ได้ `piiStorage: null` | ยังไม่เปิดคอมเมนต์ binding `PII_KV`/`PII_BUCKET` ใน wrangler.toml แล้ว deploy ใหม่ |
| เผยแพร่ได้ error `ยังไม่ได้ตั้งค่าพื้นที่เก็บข้อมูลส่วนบุคคล...` | เหมือนข้างบน (ระบบกันไม่ให้เขียนข้อมูลลง GitHub โดยไม่มีที่เก็บข้อมูลจริง) |
| ล็อกอินได้ 401 ทั้งที่รหัสถูก | `AUTH_USERS` ยังไม่ได้ตั้ง หรือตั้งแล้วแต่ลืม deploy |
| ปุ่มเผยแพร่กดไม่ได้ | ยังไม่ได้ล็อกอิน หรือล็อกอินด้วยบัญชี `viewer` (ต้องเป็น `admin`) |
| ข้อมูลในหน้าจอยังเป็นชื่อที่ถูกปิดบัง | ยังไม่ได้ล็อกอิน หรือกด "🔄 ดึงข้อมูลจริงล่าสุด" |
| ล็อกอินไม่ผ่านและขึ้นให้รอ 15 นาที | โดน throttle (กันเดารหัส) — รอ หรือใช้บัญชี/IP อื่น |

