/* SMI-V Plus — UI wiring (upload, render, charts, export, publish) */
'use strict';

const { state, readWorkbook, validateAndParse, buildReport, analyzeArea, countFindingsByCategory,
  FINDING_CATEGORY_LABELS, REPORT_LEVELS, KNOWN_AMPUR, pct,
  qualityLevelAccess, scoreQuantitative, SCORE_SCALE_6M, SCORE_SCALE_10M, buildYearlyTrend, buildYearlyTrendByAmpur, buildAccessRateTrend } = window.smivEngine;

const LS_KEY = 'smivplus_state_v1';
let unpublishedChanges = false;
function markDirty() {
  unpublishedChanges = true;
  const banner = document.getElementById('unpublishedBanner');
  if (banner) banner.hidden = false;
}
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

// ---------- แจ้งเตือนเบราว์เซอร์ (Desktop Notification) เมื่อพบผู้ป่วยความสำคัญสูง ----------
let lastNotifiedHighCount = -1;
function notificationSupported() {
  return typeof Notification !== 'undefined';
}
function updateNotifyButton() {
  const btn = $('#enableNotifyBtn');
  if (!btn) return;
  if (!notificationSupported() || Notification.permission === 'granted' || Notification.permission === 'denied') {
    btn.hidden = true;
  } else {
    btn.hidden = false;
  }
}
function requestNotifyPermission() {
  if (!notificationSupported()) return;
  Notification.requestPermission().then(updateNotifyButton);
}
function maybeNotifyRisk(highCount) {
  if (!notificationSupported() || Notification.permission !== 'granted') return;
  if (highCount > 0 && highCount !== lastNotifiedHighCount) {
    new Notification('SMI-V Plus — แจ้งเตือนความเสี่ยง', {
      body: `พบผู้ป่วยความสำคัญสูง (ก่อความรุนแรงซ้ำ) ${highCount.toLocaleString('th-TH')} คน ต้องติดตามด่วน`,
      tag: 'smiv-risk-alert',
    });
  }
  lastNotifiedHighCount = highCount;
}

function saveLocal() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ patients: state.patients, population: state.population, settings: state.settings })); } catch (e) {}
}
function loadLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (data.patients) state.patients = data.patients;
    if (data.population) state.population = data.population;
    if (data.settings) state.settings = { ...state.settings, ...data.settings };
    return true;
  } catch (e) { return false; }
}

let lastPublishedCount = 0;

async function loadPublished() {
  try {
    const res = await fetch('./data.json', { cache: 'no-store' });
    if (!res.ok) return false;
    const data = await res.json();
    if (!data.patients || !data.patients.length) return false;
    state.patients = data.patients;
    state.population = data.population || {};
    state.settings = { ...state.settings, ...(data.settings || {}) };
    lastPublishedCount = data.patients.length;
    $('#publishedAt').textContent = data.publishedAt ? `เผยแพร่ล่าสุด: ${new Date(data.publishedAt).toLocaleString('th-TH')}` : '';
    return true;
  } catch (e) { return false; }
}

function seedDefaultPopulationNames(fy) {
  if (!state.population[fy]) state.population[fy] = {};
  for (const [code, name] of Object.entries(KNOWN_AMPUR)) {
    if (!state.population[fy][code]) state.population[fy][code] = { name, pop15_60: 0 };
  }
}

// ---------- เก็บไฟล์ Excel ต้นฉบับล่าสุดไว้ในเครื่อง (อัปโหลดใหม่ = ทับของเดิม) ----------
const RAW_FILE_KEY = 'smivplus_last_xlsx';
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
async function saveRawFile(file) {
  try {
    const dataUrl = await fileToBase64(file);
    localStorage.setItem(RAW_FILE_KEY, JSON.stringify({ name: file.name, size: file.size, uploadedAt: new Date().toISOString(), dataUrl }));
    renderStoredFileInfo();
  } catch (e) { /* ไฟล์ใหญ่เกิน localStorage ไหว — ไม่เป็นไร ข้อมูลที่ parse แล้วยังอยู่ */ }
}
function renderStoredFileInfo() {
  const el = document.getElementById('storedFileInfo');
  if (!el) return;
  try {
    const raw = localStorage.getItem(RAW_FILE_KEY);
    if (!raw) { el.hidden = true; return; }
    const meta = JSON.parse(raw);
    el.hidden = false;
    el.innerHTML = `📁 ไฟล์ที่เก็บไว้ในเครื่องนี้: <strong>${escapeHtml(meta.name)}</strong> (${(meta.size / 1024).toFixed(0)} KB) · อัปโหลดเมื่อ ${new Date(meta.uploadedAt).toLocaleString('th-TH')} — <a href="#" id="downloadStoredFile">ดาวน์โหลดไฟล์นี้กลับ</a>`;
    document.getElementById('downloadStoredFile').addEventListener('click', e => {
      e.preventDefault();
      const a = document.createElement('a');
      a.href = meta.dataUrl; a.download = meta.name;
      document.body.appendChild(a); a.click(); a.remove();
    });
  } catch (e) { el.hidden = true; }
}

// ---------- Upload ----------
async function handleUpload(file) {
  if (viewingHistory) { await exitHistoryView(); }
  setStatus('กำลังอ่านไฟล์...', '');
  try {
    const wb = await readWorkbook(file);
    const patients = validateAndParse(wb);
    // upsert by hoscode+pid
    const map = new Map(state.patients.map(p => [`${p.hoscode}|${p.pid}`, p]));
    for (const p of patients) map.set(`${p.hoscode}|${p.pid}`, p);
    state.patients = Array.from(map.values());
    seedDefaultPopulationNames(currentFy());
    saveLocal();
    saveRawFile(file);
    markDirty();
    setStatus(`นำเข้าสำเร็จ ${patients.length} แถว (รวมทั้งหมด ${state.patients.length} คน) — กำลังเผยแพร่...`, 'ok');
    render();
    await publishToGithub();
  } catch (err) {
    setStatus('นำเข้าล้มเหลว: ' + err.message, 'error');
  }
}

function setStatus(msg, cls) {
  const el = $('#importStatus');
  el.textContent = msg;
  el.className = 'status ' + (cls || '');
}

// ---------- Controls ----------
function currentFy() { return Number($('#fySelect').value) || state.settings.current_fiscal_year_be; }
function currentLevel() { return $('#levelSelect').value || 'ampur'; }

function populateAreaSelect(report) {
  const sel = $('#areaSelect');
  const current = sel.value;
  sel.innerHTML = '<option value="">— ทั้งหมด —</option>' + report.map(r => `<option value="${r.group_key}">${escapeHtml(r.ampur_name)} (D=${r.d})</option>`).join('');
  sel.value = current && report.some(r => String(r.group_key) === current) ? current : '';
}

function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function fmt(n) { return Number(n || 0).toLocaleString('en-US'); }

// ---------- Render ----------
function render() {
  const fy = currentFy();
  const level = currentLevel();
  const dateFrom = $('#dateFrom').value || null;
  const dateTo = $('#dateTo').value || null;

  const data = buildReport(fy, level, dateFrom, dateTo);
  let { report, totals, hasPopulationData } = data;

  populateAreaSelect(report);
  const areaFilter = $('#areaSelect').value;
  let shownReport = report, shownTotals = totals;
  if (areaFilter) {
    shownReport = report.filter(r => String(r.group_key) === areaFilter);
    shownTotals = shownReport[0] || totals;
  }

  if (!state.patients.length) {
    $('#emptyState').hidden = false;
    $('#dashboard').hidden = true;
    return;
  }
  $('#emptyState').hidden = true;
  $('#dashboard').hidden = false;

  // KPI
  $('#kpiAccess').textContent = shownTotals.e.toFixed(2) + '%';
  $('#kpiAccess').closest('.kpi-card').classList.toggle('kpi-danger', shownTotals.e < 40);
  $('#kpiAccess').closest('.kpi-card').classList.toggle('kpi-ok', shownTotals.e >= 40);
  $('#kpiD').textContent = fmt(shownTotals.d);
  $('#kpiDsub').textContent = `เก่า ${fmt(shownTotals.b)} + ใหม่ ${fmt(shownTotals.c)}`;
  $('#kpiG').textContent = shownTotals.g.toFixed(2) + '%';
  $('#kpiGsub').textContent = `ติดตาม≥2ครั้งไม่ก่อซ้ำ ${fmt(shownTotals.n)} คน`;
  $('#kpiMissing').textContent = fmt(shownTotals.missing_followup);
  $('#kpiMissing').closest('.kpi-card').classList.toggle('kpi-danger', shownTotals.missing_followup > 0);
  $('#kpiArea').textContent = shownReport.length;
  $('#kpiAreaLabel').textContent = REPORT_LEVELS[level];

  if (!hasPopulationData) {
    $('#popWarning').hidden = false;
  } else {
    $('#popWarning').hidden = true;
  }

  renderTable(shownReport, shownTotals, level);
  renderFindings(report, level);
  renderCharts(report, totals, level, hasPopulationData);
  renderQualityScore(shownTotals);
  renderProblemPatients(fy, level, areaFilter);
  saveLocal();
}

// ---------- คะแนนประเมินผล (6 Building Blocks) ตามเอกสารกรมสุขภาพจิต ----------
function renderQualityScore(totals) {
  const q = qualityLevelAccess(totals.e);
  const score6 = scoreQuantitative(totals.g, SCORE_SCALE_6M);
  const score10 = scoreQuantitative(totals.g, SCORE_SCALE_10M);
  $('#qualityLevel').textContent = q.label;
  $('#qualityRange').textContent = `คะแนน ${q.scoreRange}`;
  $('#score6m').textContent = `${score6}/10`;
  $('#score10m').textContent = `${score10}/10`;
}

function renderTable(report, totals, level) {
  const tbody = $('#reportTableBody');
  tbody.innerHTML = report.map(r => `
    <tr>
      <td>${escapeHtml(r.ampur_name)}</td>
      <td>${fmt(r.b)}</td><td>${fmt(r.c)}</td><td>${fmt(r.d)}</td>
      <td>${r.e.toFixed(2)}</td><td>${fmt(r.f)}</td><td>${r.g.toFixed(2)}</td>
      <td>${fmt(r.h)}</td><td>${fmt(r.i)}</td>
      <td>${fmt(r.j)}</td><td>${fmt(r.k)}</td><td>${r.l.toFixed(2)}</td>
      <td>${fmt(r.m)}</td><td>${fmt(r.n)}</td><td>${r.o.toFixed(2)}</td>
      <td>${fmt(r.missing_followup)}</td>
    </tr>`).join('') + `
    <tr class="total-row">
      <td>รวม</td>
      <td>${fmt(totals.b)}</td><td>${fmt(totals.c)}</td><td>${fmt(totals.d)}</td>
      <td>${totals.e.toFixed(2)}</td><td>${fmt(totals.f)}</td><td>${totals.g.toFixed(2)}</td>
      <td>${fmt(totals.h)}</td><td>${fmt(totals.i)}</td>
      <td>${fmt(totals.j)}</td><td>${fmt(totals.k)}</td><td>${totals.l.toFixed(2)}</td>
      <td>${fmt(totals.m)}</td><td>${fmt(totals.n)}</td><td>${totals.o.toFixed(2)}</td>
      <td>${fmt(totals.missing_followup)}</td>
    </tr>`;
  $('#tableAreaLabel').textContent = REPORT_LEVELS[level];
}

function renderFindings(report, level) {
  const analysisList = report.map(r => ({ area: r, findings: analyzeArea(r) }));
  const catCounts = countFindingsByCategory(analysisList);

  const catBox = $('#issueCategoryChartBox');
  catBox.hidden = Object.keys(catCounts).length === 0;
  drawChart('chartIssueCategory', {
    type: 'bar',
    data: { labels: Object.keys(catCounts).map(k => FINDING_CATEGORY_LABELS[k]), datasets: [{ label: 'จำนวนพื้นที่ที่พบปัญหานี้', data: Object.values(catCounts), backgroundColor: '#c0392b' }] },
    options: { responsive: true, indexAxis: 'y', scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } }, plugins: { legend: { display: false } } },
  });

  $('#findingsList').innerHTML = analysisList.map(item => `
    <div class="analysis-card">
      <h3>${escapeHtml(item.area.ampur_name)} <span class="muted">(D=${item.area.d} คน)</span></h3>
      ${item.findings.map(f => `
        <div class="finding finding-${f.level}">
          <div class="finding-title">${escapeHtml(f.title)}</div>
          <div class="finding-detail">${escapeHtml(f.detail)}</div>
          <div class="finding-action">➜ ${escapeHtml(f.action)}</div>
        </div>`).join('')}
    </div>`).join('');
}

function drawChart(canvasId, config) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (state.charts[canvasId]) state.charts[canvasId].destroy();
  state.charts[canvasId] = new Chart(canvas, config);
}

function renderCharts(report, totals, level, hasPop) {
  const labels = report.map(r => r.ampur_name);

  drawChart('chartPatients', {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'เก่า (B)', data: report.map(r => r.b), backgroundColor: '#2c6e91' },
      { label: 'ใหม่ (C)', data: report.map(r => r.c), backgroundColor: '#5aa7c9' },
    ] },
    options: { responsive: true, indexAxis: 'y', scales: { x: { stacked: true, beginAtZero: true }, y: { stacked: true } } },
  });

  $('#accessChartBox').hidden = !hasPop;
  $('#followSummaryChartBox').hidden = hasPop;
  if (hasPop) {
    drawChart('chartAccess', {
      type: 'bar',
      data: { labels, datasets: [{ label: 'อัตราเข้าถึงบริการ (E) %', data: report.map(r => r.e), backgroundColor: report.map(r => r.e < 40 ? '#c0392b' : '#1e7e34') }] },
      options: { responsive: true, indexAxis: 'y', scales: { x: { beginAtZero: true } } },
    });
  } else {
    drawChart('chartFollowSummary', {
      type: 'doughnut',
      data: { labels: ['ไม่เคยติดตาม', 'ติดตาม 1 ครั้ง', 'ติดตาม ≥2 ครั้ง'], datasets: [{ data: [totals.zero_followup, totals.j, totals.m], backgroundColor: ['#c0392b', '#e0a63c', '#1e7e34'] }] },
      options: { responsive: true },
    });
  }

  drawChart('chartRepeatRate', {
    type: 'bar',
    data: { labels, datasets: [{ label: 'อัตราก่อความรุนแรงซ้ำ %', data: report.map(r => pct(r.repeat_violence_count, r.d)), backgroundColor: report.map(r => pct(r.repeat_violence_count, r.d) > 15 ? '#c0392b' : '#1e7e34') }] },
    options: { responsive: true, indexAxis: 'y', scales: { x: { beginAtZero: true } } },
  });

  drawChart('chartFollowByArea', {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'ไม่เคยติดตาม', data: report.map(r => r.zero_followup), backgroundColor: '#c0392b' },
      { label: 'ติดตาม 1 ครั้ง', data: report.map(r => r.j), backgroundColor: '#e0a63c' },
      { label: 'ติดตาม ≥2 ครั้ง', data: report.map(r => r.m), backgroundColor: '#1e7e34' },
    ] },
    options: { responsive: true, indexAxis: 'y', scales: { x: { stacked: true, beginAtZero: true }, y: { stacked: true } } },
  });

  // เพศ + แนวโน้มรายเดือน (จากผู้ป่วยทั้งหมด ไม่ผูกกับ level/area filter)
  const sexCount = { 'ชาย': 0, 'หญิง': 0, 'ไม่ระบุ': 0 };
  for (const p of state.patients) {
    if (p.sex === 1) sexCount['ชาย']++; else if (p.sex === 2) sexCount['หญิง']++; else sexCount['ไม่ระบุ']++;
  }
  drawChart('chartSex', {
    type: 'pie',
    data: { labels: Object.keys(sexCount), datasets: [{ data: Object.values(sexCount), backgroundColor: ['#2c6e91', '#e07b9e', '#9aa5ad'] }] },
    options: { responsive: true },
  });

  const monthCount = {};
  for (const p of state.patients) {
    const ym = p.first_date_serv.slice(0, 7);
    monthCount[ym] = (monthCount[ym] || 0) + 1;
  }
  const months = Object.keys(monthCount).sort();
  drawChart('chartMonthlyTrend', {
    type: 'line',
    data: { labels: months, datasets: [{ label: 'ผู้ป่วยใหม่ (คน)', data: months.map(m => monthCount[m]), borderColor: '#2c6e91', backgroundColor: 'rgba(44,110,145,.15)', fill: true, tension: 0.2 }] },
    options: { responsive: true, scales: { y: { beginAtZero: true } } },
  });

  const yearly = buildYearlyTrend();
  drawChart('chartYearlyTrend', {
    type: 'bar',
    data: { labels: yearly.years.map(y => 'ปีงบ ' + y), datasets: [{ label: 'ผู้ป่วยใหม่ (คน)', data: yearly.newPatients, backgroundColor: '#2c6e91' }] },
    options: { responsive: true, scales: { y: { beginAtZero: true } } },
  });

  const byAmpur = buildYearlyTrendByAmpur();
  const ampurColors = ['#2c6e91', '#c0392b', '#1e7e34', '#e0a63c', '#8e44ad', '#16a085', '#d35400', '#7f8c8d'];
  drawChart('chartYearlyTrendByAmpur', {
    type: 'line',
    data: {
      labels: byAmpur.years.map(y => 'ปีงบ ' + y),
      datasets: byAmpur.series.map((s, i) => ({
        label: s.label, data: s.data,
        borderColor: ampurColors[i % ampurColors.length],
        backgroundColor: ampurColors[i % ampurColors.length],
        tension: 0.2, fill: false,
      })),
    },
    options: { responsive: true, scales: { y: { beginAtZero: true } } },
  });

  const accessTrend = buildAccessRateTrend();
  const accessTrendBox = $('#accessTrendChartBox');
  if (accessTrend.years.length >= 1) {
    accessTrendBox.hidden = false;
    drawChart('chartAccessTrend', {
      type: 'line',
      data: {
        labels: accessTrend.years.map(y => 'ปีงบ ' + y),
        datasets: [
          { label: 'อัตราเข้าถึงบริการ E (%)', data: accessTrend.ePct, borderColor: '#2c6e91', backgroundColor: 'rgba(44,110,145,.15)', fill: true, tension: 0.2 },
          { label: 'เป้าหมาย 40%', data: accessTrend.years.map(() => 40), borderColor: '#c0392b', borderDash: [6, 4], pointRadius: 0, fill: false },
        ],
      },
      options: { responsive: true, scales: { y: { beginAtZero: true } } },
    });
  } else {
    accessTrendBox.hidden = true;
  }
}

// ---------- Population editor ----------
function renderPopulationEditor() {
  const fy = currentFy();
  seedDefaultPopulationNames(fy);
  const rows = state.population[fy] || {};
  $('#popTableBody').innerHTML = Object.entries(rows).map(([code, r]) => `
    <tr>
      <td>${escapeHtml(code)}</td>
      <td>${escapeHtml(r.name)}</td>
      <td><input type="number" min="0" value="${r.pop15_60}" data-ampur="${escapeHtml(code)}" class="pop-input"></td>
      <td>${fmt(Math.round(r.pop15_60 * state.settings.smi_prevalence_pct / 100 * state.settings.smiv_ratio_pct / 100))}</td>
    </tr>`).join('');

  const copyBtn = $('#copyPopPrevYearBtn');
  if (copyBtn) {
    const prevFy = fy - 1;
    const hasPrev = state.population[prevFy] && Object.values(state.population[prevFy]).some(r => r.pop15_60 > 0);
    copyBtn.hidden = !hasPrev;
    copyBtn.textContent = `📋 คัดลอกประชากรจากปีงบ ${prevFy}`;
  }
}

function copyPopulationFromPreviousYear() {
  const fy = currentFy();
  const prevFy = fy - 1;
  const prev = state.population[prevFy];
  if (!prev) return;
  if (!confirm(`คัดลอกข้อมูลประชากรจากปีงบ ${prevFy} มาเป็นค่าเริ่มต้นของปีงบ ${fy}? (ช่องที่กรอกไว้แล้วในปีนี้จะถูกทับ)`)) return;
  if (!state.population[fy]) state.population[fy] = {};
  for (const [code, r] of Object.entries(prev)) {
    state.population[fy][code] = { name: r.name, pop15_60: r.pop15_60 };
  }
  renderPopulationEditor();
}

function savePopulationFromForm() {
  const fy = currentFy();
  if (!state.population[fy]) state.population[fy] = {};

  // กันเผลอบันทึกทับเป็น 0: เช็คก่อนว่ามีอำเภอไหนเคยมีค่า H>0 แล้วจะกลายเป็น 0 ไหม
  const zeroedOut = [];
  $$('.pop-input').forEach(input => {
    const code = input.dataset.ampur;
    const oldVal = state.population[fy][code]?.pop15_60 || 0;
    const newVal = Number(input.value) || 0;
    if (oldVal > 0 && newVal === 0) {
      const name = state.population[fy][code]?.name || code;
      zeroedOut.push(name);
    }
  });
  if (zeroedOut.length) {
    const ok = confirm(
      `⚠️ อำเภอต่อไปนี้เคยมีข้อมูลประชากรแล้ว แต่ช่องนี้ว่าง/เป็น 0 — บันทึกแล้วจะทับเป็น 0:\n\n${zeroedOut.join(', ')}\n\n` +
      `ถ้าไม่ได้ตั้งใจแก้อำเภอเหล่านี้ ให้กด "ยกเลิก" แล้วกรอกค่าเดิมกลับก่อน หรือกด "ตกลง" เพื่อบันทึกทับเป็น 0 จริงๆ`
    );
    if (!ok) return;
  }

  $$('.pop-input').forEach(input => {
    const code = input.dataset.ampur;
    if (!state.population[fy][code]) state.population[fy][code] = { name: code, pop15_60: 0 };
    state.population[fy][code].pop15_60 = Number(input.value) || 0;
  });
  saveLocal();
  markDirty();
  render();
  renderPopulationEditor();
  publishToGithub();
}

// ---------- Settings editor ----------
function renderSettingsEditor() {
  $('#setPrevalence').value = state.settings.smi_prevalence_pct;
  $('#setRatio').value = state.settings.smiv_ratio_pct;
  $('#setMaxAge').value = state.settings.max_age_included;
  $('#setCurrentFy').value = state.settings.current_fiscal_year_be;
}

function saveSettingsFromForm() {
  state.settings.smi_prevalence_pct = Number($('#setPrevalence').value) || 4.37;
  state.settings.smiv_ratio_pct = Number($('#setRatio').value) || 11.92;
  state.settings.max_age_included = Number($('#setMaxAge').value) || 60;
  state.settings.current_fiscal_year_be = Number($('#setCurrentFy').value) || state.settings.current_fiscal_year_be;
  saveLocal();
  markDirty();
  render();
  renderPopulationEditor();
  publishToGithub();
}

// ---------- Excel export (SheetJS) ----------
function exportReportXlsx(levelOverride) {
  const fy = currentFy(), level = levelOverride || currentLevel();
  const { report, totals } = buildReport(fy, level, $('#dateFrom').value || null, $('#dateTo').value || null);
  const areaLabel = REPORT_LEVELS[level];
  const header = [`รายงาน SMI-V ปีงบประมาณ ${fy} — ${areaLabel}`];
  const cols = ['พื้นที่','เก่า (B)','ใหม่ (C)','รวม (D)','อัตราเข้าถึงบริการ E (%)','ไม่ก่อซ้ำสะสม (F)','ร้อยละต่อเนื่องไม่ก่อซ้ำ G (%)','ประชากร H','ประมาณการณ์ I','ติดตาม1ครั้ง J','J ไม่ก่อซ้ำ K','L=K/I*100','ติดตาม≥2ครั้ง M','M ไม่ก่อซ้ำ N','O=N/I*100','ขาดการติดตาม'];
  const rows = report.map(r => [r.ampur_name, r.b, r.c, r.d, r.e, r.f, r.g, r.h, r.i, r.j, r.k, r.l, r.m, r.n, r.o, r.missing_followup]);
  rows.push(['รวม', totals.b, totals.c, totals.d, totals.e, totals.f, totals.g, totals.h, totals.i, totals.j, totals.k, totals.l, totals.m, totals.n, totals.o, totals.missing_followup]);

  const ws = XLSX.utils.aoa_to_sheet([header, [], cols, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'SMI-V Report');
  XLSX.writeFile(wb, `smiv_report_${level}_${fy}.xlsx`);
}

const ISSUE_ACTION_FOR = {
  'ก่อความรุนแรงซ้ำ': 'จัด Conference ทีมสหวิชาชีพ + ทำ Individual Care Plan รายบุคคล เพิ่มความถี่เยี่ยมตามระดับความเสี่ยง',
  'ขาดการติดตาม (follow_last ว่าง)': 'นัดติดตามอาการ/ลงพื้นที่เยี่ยมบ้านโดยเร็ว และลงรหัส 1B037 เมื่อประเมินแล้ว',
  'ไม่เคยติดตามซ้ำ': 'ประสาน อสม./รพ.สต. ติดตามเยี่ยมครั้งที่ 2 ให้ครบเกณฑ์ "ติดตามต่อเนื่องอย่างน้อย 2 ครั้ง/ปีงบ"',
  'สงสัยลงรหัสผิด (ติดตาม=วันแรก)': 'ตรวจสอบกับผู้บันทึกว่าลงรหัส 1B037 ซ้ำวันเดียวกับ 1B030-1B033 ครั้งแรกโดยไม่ได้ตั้งใจหรือไม่',
  'ไม่มีวันเกิด': 'ตรวจสอบและเพิ่มวันเดือนปีเกิดในระบบ HIS ต้นทาง',
  'ไม่มีตำบล': 'ตรวจสอบและเพิ่มรหัสตำบลที่อยู่ในระบบ HIS ต้นทาง',
  'ค้างติดตามนาน (>90 วัน)': 'ให้ลำดับความสำคัญก่อน — ติดตามเยี่ยมบ้าน/โทรศัพท์ด่วนที่สุด',
};

function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function buildProblemPatients(fy, level, areaFilter) {
  const maxAge = state.settings.max_age_included;
  const rows = [];
  for (const p of state.patients) {
    if (p.fiscal_year_be > fy) continue;
    if (p.age_at_fy_end !== null && p.age_at_fy_end > maxAge) continue;
    if (areaFilter) {
      const key = level === 'hoscode' ? p.hoscode : (level === 'chw_addr' ? p.chw_addr : p.ampur);
      if (String(key) !== areaFilter) continue;
    }
    const lastContact = p.follow_last || p.first_date_serv;
    const daysOverdue = daysSince(lastContact);

    const issues = [];
    if (p.has_repeat_violence) issues.push('ก่อความรุนแรงซ้ำ');
    if (!p.follow_last) issues.push('ขาดการติดตาม (follow_last ว่าง)');
    if (p.total_visits === 1) issues.push('ไม่เคยติดตามซ้ำ');
    if (p.follow_last && p.follow_last === p.first_date_serv) issues.push('สงสัยลงรหัสผิด (ติดตาม=วันแรก)');
    if (!p.birth) issues.push('ไม่มีวันเกิด');
    if (!p.tambon) issues.push('ไม่มีตำบล');
    if (daysOverdue !== null && daysOverdue > 90) issues.push('ค้างติดตามนาน (>90 วัน)');
    if (!issues.length) continue;

    const priority = p.has_repeat_violence ? 'สูง' : ((issues.length >= 2 || (daysOverdue !== null && daysOverdue > 90)) ? 'กลาง' : 'ปกติ');
    rows.push({
      p, issues, priority, daysOverdue, lastContact,
      recommendations: issues.map(i => ISSUE_ACTION_FOR[i] || '').filter(Boolean).join(' | '),
    });
  }
  const order = { 'สูง': 0, 'กลาง': 1, 'ปกติ': 2 };
  rows.sort((a, b) => order[a.priority] - order[b.priority] || (b.daysOverdue || 0) - (a.daysOverdue || 0));
  return rows;
}

function renderProblemPatients(fy, level, areaFilter) {
  const box = $('#problemPatientsBox');
  if (!box) return;
  const rows = buildProblemPatients(fy, level, areaFilter);
  $('#problemPatientsCount').textContent = rows.length;

  const priorityCount = { 'สูง': 0, 'กลาง': 0, 'ปกติ': 0 };
  for (const r of rows) priorityCount[r.priority]++;

  const alertBanner = $('#riskAlertBanner');
  if (priorityCount['สูง'] > 0) {
    alertBanner.hidden = false;
    $('#riskAlertText').textContent = `พบผู้ป่วยความสำคัญสูง (ก่อความรุนแรงซ้ำ) ${priorityCount['สูง'].toLocaleString('th-TH')} คน ต้องติดตามด่วน`;
  } else {
    alertBanner.hidden = true;
  }
  maybeNotifyRisk(priorityCount['สูง']);

  drawChart('chartProblemPriority', {
    type: 'doughnut',
    data: { labels: ['สูง (ก่อความรุนแรงซ้ำ)', 'กลาง (หลายปัญหา/ค้างนาน)', 'ปกติ'], datasets: [{ data: [priorityCount['สูง'], priorityCount['กลาง'], priorityCount['ปกติ']], backgroundColor: ['#c0392b', '#e0a63c', '#9aa5ad'] }] },
    options: { responsive: true },
  });

  if (!rows.length) {
    box.innerHTML = '<p class="note">ไม่พบผู้ป่วยที่เข้าเกณฑ์ต้องติดตาม/แก้ไขข้อมูลในเงื่อนไขปัจจุบัน</p>';
    return;
  }
  const top = rows.slice(0, 20);
  const rowsHtml = top.map(({ p, issues, priority, daysOverdue }) => `
    <tr>
      <td>${priority === 'สูง' ? '🔴' : priority === 'กลาง' ? '🟠' : '⚪'} ${priority}</td>
      <td>${escapeHtml(p.name || '')} ${escapeHtml(p.lname || '')}</td>
      <td>${escapeHtml(p.hosname || p.hoscode || '')}</td>
      <td>${escapeHtml(p.ampur || '')}/${escapeHtml(p.tambon || '-')}</td>
      <td>${daysOverdue === null ? '-' : daysOverdue.toLocaleString('th-TH') + ' วัน'}</td>
      <td>${issues.join(', ')}</td>
    </tr>`).join('');
  box.innerHTML = `<div class="table-scroll"><table class="report-table">
    <thead><tr><th>ความสำคัญ</th><th>ชื่อ-สกุล</th><th>หน่วยบริการ</th><th>อำเภอ/ตำบล</th><th>ค้างติดตามมา</th><th>ปัญหาที่พบ</th></tr></thead>
    <tbody>${rowsHtml}</tbody></table></div>
    ${rows.length > 20 ? `<p class="note" style="margin-top:8px">แสดง 20 จาก ${rows.length} คน — กด "ส่งออกรายชื่อปัญหา" เพื่อดูทั้งหมดพร้อมคำแนะนำรายคน</p>` : ''}`;
}

function exportIssuesXlsx() {
  const fy = currentFy(), level = currentLevel();
  const areaFilter = $('#areaSelect').value;
  const rows = buildProblemPatients(fy, level, areaFilter);

  const cols = ['hoscode','hosname','pid','cid','name','lname','birth','sex','chw_addr','tambon','ampur','first_date_serv','date_serv','diagcode','b03x','follow_last','จำนวนรหัสSMIV','ครั้งที่มารับบริการ','ค้างติดตาม(วัน)','ความสำคัญ','ปัญหาที่พบ','คำแนะนำ'];
  const data = rows.map(({ p, issues, priority, recommendations, daysOverdue }) => [p.hoscode,p.hosname,p.pid,p.cid,p.name,p.lname,p.birth,p.sex,p.chw_addr,p.tambon,p.ampur,p.first_date_serv,p.date_serv_raw,p.diagcode_raw,p.b03x_raw,p.follow_last||'NULL',p.smiv_code_count,p.total_visits,daysOverdue===null?'':daysOverdue,priority,issues.join('; '),recommendations]);
  const ws = XLSX.utils.aoa_to_sheet([cols, ...(data.length ? data : [['ไม่พบผู้ป่วยที่มีปัญหาตามเกณฑ์']])]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ปัญหา');
  XLSX.writeFile(wb, `smiv_problem_patients_${level}_${fy}.xlsx`);
}

// ---------- Publish (สร้าง data.json ให้ admin นำไป commit เข้า repo เอง — ไม่ฝัง token ใดๆ) ----------
function buildPayload() {
  return { patients: state.patients, population: state.population, settings: state.settings, publishedAt: new Date().toISOString() };
}

function publishData() {
  const payload = buildPayload();
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'data.json';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  markPublished();
  const helper = document.getElementById('publishHelper');
  if (helper) helper.hidden = false;
}

function markPublished() {
  unpublishedChanges = false;
  const banner = document.getElementById('unpublishedBanner');
  if (banner) banner.hidden = true;
}

// ---------- Publish เข้า GitHub ผ่าน Cloudflare Worker proxy ----------
// Worker เก็บ GitHub token จริงไว้ฝั่งเซิร์ฟเวอร์ (ไม่เคยส่งมาที่เบราว์เซอร์) เว็บนี้แค่ยิง
// payload ไปให้ Worker เขียนเข้า GitHub แทน — จึงกดปุ่มแล้วเผยแพร่ได้ทันทีไม่ต้องถาม token เลย
// SITE_KEY ด้านล่างไม่ใช่ secret จริง (ใครอ่านซอร์สก็เห็นได้) มีไว้กันบอท/คนแปลกหน้ายิง endpoint
// เล่นๆ เท่านั้น — ต่อให้หลุดไป ผลคือเขียนทับ data.json ได้ (กู้คืนได้จากประวัติ) ไม่ใช่สิทธิ์เข้าถึง GitHub จริง
const PUBLISH_WORKER_URL = 'https://smiv-plus-publish.habusaya.workers.dev';
const PUBLISH_SITE_KEY = 'gBi6PVlhZA9QuXxcYo1z0CoIOgbczFwc';

let publishInFlight = false;
let lastPublishAt = 0;
const PUBLISH_COOLDOWN_MS = 8000;

async function publishToGithub() {
  const statusEl = document.getElementById('githubPublishStatus');

  if (publishInFlight) {
    statusEl.textContent = '⏳ กำลังเผยแพร่รอบก่อนหน้าอยู่ รอสักครู่แล้วลองใหม่';
    statusEl.className = 'status';
    return;
  }
  const sinceLast = Date.now() - lastPublishAt;
  if (sinceLast < PUBLISH_COOLDOWN_MS) {
    statusEl.textContent = `⏳ เพิ่งเผยแพร่ไปเมื่อครู่ กรุณารออีก ${Math.ceil((PUBLISH_COOLDOWN_MS - sinceLast) / 1000)} วินาที (กันยิง GitHub API ถี่เกินไป)`;
    statusEl.className = 'status';
    return;
  }

  const newCount = state.patients.length;
  if (lastPublishedCount > 0 && newCount < lastPublishedCount * 0.8) {
    const pctDrop = (100 * (1 - newCount / lastPublishedCount)).toFixed(0);
    const ok = confirm(
      `⚠️ จำนวนผู้ป่วยลดลงผิดปกติ: จากเดิม ${lastPublishedCount.toLocaleString('th-TH')} คน เหลือ ${newCount.toLocaleString('th-TH')} คน (ลดลง ${pctDrop}%)\n\n` +
      `อาจเกิดจากอัปโหลดไฟล์ผิด/ไฟล์ไม่ครบ — ต้องการเผยแพร่ทับข้อมูลเดิมจริงหรือไม่?\n(กด "ยกเลิก" เพื่อหยุดและตรวจสอบไฟล์ก่อน)`
    );
    if (!ok) {
      statusEl.textContent = '⏸️ ยกเลิกการเผยแพร่ — ตรวจสอบไฟล์ที่อัปโหลดอีกครั้ง';
      statusEl.className = 'status';
      return;
    }
  }

  statusEl.textContent = 'กำลังเผยแพร่...';
  statusEl.className = 'status';
  publishInFlight = true;
  try {
    const payload = buildPayload();
    const res = await fetch(PUBLISH_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Site-Key': PUBLISH_SITE_KEY },
      body: JSON.stringify(payload),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(result.error || `เผยแพร่ไม่สำเร็จ (${res.status})`);

    markPublished();
    lastPublishedCount = payload.patients.length;
    lastPublishAt = Date.now();
    statusEl.textContent = `✅ เผยแพร่สำเร็จ (${result.patientCount || payload.patients.length} คน) — ทุกคนจะเห็นข้อมูลใหม่ภายใน ~1 นาที`;
    statusEl.className = 'status ok';
  } catch (err) {
    statusEl.textContent = '❌ ล้มเหลว: ' + err.message;
    statusEl.className = 'status error';
  } finally {
    publishInFlight = false;
  }
}

// ---------- ดูประวัติการนำเข้าย้อนหลัง (อ่านอย่างเดียว ไม่ต้อง token) ----------
let viewingHistory = false;

async function loadHistoryList() {
  const box = document.getElementById('historyList');
  box.innerHTML = '<p class="note">กำลังโหลด...</p>';
  try {
    const res = await fetch('./history/index.json', { cache: 'no-store' });
    if (!res.ok) { box.innerHTML = '<p class="note">ยังไม่มีประวัติการเผยแพร่</p>'; return; }
    const list = await res.json();
    if (!list.length) { box.innerHTML = '<p class="note">ยังไม่มีประวัติการเผยแพร่</p>'; return; }
    const rows = list.slice().reverse().map(item => `
      <tr>
        <td>${new Date(item.publishedAt).toLocaleString('th-TH')}</td>
        <td>${item.fiscalYear || '-'}</td>
        <td>${item.patientCount.toLocaleString('th-TH')}</td>
        <td>
          <button class="btn btn-outline" data-history-file="${escapeHtml(item.file)}">👁️ ดูข้อมูลนี้</button>
          <button class="btn btn-danger" data-restore-file="${escapeHtml(item.file)}">↩️ กู้คืนเป็นข้อมูลนี้</button>
        </td>
      </tr>`).join('');
    box.innerHTML = `<div class="table-scroll"><table class="report-table">
      <thead><tr><th>เผยแพร่เมื่อ</th><th>ปีงบ</th><th>จำนวนผู้ป่วย</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
    box.querySelectorAll('[data-history-file]').forEach(btn => {
      btn.addEventListener('click', () => loadHistorySnapshot(btn.getAttribute('data-history-file')));
    });
    box.querySelectorAll('[data-restore-file]').forEach(btn => {
      btn.addEventListener('click', () => restoreHistorySnapshot(btn.getAttribute('data-restore-file')));
    });
  } catch (e) {
    box.innerHTML = '<p class="note">โหลดประวัติไม่สำเร็จ: ' + escapeHtml(e.message) + '</p>';
  }
}

async function loadHistorySnapshot(file) {
  try {
    const res = await fetch('./' + file.replace(/^docs\//, ''), { cache: 'no-store' });
    if (!res.ok) throw new Error('อ่านไฟล์ไม่สำเร็จ (' + res.status + ')');
    const data = await res.json();
    state.patients = data.patients || [];
    state.population = data.population || {};
    state.settings = { ...state.settings, ...(data.settings || {}) };
    viewingHistory = true;
    const banner = document.getElementById('historyViewBanner');
    banner.hidden = false;
    banner.querySelector('span').textContent = `กำลังดูข้อมูลย้อนหลัง ณ วันที่เผยแพร่ ${new Date(data.publishedAt).toLocaleString('th-TH')} (ห้ามแก้ไข/เผยแพร่ทับจากมุมมองนี้)`;
    $('#historyPanel').hidden = true;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    alert('โหลดข้อมูลย้อนหลังไม่สำเร็จ: ' + e.message);
  }
}

async function restoreHistorySnapshot(file) {
  if (!confirm('กู้คืนข้อมูลจากประวัตินี้ให้กลายเป็นข้อมูลปัจจุบัน (ทับข้อมูลล่าสุดที่ทุกคนเห็นอยู่ตอนนี้)?\nไม่สามารถยกเลิกภายหลังได้ (แต่จะถูกบันทึกเป็นประวัติใหม่ กู้คืนย้อนกลับได้อีกถ้าจำเป็น)')) return;
  try {
    const res = await fetch('./' + file.replace(/^docs\//, ''), { cache: 'no-store' });
    if (!res.ok) throw new Error('อ่านไฟล์ไม่สำเร็จ (' + res.status + ')');
    const data = await res.json();
    state.patients = data.patients || [];
    state.population = data.population || {};
    state.settings = { ...state.settings, ...(data.settings || {}) };
    viewingHistory = false;
    document.getElementById('historyViewBanner').hidden = true;
    saveLocal();
    markDirty();
    render();
    await publishToGithub();
    $('#historyPanel').hidden = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    alert('กู้คืนไม่สำเร็จ: ' + e.message);
  }
}

async function exitHistoryView() {
  viewingHistory = false;
  document.getElementById('historyViewBanner').hidden = true;
  const publishedOk = await loadPublished();
  if (!publishedOk) loadLocal();
  render();
}

function clearAllData() {
  if (!confirm('ล้างข้อมูลทั้งหมดในเครื่องนี้ (ไม่กระทบข้อมูลที่เผยแพร่ไปแล้วบน GitHub)? ต้องนำเข้า Excel ใหม่')) return;
  state.patients = [];
  state.population = {};
  try { localStorage.removeItem(LS_KEY); localStorage.removeItem(RAW_FILE_KEY); } catch (e) {}
  renderStoredFileInfo();
  unpublishedChanges = false;
  document.getElementById('unpublishedBanner').hidden = true;
  document.getElementById('publishHelper').hidden = true;
  setStatus('ล้างข้อมูลแล้ว', 'ok');
  render();
  renderPopulationEditor();
}

// ---------- init ----------
async function init() {
  const publishedOk = await loadPublished();
  if (!publishedOk) loadLocal();
  if (state.settings.current_fiscal_year_be) $('#fySelect').value = state.settings.current_fiscal_year_be;
  seedDefaultPopulationNames(currentFy());
  render();
  renderPopulationEditor();
  renderSettingsEditor();
  renderStoredFileInfo();

  window.addEventListener('beforeunload', e => {
    if (unpublishedChanges) { e.preventDefault(); e.returnValue = ''; }
  });

  $('#xlsxFile').addEventListener('change', e => { if (e.target.files[0]) handleUpload(e.target.files[0]); });
  $('#fySelect').addEventListener('change', () => { seedDefaultPopulationNames(currentFy()); render(); renderPopulationEditor(); });
  $('#levelSelect').addEventListener('change', render);
  $('#areaSelect').addEventListener('change', render);
  $('#dateFrom').addEventListener('change', render);
  $('#dateTo').addEventListener('change', render);
  $('#clearDates').addEventListener('click', () => { $('#dateFrom').value = ''; $('#dateTo').value = ''; render(); });
  $('#exportReportBtn').addEventListener('click', () => exportReportXlsx());
  $('#exportReportAmpurBtn').addEventListener('click', () => exportReportXlsx('ampur'));
  $('#exportReportHoscodeBtn').addEventListener('click', () => exportReportXlsx('hoscode'));
  $('#exportReportChwBtn').addEventListener('click', () => exportReportXlsx('chw_addr'));
  $('#exportIssuesBtn').addEventListener('click', exportIssuesXlsx);
  $('#exportIssuesBtn2').addEventListener('click', exportIssuesXlsx);
  $('#savePopBtn').addEventListener('click', savePopulationFromForm);
  $('#copyPopPrevYearBtn').addEventListener('click', copyPopulationFromPreviousYear);
  $('#publishBtn').addEventListener('click', publishData);
  $('#publishGithubBtn').addEventListener('click', publishToGithub);
  $('#togglePopEditor').addEventListener('click', () => { $('#popEditor').hidden = !$('#popEditor').hidden; });
  $('#toggleSettingsEditor').addEventListener('click', () => { $('#settingsEditor').hidden = !$('#settingsEditor').hidden; });
  $('#clearDataBtn').addEventListener('click', clearAllData);
  $('#saveSettingsBtn').addEventListener('click', saveSettingsFromForm);
  $('#toggleHistoryPanel').addEventListener('click', () => {
    const panel = $('#historyPanel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) loadHistoryList();
  });
  $('#exitHistoryViewBtn').addEventListener('click', e => { e.preventDefault(); exitHistoryView(); });
  $('#riskAlertBanner').addEventListener('click', () => {
    $('#problemPatientsBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  updateNotifyButton();
  const notifyBtn = $('#enableNotifyBtn');
  if (notifyBtn) notifyBtn.addEventListener('click', requestNotifyPermission);
}

document.addEventListener('DOMContentLoaded', init);
