# SMI-V Plus Feature Test Checklist

**Status**: All 12 features implemented, syntax-checked, security-verified
**Prerequisites**: Docker Desktop running, `docker-compose up -d` executed

## Setup
- [ ] Start Docker: `docker-compose up -d`
- [ ] Wait for PostgreSQL healthcheck (5-10s)
- [ ] Access http://localhost:8081/smiv_plus/index.php
- [ ] Login (default admin from db/schema.sql)

---

## Phase 1: Core Features (5)

### 1. Action List (`/action_list.php`)
- [ ] Navigate to menu → "รายชื่อต้องติดตาม"
- [ ] Filter by fiscal year, view level (ampur/hoscode)
- [ ] Verify patients flagged as priority สูง (repeat violence), priority กลาง (2+ issues), priority ปกติ
- [ ] Click "📥 Export CSV" → download problem_patients_*.csv
- [ ] Verify CSV contains: หน่วยบริการ, PID, ชื่อ, ปัญหา, สิทธิ์, การแนะนำ

### 2. Dashboard (`/dashboard.php`)
- [ ] Navigate to menu → "แดชบอร์ด"
- [ ] View stat cards: ผู้ป่วยทั้งหมด (D), อัตราเข้าถึงบริการ (E%), ติดตาม≥2ครั้ง (N), ก่อความรุนแรงซ้ำ
- [ ] Verify 3 charts render: monthly trend (bar), access rate trend (line), sex distribution (doughnut)
- [ ] Change fiscal year → charts update

### 3. Alerts (`/alert.php`)
- [ ] Navigate to menu → "การแจ้งเตือน"
- [ ] Verify alerts auto-generated for breaches: low access <40%, high repeat violence >15%, high no-followup >30%
- [ ] Click "ยืนยันแล้ว" → alert dismissed and removed from list
- [ ] Change fiscal year → shows different alerts
- [ ] Check error log for email attempts (ALERT_EMAIL env not set = expected fail-soft)

### 4. Benchmark (`/benchmark.php`)
- [ ] Navigate to menu → "เปรียบเทียบผลงาน"
- [ ] Select metric: อัตราเข้าถึงบริการ (default)
- [ ] Verify districts ranked by access rate
- [ ] Switch metric → ก่อความรุนแรงซ้ำ, อัตราติดตาม, สัดส่วนไม่เคยติดตาม → rankings reorder
- [ ] Green badge = ผ่านเกณฑ์, red = ต้องปรับปรุง

### 5. PDF Export
- [ ] On `/index.php` (Dashboard), find export button
- [ ] Click "Export" → ?format=pdf
- [ ] Verify HTML table renders in browser (can print to PDF via Ctrl+P)
- [ ] Compare with Excel export (?format=xlsx) — same data

---

## Phase 2: Export & Notify (2)

### 6. CSV Export (Patient List)
- [ ] On `/action_list.php`, filter patients, click "📥 Export CSV"
- [ ] Verify file: problem_patients_fy<YEAR>_<TIMESTAMP>.csv
- [ ] Check columns: หน่วยบริการ, PID, ชื่อ-นามสกุล, ปัญหา, สิทธิ์, การแนะนำ
- [ ] Open in spreadsheet → UTF-8 Thai text displays correctly

### 7. Email Alerts
- [ ] Set env var: `ALERT_EMAIL=admin@example.com` (docker-compose.yml)
- [ ] Restart: `docker-compose restart web`
- [ ] Navigate to `/alert.php` → new alerts generated
- [ ] Check mail logs (in container): `docker-compose exec web tail -f /var/log/mail.log` (or check error_log)
- [ ] Without ALERT_EMAIL set: alerts still display, email silently skipped (fail-soft)

---

## Phase 3: Advanced Features (5)

### 8. Data Audit (`/data_audit.php`)
- [ ] Menu → "ตรวจสอบข้อมูล"
- [ ] View summary: ปัญหา count, ประเภทปัญหา count, top problem
- [ ] Verify problem detection:
  - [ ] ไม่มีวันเกิด (birth IS NULL)
  - [ ] ชื่อ/นามสกุลว่าง
  - [ ] วันติดตามก่อนวันแรก (follow_last < first_date_serv)
  - [ ] วันเกิดในอนาคต
  - [ ] ติดตาม >1 แต่ follow_last ว่าง
- [ ] Click patient row → shows all problems for that patient

### 9. Intervention Tracker (`/intervention_tracker.php`)
- [ ] Admin menu → "ติดตามแทรกแซง"
- [ ] Add intervention: ampur, ปัญหา, การดำเนินการ, ผู้รับผิดชอบ, target date
- [ ] Verify intervention appears in table, status = "ดำเนินการอยู่" (yellow)
- [ ] Click ✓ (complete) → status = "สำเร็จ" (green), completion_date set
- [ ] Filter by status: ongoing, completed, all
- [ ] Click ✕ → delete intervention (confirm dialog)

### 10. Report Scheduler (`/report_scheduler.php`)
- [ ] Admin menu → "ตัวกำหนดการรายงาน"
- [ ] Add schedule: ชื่อ, ประเภท (รายอำเภอ), ความถี่ (รายเดือน), email_to
- [ ] Verify next_send date auto-calculated (first day of next month/quarter/year)
- [ ] Toggle enabled/disabled → button color change (green/gray)
- [ ] Delete schedule (confirm dialog)
- [ ] Note: actual sending requires cron job `php src/bin/send_scheduled_reports.php`

### 11. District Map (`/district_map.php`)
- [ ] Menu → "แผนที่ความร้อน"
- [ ] View SVG heatmap circles + legend
- [ ] Select metric:
  - [ ] อัตราเข้าถึงบริการ: green≥40%, yellow 30-40%, red <30%
  - [ ] ก่อความรุนแรงซ้ำ: green≤5%, yellow 5-15%, red >15%
  - [ ] ติดตาม rate: green≥40%, yellow 30-40%, red <30%
- [ ] Click district circle → shows name + metric value + patient count
- [ ] Table on right shows detailed rankings

### 12. Forecast (`/forecast.php`)
- [ ] Menu → "ประมาณการ"
- [ ] View historical data table (past 2+ fiscal years)
- [ ] View forecast card: year, rate, slope, trend
- [ ] If rate ≥40%: "ดีเลิศ" (green)
- [ ] If slope >0 but <40%: "ปานกลาง" (orange)
- [ ] If slope <0: "เสี่ยง" (red)
- [ ] Verify math: linear regression forecast = intercept + slope*next_year

---

## Integration Tests

### Navigation
- [ ] All 12 pages appear in main menu or admin dropdown
- [ ] Menu active state highlights current page
- [ ] "Dashboard" in topbar logo returns to index.php

### Database Tables
- [ ] `alerts` created (trigger: /alert.php first load)
- [ ] `interventions` created (trigger: /intervention_tracker.php first load)
- [ ] `report_schedules` created (trigger: /report_scheduler.php first load)
- [ ] No errors in browser console (F12)

### Security
- [ ] All POST forms have CSRF tokens
- [ ] admin pages require require_admin() + login
- [ ] All user input escaped in HTML output
- [ ] All SQL uses prepared statements
- [ ] No console errors or 500 errors

### Data Consistency
- [ ] Action list: patients match those in dashboard/benchmark
- [ ] Alert thresholds match analyze_area() logic
- [ ] Benchmark ranking matches report data
- [ ] Forecast uses same population estimates as main report

---

## Load Test (Optional)

### Generate Data
```sql
-- In docker-compose shell:
INSERT INTO population_estimates (fiscal_year_be, ampur, ampur_name, population_15_60)
VALUES (2569, '01', 'เมืองมุกดาหาร', 50000);
-- ...repeat for all ampur
```

### Performance
- [ ] Dashboard loads <2s with 1000+ patients
- [ ] Data audit filters <1s
- [ ] Map renders heatmap circles immediately
- [ ] Forecast regression calculates <500ms

---

## Rollback
If any test fails:
```bash
git log --oneline -12  # see all commits
git revert c8f40f0    # revert Phase 3 (if needed)
```

---

## Sign-off
- [ ] All 12 features tested
- [ ] No blocking bugs
- [ ] Ready for production

**Tested by**: ___________  
**Date**: ___________  
**Notes**: ___________
