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
