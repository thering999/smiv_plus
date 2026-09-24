<?php
require __DIR__ . '/config/base_path.php';
require __DIR__ . '/includes/session_start.php';
require __DIR__ . '/config/db.php';
require __DIR__ . '/config/settings.php';
require __DIR__ . '/includes/require_login.php';
require __DIR__ . '/includes/report_data.php';

$fy = isset($_GET['fy']) ? (int) $_GET['fy'] : current_fiscal_year_be($pdo);
$metric = $_GET['metric'] ?? 'access_rate';

$data = build_smiv_report($pdo, $fy, 'ampur');
$report = $data['report'];

// Prepare benchmark data
$benchmarks = [];
foreach ($report as $r) {
    $benchmarks[] = [
        'ampur' => $r['ampur_name'],
        'group_key' => $r['group_key'],
        'd' => $r['d'],
        'access_rate' => $r['e'],
        'access_rate_target' => TARGET_ACCESS_RATE,
        'repeat_rate' => pct($r['repeat_violence_count'], $r['d']),
        'followup_rate' => $r['o'],
        'followup_target' => 100,
        'zero_followup_pct' => pct($r['zero_followup'], $r['d']),
    ];
}

// Sort by selected metric
usort($benchmarks, function($a, $b) use ($metric) {
    $aVal = $a[$metric] ?? 0;
    $bVal = $b[$metric] ?? 0;
    return $bVal <=> $aVal; // descending
});

$metricLabels = [
    'access_rate' => 'อัตราเข้าถึงบริการ (E%)',
    'repeat_rate' => 'อัตราก่อความรุนแรงซ้ำ (%)',
    'followup_rate' => 'อัตราติดตาม ≥2 ครั้ง + ไม่ก่อซ้ำ (%)',
    'zero_followup_pct' => 'สัดส่วนไม่เคยติดตามซ้ำ (%)',
];

$pageTitle = 'เปรียบเทียบผลงาน - SMI-V Plus';
require __DIR__ . '/includes/header.php';
?>
<h1>เปรียบเทียบผลงานอำเภอ (ปีงบ <?= (int) $fy ?>)</h1>
<p class="note">จัดอันดับอำเภอตามตัวชี้วัดที่เลือก</p>

<form method="get" style="margin-bottom: 1rem;">
  <label>ปีงบประมาณ (พ.ศ.)</label>
  <input type="number" name="fy" value="<?= (int) $fy ?>" style="width: 100px;">
  <label>ตัวชี้วัด</label>
  <select name="metric" onchange="this.form.submit()">
    <?php foreach ($metricLabels as $k => $lbl): ?>
      <option value="<?= $k ?>" <?= $metric === $k ? 'selected' : '' ?>><?= htmlspecialchars($lbl) ?></option>
    <?php endforeach; ?>
  </select>
</form>

<table class="benchmark-table">
  <thead>
    <tr>
      <th style="width: 30px;">อันดับ</th>
      <th>อำเภอ</th>
      <th style="text-align: right;">ผู้ป่วย (D)</th>
      <th style="text-align: right;"><?= htmlspecialchars($metricLabels[$metric]) ?></th>
      <th style="text-align: right;">เป้าหมาย</th>
      <th style="width: 150px;">สถานะ</th>
    </tr>
  </thead>
  <tbody>
    <?php foreach ($benchmarks as $idx => $b):
      $val = $b[$metric] ?? 0;
      $target = $b[$metric . '_target'] ?? 0;

      if ($metric === 'repeat_rate' || $metric === 'zero_followup_pct') {
        $pass = $val <= $target;
        $statusLabel = $pass ? 'ผ่าน' : 'ต่ำกว่า';
      } else {
        $pass = $val >= $target;
        $statusLabel = $pass ? 'ผ่าน' : 'ต้องปรับปรุง';
      }
      $statusColor = $pass ? '#388e3c' : '#d32f2f';
    ?>
    <tr>
      <td style="text-align: center; font-weight: bold;"><?= $idx + 1 ?></td>
      <td><?= htmlspecialchars($b['ampur']) ?></td>
      <td style="text-align: right;"><?= number_format($b['d']) ?></td>
      <td style="text-align: right; font-weight: bold; color: <?= $statusColor ?>"><?= number_format($val, 2) ?>%</td>
      <td style="text-align: right;"><?= number_format($target, 2) ?>%</td>
      <td style="text-align: center;">
        <span class="badge" style="background: <?= $statusColor ?>; color: white;">
          <?= htmlspecialchars($statusLabel) ?>
        </span>
      </td>
    </tr>
    <?php endforeach; ?>
  </tbody>
</table>

<div style="margin-top: 2rem; padding: 1rem; background: #f9f9f9; border-radius: 6px; font-size: 0.9em;">
  <h3>ความหมาย</h3>
  <ul style="margin: 0.5rem 0 0 1.5rem;">
    <li><strong>อัตราเข้าถึงบริการ (E%):</strong> ผู้ป่วยที่ลงทะเบียน ÷ ผู้ป่วยประมาณการณ์ × 100 | เป้า > 40%</li>
    <li><strong>อัตราก่อความรุนแรงซ้ำ:</strong> % ผู้ป่วยที่ลงรหัส SMI-V มากกว่า 1 ครั้ง | ต่ำยิ่งดี</li>
    <li><strong>อัตราติดตาม ≥2 ครั้ง + ไม่ก่อซ้ำ (O%):</strong> N ÷ I × 100 | เป้า > 40%</li>
    <li><strong>สัดส่วนไม่เคยติดตามซ้ำ:</strong> % ผู้ป่วยที่มารับบริการครั้งแรกไม่มีการติดตามต่อ | ต่ำยิ่งดี</li>
  </ul>
</div>

<style>
.benchmark-table { width: 100%; border-collapse: collapse; margin: 1.5rem 0; }
.benchmark-table th, .benchmark-table td { padding: 0.75rem; border-bottom: 1px solid #ddd; text-align: left; }
.benchmark-table th { background: #f5f5f5; font-weight: bold; color: #333; }
.benchmark-table tr:hover { background: #f9f9f9; }
.benchmark-table tbody tr:first-child { background: #fffacd; }
.badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 4px; font-weight: bold; }
</style>

<?php require __DIR__ . '/includes/footer.php'; ?>
