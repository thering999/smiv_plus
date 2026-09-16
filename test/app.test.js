const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine } = require('./load-engine');

let engine;
beforeEach(() => { engine = loadEngine(); });

test('pct() คำนวณเปอร์เซ็นต์ปัดทศนิยม 2 ตำแหน่งถูกต้อง', () => {
  assert.equal(engine.pct(642, 1234), 52.03); // ค่าอ้างอิงที่ยืนยันถูกต้องแล้วในระบบจริง
  assert.equal(engine.pct(0, 100), 0);
  assert.equal(engine.pct(5, 0), 0); // หารด้วยศูนย์ต้องไม่ throw/NaN
});

test('I = H × 4.37% × 11.92% (ค่าประมาณการณ์ผู้ป่วย SMI-V) ตรงกับค่าที่ยืนยันแล้ว', () => {
  // H=236,984 → I=1,234 คือค่าที่ยืนยันตรงกับระบบจริงมาก่อนหน้านี้ (byte-for-byte กับ HDC template)
  engine.state.settings = { smi_prevalence_pct: 4.37, smiv_ratio_pct: 11.92, max_age_included: 60, current_fiscal_year_be: 2569 };
  engine.state.population = { 2569: { '01': { name: 'เมืองมุกดาหาร', pop15_60: 236984 } } };
  engine.state.patients = [mkPatient({ ampur: '01', fiscal_year_be: 2568 })]; // ต้องมีผู้ป่วยอย่างน้อย 1 คนให้อำเภอนี้โผล่ในรายงาน
  const { report } = engine.buildReport(2569, 'ampur', null, null);
  assert.equal(report[0].i, 1234);
});

test('E = D / I × 100 ตรงกับค่าที่ยืนยันแล้ว (D=642, I=1234 → E=52.03%)', () => {
  engine.state.settings = { smi_prevalence_pct: 4.37, smiv_ratio_pct: 11.92, max_age_included: 60, current_fiscal_year_be: 2569 };
  engine.state.population = { 2569: { '01': { name: 'เมืองมุกดาหาร', pop15_60: 236984 } } };
  engine.state.patients = Array.from({ length: 642 }, (_, i) => mkPatient({ ampur: '01', fiscal_year_be: 2568, pid: String(i) }));
  const { report } = engine.buildReport(2569, 'ampur', null, null);
  assert.equal(report[0].d, 642);
  assert.equal(report[0].i, 1234);
  assert.equal(report[0].e, 52.03);
});

test('ก่อความรุนแรงซ้ำ: นับผู้ป่วยที่ has_repeat_violence=true เข้า repeat_violence_count และไม่นับใน F (ไม่ก่อซ้ำสะสม)', () => {
  engine.state.settings = { smi_prevalence_pct: 4.37, smiv_ratio_pct: 11.92, max_age_included: 60, current_fiscal_year_be: 2569 };
  engine.state.population = {};
  engine.state.patients = [
    mkPatient({ ampur: '01', fiscal_year_be: 2569, pid: '1', has_repeat_violence: true }),
    mkPatient({ ampur: '01', fiscal_year_be: 2569, pid: '2', has_repeat_violence: false }),
  ];
  const { report } = engine.buildReport(2569, 'ampur', null, null);
  assert.equal(report[0].d, 2);
  assert.equal(report[0].repeat_violence_count, 1);
  assert.equal(report[0].f, 1); // ไม่ก่อซ้ำสะสม = คนที่ไม่ได้ก่อซ้ำ = 1 คน
});

test('ตัดผู้ป่วยอายุเกิน max_age_included (60 ปี) ออกจากรายงาน', () => {
  engine.state.settings = { smi_prevalence_pct: 4.37, smiv_ratio_pct: 11.92, max_age_included: 60, current_fiscal_year_be: 2569 };
  engine.state.population = {};
  engine.state.patients = [
    mkPatient({ ampur: '01', fiscal_year_be: 2569, pid: '1', age_at_fy_end: 45 }),
    mkPatient({ ampur: '01', fiscal_year_be: 2569, pid: '2', age_at_fy_end: 61 }), // เกินเกณฑ์ ต้องถูกตัดออก
  ];
  const { report } = engine.buildReport(2569, 'ampur', null, null);
  assert.equal(report[0].d, 1);
});

test('ตัดผู้ป่วยที่ fiscal_year_be เกินปีงบที่ดูอยู่ออกจากรายงาน (ยังไม่เกิดในปีงบนี้)', () => {
  engine.state.settings = { smi_prevalence_pct: 4.37, smiv_ratio_pct: 11.92, max_age_included: 60, current_fiscal_year_be: 2569 };
  engine.state.population = {};
  engine.state.patients = [
    mkPatient({ ampur: '01', fiscal_year_be: 2569, pid: '1' }),
    mkPatient({ ampur: '01', fiscal_year_be: 2570, pid: '2' }), // ปีงบถัดไป ยังไม่นับใน 2569
  ];
  const { report } = engine.buildReport(2569, 'ampur', null, null);
  assert.equal(report[0].d, 1);
});

test('มุมมองรายจังหวัด (chw_addr): แปลรหัสจังหวัดเป็นชื่อจริง ไม่ใช่ "จังหวัดรหัส XX"', () => {
  engine.state.settings = { smi_prevalence_pct: 4.37, smiv_ratio_pct: 11.92, max_age_included: 60, current_fiscal_year_be: 2569 };
  engine.state.population = {};
  engine.state.patients = [mkPatient({ ampur: '01', chw_addr: '49', fiscal_year_be: 2569, pid: '1' })];
  const { report } = engine.buildReport(2569, 'chw_addr', null, null);
  assert.equal(report[0].ampur_name, 'มุกดาหาร');
});

test('qualityLevelAccess: ขอบเขตระดับคุณภาพตามเกณฑ์กรมสุขภาพจิต', () => {
  assert.equal(engine.qualityLevelAccess(40).level, 5);
  assert.equal(engine.qualityLevelAccess(39.99).level, 4);
  assert.equal(engine.qualityLevelAccess(35).level, 4);
  assert.equal(engine.qualityLevelAccess(30).level, 3);
  assert.equal(engine.qualityLevelAccess(29.99).level, null);
});

test('scoreQuantitative: ให้คะแนนตามตารางขั้นบันได 6 เดือน/10 เดือน', () => {
  assert.equal(engine.scoreQuantitative(20, engine.SCORE_SCALE_6M), 10);
  assert.equal(engine.scoreQuantitative(19, engine.SCORE_SCALE_6M), 9);
  assert.equal(engine.scoreQuantitative(1, engine.SCORE_SCALE_6M), 0);
  assert.equal(engine.scoreQuantitative(40, engine.SCORE_SCALE_10M), 10);
});

test('buildYearlyTrend: นับจำนวนผู้ป่วยใหม่แยกตามปีงบ เรียงจากเก่าไปใหม่', () => {
  engine.state.patients = [
    mkPatient({ fiscal_year_be: 2567, pid: '1' }),
    mkPatient({ fiscal_year_be: 2567, pid: '2' }),
    mkPatient({ fiscal_year_be: 2568, pid: '3' }),
  ];
  const trend = engine.buildYearlyTrend();
  assert.equal(JSON.stringify(trend.years), JSON.stringify([2567, 2568]));
  assert.equal(JSON.stringify(trend.newPatients), JSON.stringify([2, 1]));
});

test('analyzeArea: ไม่มีข้อมูลประชากร (H=0) ต้องแจ้งเตือน no_population และไม่แจ้ง low_access ซ้อน (E คำนวณไม่ได้อยู่แล้ว)', () => {
  const findings = engine.analyzeArea({ d: 10, e: 0, h: 0, repeat_violence_count: 0, zero_followup: 0, missing_birth: 0, missing_tambon: 0, missing_followup: 0, same_day_followup: 0 });
  const categories = findings.map(f => f.category);
  assert.ok(categories.includes('no_population'));
  assert.ok(!categories.includes('low_access')); // ตั้งใจ skip เพราะ E ยังคำนวณไม่ได้จริงเมื่อไม่มี H
});

test('analyzeArea: E ต่ำกว่าเป้า 40% (มี H แล้ว) ต้องแจ้งเตือน low_access', () => {
  const findings = engine.analyzeArea({ d: 10, e: 39.9, h: 1000, repeat_violence_count: 0, zero_followup: 0, missing_birth: 0, missing_tambon: 0, missing_followup: 0, same_day_followup: 0 });
  assert.ok(findings.some(f => f.category === 'low_access'));
});

test('analyzeArea: อัตราก่อความรุนแรงซ้ำเกิน 15% ต้องแจ้งเตือน high_repeat', () => {
  const findings = engine.analyzeArea({ d: 100, e: 50, h: 1000, repeat_violence_count: 16, zero_followup: 0, missing_birth: 0, missing_tambon: 0, missing_followup: 0, same_day_followup: 0 });
  assert.ok(findings.some(f => f.category === 'high_repeat'));
});

test('analyzeArea: ไม่มีปัญหาเลย ต้องคืนสถานะ ok', () => {
  const findings = engine.analyzeArea({ d: 100, e: 50, h: 1000, repeat_violence_count: 0, zero_followup: 0, missing_birth: 0, missing_tambon: 0, missing_followup: 0, same_day_followup: 0 });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].category, 'ok');
});

test('countFindingsByCategory: นับพื้นที่ที่พบปัญหาแต่ละประเภท (นับพื้นที่ ไม่ใช่นับ finding ซ้ำในพื้นที่เดียว)', () => {
  const analysisList = [
    { area: {}, findings: [{ category: 'high_repeat' }, { category: 'data_quality' }] },
    { area: {}, findings: [{ category: 'high_repeat' }] },
    { area: {}, findings: [{ category: 'ok' }] },
  ];
  const counts = engine.countFindingsByCategory(analysisList);
  assert.equal(counts.high_repeat, 2);
  assert.equal(counts.data_quality, 1);
  assert.equal(counts.ok, undefined); // ok ไม่อยู่ใน FINDING_CATEGORY_LABELS จึงไม่ถูกนับ
});

test('buildAccessRateTrend: แสดงเฉพาะปีที่มีข้อมูลประชากรกรอกไว้แล้ว (ปีที่ไม่มีต้องไม่โผล่)', () => {
  engine.state.settings = { smi_prevalence_pct: 4.37, smiv_ratio_pct: 11.92, max_age_included: 60, current_fiscal_year_be: 2569 };
  engine.state.population = {
    2568: { '01': { name: 'A', pop15_60: 50000 } },
    2569: {}, // ปีนี้ยังไม่มีค่า H>0 เลย ต้องไม่โผล่ในผล
  };
  engine.state.patients = [mkPatient({ ampur: '01', fiscal_year_be: 2568, pid: '1' })];
  const trend = engine.buildAccessRateTrend();
  assert.equal(JSON.stringify(trend.years), JSON.stringify([2568]));
  assert.equal(trend.ePct.length, 1);
});

test('buildYearlyTrendByAmpur: แยกยอดผู้ป่วยใหม่ตามอำเภอต่อปีงบ ถูกต้อง และอำเภอนอกพื้นที่ลงกลุ่ม "อื่นๆ"', () => {
  engine.state.patients = [
    mkPatient({ ampur: '01', fiscal_year_be: 2568, pid: '1' }),
    mkPatient({ ampur: '01', fiscal_year_be: 2568, pid: '2' }),
    mkPatient({ ampur: '99', fiscal_year_be: 2568, pid: '3' }), // ไม่ใช่ 1 ใน 7 อำเภอหลัก -> "other"
  ];
  const trend = engine.buildYearlyTrendByAmpur();
  const ampur01 = trend.series.find(s => s.key === '01');
  const other = trend.series.find(s => s.key === 'other');
  assert.equal(ampur01.data[trend.years.indexOf(2568)], 2);
  assert.equal(other.data[trend.years.indexOf(2568)], 1);
});

test('buildViolenceTypeDropoutReport: นับเฉพาะผู้ป่วยก่อซ้ำ+ขาดติดตาม>=30วัน และยึดรหัสรุนแรงสุด (1 คน 1 ประเภท)', () => {
  engine.state.settings = { smi_prevalence_pct: 4.37, smiv_ratio_pct: 11.92, max_age_included: 60, current_fiscal_year_be: 2569 };
  const refDate = new Date('2026-06-15');
  engine.state.patients = [
    // ก่อซ้ำ + ขาดติดตามพอดี 30 วัน + มีทั้ง 1B030 กับ 1B032 -> ต้องนับเป็น 1B032 (รุนแรงกว่า) เท่านั้น
    mkPatient({ pid: '1', fiscal_year_be: 2569, has_repeat_violence: true, b03x_raw: '1B030|1B032', follow_last: '2026-05-16' }),
    // ก่อซ้ำ แต่ขาดติดตามแค่ 10 วัน -> ไม่เข้าเกณฑ์ ไม่นับ
    mkPatient({ pid: '2', fiscal_year_be: 2569, has_repeat_violence: true, b03x_raw: '1B030', follow_last: '2026-06-05' }),
    // ขาดติดตามนาน แต่ไม่ก่อซ้ำ -> ไม่นับ
    mkPatient({ pid: '3', fiscal_year_be: 2569, has_repeat_violence: false, b03x_raw: '1B031', follow_last: '2026-01-01' }),
    // ก่อซ้ำ+ขาดติดตามนาน แต่คนละปีงบ -> ไม่นับ
    mkPatient({ pid: '4', fiscal_year_be: 2568, has_repeat_violence: true, b03x_raw: '1B031', follow_last: '2026-01-01' }),
  ];
  const { totalPatients, rows } = engine.buildViolenceTypeDropoutReport(2569, refDate);
  assert.equal(totalPatients, 1);
  const v3 = rows.find(r => r.code === '1B032');
  const v1 = rows.find(r => r.code === '1B030');
  assert.equal(v3.count, 1);
  assert.equal(v1.count, 0);
});

test('buildViolenceTypeDropoutReportByArea: แยกยอดตามอำเภอ ยอดรวมต้องตรงกับผลรวมของทุกอำเภอ', () => {
  engine.state.settings = { smi_prevalence_pct: 4.37, smiv_ratio_pct: 11.92, max_age_included: 60, current_fiscal_year_be: 2569 };
  const refDate = new Date('2026-06-15');
  engine.state.patients = [
    mkPatient({ pid: '1', ampur: '01', fiscal_year_be: 2569, has_repeat_violence: true, b03x_raw: '1B030', follow_last: '2026-05-01' }),
    mkPatient({ pid: '2', ampur: '02', fiscal_year_be: 2569, has_repeat_violence: true, b03x_raw: '1B031', follow_last: '2026-05-01' }),
    mkPatient({ pid: '3', ampur: '02', fiscal_year_be: 2569, has_repeat_violence: true, b03x_raw: '1B031', follow_last: '2026-05-01' }),
  ];
  const { totalPatients, areas } = engine.buildViolenceTypeDropoutReportByArea(2569, 'ampur', refDate);
  assert.equal(totalPatients, 3);
  const a01 = areas.find(a => a.key === '01'), a02 = areas.find(a => a.key === '02');
  assert.equal(a01.total, 1);
  assert.equal(a02.total, 2);
  assert.equal(areas.reduce((s, a) => s + a.total, 0), totalPatients);
});

test('crossCheckRegistry: หา PID ที่มีในทะเบียน HDC แต่ขาดใน import และกลับกัน โดยเทียบ hoscode+pid', () => {
  engine.state.patients = [
    mkPatient({ pid: '1', hoscode: 'H1' }), // มีทั้งสองฝั่ง
    mkPatient({ pid: '2', hoscode: 'H1' }), // มีเฉพาะใน import (ไม่พบในทะเบียน)
  ];
  const registryRows = [
    { hoscode: 'H1', pid: '1', cid: 'x', name: 'a', lname: 'b' },
    { hoscode: 'H1', pid: '3', cid: 'y', name: 'c', lname: 'd' }, // มีเฉพาะในทะเบียน (ขาดใน import)
  ];
  const result = engine.crossCheckRegistry(registryRows);
  assert.equal(result.registryTotal, 2);
  assert.equal(result.importedTotal, 2);
  assert.equal(result.missingInImport.length, 1);
  assert.equal(result.missingInImport[0].pid, '3');
  assert.equal(result.extraInImport.length, 1);
  assert.equal(result.extraInImport[0].pid, '2');
});

test('parseRegistryWorkbook: ดึง hoscode/pid/cid/name/lname ได้ไม่ว่าคอลัมน์อื่นจะมีอะไรบ้าง (ฟอร์แมต HDC ไม่ตายตัว)', () => {
  const wb = {
    SheetNames: ['sheet1'],
    Sheets: { sheet1: [
      ['hoscode', 'hosname', 'pid', 'cid', 'name', 'lname', 'hn', 'nation', 'vhid', 'typearea', 'discharge', 'fx_all', 'g_code', 'total_visit'],
      ['10712', 'รพ.ทดสอบ', '543823', '0107xxxxx1234', 'พุดส', 'หลว', '670014971', '099', '49010104', '4', '9', '0', '{}', '1'],
    ] },
  };
  const rows = engine.parseRegistryWorkbook(wb);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hoscode, '10712');
  assert.equal(rows[0].pid, '543823');
  assert.equal(rows[0].cid, '0107xxxxx1234');
  assert.equal(rows[0].name, 'พุดส');
});

test('parseRegistryWorkbook: ฟอร์แมตคอลัมน์น้อย (ไม่มี cid/name/lname) ก็อ่านได้ ไม่ throw', () => {
  const wb = { SheetNames: ['s'], Sheets: { s: [['hoscode', 'pid'], ['10712', '1']] } };
  const rows = engine.parseRegistryWorkbook(wb);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cid, '');
});

test('parseRegistryWorkbook: ไม่มีคอลัมน์ hoscode/pid ต้อง throw บอกชัดว่าไฟล์ไม่ถูกต้อง', () => {
  const wb = { SheetNames: ['s'], Sheets: { s: [['name', 'lname'], ['a', 'b']] } };
  assert.throws(() => engine.parseRegistryWorkbook(wb), /hoscode/);
});

test('parseRegistryWorkbook: แถวที่ hoscode หรือ pid ว่าง ต้องถูกข้าม', () => {
  const wb = { SheetNames: ['s'], Sheets: { s: [['hoscode', 'pid'], ['10712', ''], ['', '1'], ['10712', '2']] } };
  const rows = engine.parseRegistryWorkbook(wb);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pid, '2');
});

test('validateAndParse: อัปโหลดไฟล์ HDC Data-Exchange ผิดช่อง ต้องเตือนให้ไปใช้ช่อง cross-check แทน', () => {
  const wb = {
    SheetNames: ['sheet1'],
    Sheets: { sheet1: [
      ['hoscode', 'hosname', 'pid', 'cid', 'name', 'lname', 'hn', 'birth', 'sex', 'nation', 'vhid', 'typearea', 'discharge', 'fx_all', 'g_code', 'total_visit'],
      ['10712', 'x', '1', '2', 'a', 'b', '3', '2530-01-01', '1', '099', '49010104', '4', '9', '0', '{}', '1'],
    ] },
  };
  assert.throws(() => engine.validateAndParse(wb), /HDC Data-Exchange/);
});

function mkPatient(overrides = {}) {
  return {
    hoscode: 'H1', hosname: 'โรงพยาบาลทดสอบ', pid: 'P1', cid: '1', name: 'ทดสอบ', lname: 'ระบบ',
    birth: '2530-01-01', sex: 1, chw_addr: '49', tambon: 'T1', ampur: '01',
    first_date_serv: '2025-10-01', date_serv_raw: '2025-10-01', diagcode_raw: 'F20',
    b03x_raw: '1B030', follow_last: null, fiscal_year_be: 2569, age_at_fy_end: 40,
    has_repeat_violence: false, total_visits: 1, smiv_code_count: 1,
    ...overrides,
  };
}
