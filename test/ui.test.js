const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadUi } = require('./load-ui');

let sandbox;
beforeEach(() => { sandbox = loadUi(); sandbox.window.smivEngine.state.settings = { smi_prevalence_pct: 4.37, smiv_ratio_pct: 11.92, max_age_included: 60, current_fiscal_year_be: 2569 }; });

test('buildProblemPatients: ผู้ป่วยก่อความรุนแรงซ้ำ = ความสำคัญ "สูง" เสมอ ไม่ว่าจะมีปัญหาอื่นร่วมด้วยกี่ข้อ', () => {
  sandbox.window.smivEngine.state.patients = [mkPatient({ pid: '1', fiscal_year_be: 2569, has_repeat_violence: true, follow_last: '2569-01-01', total_visits: 3 })];
  const rows = sandbox.buildProblemPatients(2569, 'ampur', '');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].priority, 'สูง');
});

test('buildProblemPatients: ไม่มีปัญหาเลย ต้องไม่ติดอยู่ในลิสต์ (ไม่ใช่ปัญหาของทุกคน)', () => {
  sandbox.window.smivEngine.state.patients = [mkPatient({
    pid: '1', fiscal_year_be: 2569, has_repeat_violence: false, total_visits: 2,
    follow_last: '2569-06-01', first_date_serv: '2568-10-01', birth: '2530-01-01', tambon: 'T1',
  })];
  const rows = sandbox.buildProblemPatients(2569, 'ampur', '');
  assert.equal(rows.length, 0);
});

test('buildProblemPatients: follow_last ว่าง = ปัญหา "ขาดการติดตาม" ความสำคัญอย่างน้อยระดับกลาง/ปกติ', () => {
  sandbox.window.smivEngine.state.patients = [mkPatient({ pid: '1', fiscal_year_be: 2569, follow_last: null, has_repeat_violence: false })];
  const rows = sandbox.buildProblemPatients(2569, 'ampur', '');
  assert.equal(rows.length, 1);
  assert.ok(rows[0].issues.includes('ขาดการติดตาม (follow_last ว่าง)'));
  assert.notEqual(rows[0].priority, 'สูง'); // ไม่ก่อซ้ำ จึงไม่ใช่ระดับสูง
});

test('buildProblemPatients: กรองตามอำเภอ (areaFilter) ได้ถูกต้อง', () => {
  sandbox.window.smivEngine.state.patients = [
    mkPatient({ pid: '1', ampur: '01', fiscal_year_be: 2569, follow_last: null }),
    mkPatient({ pid: '2', ampur: '02', fiscal_year_be: 2569, follow_last: null }),
  ];
  const rows = sandbox.buildProblemPatients(2569, 'ampur', '01');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].p.ampur, '01');
});

test('buildProblemPatients: เรียงลำดับ สูง มาก่อน กลาง/ปกติ เสมอ', () => {
  sandbox.window.smivEngine.state.patients = [
    mkPatient({ pid: '1', fiscal_year_be: 2569, has_repeat_violence: false, follow_last: null }), // กลาง/ปกติ
    mkPatient({ pid: '2', fiscal_year_be: 2569, has_repeat_violence: true, follow_last: '2569-01-01', total_visits: 3 }), // สูง
  ];
  const rows = sandbox.buildProblemPatients(2569, 'ampur', '');
  assert.equal(rows[0].priority, 'สูง');
});

test('checkLowAccessRatePersistence: E >= 40% ต้องลบสถานะเตือนและซ่อน banner', () => {
  sandbox.localStorage.setItem('smivplus_low_e_since', new Date(Date.now() - 40 * 86400000).toISOString());
  sandbox.checkLowAccessRatePersistence(45, true);
  assert.equal(sandbox.localStorage.getItem('smivplus_low_e_since'), null);
});

test('checkLowAccessRatePersistence: E ต่ำกว่าเป้าแต่เพิ่งเริ่ม (<30 วัน) ยังไม่ต้องขึ้นเตือน', () => {
  sandbox.localStorage.setItem('smivplus_low_e_since', new Date(Date.now() - 5 * 86400000).toISOString());
  const banner = sandbox.document.querySelector('#lowEAlertBanner');
  sandbox.checkLowAccessRatePersistence(20, true);
  assert.equal(banner.hidden, true);
});

test('checkLowAccessRatePersistence: E ต่ำกว่าเป้าต่อเนื่องเกิน 30 วัน ต้องขึ้นเตือน', () => {
  sandbox.localStorage.setItem('smivplus_low_e_since', new Date(Date.now() - 31 * 86400000).toISOString());
  const banner = sandbox.document.querySelector('#lowEAlertBanner');
  sandbox.checkLowAccessRatePersistence(20, true);
  assert.equal(banner.hidden, false);
});

test('checkLowAccessRatePersistence: ไม่มีข้อมูลประชากร ต้องไม่ขึ้นเตือน (E คำนวณไม่ได้จริง ไม่ใช่ E ต่ำจริง)', () => {
  sandbox.localStorage.setItem('smivplus_low_e_since', new Date(Date.now() - 31 * 86400000).toISOString());
  const banner = sandbox.document.querySelector('#lowEAlertBanner');
  sandbox.checkLowAccessRatePersistence(0, false);
  assert.equal(banner.hidden, true);
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
