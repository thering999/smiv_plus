<?php
require __DIR__ . '/config/base_path.php';
require __DIR__ . '/includes/session_start.php';
require __DIR__ . '/config/db.php';
require __DIR__ . '/config/settings.php';
require __DIR__ . '/includes/csrf.php';
require __DIR__ . '/includes/require_login.php';
require __DIR__ . '/includes/report_data.php';

$importMessage = '';
$importError = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'import') {
    require_admin();
    verify_csrf();
    require __DIR__ . '/import/importer.php';
    if (empty($_FILES['xlsx']) || $_FILES['xlsx']['error'] !== UPLOAD_ERR_OK) {
        $importError = 'กรุณาเลือกไฟล์ .xlsx ที่ถูกต้อง';
    } else {
        $originalName = basename($_FILES['xlsx']['name']);
        if (!preg_match('/\.xlsx$/i', $originalName)) {
            $importError = 'รองรับเฉพาะไฟล์ .xlsx';
        } else {
            try {
                $result = import_smiv_file($pdo, $_FILES['xlsx']['tmp_name'], $originalName, $_SESSION['user_id']);
                $pdo->prepare('INSERT INTO audit_log (user_id, action, detail) VALUES (?, ?, ?)')
                    ->execute([$_SESSION['user_id'], 'import', "นำเข้า {$originalName} จำนวน {$result['row_count']} แถว (batch #{$result['batch_id']})"]);
                $importMessage = "นำเข้าสำเร็จ {$result['row_count']} แถว";
            } catch (InvalidArgumentException $e) {
                $importError = "ไฟล์ไม่ถูกต้อง:\n" . $e->getMessage();
            } catch (Throwable $e) {
                $importError = 'นำเข้าล้มเหลว: ' . $e->getMessage();
            }
        }
    }
}

$fy = isset($_GET['fy']) ? (int) $_GET['fy'] : current_fiscal_year_be($pdo);
$level = $_GET['level'] ?? 'ampur';
$dateFrom = trim($_GET['date_from'] ?? '') ?: null;
$dateTo = trim($_GET['date_to'] ?? '') ?: null;
$data = build_smiv_report($pdo, $fy, $level, $dateFrom, $dateTo);
$level = $data['level'];
$areaOptions = $data['report']; // รายการพื้นที่ทั้งหมดของมุมมองนี้ ใช้ทำ dropdown กรองซ้อน
$areaFilter = trim($_GET['area'] ?? '');

$report = $data['report'];
if ($areaFilter !== '') {
    $report = array_values(array_filter($report, fn($r) => (string) $r['group_key'] === $areaFilter));
}
$totals = $data['totals'];
if ($areaFilter !== '' && $report) {
    $totals = $report[0]; // เลือกพื้นที่เดียว ใช้ค่าของแถวนั้นแทนผลรวม
}
$maxAge = $data['max_age'];
$hasPop = $data['has_population_data'];
$areaLabel = REPORT_LEVELS[$level];
$areaQs = $areaFilter !== '' ? '&area=' . urlencode($areaFilter) : '';
$dateQs = ($dateFrom ? '&date_from=' . $dateFrom : '') . ($dateTo ? '&date_to=' . $dateTo : '');

$extra = build_extra_charts($pdo, $fy);
$lastImport = $pdo->query('SELECT filename, imported_at, row_count FROM import_batches ORDER BY id DESC LIMIT 1')->fetch();

$wantAi = ($_GET['ai'] ?? '') === '1';
$aiSummary = $wantAi && $report ? ai_summarize($totals, $areaLabel, $fy, $hasPop) : null;

$areaAnalysis = [];
foreach ($report as $r) {
    $areaAnalysis[] = ['area' => $r, 'findings' => analyze_area($r)];
}
$categoryCounts = count_findings_by_category($areaAnalysis);

$pageTitle = 'Dashboard SMI-V - SMI-V Plus';
require __DIR__ . '/includes/header.php';
?>
<h1>ร้อยละผู้ป่วยจิตเวชสารเสพติดก่อความรุนแรง (SMI-V) เข้าถึงบริการต่อเนื่องและไม่ก่อความรุนแรงซ้ำ</h1>
<?php if ($lastImport): ?>
  <p class="note">ข้อมูลล่าสุด: นำเข้าเมื่อ <?= htmlspecialchars($lastImport['imported_at']) ?> จากไฟล์ <?= htmlspecialchars($lastImport['filename']) ?> (<?= number_format($lastImport['row_count']) ?> แถว) · เปิดหน้านี้เมื่อ <?= date('Y-m-d H:i') ?></p>
<?php else: ?>
  <p class="alert">ยังไม่เคยนำเข้าข้อมูล — ใช้เมนู "นำเข้าข้อมูล Excel" ด้านล่าง</p>
<?php endif; ?>

<?php if (($_SESSION['role'] ?? '') === 'admin'): ?>
<details class="table-details" <?= ($importMessage || $importError) ? 'open' : '' ?>>
<summary>นำเข้าข้อมูล Excel (exchange_file.xlsx)</summary>
<?php if ($importMessage): ?><div class="alert alert-success"><?= htmlspecialchars($importMessage) ?></div><?php endif; ?>
<?php if ($importError): ?><div class="alert"><pre style="white-space:pre-wrap;margin:0"><?= htmlspecialchars($importError) ?></pre></div><?php endif; ?>
<form method="post" enctype="multipart/form-data" class="card" style="margin-top:10px">
  <?= csrf_field() ?>
  <input type="hidden" name="action" value="import">
  <label>ไฟล์ .xlsx (ชีตชื่อ Data หัวคอลัมน์ hoscode..follow_last)</label>
  <input type="file" name="xlsx" accept=".xlsx" required>
  <button type="submit">นำเข้าข้อมูล</button>
</form>
</details>
<?php endif; ?>

<form method="get" class="filter-bar">
  <label>ปีงบประมาณ (พ.ศ.)</label>
  <input type="number" name="fy" value="<?= (int) $fy ?>" min="2560" max="2600">
  <label>มุมมอง</label>
  <select name="level" onchange="this.form.area.value=''; this.form.submit()">
    <?php foreach (REPORT_LEVELS as $lv => $lbl): ?>
      <option value="<?= $lv ?>" <?= $lv === $level ? 'selected' : '' ?>><?= htmlspecialchars($lbl) ?></option>
    <?php endforeach; ?>
  </select>
  <label>เลือก<?= htmlspecialchars($areaLabel) ?></label>
  <select name="area">
    <option value="">— ทั้งหมด —</option>
    <?php foreach ($areaOptions as $opt): ?>
      <option value="<?= htmlspecialchars($opt['group_key']) ?>" <?= $areaFilter === (string) $opt['group_key'] ? 'selected' : '' ?>>
        <?= htmlspecialchars($opt['ampur_name']) ?> (D=<?= $opt['d'] ?>)
      </option>
    <?php endforeach; ?>
  </select>
  <label>วันที่มารับบริการครั้งแรก ตั้งแต่</label>
  <input type="date" name="date_from" value="<?= htmlspecialchars($dateFrom ?? '') ?>">
  <label>ถึง</label>
  <input type="date" name="date_to" value="<?= htmlspecialchars($dateTo ?? '') ?>">
  <button type="submit">แสดงผล</button>
  <?php if ($dateFrom || $dateTo): ?><a href="<?= url('/index.php?fy=' . (int) $fy . '&level=' . $level . $areaQs) ?>">ล้างช่วงวันที่</a><?php endif; ?>
</form>

<?php if ($report): ?>
<p>
  <a class="btn-export" href="<?= url('/export.php?fy=' . (int) $fy . '&level=' . $level . $areaQs . $dateQs) ?>">⬇ ส่งออก Excel (<?= htmlspecialchars(REPORT_LEVELS[$level]) ?><?= $areaFilter !== '' ? ' - ' . htmlspecialchars($totals['ampur_name'] ?? '') : '' ?>)</a>
  <?php foreach (REPORT_LEVELS as $lv => $lbl): if ($lv === $level) continue; ?>
    <a class="btn-export btn-export-alt" href="<?= url('/export.php?fy=' . (int) $fy . '&level=' . $lv . $dateQs) ?>">⬇ <?= htmlspecialchars($lbl) ?></a>
  <?php endforeach; ?>
  <a class="btn-export" style="background:var(--danger)" href="<?= url('/export_issues.php?fy=' . (int) $fy . '&level=' . $level . $areaQs . $dateQs) ?>">⬇ ส่งคืนรายชื่อที่มีปัญหา (ให้พื้นที่ตรวจสอบ)</a>
</p>
<?php endif; ?>

<?php if (!$report): ?>
  <p class="alert">ไม่มีข้อมูลปีงบ <?= (int) $fy ?> — นำเข้าไฟล์ Excel หรือกรอกข้อมูลประชากรก่อน</p>
<?php else: ?>

<?php if (!$hasPop): ?>
  <p class="alert">ยังไม่มีข้อมูลประชากร 15-60 ปี (H) — อัตราเข้าถึงบริการ (E) และตัวเลขที่อิง I จะเป็น 0 จนกว่าจะกรอกที่เมนู "ประชากร/ประมาณการณ์"</p>
<?php endif; ?>

<div class="kpi-grid">
  <div class="kpi-card <?= $totals['e'] < 40 ? 'kpi-danger' : 'kpi-ok' ?>">
    <div class="kpi-label">อัตราเข้าถึงบริการ (E)</div>
    <div class="kpi-value"><?= number_format($totals['e'], 2) ?>%</div>
    <div class="kpi-target">เป้า &gt; 40%<?= $hasPop ? '' : ' · รอข้อมูลประชากร' ?></div>
  </div>
  <div class="kpi-card kpi-neutral">
    <div class="kpi-label">ผู้ป่วย SMI-V ทั้งหมด (D)</div>
    <div class="kpi-value"><?= number_format($totals['d']) ?></div>
    <div class="kpi-target">เก่า <?= number_format($totals['b']) ?> + ใหม่ <?= number_format($totals['c']) ?></div>
  </div>
  <div class="kpi-card kpi-neutral">
    <div class="kpi-label">ร้อยละต่อเนื่องไม่ก่อซ้ำ (G)</div>
    <div class="kpi-value"><?= number_format($totals['g'], 2) ?>%</div>
    <div class="kpi-target">ติดตาม≥2ครั้งไม่ก่อซ้ำ <?= number_format($totals['n']) ?> คน</div>
  </div>
  <div class="kpi-card <?= $totals['missing_followup'] > 0 ? 'kpi-danger' : 'kpi-ok' ?>">
    <div class="kpi-label">ขาดการติดตาม (follow_last ว่าง)</div>
    <div class="kpi-value"><?= number_format($totals['missing_followup']) ?></div>
    <div class="kpi-target">ไม่เคยได้รับรหัส 1B037 เลย</div>
  </div>
  <div class="kpi-card kpi-neutral">
    <div class="kpi-label"><?= htmlspecialchars($areaLabel) ?></div>
    <div class="kpi-value"><?= count($report) ?></div>
    <div class="kpi-target">ปีงบ <?= (int) $fy ?></div>
  </div>
</div>

<div class="chart-grid" style="margin-bottom:24px">
  <div class="chart-box">
    <h3>จำนวนผู้ป่วย SMI-V <?= htmlspecialchars($areaLabel) ?> (เก่า/ใหม่)</h3>
    <canvas id="chartPatientsSummary"></canvas>
  </div>
  <?php if ($hasPop): ?>
  <div class="chart-box">
    <h3>อัตราเข้าถึงบริการ (E) เทียบเป้า 40%</h3>
    <canvas id="chartAccessSummary"></canvas>
  </div>
  <?php else: ?>
  <div class="chart-box">
    <h3>สัดส่วนการติดตาม (ไม่เคย/1 ครั้ง/≥2 ครั้ง)</h3>
    <canvas id="chartFollowSummary"></canvas>
  </div>
  <?php endif; ?>
  <div class="chart-box">
    <h3>อัตราก่อความรุนแรงซ้ำ <?= htmlspecialchars($areaLabel) ?> (%)</h3>
    <canvas id="chartRepeatRate"></canvas>
  </div>
  <div class="chart-box">
    <h3>แนวโน้มผู้ป่วยใหม่รายเดือน (ปีงบ <?= (int) $fy ?>)</h3>
    <canvas id="chartMonthlyTrend"></canvas>
  </div>
  <div class="chart-box">
    <h3>สัดส่วนเพศ (ผู้ป่วยสะสมทั้งหมด)</h3>
    <canvas id="chartSex"></canvas>
  </div>
  <div class="chart-box">
    <h3>สัดส่วนการติดตาม <?= htmlspecialchars($areaLabel) ?> (ไม่เคย/1 ครั้ง/≥2 ครั้ง)</h3>
    <canvas id="chartFollowByArea"></canvas>
  </div>
</div>
<h2>สรุปด้วย AI</h2>
<?php if ($aiSummary): ?>
  <div class="analysis-card" style="border-left:4px solid var(--primary)">
    <p style="white-space:pre-line;margin:0"><?= htmlspecialchars($aiSummary) ?></p>
    <p class="note" style="margin-top:8px">สรุปโดย AI ท้องถิ่น (Ollama) จากตัวเลขในตารางนี้ — ใช้ประกอบการตัดสินใจ ไม่ใช่แหล่งความจริงหลัก ตรวจสอบกับกฎวิเคราะห์ด้านล่างเสมอ</p>
  </div>
<?php elseif ($wantAi): ?>
  <p class="alert">เรียก AI ไม่สำเร็จ (Ollama ไม่ตอบสนองหรือ timeout) — ดูสรุปกฎเกณฑ์ด้านล่างแทนได้</p>
<?php else: ?>
  <p class="note"><a href="<?= url('/index.php?fy=' . (int) $fy . '&level=' . $level . $areaQs . $dateQs . '&ai=1') ?>">▶ ให้ AI ช่วยสรุปภาพรวม</a> (เรียก Ollama ท้องถิ่น อาจใช้เวลาสักครู่)</p>
<?php endif; ?>

<?php if ($categoryCounts): ?>
<h2>สรุปปัญหาแยกประเด็น (จำนวนพื้นที่ที่พบ)</h2>
<div class="chart-box" style="max-width:700px;margin-bottom:24px">
  <canvas id="chartIssueCategory"></canvas>
</div>
<?php endif; ?>

<h2>สรุปปัญหาแยกรายพื้นที่ (<?= htmlspecialchars($areaLabel) ?>)</h2>
<?php foreach ($areaAnalysis as $item): ?>
  <div class="analysis-card">
    <h3><?= htmlspecialchars($item['area']['ampur_name']) ?> <span class="muted">(D=<?= $item['area']['d'] ?> คน)</span></h3>
    <?php foreach ($item['findings'] as $f): ?>
      <div class="finding finding-<?= $f['level'] ?>">
        <div class="finding-title"><?= htmlspecialchars($f['title']) ?></div>
        <div class="finding-detail"><?= htmlspecialchars($f['detail']) ?></div>
        <div class="finding-action">➜ <?= htmlspecialchars($f['action']) ?></div>
      </div>
    <?php endforeach; ?>
  </div>
<?php endforeach; ?>
<p class="note">ดูกราฟเพิ่มเติมแยกรายประเด็น (อัตราก่อความรุนแรงซ้ำ, สัดส่วนการติดตาม) และข้อเสนอแนะภาพรวมที่หน้า <a href="<?= url('/analysis.php?fy=' . (int) $fy . '&level=' . $level . $areaQs) ?>">วิเคราะห์ปัญหา</a></p>

<details class="table-details">
<summary>ตารางแบบเต็ม (รูปแบบ HDC Template) — <?= htmlspecialchars($areaLabel) ?></summary>
<div class="table-scroll">
<table class="report-table">
  <thead>
    <tr>
      <th rowspan="2">พื้นที่</th>
      <th colspan="3">จำนวนผู้ป่วย SMI-V (1B030-33)</th>
      <th rowspan="2">อัตราเข้าถึงบริการ<br>D/I*100 (E)</th>
      <th rowspan="2">ไม่ก่อความรุนแรงซ้ำสะสม (F)</th>
      <th rowspan="2">ร้อยละต่อเนื่อง<br>ไม่ก่อซ้ำ (G)</th>
      <th rowspan="2">ประชากร 15-60 (H)</th>
      <th rowspan="2">ประมาณการณ์ผู้ป่วย (I)<br><small>H×4.37%×11.92%</small></th>
      <th colspan="3">ติดตาม 1 ครั้ง</th>
      <th colspan="3">ติดตามอย่างน้อย 2 ครั้ง</th>
      <th rowspan="2">ขาดการติดตาม<br><small>(follow_last ว่าง)</small></th>
    </tr>
    <tr>
      <th>เก่า (B)</th><th>ใหม่ (C)</th><th>รวม (D)</th>
      <th>J</th><th>K</th><th>L=K/I*100</th>
      <th>M</th><th>N</th><th>O=N/I*100</th>
    </tr>
  </thead>
  <tbody>
  <?php foreach ($report as $r): ?>
    <tr>
      <td><?= htmlspecialchars($r['ampur_name']) ?></td>
      <td><?= number_format($r['b']) ?></td>
      <td><?= number_format($r['c']) ?></td>
      <td><?= number_format($r['d']) ?></td>
      <td><?= number_format($r['e'], 2) ?></td>
      <td><?= number_format($r['f']) ?></td>
      <td><?= number_format($r['g'], 2) ?></td>
      <td><?= number_format($r['h']) ?></td>
      <td><?= number_format($r['i']) ?></td>
      <td><?= number_format($r['j']) ?></td>
      <td><?= number_format($r['k']) ?></td>
      <td><?= number_format($r['l'], 2) ?></td>
      <td><?= number_format($r['m']) ?></td>
      <td><?= number_format($r['n']) ?></td>
      <td><?= number_format($r['o'], 2) ?></td>
      <td><?= number_format($r['missing_followup']) ?></td>
    </tr>
  <?php endforeach; ?>
  <?php if ($report): ?>
    <tr class="total-row">
      <td>รวม</td>
      <td><?= number_format($totals['b']) ?></td>
      <td><?= number_format($totals['c']) ?></td>
      <td><?= number_format($totals['d']) ?></td>
      <td><?= number_format($totals['e'], 2) ?></td>
      <td><?= number_format($totals['f']) ?></td>
      <td><?= number_format($totals['g'], 2) ?></td>
      <td><?= number_format($totals['h']) ?></td>
      <td><?= number_format($totals['i']) ?></td>
      <td><?= number_format($totals['j']) ?></td>
      <td><?= number_format($totals['k']) ?></td>
      <td><?= number_format($totals['l'], 2) ?></td>
      <td><?= number_format($totals['m']) ?></td>
      <td><?= number_format($totals['n']) ?></td>
      <td><?= number_format($totals['o'], 2) ?></td>
    </tr>
  <?php endif; ?>
  </tbody>
</table>
</div>
<p class="note">
I = ผู้ป่วยประมาณการณ์ คำนวณอัตโนมัติจาก H × ความชุก SMI (4.37%) × สัดส่วน SMI-V (11.92%) ตามสูตร HDC (ปรับค่าได้ที่ "ตั้งค่าระบบ") ·
ตัดผู้ป่วยอายุเกิน <?= (int) $maxAge ?> ปี ณ สิ้นปีงบประมาณออกจากตัวนับแล้ว ·
"ก่อความรุนแรงซ้ำ" นับจากจำนวนรหัส b03x (1B030-1B033) ที่ถูกลงทะเบียนมากกว่า 1 ครั้งต่อคน ·
<strong>หมายเหตุ:</strong> ยังไม่ตัดผู้เสียชีวิตออก เนื่องจากไม่มีข้อมูลเชื่อมโยงจากฐานข้อมูลกระทรวงมหาดไทย
</p>
</details>

<script src="<?= url('/assets/js/chart.min.js') ?>"></script>
<script>
const summaryLabels = <?= json_encode(array_column($report, 'ampur_name'), JSON_UNESCAPED_UNICODE) ?>;
new Chart(document.getElementById('chartPatientsSummary'), {
  type: 'bar',
  data: {
    labels: summaryLabels,
    datasets: [
      { label: 'เก่า (B)', data: <?= json_encode(array_column($report, 'b')) ?>, backgroundColor: '#2c6e91' },
      { label: 'ใหม่ (C)', data: <?= json_encode(array_column($report, 'c')) ?>, backgroundColor: '#5aa7c9' },
    ]
  },
  options: { responsive: true, indexAxis: 'y', scales: { x: { stacked: true, beginAtZero: true }, y: { stacked: true } } }
});
<?php if ($hasPop): ?>
new Chart(document.getElementById('chartAccessSummary'), {
  type: 'bar',
  data: {
    labels: summaryLabels,
    datasets: [{ label: 'อัตราเข้าถึงบริการ (E) %', data: <?= json_encode(array_column($report, 'e')) ?>,
      backgroundColor: <?= json_encode(array_map(fn($r) => $r['e'] < 40 ? '#c0392b' : '#1e7e34', $report)) ?> }]
  },
  options: { responsive: true, indexAxis: 'y', scales: { x: { beginAtZero: true } } }
});
<?php else: ?>
new Chart(document.getElementById('chartFollowSummary'), {
  type: 'doughnut',
  data: {
    labels: ['ไม่เคยติดตาม', 'ติดตาม 1 ครั้ง', 'ติดตาม ≥2 ครั้ง'],
    datasets: [{
      data: [<?= (int) $totals['zero_followup'] ?>, <?= (int) $totals['j'] ?>, <?= (int) $totals['m'] ?>],
      backgroundColor: ['#c0392b', '#e0a63c', '#1e7e34'],
    }]
  },
  options: { responsive: true }
});
<?php endif; ?>

new Chart(document.getElementById('chartRepeatRate'), {
  type: 'bar',
  data: {
    labels: summaryLabels,
    datasets: [{
      label: 'อัตราก่อความรุนแรงซ้ำ %',
      data: <?= json_encode(array_map(fn($r) => pct($r['repeat_violence_count'], $r['d']), $report)) ?>,
      backgroundColor: <?= json_encode(array_map(fn($r) => pct($r['repeat_violence_count'], $r['d']) > 15 ? '#c0392b' : '#1e7e34', $report)) ?>,
    }]
  },
  options: { responsive: true, indexAxis: 'y', scales: { x: { beginAtZero: true } } }
});

new Chart(document.getElementById('chartMonthlyTrend'), {
  type: 'line',
  data: {
    labels: <?= json_encode(array_keys($extra['trend'])) ?>,
    datasets: [{
      label: 'ผู้ป่วยใหม่ (คน)',
      data: <?= json_encode(array_values($extra['trend'])) ?>,
      borderColor: '#2c6e91', backgroundColor: 'rgba(44,110,145,.15)', fill: true, tension: 0.2,
    }]
  },
  options: { responsive: true, scales: { y: { beginAtZero: true } } }
});

new Chart(document.getElementById('chartSex'), {
  type: 'pie',
  data: {
    labels: <?= json_encode(array_keys($extra['sex']), JSON_UNESCAPED_UNICODE) ?>,
    datasets: [{
      data: <?= json_encode(array_values($extra['sex'])) ?>,
      backgroundColor: ['#2c6e91', '#e07b9e', '#9aa5ad'],
    }]
  },
  options: { responsive: true }
});

new Chart(document.getElementById('chartFollowByArea'), {
  type: 'bar',
  data: {
    labels: summaryLabels,
    datasets: [
      { label: 'ไม่เคยติดตาม', data: <?= json_encode(array_column($report, 'zero_followup')) ?>, backgroundColor: '#c0392b' },
      { label: 'ติดตาม 1 ครั้ง', data: <?= json_encode(array_column($report, 'j')) ?>, backgroundColor: '#e0a63c' },
      { label: 'ติดตาม ≥2 ครั้ง', data: <?= json_encode(array_column($report, 'm')) ?>, backgroundColor: '#1e7e34' },
    ]
  },
  options: { responsive: true, scales: { x: { stacked: true, beginAtZero: true }, y: { stacked: true } }, indexAxis: 'y' }
});

<?php if ($categoryCounts): ?>
new Chart(document.getElementById('chartIssueCategory'), {
  type: 'bar',
  data: {
    labels: <?= json_encode(array_map(fn($k) => FINDING_CATEGORY_LABELS[$k], array_keys($categoryCounts)), JSON_UNESCAPED_UNICODE) ?>,
    datasets: [{
      label: 'จำนวนพื้นที่ที่พบปัญหานี้',
      data: <?= json_encode(array_values($categoryCounts)) ?>,
      backgroundColor: '#c0392b',
    }]
  },
  options: { responsive: true, indexAxis: 'y', scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } }, plugins: { legend: { display: false } } }
});
<?php endif; ?>
</script>
<?php endif; ?>
<?php require __DIR__ . '/includes/footer.php'; ?>
