<?php
require __DIR__ . '/config/base_path.php';
require __DIR__ . '/includes/session_start.php';
require __DIR__ . '/config/db.php';
require __DIR__ . '/config/settings.php';
require __DIR__ . '/includes/require_login.php';
require __DIR__ . '/includes/report_data.php';

$fy = isset($_GET['fy']) ? (int) $_GET['fy'] : current_fiscal_year_be($pdo);

$stmt = $pdo->prepare(
    "SELECT id, hoscode, hosname, pid, name, lname, birth, ampur,
            first_date_serv, follow_last, total_visits
     FROM patients p
     LEFT JOIN (SELECT patient_id, COUNT(*) total_visits FROM patient_visits GROUP BY patient_id) v ON v.patient_id = p.id
     WHERE p.fiscal_year_be = ?
     ORDER BY p.hoscode, p.pid"
);
$stmt->execute([$fy]);
$allPatients = $stmt->fetchAll();

$issues = [];
foreach ($allPatients as $p) {
    $patientIssues = [];

    if ($p['birth'] === null) $patientIssues[] = 'ไม่มีวันเกิด';
    if (empty($p['name'])) $patientIssues[] = 'ชื่อว่าง';
    if (empty($p['lname'])) $patientIssues[] = 'นามสกุลว่าง';
    if ($p['follow_last'] === null && ($p['total_visits'] ?? 0) > 1) $patientIssues[] = 'ติดตาม >1 แต่ follow_last ว่าง';
    if ($p['follow_last'] !== null && strtotime($p['follow_last']) < strtotime($p['first_date_serv'])) {
        $patientIssues[] = 'วันติดตามก่อนวันแรก';
    }
    if ($p['birth'] !== null && strtotime($p['birth']) > time()) $patientIssues[] = 'วันเกิดในอนาคต';

    if ($patientIssues) {
        $issues[] = [
            'hoscode' => $p['hoscode'],
            'hosname' => $p['hosname'],
            'pid' => $p['pid'],
            'name' => $p['name'] . ' ' . $p['lname'],
            'problems' => implode('; ', $patientIssues),
            'count' => count($patientIssues),
        ];
    }
}

usort($issues, fn($a, $b) => $b['count'] <=> $a['count']);

$issueCounts = [];
foreach ($issues as $i) {
    foreach (explode('; ', $i['problems']) as $p) {
        $issueCounts[$p] = ($issueCounts[$p] ?? 0) + 1;
    }
}
arsort($issueCounts);

$pageTitle = 'ตรวจสอบคุณภาพข้อมูล - SMI-V Plus';
require __DIR__ . '/includes/header.php';
?>
<h1>ตรวจสอบคุณภาพข้อมูล (ปีงบ <?= (int) $fy ?>)</h1>
<p class="note">ตรวจหาข้อมูลที่หายหรือไม่สอดคล้องกัน</p>

<form method="get" style="margin-bottom: 1rem;">
  <label>ปีงบประมาณ (พ.ศ.)</label>
  <input type="number" name="fy" value="<?= (int) $fy ?>" style="width: 100px;">
  <button type="submit">เปลี่ยน</button>
</form>

<?php if (!$issues): ?>
<div class="alert alert-success">✓ ข้อมูลมีคุณภาพ ไม่พบปัญหา</div>
<?php else: ?>

<div class="audit-stats">
  <div class="stat-card">
    <div class="stat-value" style="color: #d32f2f;"><?= count($issues) ?></div>
    <div class="stat-label">ผู้ป่วยมีปัญหาข้อมูล</div>
  </div>
  <div class="stat-card">
    <div class="stat-value"><?= count($issueCounts) ?></div>
    <div class="stat-label">ประเภทปัญหา</div>
  </div>
  <div class="stat-card">
    <div class="stat-value"><?= max(array_values($issueCounts)) ?? 0 ?></div>
    <div class="stat-label">ปัญหาสูงสุด</div>
  </div>
</div>

<div style="background: #f9f9f9; padding: 1rem; border-radius: 6px; margin: 1rem 0;">
  <h3>สรุปประเภทปัญหา</h3>
  <table style="width: 100%; border-collapse: collapse;">
    <tr>
      <th style="text-align: left; padding: 0.5rem; border-bottom: 1px solid #ddd;">ปัญหา</th>
      <th style="text-align: right; padding: 0.5rem; border-bottom: 1px solid #ddd;">จำนวน</th>
    </tr>
    <?php foreach ($issueCounts as $issue => $count): ?>
    <tr>
      <td style="padding: 0.5rem; border-bottom: 1px solid #eee;"><?= htmlspecialchars($issue) ?></td>
      <td style="text-align: right; padding: 0.5rem; border-bottom: 1px solid #eee; font-weight: bold; color: #d32f2f;"><?= $count ?></td>
    </tr>
    <?php endforeach; ?>
  </table>
</div>

<h3>รายชื่อผู้ป่วยที่มีปัญหา</h3>
<table class="report-table">
  <thead>
    <tr>
      <th>หน่วยบริการ</th>
      <th>PID</th>
      <th>ชื่อ-นามสกุล</th>
      <th>ปัญหา</th>
    </tr>
  </thead>
  <tbody>
    <?php foreach ($issues as $i): ?>
    <tr>
      <td><?= htmlspecialchars($i['hosname'] ?? '') ?></td>
      <td class="mono"><?= htmlspecialchars($i['pid']) ?></td>
      <td><?= htmlspecialchars($i['name']) ?></td>
      <td style="color: #d32f2f; font-size: 0.9em;"><?= htmlspecialchars($i['problems']) ?></td>
    </tr>
    <?php endforeach; ?>
  </tbody>
</table>

<?php endif; ?>

<style>
.audit-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin: 1.5rem 0; }
.stat-card { background: #f5f5f5; padding: 1rem; border-radius: 6px; text-align: center; }
.stat-value { font-size: 2em; font-weight: bold; line-height: 1; margin-bottom: 0.5rem; }
.stat-label { font-size: 0.9em; color: #666; }
.mono { font-family: monospace; }
.alert-success { background: #e8f5e9; border-left: 4px solid #388e3c; padding: 1rem; border-radius: 4px; color: #2e7d32; }
</style>

<?php require __DIR__ . '/includes/footer.php'; ?>
