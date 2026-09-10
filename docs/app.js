/* SMI-V Plus — static client-side engine (พอร์ตจาก report_data.php/importer.php เดิม) */
(function () {
'use strict';

const EXPECTED_HEADERS = ['hoscode','hosname','pid','cid','name','lname','birth','sex','chw_addr','tambon','ampur','first_date_serv','date_serv','diagcode','b03x','follow_last'];
const REPORT_LEVELS = { ampur: 'รายอำเภอ', hoscode: 'รายหน่วยบริการ', chw_addr: 'รายจังหวัด (ภูมิลำเนาผู้ป่วย)' };
const KNOWN_AMPUR = { '01':'เมืองมุกดาหาร','02':'นิคมคำสร้อย','03':'ดอนตาล','04':'ดงหลวง','05':'คำชะอี','06':'หว้านใหญ่','07':'หนองสูง' };
// รายชื่อจังหวัดตามรหัส (อ้างอิง db/cchangwat.sql — มาตรฐานกระทรวงมหาดไทย) ใช้แปลรหัส chw_addr เป็นชื่อจังหวัดจริง
const PROVINCE_NAMES = {
  '10':'กรุงเทพมหานคร','11':'สมุทรปราการ','12':'นนทบุรี','13':'ปทุมธานี','14':'พระนครศรีอยุธยา',
  '15':'อ่างทอง','16':'ลพบุรี','17':'สิงห์บุรี','18':'ชัยนาท','19':'สระบุรี',
  '20':'ชลบุรี','21':'ระยอง','22':'จันทบุรี','23':'ตราด','24':'ฉะเชิงเทรา',
  '25':'ปราจีนบุรี','26':'นครนายก','27':'สระแก้ว','30':'นครราชสีมา','31':'บุรีรัมย์',
  '32':'สุรินทร์','33':'ศรีสะเกษ','34':'อุบลราชธานี','35':'ยโสธร','36':'ชัยภูมิ',
  '37':'อำนาจเจริญ','38':'บึงกาฬ','39':'หนองบัวลำภู','40':'ขอนแก่น','41':'อุดรธานี',
  '42':'เลย','43':'หนองคาย','44':'มหาสารคาม','45':'ร้อยเอ็ด','46':'กาฬสินธุ์',
  '47':'สกลนคร','48':'นครพนม','49':'มุกดาหาร','50':'เชียงใหม่','51':'ลำพูน',
  '52':'ลำปาง','53':'อุตรดิตถ์','54':'แพร่','55':'น่าน','56':'พะเยา',
  '57':'เชียงราย','58':'แม่ฮ่องสอน','60':'นครสวรรค์','61':'อุทัยธานี','62':'กำแพงเพชร',
  '63':'ตาก','64':'สุโขทัย','65':'พิษณุโลก','66':'พิจิตร','67':'เพชรบูรณ์',
  '70':'ราชบุรี','71':'กาญจนบุรี','72':'สุพรรณบุรี','73':'นครปฐม','74':'สมุทรสาคร',
  '75':'สมุทรสงคราม','76':'เพชรบุรี','77':'ประจวบคีรีขันธ์','80':'นครศรีธรรมราช','81':'กระบี่',
  '82':'พังงา','83':'ภูเก็ต','84':'สุราษฎร์ธานี','85':'ระนอง','86':'ชุมพร',
  '90':'สงขลา','91':'สตูล','92':'ตรัง','93':'พัทลุง','94':'ปัตตานี',
  '95':'ยะลา','96':'นราธิวาส','99':'ไม่ทราบ',
};
function provinceName(code) { return PROVINCE_NAMES[code] || `จังหวัดรหัส ${code}`; }
const TARGET_ACCESS_RATE = 40, THRESHOLD_REPEAT_VIOLENCE = 15, THRESHOLD_ZERO_FOLLOWUP = 30;

// เกณฑ์เชิงคุณภาพ (6 Building Blocks) ด้านผลกระทบ "การเข้าถึงบริการ" — จากสไลด์กรมสุขภาพจิต
// ระดับ 1-2 เป็นขั้นตอนกระบวนการ (ออกแบบ Template / ขึ้น Dashboard กระทรวง) ไม่ผูกกับ % จึงไม่ประเมินระดับ 1-2 ที่นี่
function qualityLevelAccess(ePct) {
  if (ePct >= 40) return { level: 5, scoreRange: '86-100', label: 'ระดับ 5 (ผ่านเกณฑ์ >40%)' };
  if (ePct >= 35) return { level: 4, scoreRange: '71-85', label: 'ระดับ 4 (>35%)' };
  if (ePct >= 30) return { level: 3, scoreRange: '56-70', label: 'ระดับ 3 (>30%)' };
  return { level: null, scoreRange: '0-55', label: 'ต่ำกว่าระดับ 3 (<30%) — ยังอยู่ขั้นตอนกระบวนการ (ระดับ 1-2)' };
}

// คะแนนเชิงปริมาณ (1-10) ของตัวชี้วัด G (เข้าถึงบริการต่อเนื่องไม่ก่อซ้ำ) ตามรอบประเมิน 6 เดือน / 10 เดือน
const SCORE_SCALE_6M = { 2:1, 4:2, 6:3, 8:4, 10:5, 12:6, 14:7, 16:8, 18:9, 20:10 };
const SCORE_SCALE_10M = { 22:1, 24:2, 26:3, 28:4, 30:5, 32:6, 34:7, 36:8, 38:9, 40:10 };

function scoreQuantitative(gPct, scale) {
  let best = 0;
  for (const [threshold, score] of Object.entries(scale)) {
    if (gPct >= Number(threshold)) best = score;
  }
  return best;
}

const state = {
  patients: [],       // แถวดิบหลัง parse+คำนวณ
  population: {},      // { fyBe: { ampurCode: {name, pop15_60} } }
  settings: { smi_prevalence_pct: 4.37, smiv_ratio_pct: 11.92, max_age_included: 60, current_fiscal_year_be: 2569 },
  charts: {},
};

// ---------- วันที่/ปีงบ ----------
function toYmd(d) {
  if (!(d instanceof Date) || isNaN(d)) return null;
  return d.toISOString().slice(0, 10);
}
function excelDateToJs(v) {
  if (v instanceof Date) return v;
  if (typeof v === 'number') {
    // Excel serial date -> JS Date (1900 date system)
    const utc = Math.round((v - 25569) * 86400 * 1000);
    return new Date(utc);
  }
  if (typeof v === 'string' && v.trim() !== '') {
    const d = new Date(v.trim());
    return isNaN(d) ? null : d;
  }
  return null;
}
function fiscalYearBe(dateYmd) {
  const d = new Date(dateYmd);
  const y = d.getUTCFullYear() + 543;
  const m = d.getUTCMonth() + 1;
  return m >= 10 ? y + 1 : y;
}
function fiscalYearEndDate(fyBe) {
  const ceYear = fyBe - 543;
  return `${ceYear}-09-30`;
}
function ageAt(birthYmd, atYmd) {
  const b = new Date(birthYmd), a = new Date(atYmd);
  let age = a.getUTCFullYear() - b.getUTCFullYear();
  const m = a.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && a.getUTCDate() < b.getUTCDate())) age--;
  return age;
}
function parsePipe(raw) {
  return String(raw || '').split('|').map(s => s.trim()).filter(s => s !== '' && s !== 'NULL');
}
function pct(num, den) {
  return den > 0 ? Math.round((num / den) * 10000) / 100 : 0;
}

// ---------- Import xlsx (client-side, SheetJS) ----------
function readWorkbook(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: false });
        resolve(wb);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function validateAndParse(wb) {
  const sheetName = wb.SheetNames.includes('Data') ? 'Data' : wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  if (!rows.length) throw new Error('ชีตไม่มีข้อมูล (แถวว่าง)');

  const header = rows[0].map(h => String(h).trim());
  const errors = [];
  EXPECTED_HEADERS.forEach((expected, i) => {
    if ((header[i] || '') !== expected) errors.push(`หัวคอลัมน์ที่ ${i + 1} ต้องเป็น '${expected}' แต่พบ '${header[i] || ''}'`);
  });
  if (errors.length) throw new Error(errors.join('\n'));

  const patients = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const hoscode = String(row[0] || '').trim();
    if (!hoscode) continue;

    const birthRaw = row[6];
    const birthDate = excelDateToJs(birthRaw);
    const firstDateRaw = row[11];
    const firstDate = excelDateToJs(firstDateRaw);
    if (!firstDate) { errors.push(`แถว ${r + 1}: first_date_serv อ่านเป็นวันที่ไม่ได้`); continue; }
    const firstDateServ = toYmd(firstDate);
    const fy = fiscalYearBe(firstDateServ);

    const followLastDate = excelDateToJs(row[15]);
    const followLast = followLastDate ? toYmd(followLastDate) : null;

    const b03xRaw = String(row[14] || '').trim();
    const b03xCodes = parsePipe(b03xRaw);
    const smivCodeCount = b03xCodes.length;
    const hasRepeatViolence = smivCodeCount > 1;

    const dateServRaw = String(row[12] || '').trim();
    const visitDates = parsePipe(dateServRaw).map(s => {
      const d = excelDateToJs(isNaN(s) ? s : Number(s));
      return d ? toYmd(d) : null;
    }).filter(Boolean);
    const totalVisits = visitDates.length || 1; // อย่างน้อย 1 ครั้ง (ครั้งแรก)

    const birth = birthDate ? toYmd(birthDate) : null;
    const ageAtFyEnd = birth ? ageAt(birth, fiscalYearEndDate(fy)) : null;

    patients.push({
      hoscode, hosname: String(row[1] || '').trim(), pid: String(row[2] || '').trim(),
      cid: String(row[3] || '').trim(), name: String(row[4] || '').trim(), lname: String(row[5] || '').trim(),
      birth, sex: row[7] === '' ? null : Number(row[7]),
      chw_addr: String(row[8] || '').trim(), tambon: String(row[9] || '').trim(), ampur: String(row[10] || '').trim(),
      first_date_serv: firstDateServ, date_serv_raw: dateServRaw, diagcode_raw: String(row[13] || '').trim(),
      b03x_raw: b03xRaw, follow_last: followLast,
      fiscal_year_be: fy, smiv_code_count: smivCodeCount, has_repeat_violence: hasRepeatViolence,
      age_at_fy_end: ageAtFyEnd, total_visits: totalVisits,
    });
  }
  if (errors.length) throw new Error(errors.slice(0, 20).join('\n'));
  return patients;
}

// ---------- คำนวณรายงาน (ตรงกับ build_smiv_report ใน PHP) ----------
function estimateSmivPatients(pop15to60) {
  const { smi_prevalence_pct, smiv_ratio_pct } = state.settings;
  return Math.round(pop15to60 * (smi_prevalence_pct / 100) * (smiv_ratio_pct / 100));
}

function groupKeyFor(p, level) {
  if (level === 'hoscode') return p.hoscode;
  if (level === 'chw_addr') return p.chw_addr;
  return p.ampur;
}

function buildReport(fy, level, dateFrom, dateTo) {
  const maxAge = state.settings.max_age_included;
  const pop = state.population[fy] || {};

  const filtered = state.patients.filter(p => {
    if (p.fiscal_year_be > fy) return false;
    if (p.age_at_fy_end !== null && p.age_at_fy_end > maxAge) return false;
    if (dateFrom && dateTo && !(p.first_date_serv >= dateFrom && p.first_date_serv <= dateTo)) return false;
    return true;
  });

  const groups = new Map();
  for (const p of filtered) {
    const key = groupKeyFor(p, level);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  let rows = [];
  for (const [key, ps] of groups) {
    let hoscodeLabel = null;
    if (level === 'hoscode') {
      hoscodeLabel = ps.reduce((a, b) => (b.hosname && b.hosname.length > (a || '').length ? b.hosname : a), null);
    }
    const ampurRef = level === 'hoscode' ? (ps.map(p => p.ampur).sort()[0] || '') : (level === 'chw_addr' ? '' : key);
    rows.push({ group_key: key, label: level === 'hoscode' ? hoscodeLabel : (level === 'chw_addr' ? provinceName(key) : key), ampur_ref: ampurRef, patients: ps });
  }

  // รวมกลุ่มนอกพื้นที่หลักเป็น "อื่นๆ"
  if (level === 'ampur') {
    const known = rows.filter(r => pop[r.ampur_ref]);
    const unknown = rows.filter(r => !pop[r.ampur_ref]);
    rows = known;
    if (unknown.length) rows.push({ group_key: 'other', label: 'อื่นๆ (นอกอำเภอ/ข้อมูลนอกพื้นที่)', ampur_ref: null, patients: unknown.flatMap(r => r.patients) });
  } else if (level === 'chw_addr') {
    rows.sort((a, b) => b.patients.length - a.patients.length);
    const keep = rows.slice(0, 8), rest = rows.slice(8);
    rows = keep;
    if (rest.length) rows.push({ group_key: 'other', label: 'อื่นๆ (จังหวัดอื่น)', ampur_ref: null, patients: rest.flatMap(r => r.patients) });
  }

  const report = [];
  const totals = { b:0,c:0,d:0,f:0,j:0,k:0,m:0,n:0,h:0,i:0, zero_followup:0, repeat_violence_count:0, missing_birth:0, missing_tambon:0, missing_followup:0, same_day_followup:0 };
  let hasPopulationData = false;

  for (const r of rows) {
    const ps = r.patients;
    const b = ps.filter(p => p.fiscal_year_be < fy).length;
    const c = ps.filter(p => p.fiscal_year_be === fy).length;
    const d = ps.length;
    const f = ps.filter(p => !p.has_repeat_violence).length;
    const j = ps.filter(p => p.total_visits === 2).length;
    const k = ps.filter(p => p.total_visits === 2 && !p.has_repeat_violence).length;
    const m = ps.filter(p => p.total_visits >= 3).length;
    const n = ps.filter(p => p.total_visits >= 3 && !p.has_repeat_violence).length;
    const zeroFollowup = ps.filter(p => p.total_visits === 1).length;
    const repeatViolenceCount = ps.filter(p => p.has_repeat_violence).length;
    const missingBirth = ps.filter(p => !p.birth).length;
    const missingTambon = ps.filter(p => !p.tambon).length;
    const missingFollowup = ps.filter(p => !p.follow_last).length;
    const sameDayFollowup = ps.filter(p => p.follow_last && p.follow_last === p.first_date_serv).length;

    let h = 0, ampurName = null;
    if (level !== 'chw_addr') {
      const popRow = pop[r.ampur_ref];
      h = popRow ? Number(popRow.pop15_60) : 0;
      ampurName = popRow ? popRow.name : null;
    }
    const i = h > 0 ? estimateSmivPatients(h) : 0;
    if (h > 0) hasPopulationData = true;

    const label = level === 'ampur' ? (ampurName || r.label) : r.label;
    const line = {
      group_key: r.group_key, ampur: r.group_key, ampur_name: label,
      b, c, d, e: pct(d, i), f, h, i,
      j, k, l: pct(k, i), m, n, o: pct(n, i),
      zero_followup: zeroFollowup, repeat_violence_count: repeatViolenceCount,
      missing_birth: missingBirth, missing_tambon: missingTambon,
      missing_followup: missingFollowup, same_day_followup: sameDayFollowup,
    };
    line.g = line.o;
    report.push(line);

    for (const key of ['b','c','d','f','j','k','m','n','zero_followup','repeat_violence_count','missing_birth','missing_tambon','missing_followup','same_day_followup']) totals[key] += line[key];
    totals.h += h; totals.i += i;
  }
  report.sort((a, b) => b.d - a.d);
  totals.e = pct(totals.d, totals.i);
  totals.l = pct(totals.k, totals.i);
  totals.o = pct(totals.n, totals.i);
  totals.g = totals.o;

  return { report, totals, level, hasPopulationData };
}

// ---------- กฎวิเคราะห์ปัญหา (ตรงกับ analyze_area ใน PHP) ----------
function analyzeArea(r) {
  const findings = [];
  const d = r.d;
  const repeatRate = pct(r.repeat_violence_count, d);
  const zeroFollowRate = pct(r.zero_followup, d);

  if (r.h === 0) {
    findings.push({ level: 'warn', category: 'no_population', title: 'ยังไม่มีข้อมูลประชากร (H)', detail: 'ไม่สามารถคำนวณอัตราเข้าถึงบริการ (E) และผู้ป่วยประมาณการณ์ (I) ได้ เพราะยังไม่กรอกประชากร 15-60 ปีของพื้นที่นี้', action: 'กรอกข้อมูลประชากรที่ปุ่ม "ประชากร/ประมาณการณ์"' });
  } else if (r.e < TARGET_ACCESS_RATE) {
    findings.push({ level: 'danger', category: 'low_access', title: `อัตราเข้าถึงบริการต่ำกว่าเป้า (${r.e}% < ${TARGET_ACCESS_RATE}%)`, detail: 'จำนวนผู้ป่วย SMI-V ที่ลงทะเบียนแล้ว (D) เทียบกับผู้ป่วยประมาณการณ์ (I) ยังไม่ถึงเป้าหมาย HDC', action: 'เร่งคัดกรอง 5 สัญญาณเตือน (V-Care) และตรวจสอบว่าส่งข้อมูล 1B030-1B033 เข้า HDC ครบหรือไม่ (ดูหน้าคู่มือรหัส)' });
  }
  if (d > 0 && repeatRate > THRESHOLD_REPEAT_VIOLENCE) {
    findings.push({ level: 'danger', category: 'high_repeat', title: `อัตราก่อความรุนแรงซ้ำสูง (${repeatRate}% ของผู้ป่วย ${r.repeat_violence_count}/${d} คน)`, detail: 'ผู้ป่วยกลุ่มนี้เคยถูกลงทะเบียนรหัส SMI-V (1B030-1B033) มากกว่า 1 ครั้ง', action: 'จัด Conference ทีมสหวิชาชีพ ทำ Individual Care Plan รายบุคคล เพิ่มความถี่ติดตามเยี่ยม (สีแดง=ทุก 7 วัน)' });
  }
  if (d > 0 && zeroFollowRate > THRESHOLD_ZERO_FOLLOWUP) {
    findings.push({ level: 'warn', category: 'low_followup', title: `ผู้ป่วยไม่เคยติดตามซ้ำเลยสูง (${zeroFollowRate}% ของผู้ป่วย ${r.zero_followup}/${d} คน)`, detail: 'มารับบริการครั้งแรกแล้วไม่มีการติดตามครั้งถัดไปในข้อมูลที่นำเข้า', action: 'ประสาน อสม./ทีม รพ.สต. ลงพื้นที่ติดตามเยี่ยมบ้าน ให้ครบเกณฑ์ "ติดตามต่อเนื่องอย่างน้อย 2 ครั้ง/ปีงบ"' });
  }
  if (r.missing_birth > 0 || r.missing_tambon > 0 || r.missing_followup > 0) {
    findings.push({ level: 'info', category: 'data_quality', title: 'ข้อมูลไม่ครบถ้วน', detail: `ไม่มีวันเกิด ${r.missing_birth} ราย, ไม่มีตำบล ${r.missing_tambon} ราย, ขาดการติดตาม ${r.missing_followup} ราย`, action: 'ตรวจสอบคุณภาพข้อมูลที่ต้นทาง HIS/43แฟ้ม SPECIALPP ก่อนนำเข้าครั้งถัดไป' });
  }
  if (r.same_day_followup > 0) {
    findings.push({ level: 'info', category: 'same_day', title: `สงสัยลงรหัสผิด — วันติดตามล่าสุดตรงกับวันแรก (${r.same_day_followup} ราย)`, detail: 'follow_last เท่ากับ first_date_serv ในวันเดียวกัน ซึ่งไม่ควรเกิดขึ้นถ้ามีการติดตามจริง', action: 'ตรวจสอบกับหน่วยบริการว่าลงรหัส 1B037 ซ้ำวันเดียวกับ 1B030-1B033 ครั้งแรกโดยไม่ตั้งใจหรือไม่' });
  }
  if (!findings.length) {
    findings.push({ level: 'ok', category: 'ok', title: 'ไม่พบปัญหาตามเกณฑ์ที่ตั้งไว้', detail: 'อัตราเข้าถึงบริการ อัตราก่อซ้ำ และความครบถ้วนของข้อมูล อยู่ในเกณฑ์ที่ยอมรับได้', action: 'คงมาตรฐานการคัดกรองและติดตามต่อเนื่อง' });
  }
  return findings;
}

const FINDING_CATEGORY_LABELS = { no_population:'ยังไม่มีข้อมูลประชากร', low_access:'เข้าถึงบริการต่ำกว่าเป้า', high_repeat:'ก่อความรุนแรงซ้ำสูง', low_followup:'ไม่เคยติดตามซ้ำสูง', data_quality:'ข้อมูลไม่ครบถ้วน', same_day:'สงสัยลงรหัสผิด' };

function countFindingsByCategory(analysisList) {
  const counts = {};
  for (const k of Object.keys(FINDING_CATEGORY_LABELS)) counts[k] = 0;
  for (const item of analysisList) {
    const seen = new Set();
    for (const f of item.findings) {
      if (counts[f.category] !== undefined && !seen.has(f.category)) { counts[f.category]++; seen.add(f.category); }
    }
  }
  return Object.fromEntries(Object.entries(counts).filter(([, v]) => v > 0));
}

// แนวโน้มข้ามปีงบ: จำนวนผู้ป่วยใหม่ (fiscal_year_be === FY) ต่อปีงบ จากข้อมูลทั้งหมดที่มี
function buildYearlyTrend() {
  const counts = {};
  for (const p of state.patients) counts[p.fiscal_year_be] = (counts[p.fiscal_year_be] || 0) + 1;
  const years = Object.keys(counts).map(Number).sort((a, b) => a - b);
  return { years, newPatients: years.map(y => counts[y]) };
}

// ---------- export ----------
window.smivEngine = {
  state, readWorkbook, validateAndParse, buildReport, analyzeArea,
  countFindingsByCategory, FINDING_CATEGORY_LABELS, REPORT_LEVELS, KNOWN_AMPUR,
  TARGET_ACCESS_RATE, THRESHOLD_REPEAT_VIOLENCE, THRESHOLD_ZERO_FOLLOWUP, pct,
  qualityLevelAccess, scoreQuantitative, SCORE_SCALE_6M, SCORE_SCALE_10M, buildYearlyTrend,
};

})();
