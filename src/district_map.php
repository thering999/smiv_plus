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

$metricLabels = [
    'access_rate' => 'อัตราเข้าถึงบริการ (E%)',
    'repeat_rate' => 'อัตราก่อความรุนแรงซ้ำ (%)',
    'followup_rate' => 'อัตราติดตาม ≥2 ครั้ง + ไม่ก่อซ้ำ (%)',
];

// ข้อมูลอำเภอ (ตำแหน่ง x,y สำหรับแสดงใน SVG แบบง่าย)
$ampurCoords = [
    '01' => ['name' => 'เมืองมุกดาหาร', 'x' => 50, 'y' => 50],
    '02' => ['name' => 'นิคมคำสร้อย', 'x' => 30, 'y' => 70],
    '03' => ['name' => 'ดอนตาล', 'x' => 70, 'y' => 60],
    '04' => ['name' => 'ดงหลวง', 'x' => 60, 'y' => 80],
    '05' => ['name' => 'คำชะอี', 'x' => 40, 'y' => 30],
    '06' => ['name' => 'หว้านใหญ่', 'x' => 80, 'y' => 40],
    '07' => ['name' => 'หนองสูง', 'x' => 75, 'y' => 25],
];

// Map data
$mapData = [];
foreach ($report as $r) {
    $val = 0;
    if ($metric === 'access_rate') $val = $r['e'];
    elseif ($metric === 'repeat_rate') $val = pct($r['repeat_violence_count'], $r['d']);
    elseif ($metric === 'followup_rate') $val = $r['o'];

    $mapData[$r['group_key']] = [
        'val' => $val,
        'label' => $r['ampur_name'],
        'd' => $r['d'],
    ];
}

// Color function (red=bad, yellow=medium, green=good)
function getHeatmapColor($val, $metric) {
    if ($metric === 'repeat_rate') {
        if ($val <= 5) return '#c8e6c9';
        if ($val <= 15) return '#fff9c4';
        return '#ffcdd2';
    }
    if ($val >= 40) return '#c8e6c9';
    if ($val >= 30) return '#fff9c4';
    return '#ffcdd2';
}

$pageTitle = 'แผนที่ความร้อน - SMI-V Plus';
require __DIR__ . '/includes/header.php';
?>
<h1>แผนที่ความร้อนอำเภอ (ปีงบ <?= (int) $fy ?>)</h1>

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

<div style="display: grid; grid-template-columns: 1fr 250px; gap: 2rem; margin: 1.5rem 0;">

  <!-- Map Grid -->
  <div style="background: #f9f9f9; padding: 1rem; border-radius: 8px;">
    <h3>แผนที่จังหวัดมุกดาหาร</h3>
    <svg viewBox="0 0 100 100" style="width: 100%; max-width: 400px; border: 1px solid #ddd; border-radius: 4px; background: white;">
      <!-- Grid background -->
      <defs>
        <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#eee" stroke-width="0.1"/>
        </pattern>
      </defs>
      <rect width="100" height="100" fill="url(#grid)" />

      <!-- Districts as circles -->
      <?php foreach ($ampurCoords as $code => $coord):
        $data = $mapData[$code] ?? null;
        $color = $data ? getHeatmapColor($data['val'], $metric) : '#f0f0f0';
        $val = $data ? number_format($data['val'], 1) : '—';
      ?>
      <circle cx="<?= $coord['x'] ?>" cy="<?= $coord['y'] ?>" r="8" fill="<?= $color ?>" stroke="#333" stroke-width="0.5" style="cursor: pointer;"
              onclick="alert('<?= htmlspecialchars($coord['name']) ?>\n<?= htmlspecialchars($metricLabels[$metric]) ?>: <?= $val ?>%\nผู้ป่วย: <?= $data['d'] ?? 0 ?>')">
      </circle>
      <text x="<?= $coord['x'] ?>" y="<?= $coord['y'] + 2 ?>" text-anchor="middle" font-size="3" font-weight="bold" style="pointer-events: none;">
        <?= $code ?>
      </text>
      <?php endforeach; ?>
    </svg>

    <!-- Legend -->
    <div style="margin-top: 1rem;">
      <h4>คำอธิบาย</h4>
      <?php if ($metric === 'repeat_rate'): ?>
      <div style="display: flex; gap: 0.5rem; margin: 0.5rem 0;">
        <div style="width: 30px; height: 20px; background: #c8e6c9; border: 1px solid #ddd;"></div>
        <span>ต่ำ (≤5%)</span>
      </div>
      <div style="display: flex; gap: 0.5rem; margin: 0.5rem 0;">
        <div style="width: 30px; height: 20px; background: #fff9c4; border: 1px solid #ddd;"></div>
        <span>กลาง (5-15%)</span>
      </div>
      <div style="display: flex; gap: 0.5rem; margin: 0.5rem 0;">
        <div style="width: 30px; height: 20px; background: #ffcdd2; border: 1px solid #ddd;"></div>
        <span>สูง (>15%)</span>
      </div>
      <?php else: ?>
      <div style="display: flex; gap: 0.5rem; margin: 0.5rem 0;">
        <div style="width: 30px; height: 20px; background: #c8e6c9; border: 1px solid #ddd;"></div>
        <span>ผ่านเกณฑ์ (≥40%)</span>
      </div>
      <div style="display: flex; gap: 0.5rem; margin: 0.5rem 0;">
        <div style="width: 30px; height: 20px; background: #fff9c4; border: 1px solid #ddd;"></div>
        <span>ปานกลาง (30-40%)</span>
      </div>
      <div style="display: flex; gap: 0.5rem; margin: 0.5rem 0;">
        <div style="width: 30px; height: 20px; background: #ffcdd2; border: 1px solid #ddd;"></div>
        <span>ต่ำ (<30%)</span>
      </div>
      <?php endif; ?>
    </div>
  </div>

  <!-- Table -->
  <div>
    <h3>รายละเอียด</h3>
    <table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">
      <thead>
        <tr style="background: #f0f0f0;">
          <th style="padding: 0.5rem; border: 1px solid #ddd; text-align: left;">อำเภอ</th>
          <th style="padding: 0.5rem; border: 1px solid #ddd; text-align: right;"><?= htmlspecialchars(str_replace('(%)', '', $metricLabels[$metric])) ?></th>
        </tr>
      </thead>
      <tbody>
        <?php foreach ($ampurCoords as $code => $coord):
          $data = $mapData[$code] ?? null;
          if (!$data) continue;
          $color = getHeatmapColor($data['val'], $metric);
        ?>
        <tr style="background: <?= $color ?>;">
          <td style="padding: 0.5rem; border: 1px solid #ddd;"><?= htmlspecialchars($coord['name']) ?></td>
          <td style="padding: 0.5rem; border: 1px solid #ddd; text-align: right; font-weight: bold;"><?= number_format($data['val'], 2) ?>%</td>
        </tr>
        <?php endforeach; ?>
      </tbody>
    </table>
  </div>
</div>

<?php require __DIR__ . '/includes/footer.php'; ?>
