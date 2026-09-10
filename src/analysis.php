<?php
require __DIR__ . '/config/base_path.php';
require __DIR__ . '/includes/session_start.php';
require __DIR__ . '/config/db.php';
require __DIR__ . '/config/settings.php';
require __DIR__ . '/includes/require_login.php';
require __DIR__ . '/includes/report_data.php';

$fy = isset($_GET['fy']) ? (int) $_GET['fy'] : current_fiscal_year_be($pdo);
$level = $_GET['level'] ?? 'ampur';
$data = build_smiv_report($pdo, $fy, $level);
$report = $data['report'];
$totals = $data['totals'];
$level = $data['level'];
$areaLabel = REPORT_LEVELS[$level];

$ampurAnalysis = [];
foreach ($report as $r) {
    $ampurAnalysis[] = ['ampur' => $r, 'findings' => analyze_area($r)];
}

$overallRepeatRate = pct($totals['repeat_violence_count'] ?? 0, $totals['d']);
$overallZeroFollowRate = pct($totals['zero_followup'] ?? 0, $totals['d']);

$chartLabels = array_column($report, 'ampur_name');
$chartData = [
    'bc' => ['b' => array_column($report, 'b'), 'c' => array_column($report, 'c')],
    'access' => array_column($report, 'e'),
    'repeatRate' => array_map(fn($r) => pct($r['repeat_violence_count'], $r['d']), $report),
    'followDist' => [
        'zero' => array_column($report, 'zero_followup'),
        'one' => array_column($report, 'j'),
        'twoplus' => array_column($report, 'm'),
    ],
];

$pageTitle = 'วิเคราะห์ปัญหา - SMI-V Plus';
require __DIR__ . '/includes/header.php';
?>
<h1>วิเคราะห์ปัญหาแยกรายประเด็น (ปีงบ <?= (int) $fy ?>)</h1>
<p class="note">วิเคราะห์ด้วยกฎเกณฑ์ที่กำหนดชัดเจนจากเอกสาร HDC/V-Care (ไม่ใช่ระบบ AI ภายนอก) — ทุกข้อสรุปตรวจสอบย้อนกลับได้จากตัวเลขในตาราง Dashboard</p>

<form method="get" class="filter-bar">
  <label>ปีงบประมาณ (พ.ศ.)</label>
  <input type="number" name="fy" value="<?= (int) $fy ?>">
  <label>มุมมอง</label>
  <select name="level">
    <?php foreach (REPORT_LEVELS as $lv => $lbl): ?>
      <option value="<?= $lv ?>" <?= $lv === $level ? 'selected' : '' ?>><?= htmlspecialchars($lbl) ?></option>
    <?php endforeach; ?>
  </select>
  <button type="submit">แสดงผล</button>
</form>

<?php if (!$report): ?>
  <p class="alert">ไม่มีข้อมูลปีงบ <?= (int) $fy ?> — นำเข้าไฟล์ Excel ก่อน</p>
<?php else: ?>
<p><a class="btn-export" href="<?= url('/export.php?fy=' . (int) $fy . '&level=' . $level) ?>">⬇ ส่งออก Excel (<?= htmlspecialchars($areaLabel) ?>)</a></p>

<h2>ภาพรวม</h2>
<div class="kpi-grid">
  <div class="kpi-card <?= $totals['e'] < TARGET_ACCESS_RATE ? 'kpi-danger' : 'kpi-ok' ?>">
    <div class="kpi-label">อัตราเข้าถึงบริการ (E)</div>
    <div class="kpi-value"><?= number_format($totals['e'], 2) ?>%</div>
    <div class="kpi-target">เป้า &gt; <?= TARGET_ACCESS_RATE ?>%</div>
  </div>
  <div class="kpi-card <?= $overallRepeatRate > THRESHOLD_REPEAT_VIOLENCE ? 'kpi-danger' : 'kpi-ok' ?>">
    <div class="kpi-label">อัตราก่อความรุนแรงซ้ำ</div>
    <div class="kpi-value"><?= number_format($overallRepeatRate, 2) ?>%</div>
    <div class="kpi-target">เกณฑ์เฝ้าระวัง &gt; <?= THRESHOLD_REPEAT_VIOLENCE ?>%</div>
  </div>
  <div class="kpi-card <?= $overallZeroFollowRate > THRESHOLD_ZERO_FOLLOWUP ? 'kpi-danger' : 'kpi-ok' ?>">
    <div class="kpi-label">ไม่เคยติดตามซ้ำ</div>
    <div class="kpi-value"><?= number_format($overallZeroFollowRate, 2) ?>%</div>
    <div class="kpi-target">เกณฑ์เฝ้าระวัง &gt; <?= THRESHOLD_ZERO_FOLLOWUP ?>%</div>
  </div>
  <div class="kpi-card kpi-neutral">
    <div class="kpi-label">ผู้ป่วยทั้งหมด (D)</div>
    <div class="kpi-value"><?= number_format($totals['d']) ?></div>
    <div class="kpi-target"><?= count($report) ?> อำเภอ</div>
  </div>
</div>

<h2>กราฟ</h2>
<div class="chart-grid">
  <div class="chart-box"><h3>ผู้ป่วยเก่า/ใหม่ รายอำเภอ (B/C)</h3><canvas id="chartBC"></canvas></div>
  <div class="chart-box"><h3>อัตราเข้าถึงบริการ (E) เทียบเป้า <?= TARGET_ACCESS_RATE ?>%</h3><canvas id="chartAccess"></canvas></div>
  <div class="chart-box"><h3>อัตราก่อความรุนแรงซ้ำ รายอำเภอ</h3><canvas id="chartRepeat"></canvas></div>
  <div class="chart-box"><h3>สัดส่วนการติดตาม (ไม่เคย/1 ครั้ง/≥2 ครั้ง)</h3><canvas id="chartFollow"></canvas></div>
</div>

<h2>รายละเอียดปัญหาและข้อเสนอแนะรายอำเภอ</h2>
<?php foreach ($ampurAnalysis as $item): ?>
  <div class="analysis-card">
    <h3><?= htmlspecialchars($item['ampur']['ampur_name']) ?> <span class="muted">(D=<?= $item['ampur']['d'] ?> คน)</span></h3>
    <?php foreach ($item['findings'] as $f): ?>
      <div class="finding finding-<?= $f['level'] ?>">
        <div class="finding-title"><?= htmlspecialchars($f['title']) ?></div>
        <div class="finding-detail"><?= htmlspecialchars($f['detail']) ?></div>
        <div class="finding-action">➜ <?= htmlspecialchars($f['action']) ?></div>
      </div>
    <?php endforeach; ?>
  </div>
<?php endforeach; ?>

<h2>ข้อเสนอแนะการติดตามและใช้งานระบบ (ภาพรวม)</h2>
<ul class="reco-list">
  <li><strong>นำเข้าข้อมูลสม่ำเสมอ</strong> — อย่างน้อยเดือนละครั้ง เพื่อให้ตัวเลขติดตาม (J/M) และอัตราก่อซ้ำสะท้อนสถานการณ์ปัจจุบัน</li>
  <li><strong>กรอกข้อมูลประชากร (H) ให้ครบทุกอำเภอ</strong> ก่อนอ่านผล E/L/O เพราะถ้า H ว่างจะคำนวณอัตราเข้าถึงบริการไม่ได้</li>
  <li><strong>ตรวจสอบคุณภาพข้อมูลต้นทาง</strong> — เจ้าหน้าที่บันทึก 43แฟ้ม SPECIALPP ต้องลงรหัส 1B030-1B033 ให้ตรง ไม่ใช้ Z-code ทดแทน (สาเหตุอัตราเข้าถึงต่ำที่พบบ่อยตามเอกสาร HDC)</li>
  <li><strong>เคสก่อความรุนแรงซ้ำ</strong> — นำเข้าสู่ Conference ทีมสหวิชาชีพ (สาธารณสุข+ฝ่ายปกครอง+ตำรวจ+ท้องถิ่น) ทำ Individual Care Plan ตามแนวทาง V-Care</li>
  <li><strong>ความถี่ติดตามเยี่ยม</strong> — ปรับตามระดับความเสี่ยง: สูง/แดง ทุก 7 วัน, ส้ม ทุก 7-15 วัน, เหลือง ทุก 15 วัน, เขียว ทุก 30 วัน</li>
  <li><strong>ผู้ดูแลระบบ</strong> — ทบทวนสิทธิ์ผู้ใช้งานเป็นระยะ, เปลี่ยนรหัสผ่านเริ่มต้นทันทีหลัง deploy, สำรองฐานข้อมูล (mysqldump) ก่อน import ไฟล์ใหญ่</li>
  <li><strong>ข้อจำกัดที่ต้องทราบ</strong> — ระบบยังไม่ตัดผู้เสียชีวิตออกจากตัวนับ (ไม่มีข้อมูลเชื่อมกระทรวงมหาดไทย) ตัวเลข D/E จึงอาจสูงกว่าความเป็นจริงเล็กน้อย</li>
</ul>

<script src="<?= url('/assets/js/chart.min.js') ?>"></script>
<script>
const labels = <?= json_encode($chartLabels, JSON_UNESCAPED_UNICODE) ?>;
const chartData = <?= json_encode($chartData, JSON_UNESCAPED_UNICODE) ?>;

new Chart(document.getElementById('chartBC'), {
  type: 'bar',
  data: {
    labels,
    datasets: [
      { label: 'เก่า (B)', data: chartData.bc.b, backgroundColor: '#2c6e91' },
      { label: 'ใหม่ (C)', data: chartData.bc.c, backgroundColor: '#5aa7c9' },
    ]
  },
  options: { responsive: true, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } }
});

new Chart(document.getElementById('chartAccess'), {
  type: 'bar',
  data: {
    labels,
    datasets: [
      { label: 'อัตราเข้าถึงบริการ (E) %', data: chartData.access, backgroundColor: chartData.access.map(v => v < <?= TARGET_ACCESS_RATE ?> ? '#c0392b' : '#1e7e34') },
    ]
  },
  options: {
    responsive: true,
    scales: { y: { beginAtZero: true } },
    plugins: { annotation: undefined }
  }
});

new Chart(document.getElementById('chartRepeat'), {
  type: 'bar',
  data: {
    labels,
    datasets: [
      { label: 'อัตราก่อความรุนแรงซ้ำ %', data: chartData.repeatRate, backgroundColor: chartData.repeatRate.map(v => v > <?= THRESHOLD_REPEAT_VIOLENCE ?> ? '#c0392b' : '#1e7e34') },
    ]
  },
  options: { responsive: true, scales: { y: { beginAtZero: true } } }
});

new Chart(document.getElementById('chartFollow'), {
  type: 'bar',
  data: {
    labels,
    datasets: [
      { label: 'ไม่เคยติดตาม', data: chartData.followDist.zero, backgroundColor: '#c0392b' },
      { label: 'ติดตาม 1 ครั้ง', data: chartData.followDist.one, backgroundColor: '#e0a63c' },
      { label: 'ติดตาม ≥2 ครั้ง', data: chartData.followDist.twoplus, backgroundColor: '#1e7e34' },
    ]
  },
  options: { responsive: true, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } }
});
</script>
<?php endif; ?>
<?php require __DIR__ . '/includes/footer.php'; ?>
