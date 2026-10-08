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

test('exportReportXlsx: จำนวนคอลัมน์ของ header ต้องตรงกับทุกแถวข้อมูล (รวมแถวรวม) — บั๊กที่เคยเกิดจริง', () => {
  sandbox.window.smivEngine.state.patients = [mkPatient({ pid: '1', fiscal_year_be: 2569 }), mkPatient({ pid: '2', ampur: '02', fiscal_year_be: 2569 })];
  sandbox.window.smivEngine.state.population = {};
  sandbox.exportReportXlsx('ampur');
  const aoa = sandbox.XLSX.lastAoa;
  const headerRow = aoa[2]; // [title], [blank], [cols], ...rows
  const dataRows = aoa.slice(3);
  assert.ok(dataRows.length > 0, 'ต้องมีอย่างน้อย 1 แถวข้อมูล (รวมแถวรวม) ให้ตรวจสอบ');
  for (const row of dataRows) assert.equal(row.length, headerRow.length, `แถวข้อมูล [${row}] มีจำนวนคอลัมน์ไม่ตรงกับ header`);
});

test('exportIssuesXlsx: จำนวนคอลัมน์ของ header ต้องตรงกับทุกแถวข้อมูล — บั๊กที่เคยเกิดจริง', () => {
  sandbox.window.smivEngine.state.patients = [mkPatient({ pid: '1', fiscal_year_be: 2569, follow_last: null })];
  sandbox.exportIssuesXlsx();
  const aoa = sandbox.XLSX.lastAoa;
  const headerRow = aoa[0];
  const dataRows = aoa.slice(1);
  assert.ok(dataRows.length > 0, 'ต้องมีอย่างน้อย 1 แถวปัญหาให้ตรวจสอบ (patient มี follow_last ว่างจงใจให้ติดเกณฑ์)');
  for (const row of dataRows) assert.equal(row.length, headerRow.length, `แถวข้อมูล [${row}] มีจำนวนคอลัมน์ไม่ตรงกับ header`);
});

test('checkDataQuality: cid ไม่ครบ 13 หลัก/ไม่ใช่ตัวเลข ต้องขึ้น badCid', () => {
  const patients = [
    mkPatient({ pid: '1', cid: '1234567890123' }), // 13 หลักถูกต้อง
    mkPatient({ pid: '2', cid: '123' }), // สั้นเกิน
    mkPatient({ pid: '3', cid: 'abc1234567890' }), // มีตัวอักษร
    mkPatient({ pid: '4', cid: '' }), // ว่าง ไม่ถือเป็นปัญหารูปแบบ (คนละเคสกับ missing data)
  ];
  const { badCid } = sandbox.checkDataQuality(patients);
  assert.equal(badCid.length, 2);
});

test('checkDataQuality: อายุติดลบหรือเกิน 120 ปี ต้องขึ้น badAge', () => {
  const patients = [
    mkPatient({ pid: '1', age_at_fy_end: 40 }),
    mkPatient({ pid: '2', age_at_fy_end: -1 }),
    mkPatient({ pid: '3', age_at_fy_end: 121 }),
    mkPatient({ pid: '4', age_at_fy_end: null }),
  ];
  const { badAge } = sandbox.checkDataQuality(patients);
  assert.equal(badAge.length, 2);
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

test('buildPublicPayload: ไฟล์ที่ดาวน์โหลดเอง (เส้นทาง manual) ต้องปิดบัง cid/ชื่อ-สกุลด้วย', () => {
  sandbox.window.smivEngine.state.patients = [mkPatient({ pid: '1', cid: '1234567890123', name: 'สมชาย', lname: 'ใจดี' })];
  sandbox.window.smivEngine.state.population = {};
  const payload = sandbox.buildPublicPayload();
  const text = JSON.stringify(payload);
  assert.ok(!text.includes('1234567890123'), 'ห้ามมี cid เต็มในไฟล์ที่ดาวน์โหลด');
  assert.ok(!/\d{13}/.test(text), 'ห้ามมีตัวเลข 13 หลักในไฟล์ที่ดาวน์โหลด');
  assert.equal(payload.patients[0].name, 'ส***');
  assert.equal(payload.patients[0].lname, 'ใ***');
  assert.equal('cid' in payload.patients[0], false);
  assert.equal(payload.patients[0].pid, '1', 'ฟิลด์อื่นต้องยังอยู่ครบเพื่อให้รายงานสาธารณะใช้งานได้');
});



// ---------- โหมดข้อมูลจริง / สิทธิ์ผู้ใช้ (ตรวจผ่าน UI จริงของ ui.js) ----------
test('saveAuth (admin): ซ่อนการ์ดล็อกอิน แสดงแบนเนอร์โหมดข้อมูลจริง และเปิดปุ่มเผยแพร่', () => {
  sandbox.saveAuth({ token: 'v1.a.b', username: 'admin', displayName: 'ผู้ดูแลระบบ', role: 'admin', ampur: null, expiresAt: Math.floor(Date.now() / 1000) + 3600 });
  assert.equal(sandbox.document.getElementById('authBanner').hidden, false);
  assert.equal(sandbox.document.getElementById('authLoginBox').hidden, true);
  assert.equal(sandbox.document.getElementById('publishGithubBtn').disabled, false);
  assert.equal(sandbox.document.body.classList.contains('viewer-role'), false);
  assert.match(sandbox.document.getElementById('authUserLabel').textContent, /ผู้ดูแลระบบ/);
});

test('saveAuth (viewer จำกัดอำเภอ): ปิดปุ่มที่ต้องใช้สิทธิ์ admin + ขึ้นแถบโหมดดูอย่างเดียว', () => {
  sandbox.saveAuth({ token: 'v1.a.b', username: 'muk01', displayName: 'เจ้าหน้าที่อำเภอเมือง', role: 'viewer', ampur: '01', expiresAt: Math.floor(Date.now() / 1000) + 3600 });
  assert.equal(sandbox.document.getElementById('publishGithubBtn').disabled, true);
  assert.equal(sandbox.document.getElementById('xlsxFile').disabled, true);
  assert.equal(sandbox.document.body.classList.contains('viewer-role'), true);
  assert.equal(sandbox.document.getElementById('authBanner').hidden, false);
});

test('clearAuth: กลับสู่โหมดสาธารณะ (แสดงการ์ดล็อกอิน + ปิดปุ่มเผยแพร่)', () => {
  sandbox.saveAuth({ token: 'v1.a.b', username: 'admin', displayName: 'ผู้ดูแลระบบ', role: 'admin', ampur: null, expiresAt: Math.floor(Date.now() / 1000) + 3600 });
  sandbox.clearAuth();
  assert.equal(sandbox.document.getElementById('authLoginBox').hidden, false);
  assert.equal(sandbox.document.getElementById('authBanner').hidden, true);
  assert.equal(sandbox.document.getElementById('publishGithubBtn').disabled, true);
  assert.equal(sandbox.localStorage.getItem('smivplus_auth_v2'), null);
});

test('applyRealPatients: สลับไปใช้ข้อมูลจริง (cid เต็ม) และตารางที่ต้องติดตามแสดงเลขบัตรประชาชน + ปุ่มคัดลอก', () => {
  sandbox.window.smivEngine.state.settings = { smi_prevalence_pct: 4.37, smiv_ratio_pct: 11.92, max_age_included: 60, current_fiscal_year_be: 2569 };
  sandbox.applyRealPatients({
    patients: [mkPatient({ pid: 'P1', cid: '1234567890123', name: 'สมชาย', lname: 'ใจดี', ampur: '01', fiscal_year_be: 2569, follow_last: null })],
    population: {}, settings: {}, publishedAt: '2026-09-29T00:00:00.000Z',
    scope: { username: 'admin', displayName: 'ผู้ดูแลระบบ', role: 'admin', ampur: null, patientCount: 1, totalCount: 1 },
  });
  assert.equal(sandbox.window.smivEngine.state.patients[0].cid, '1234567890123');
  const boxHtml = sandbox.document.querySelector('#problemPatientsBox').innerHTML;
  assert.ok(boxHtml.includes('1234567890123'), 'ตารางต้องแสดงเลขบัตรประชาชนเพื่อใช้ติดตาม');
  assert.ok(boxHtml.includes('data-copy-cid="1234567890123"'), 'ต้องมีปุ่มคัดลอกเลขบัตรประชาชน');
});

test('ยังไม่ล็อกอิน: ไม่แสดงรายชื่อรายบุคคลเลย (แม้แบบปิดบัง) และไม่มีปุ่มคัดลอกเลขบัตร', () => {
  sandbox.window.smivEngine.state.settings = { smi_prevalence_pct: 4.37, smiv_ratio_pct: 11.92, max_age_included: 60, current_fiscal_year_be: 2569 };
  sandbox.window.smivEngine.state.patients = [mkPatient({ pid: 'P1', cid: '', name: 'ส***', lname: 'ใ***', fiscal_year_be: 2569, follow_last: null })];
  sandbox.render();
  const boxHtml = sandbox.document.querySelector('#problemPatientsBox').innerHTML;
  assert.ok(boxHtml.includes('เฉพาะเจ้าหน้าที่ที่เข้าสู่ระบบ'), 'โหมดสาธารณะต้องบอกให้เข้าสู่ระบบ');
  assert.ok(!boxHtml.includes('ส***') && !boxHtml.includes('<table'), 'โหมดสาธารณะต้องไม่มีตารางรายชื่อ');
  assert.ok(!boxHtml.includes('data-copy-cid'), 'โหมดสาธารณะต้องไม่มีปุ่มคัดลอกเลขบัตร');
});

test('publishToGithub: ยังไม่ล็อกอินเป็น admin → ไม่ยิง network เลย และแจ้งให้เข้าสู่ระบบ', async () => {
  await sandbox.publishToGithub();
  assert.equal(sandbox.fetchCalls.length, 0, 'ต้องไม่ยิงไปที่ Worker เลยถ้าไม่ได้ล็อกอิน');
  assert.match(sandbox.document.getElementById('githubPublishStatus').textContent, /เข้าสู่ระบบ/);
});

test('publishToGithub (admin): ส่ง Authorization: Bearer token ไปกับ payload และรายงานผลสำเร็จ', async () => {
  sandbox.saveAuth({ token: 'v1.token.sig', username: 'admin', displayName: 'ผู้ดูแลระบบ', role: 'admin', ampur: null, expiresAt: Math.floor(Date.now() / 1000) + 3600 });
  sandbox.window.smivEngine.state.patients = [mkPatient({ pid: 'P1', cid: '1234567890123' })];
  const calls = [];
  sandbox.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/health')) return { ok: true, status: 200, json: async () => ({ ok: true, version: '2.0.0' }) };
    return { ok: true, status: 200, json: async () => ({ ok: true, patientCount: 1 }) };
  };
  await sandbox.publishToGithub();
  assert.equal(calls.length, 2, 'ต้องยิง /health เพื่อตรวจเวอร์ชัน Worker ก่อน แล้วจึงยิง publish');
  const publishCall = calls.find(c => !c.url.includes('/health'));
  assert.match(publishCall.url, /smiv-plus-publish/);
  assert.equal(publishCall.init.headers.Authorization, 'Bearer v1.token.sig', 'ต้องแนบ token ไปด้วย ไม่งั้น Worker จะปฏิเสธ');
  assert.ok(JSON.parse(publishCall.init.body).patients[0].cid === '1234567890123', 'ผู้ที่ล็อกอินเป็น admin ส่งข้อมูลจริงให้ Worker (Worker เป็นคนปิดบังก่อนขึ้น GitHub)');
  assert.match(sandbox.document.getElementById('githubPublishStatus').textContent, /เผยแพร่สำเร็จ|ปิดบัง/);
});

test('publishToGithub: ถ้า Worker ที่ deploy ยังเป็นเวอร์ชันเก่า (<2.0.0) ต้องปฏิเสธการเผยแพร่ (กันข้อมูลจริงหลุดขึ้น GitHub)', async () => {
  sandbox.saveAuth({ token: 'v1.token.sig', username: 'admin', displayName: 'ผู้ดูแลระบบ', role: 'admin', ampur: null, expiresAt: Math.floor(Date.now() / 1000) + 3600 });
  sandbox.window.smivEngine.state.patients = [mkPatient({ pid: 'P1', cid: '1234567890123' })];
  const calls = [];
  sandbox.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return { ok: true, status: 200, json: async () => ({ ok: true, version: '1.4.0' }) };
  };
  await sandbox.publishToGithub();
  assert.equal(calls.filter(c => !c.url.includes('/health')).length, 0, 'ต้องไม่ส่งข้อมูลผู้ป่วยไปเลยถ้า Worker เก่า');
  assert.match(sandbox.document.getElementById('githubPublishStatus').textContent, /เวอร์ชันเก่า|ต้อง deploy/);
});

test('followupCoverage: นับติดตามใน 90 วัน และเกินนัด (ไม่นับปิดเคส) แยกอำเภอ', () => {
  const rows = [
    { p: { hoscode: 'H', pid: '1', ampur: '01' } },
    { p: { hoscode: 'H', pid: '2', ampur: '01' } },
    { p: { hoscode: 'H', pid: '3', ampur: '01' } },
    { p: { hoscode: 'H', pid: '4', ampur: '02' } },
  ];
  const map = {
    'H-1': { lastAt: '2026-10-01T03:00:00Z', lastStatus: 'visited', nextDate: '2026-10-05' },
    'H-2': { lastAt: '2026-05-01T03:00:00Z', lastStatus: 'visited', nextDate: '2026-06-01' },
    'H-3': { lastAt: '2026-10-02T03:00:00Z', lastStatus: 'closed', nextDate: '2026-10-03' },
  };
  const cov = sandbox.followupCoverage(rows, map, '2026-10-08');
  assert.deepEqual({ ...cov['01'] }, { total: 3, followed: 2, overdue: 2 });
  assert.deepEqual({ ...cov['02'] }, { total: 1, followed: 0, overdue: 0 });
});

test('buildWorklistHtml: 1 section ต่อหน่วยบริการ, เรียงความสำคัญ, escape HTML', () => {
  const rows = [
    { p: { hoscode: 'A', hosname: 'รพ.สต.ก', pid: '1', name: '<img src=x onerror=alert(1)>', lname: 'x', ampur: '01' }, priority: 'ปกติ', daysOverdue: 10 },
    { p: { hoscode: 'A', hosname: 'รพ.สต.ก', pid: '2', name: 'สูงสุด', lname: 'y', ampur: '01' }, priority: 'สูง', daysOverdue: 5 },
    { p: { hoscode: 'B', hosname: 'รพ.สต.ข', pid: '3', name: 'z', lname: 'z', ampur: '02' }, priority: 'กลาง', daysOverdue: null },
  ];
  const html = sandbox.buildWorklistHtml(rows, '2026-10-08');
  assert.equal((html.match(/<section>/g) || []).length, 2);
  assert.ok(!html.includes('<img src=x'), 'ต้อง escape ชื่อ');
  assert.ok(html.indexOf('สูงสุด') < html.indexOf('&lt;img'), 'ความสำคัญสูงต้องมาก่อน');
  assert.ok(html.includes('PDPA'));
});

test('followupCoverage: อำเภอรหัสเดียวกันแต่ต่างจังหวัด ไม่ถูกรวมเป็นอำเภอของมุกดาหาร', () => {
  const rows = [
    { p: { hoscode: 'H', pid: '1', chw_addr: '49', ampur: '01' } },
    { p: { hoscode: 'H', pid: '2', chw_addr: '34', ampur: '01' } },
    { p: { hoscode: 'H', pid: '3', chw_addr: '33', ampur: '09' } },
  ];
  const cov = sandbox.followupCoverage(rows, {}, '2026-10-08');
  assert.equal(cov['01'].total, 1);
  assert.equal(cov['นอกจังหวัด'].total, 2);
  assert.equal(cov['09'], undefined);
});

test('addressLabel: ในจังหวัดแสดง ต./อ., นอกจังหวัดแสดง ต./อ./จ. และไม่มีชื่อก็ใช้รหัสแทน', () => {
  assert.equal(sandbox.addressLabel({ chw_addr: '49', ampur: '01', tambon: '01' }), 'ต.01 อ.เมืองมุกดาหาร');
  assert.equal(sandbox.addressLabel({ chw_addr: '34', ampur: '01', tambon: '01' }), 'ต.01 อ.01 จ.อุบลราชธานี');
});

test('buildProblemPatients: เลือกขอบเขตนอกจังหวัด → เหลือเฉพาะผู้ป่วยนอกจังหวัด', () => {
  sandbox.window.smivEngine.state.patients = [
    mkPatient({ pid: 'in', chw_addr: '49', ampur: '01', fiscal_year_be: 2569, follow_last: null }),
    mkPatient({ pid: 'out', chw_addr: '34', ampur: '01', fiscal_year_be: 2569, follow_last: null }),
  ];
  assert.deepEqual([...sandbox.buildProblemPatients(2569, 'ampur', '', 'out').map(r => r.p.pid)], ['out']);
  assert.deepEqual([...sandbox.buildProblemPatients(2569, 'ampur', '', 'in').map(r => r.p.pid)], ['in']);
  assert.equal(sandbox.buildProblemPatients(2569, 'ampur', '', 'all').length, 2);
});

test('followupCoverage: โหมดนอกจังหวัดแยกแถวตามอำเภอ+จังหวัด', () => {
  const rows = [{ p: { hoscode: 'H', pid: '1', chw_addr: '34', ampur: '01', tambon: '01' } }];
  const cov = sandbox.followupCoverage(rows, {}, '2026-10-08', 90, true);
  assert.deepEqual([...Object.keys(cov)], ['อ.01 จ.อุบลราชธานี']);
});

test('buildOutProvinceSheets: 1 ชีตต่อจังหวัด, ไม่รวมคนในจังหวัด, header ตรงทุกแถว', () => {
  sandbox.window.smivEngine.state.patients = [
    mkPatient({ pid: 'a', chw_addr: '49', fiscal_year_be: 2569 }),
    mkPatient({ pid: 'b', chw_addr: '34', fiscal_year_be: 2569, has_repeat_violence: true }),
    mkPatient({ pid: 'c', chw_addr: '34', fiscal_year_be: 2569 }),
    mkPatient({ pid: 'd', chw_addr: '35', fiscal_year_be: 2569 }),
  ];
  const { summary, sheets } = sandbox.buildOutProvinceSheets(2569);
  assert.deepEqual([...sheets.map(s => s.name)], ['อุบลราชธานี', 'ยโสธร']);
  assert.deepEqual([...summary[1]], ['อุบลราชธานี', 2, 1]);
  for (const sh of sheets) for (const row of sh.aoa) assert.equal(row.length, sh.aoa[0].length);
  assert.ok(!sheets.some(sh => sh.aoa.some(r => r[3] === 'a')), 'คนในจังหวัดต้องไม่อยู่ในไฟล์');
});
