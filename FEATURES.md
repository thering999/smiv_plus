# SMI-V Plus: 12 Features Summary

## Overview
Complete system for monitoring SMI-V (mental health + substance abuse) patients. 12 features across 3 phases:
- **Phase 1**: Core dashboard + analytics (5 features)
- **Phase 2**: Export + notification (2 features)
- **Phase 3**: Advanced analysis (5 features)

---

## Phase 1: Core Features

### 1. **Action List** (`/action_list.php`)
**Purpose**: Prioritize patients needing immediate attention  
**Key Logic**:
- Flag patients with: repeat violence, no followup, missing data, or 2+ issues
- Priority levels: สูง (red), กลาง (orange), ปกติ (normal)
- Filter by FY, view level, date range

**Test**: Filter patients → verify priorities → export CSV

---

### 2. **Dashboard** (`/dashboard.php`)
**Purpose**: Real-time KPI overview + trend visualization  
**Key Logic**:
- Stat cards: total patients, access rate (E%), followup count (N%), repeat violence
- 3 Chart.js graphs: monthly new patients, access rate across years, sex distribution
- Uses: `build_monthly_trend()`, `build_access_rate_trend()`, `build_sex_distribution()`

**Test**: View stats → change FY → charts update

---

### 3. **Alerts** (`/alert.php`)
**Purpose**: Auto-detect threshold breaches  
**Key Logic**:
- Triggers: low access <40%, high repeat violence >15%, high no-followup >30%, no population data
- Auto-inserts into `alerts` table (deduplicates by ampur+type+FY)
- Dismiss = mark dismissed_at + dismissed_by
- Optional email via `send_alert_email()`

**Test**: View alerts → dismiss → reload (removed) → check email log (if ALERT_EMAIL set)

---

### 4. **Benchmark** (`/benchmark.php`)
**Purpose**: Compare districts against targets & each other  
**Key Logic**:
- Rank districts by selectable metric
- Metrics: access rate (E%), repeat violence %, followup rate (O%), no-followup %
- Status badge: green (ผ่าน) or red (ต้องปรับปรุง)

**Test**: Switch metric → rankings reorder → verify math

---

### 5. **PDF Export** (extend `/export.php`)
**Purpose**: Export report as HTML or Excel  
**Key Logic**:
- Default: Excel (XLSX) via PhpSpreadsheet
- New: ?format=pdf → HTML table (print-to-PDF)
- Same data as benchmark report

**Test**: Download Excel → Download PDF (HTML) → compare

---

## Phase 2: Export & Notify

### 6. **CSV Export** (`/export_patients.php`)
**Purpose**: Distribute problem patient list to district staff  
**Key Logic**:
- Called from `/action_list.php` "📥 Export CSV" button
- File: `problem_patients_fy<YEAR>_<TIMESTAMP>.csv`
- Columns: หน่วยบริการ, PID, ชื่อ, ปัญหา, สิทธิ์, การแนะนำ

**Test**: Filter action_list → export → open CSV in Excel

---

### 7. **Email Alerts** (extend `/alert.php` + report_data.php)
**Purpose**: Proactive notification to admin  
**Key Logic**:
- `send_alert_email()`: reads ALERT_EMAIL env, composes alert, sends via PHP mail()
- Fail-soft: logs error, doesn't crash app
- Called when new alert inserted

**Requires**: 
- Env var: `ALERT_EMAIL=admin@example.com`
- Local mail service (postfix/sendmail)

**Test**: Set ALERT_EMAIL → trigger alert → check maillog

---

## Phase 3: Advanced Features

### 8. **Data Audit** (`/data_audit.php`)
**Purpose**: Detect data quality issues  
**Key Logic**:
- Flags: missing birth, missing name/surname, invalid dates, followup before first visit, future birth dates
- Groups by problem type, counts affected patients
- Uses LEFT JOIN to patient_visits for total_visits

**Test**: View data_audit → verify flagged records match issues

---

### 9. **Intervention Tracker** (`/intervention_tracker.php`)
**Purpose**: Log & track actions per problem area  
**Key Logic**:
- Create `interventions` table (ampur, problem_type, action_taken, responsible_person, target_date, completion_date, status)
- Admin-only
- CRUD: add → ongoing, complete (sets completion_date), delete
- Filter by status: ongoing, completed, all
- CSRF protected

**Requires**: Admin role  
**Test**: Add intervention → complete → mark done → filter

---

### 10. **Report Scheduler** (`/report_scheduler.php`)
**Purpose**: Automate scheduled report generation & distribution  
**Key Logic**:
- Create `report_schedules` table (name, report_type, frequency, email_to, enabled, next_send)
- Frequencies: monthly, quarterly, yearly
- next_send auto-calculated
- Toggle enabled/disabled
- Admin-only

**Requires**: 
- Cron job: `php src/bin/send_scheduled_reports.php` (run hourly)
- Not yet built: send_scheduled_reports.php (template provided in UI)

**Test**: Add schedule → verify next_send date → toggle enable/disable

---

### 11. **District Map (Heatmap)** (`/district_map.php`)
**Purpose**: Geographic visualization of performance  
**Key Logic**:
- SVG canvas with 7 districts as circles
- Heatmap colors: green (good), yellow (medium), red (poor)
- Color thresholds vary by metric:
  - Access rate: green≥40%, yellow 30-40%, red <30%
  - Repeat violence: green≤5%, yellow 5-15%, red >15%
  - Followup: green≥40%, yellow 30-40%, red <30%
- Click circle → popup with value + patients
- Table on right shows ranking

**Test**: View map → click district → verify value in popup → change metric → colors update

---

### 12. **Forecast** (`/forecast.php`)
**Purpose**: Predict next year's access rate using trend analysis  
**Key Logic**:
- `linearRegression($data)`: fit line to historical access rates
- Forecast = intercept + slope * next_year
- Interpret: if slope >0 = improving, <0 = declining
- Status: green (≥40%), orange (30-40% + improving), red (<30% + declining)

**Math**:
```
slope = (n*∑XY - ∑X*∑Y) / (n*∑X² - (∑X)²)
intercept = (∑Y - slope*∑X) / n
forecast = intercept + slope * next_year
```

**Test**: Verify forecast rate + slope sign + status label match data

---

## Database Schema

### New Tables
```sql
-- alerts: triggered when thresholds breach
CREATE TABLE alerts (
  id SERIAL PRIMARY KEY,
  ampur TEXT, alert_type TEXT, message TEXT, severity TEXT,
  fiscal_year_be INT, metric_value FLOAT, threshold FLOAT,
  created_at TIMESTAMP, dismissed_at TIMESTAMP, dismissed_by INT
);

-- interventions: track actions per problem area
CREATE TABLE interventions (
  id SERIAL PRIMARY KEY,
  ampur VARCHAR(50), problem_type VARCHAR(100), action_taken TEXT,
  responsible_person VARCHAR(100), target_date DATE, completion_date DATE,
  status VARCHAR(20), notes TEXT,
  created_by INT, created_at TIMESTAMP, updated_at TIMESTAMP
);

-- report_schedules: auto-report configuration
CREATE TABLE report_schedules (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100), report_type VARCHAR(50), frequency VARCHAR(20),
  email_to TEXT, enabled BOOLEAN,
  last_sent TIMESTAMP, next_send TIMESTAMP,
  created_at TIMESTAMP
);
```

---

## Commits

| Commit | Features | Changes |
|--------|----------|---------|
| `c71f7b7` | Action List, Dashboard, Alerts, Benchmark, PDF | 5 pages, 3 helpers |
| `e9c3caa` | CSV Export, Email Alerts | 1 page, 1 helper |
| `c8f40f0` | Data Audit, Interventions, Scheduler, Map, Forecast | 5 pages, trend logic |

---

## Dependencies

### Required
- PHP 7.4+
- PostgreSQL 12+
- Chart.js (CDN, SRI verified)

### Optional
- Mail service (for email alerts) → env: ALERT_EMAIL
- Cron scheduler (for scheduled reports) → not yet built

### Included
- PhpSpreadsheet (Excel export)
- Existing auth/CSRF framework

---

## Security Checklist

✅ All SQL queries parameterized (prepared statements)  
✅ All POST forms CSRF-protected  
✅ All user output HTML-escaped (htmlspecialchars)  
✅ Admin pages require role check + login  
✅ Email/external calls fail-soft (no crash on error)  
✅ Input validation: int casts, trim, type checks  
✅ SRI integrity for external CDNs (Chart.js)  

---

## Known Limitations

1. **Report Scheduler**: `send_scheduled_reports.php` not yet implemented (template in UI)
2. **Email Alerts**: Requires local mail service + ALERT_EMAIL env var
3. **Map**: Static SVG coordinates (not actual geographic projection)
4. **Forecast**: Linear regression (assumes trend continues; works best with 3+ years data)
5. **Intervention Tracker**: No email notification when target date approaches

---

## Future Enhancements

- [ ] Implement send_scheduled_reports.php (cron job)
- [ ] SMS alerts (Twilio integration)
- [ ] Real geo-mapping (Leaflet.js)
- [ ] ML-based anomaly detection (Prophet)
- [ ] User preferences/dashboards
- [ ] API endpoints for mobile app

---

## Testing
See `TEST_CHECKLIST.md` for comprehensive manual test plan.

**Quick test**: 
1. `docker-compose up -d`
2. Visit http://localhost:8081/smiv_plus/action_list.php
3. Filter → verify patients → export CSV
4. Navigate menu → test each page
