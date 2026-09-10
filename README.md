# SMI-V Plus

ระบบรายงาน "ร้อยละผู้ป่วยจิตเวชสารเสพติดก่อความรุนแรง (SMI-V) ในเขตสุขภาพเข้าถึงบริการได้รับการดูแลต่อเนื่องและไม่ก่อความรุนแรงซ้ำ"
ตามรายงานมาตรฐาน HDC (Health Data Center) — นำเข้าข้อมูลจาก Excel (`exchange_file.xlsx` ชีต `Data`) แล้วแสดงตาราง สรุปรายอำเภอ/รวม

## Stack

PHP 8.2 (Apache) + PostgreSQL 16 + PhpSpreadsheet, Docker Compose

## เริ่มต้นใช้งาน

```bash
cp .env.example .env    # แก้รหัสผ่าน
docker compose up -d --build
docker compose exec web composer install
docker compose exec web php bin/create_admin.php admin "รหัสผ่านของคุณ12345"
```

เปิด http://localhost:8081/

## Deploy ออนไลน์แบบไม่ต้องเปิดเครื่องตัวเองทิ้งไว้ (Render — free tier)

[Render](https://render.com) มี Docker web service + PostgreSQL ฟรีทั้งคู่ ตรงกับ stack นี้พอดี (ย้ายจาก MySQL มา Postgres แล้วเพื่อรองรับ Render free tier — Railway หมด trial แล้วไม่ฟรีอีกต่อไป)

**ข้อจำกัด free tier**: web service จะ sleep เมื่อไม่มีคนเข้าใช้ ~15 นาที ปลุกใหม่ใช้เวลาสั้นๆ ตอนมีคนเข้าครั้งถัดไป — เหมาะกับงานที่ไม่ได้ใช้ตลอดเวลา

1. Push โค้ดขึ้น GitHub ให้เสร็จก่อน
2. ไป https://dashboard.render.com → **New → Blueprint** → เชื่อม repo `thering999/smiv_plus`
   Render จะอ่าน `render.yaml` ที่ root แล้วสร้างทั้ง web service + Postgres database ให้อัตโนมัติ พร้อมเชื่อม env vars ให้เอง (ไม่ต้อง copy ค่าเอง)
3. รอ build เสร็จ (Dockerfile ฝัง composer install ไว้แล้ว ไม่ต้องรันเพิ่ม)
4. Import schema ครั้งแรก: เปิด Postgres service ในหน้า Render → **Connect → External Connection** copy คำสั่ง `psql` แล้วรันจากเครื่องตัวเอง:
   ```bash
   psql <connection string จาก Render> -f db/schema.sql
   ```
5. สร้าง admin คนแรก: เปิด web service → tab **Shell** (Render ให้ shell เข้า container ได้ฟรีจากหน้าเว็บ ไม่ต้องติดตั้ง CLI) รัน:
   ```bash
   php bin/create_admin.php admin "รหัสผ่านที่ปลอดภัย"
   ```
6. Render สร้างโดเมน `https://smiv-plus.onrender.com` ให้อัตโนมัติพร้อม HTTPS

หมายเหตุ: ขั้นตอน login GitHub/Render ต้องทำในเบราว์เซอร์ของคุณเอง (เป็น OAuth แบบ interactive) — Claude ทำแทนไม่ได้

## เปิดออกอินเทอร์เน็ตแบบพึ่งเครื่องตัวเอง (Cloudflare Tunnel)

Stack เป็น PHP+PostgreSQL รันบน Cloudflare Pages/Workers ตรงๆ ไม่ได้ (Workers รองรับแค่ JS/TS, DB เป็น D1/SQLite) — ใช้ **Cloudflare Tunnel** แทน: เปิดเครื่อง/เซิร์ฟเวอร์ที่รัน Docker นี้ออกอินเทอร์เน็ตผ่าน Cloudflare โดยไม่ต้องเปิดพอร์ต ไม่ต้อง rewrite โค้ด

1. ไป https://one.dash.cloudflare.com/ → **Networks → Tunnels → Create a tunnel** → เลือก Cloudflared → ตั้งชื่อ
2. หน้าถัดไปจะให้ **token** (สตริงยาว) — copy เก็บไว้ (**ห้ามแชร์ที่ไหนแบบเปิดเผย** เทียบเท่ารหัสผ่าน)
3. ใส่ token ในไฟล์ `.env`:
   ```
   CLOUDFLARE_TUNNEL_TOKEN=<token ที่ copy มา>
   ```
4. ตั้ง **Public Hostname** ในหน้า dashboard เดียวกัน: Service type = `HTTP`, URL = `web:80` (ชื่อ service ในเครือข่าย Docker ภายใน ไม่ใช่ localhost)
5. รัน tunnel:
   ```bash
   docker compose --profile cloudflare up -d
   ```
6. เข้าผ่านโดเมนที่ตั้งไว้ (เช่น `smiv.yourdomain.com`) ได้ทันที มี HTTPS ให้อัตโนมัติ

**หมายเหตุ**: เครื่องที่รัน Docker ต้องเปิดทิ้งไว้ตลอดเวลาที่ต้องการให้เว็บออนไลน์ (Cloudflare Tunnel เป็นแค่ทางเชื่อม ไม่ใช่ hosting) — ถ้าต้องการ uptime 24 ชม. จริงจัง ควรย้าย Docker ไปรันบน VPS แทน
ถ้าโดเมนของ Public Hostname เป็น subdomain เฉพาะของระบบนี้ (ไม่ได้แชร์กับแอปอื่น) แนะนำตั้ง `APP_BASE_PATH=` (ว่าง) ใน docker-compose.yml แทน `/smiv_plus` เพื่อให้ URL สะอาดขึ้น

## นำเข้าข้อมูล

เมนู "ผู้ดูแลระบบ → นำเข้า Excel" อัปโหลดไฟล์ .xlsx ที่มีชีตชื่อ `Data` หัวคอลัมน์:
`hoscode, hosname, pid, cid, name, lname, birth, sex, chw_addr, tambon, ampur, first_date_serv, date_serv, diagcode, b03x, follow_last`
(`date_serv`/`diagcode`/`b03x` คั่นด้วย `|` เรียงตามลำดับครั้งที่มารับบริการ)

## สูตรคำนวณ (อ้างอิง docs/ — เอกสาร HDC Template, ยืนยันตัวเลขตัวอย่างในรายงานจริงแล้ว)

- **นิยามรหัส**: 1B030=SMI-V1(ทำร้ายตนเอง), 1B031=SMI-V2(ทำร้ายผู้อื่น/ก่อเหตุชุมชน), 1B032=SMI-V3(หลงผิด มุ่งร้ายเฉพาะเจาะจง), 1B033=SMI-V4(ก่อคดีอาชญากรรมรุนแรง), 1B037=รหัสติดตามที่ไม่ก่อซ้ำ (ลงคู่กับ 1B030-33)
- B = ผู้ป่วยเก่า (first_date_serv ก่อนปีงบปัจจุบัน), C = ผู้ป่วยใหม่ (ในปีงบปัจจุบัน), D = B+C
- H = ประชากร 15-60 ปี ย้อนหลัง 2 ปี — **ไม่ได้มาจากไฟล์นำเข้า** กรอกเองที่เมนู "ประชากร/ประมาณการณ์" ต่อปีงบ/อำเภอ
- **I = H × 4.37% (ความชุก SMI) × 11.92% (สัดส่วน SMI-V)** — คำนวณอัตโนมัติ ไม่ต้องกรอกมือ (ยืนยันตรงกับตัวอย่างจริง: 236,984×0.0437×0.1192 = 1,234)
- E = D/I×100 (อัตราเข้าถึงบริการ)
- J = ติดตาม 1 ครั้ง (มารับบริการ 2 ครั้งรวมครั้งแรก), K = J ที่ไม่ก่อซ้ำ, L = K/I×100
- M = ติดตามอย่างน้อย 2 ครั้ง (มารับบริการ ≥3 ครั้งรวมครั้งแรก), N = M ที่ไม่ก่อซ้ำ, O = N/I×100
- F = ไม่ก่อความรุนแรงซ้ำสะสม (จากผู้ป่วยทั้งหมด D), G = O
- **"ก่อความรุนแรงซ้ำ"**: ไม่มี ICD code แยก — นับจากจำนวนรหัส `b03x` (1B030-1B033) ที่ผู้ป่วยถูกลงทะเบียน **มากกว่า 1 ครั้ง** สะสม (ครั้งที่ 2 เป็นต้นไปคือ "ก่อซ้ำ") ครั้งที่ติดตามแล้วไม่ก่อซ้ำจะลงรหัสร่วมกับ 1B037 แทน จึงไม่เพิ่มจำนวนใน b03x
- ตัดผู้ป่วยอายุเกิน 60 ปี ณ สิ้นปีงบ ออกจากตัวนับ (ปรับได้ที่ "ตั้งค่าระบบ")
- **ยังไม่ตัดผู้เสียชีวิตออก** — HDC ระบุให้ตัดจากฐานข้อมูลกระทรวงมหาดไทย แต่ระบบนี้ไม่มีช่องทางเชื่อมข้อมูล ต้องเพิ่ม integration ภายหลังถ้าต้องการความแม่นยำเทียบเท่า HDC 100%

## ที่มาข้อมูล (อ้างอิงเอกสาร docs/)

- `templete.pdf`, `ร้อยละของผู้ป่วยจิตเวช...pdf` — สเปครายงาน HDC Template ตัวที่ 19, นิยามรหัส 1B03x, สูตรคำนวณ I
- `การดำเนินงาน V Care เขตสุขภาพที่ 8...pdf` — workflow ดำเนินงาน, KPI accessibility rate เป้า >40% (2569) / 100% (2571)
- `การคัดกรองและติดตามดูแลประชาชนกลุ่มเสี่ยง...pdf` (จ.อุบลราชธานี) — เกณฑ์ 5 สัญญาณเตือน (SMI-V SCAN), คะแนน OAS/สี, ใช้ในระบบคัดกรอง V-Care ต้นทาง (ไม่ได้ใช้ในระบบ smiv_plus นี้โดยตรง เพราะรับข้อมูลที่ผ่านการลงทะเบียน HDC แล้ว)

## หมายเหตุความปลอดภัยข้อมูล

`exchange_file.xlsx` และไฟล์ใน `docs/` เป็นข้อมูล/เอกสารที่อาจมีข้อมูลผู้ป่วยระดับบุคคล — อยู่ใน `.gitignore` ห้าม commit ขึ้น git
