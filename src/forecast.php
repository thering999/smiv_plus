<?php
require __DIR__ . '/config/base_path.php';
require __DIR__ . '/includes/session_start.php';
require __DIR__ . '/config/db.php';
require __DIR__ . '/config/settings.php';
require __DIR__ . '/includes/require_login.php';
require __DIR__ . '/includes/report_data.php';

$fy = isset($_GET['fy']) ? (int) $_GET['fy'] : current_fiscal_year_be($pdo);

// Linear regression helper
function linearRegression($data) {
    $n = count($data);
    if ($n < 2) return null;

    $sumX = $sumY = $sumXY = $sumX2 = 0;
    foreach ($data as $x => $y) {
        $sumX += $x;
        $sumY += $y;
        $sumXY += $x * $y;
        $sumX2 += $x * $x;
    }

    $slope = ($n * $sumXY - $sumX * $sumY) / ($n * $sumX2 - $sumX * $sumX);
    $intercept = ($sumY - $slope * $sumX) / $n;

    return ['slope' => $slope, 'intercept' => $intercept];
}

// Fetch historical data
$stmt = $pdo->prepare(
    "SELECT fiscal_year_be,
            SUM(CASE WHEN d > 0 THEN d ELSE 0 END) total_patients,
            SUM(population_15_60) total_pop
     FROM (
        SELECT p.fiscal_year_be, COUNT(*) d FROM patients p GROUP BY p.fiscal_year_be
     ) patients
     FULL OUTER JOIN (
        SELECT fiscal_year_be, SUM(population_15_60) population_15_60 FROM population_estimates GROUP BY fiscal_year_be
     ) pop ON patients.fiscal_year_be = pop.fiscal_year_be
     WHERE fiscal_year_be > 0
     GROUP BY fiscal_year_be
     ORDER BY fiscal_year_be"
);
$stmt->execute();
$historical = $stmt->fetchAll();

// Prepare data for regression
$data = [];
$years = [];
$accessRates = [];
foreach ($historical as $h) {
    if ((int) $h['total_pop'] === 0) continue;
    $estimated = estimate_smiv_patients($pdo, (int) $h['total_pop']);
    if ($estimated === 0) continue;
    $rate = pct((int) $h['total_patients'], $estimated);
    $data[(int) $h['fiscal_year_be']] = $rate;
    $years[] = (int) $h['fiscal_year_be'];
    $accessRates[] = $rate;
}

ksort($data);

// Calculate forecast
$forecast = null;
$nextYear = null;
$forecastRate = null;
if (count($data) >= 2) {
    $regression = linearRegression($data);
    if ($regression) {
        $nextYear = max(array_keys($data)) + 1;
        $forecastRate = $regression['intercept'] + $regression['slope'] * $nextYear;
        $forecast = [
            'year' => $nextYear,
            'rate' => max(0, $forecastRate),
            'slope' => $regression['slope'],
            'trend' => $regression['slope'] > 0 ? 'เพิ่มขึ้น' : 'ลดลง',
        ];
    }
}

$pageTitle = 'ประมาณการแนวโน้ม - SMI-V Plus';
require __DIR__ . '/includes/header.php';
?>
<h1>ประมาณการแนวโน้ม SMI-V</h1>
<p class="note">ใช้การวิเคราะห์ linear regression ของข้อมูลย้อนหลัง เพื่อประมาณการอัตราเข้าถึงบริการในปีต่อไป</p>

<?php if (!$forecast): ?>
<div class="alert">ข้อมูลไม่เพียงพอสำหรับประมาณการ (ต้อง ≥2 ปี)</div>
<?php else: ?>

<div class="forecast-summary">
  <div class="forecast-card">
    <div class="label">ปีงบที่ประมาณการ</div>
    <div class="value"><?= (int) $forecast['year'] ?></div>
  </div>
  <div class="forecast-card">
    <div class="label">อัตราเข้าถึงบริการ (คาดการณ์)</div>
    <div class="value" style="color: <?= $forecast['rate'] >= 40 ? '#388e3c' : '#d32f2f' ?>;">
      <?= number_format($forecast['rate'], 2) ?>%
    </div>
  </div>
  <div class="forecast-card">
    <div class="label">เป้าหมาย</div>
    <div class="value" style="color: #1976d2;">40%</div>
  </div>
  <div class="forecast-card">
    <div class="label">แนวโน้ม</div>
    <div class="value" style="color: <?= $forecast['slope'] > 0 ? '#388e3c' : '#d32f2f' ?>;">
      <?= htmlspecialchars($forecast['trend']) ?> (<?= number_format($forecast['slope'], 2) ?>% ต่อปี)
    </div>
  </div>
</div>

<div style="background: #f9f9f9; padding: 1rem; border-radius: 6px; margin: 1.5rem 0;">
  <h3>สถานการณ์</h3>
  <?php if ($forecast['rate'] >= 40): ?>
    <p style="color: #388e3c; font-weight: bold;">✓ ดีเลิศ: ตามอัตราประมาณการณ์ สามารถบรรลุเป้าหมายในปี <?= (int) $forecast['year'] ?></p>
  <?php elseif ($forecast['slope'] > 0): ?>
    <p style="color: #f57c00; font-weight: bold;">⚠ ปานกลาง: กำลังมีแนวโน้มเพิ่มขึ้นแต่ยังไม่ถึงเป้าหมาย — ต้องเร่งความพยายาม</p>
  <?php else: ?>
    <p style="color: #d32f2f; font-weight: bold;">✕ เสี่ยง: มีแนวโน้มลดลง — ต้องจัดการฉุกเฉินเพื่อกลับทิศทาง</p>
  <?php endif; ?>
</div>

<h3>ข้อมูลย้อนหลัง</h3>
<table class="report-table">
  <thead>
    <tr>
      <th>ปีงบ</th>
      <th style="text-align: right;">อัตราเข้าถึงบริการ (%)</th>
      <th style="text-align: right;">เทียบเกณฑ์ 40%</th>
    </tr>
  </thead>
  <tbody>
    <?php foreach ($data as $year => $rate): ?>
    <tr>
      <td><?= (int) $year ?></td>
      <td style="text-align: right; font-weight: bold;"><?= number_format($rate, 2) ?>%</td>
      <td style="text-align: center;">
        <?php if ($rate >= 40): ?>
          <span style="background: #c8e6c9; color: #2e7d32; padding: 0.25rem 0.5rem; border-radius: 3px;">✓ ผ่าน</span>
        <?php else: ?>
          <span style="background: #ffcdd2; color: #c62828; padding: 0.25rem 0.5rem; border-radius: 3px;"><?= (40 - $rate > 0 ? '+' : '') ?><?= number_format(40 - $rate, 2) ?>%</span>
        <?php endif; ?>
      </td>
    </tr>
    <?php endforeach; ?>
  </tbody>
</table>

<h3>วิธีการอ่าน</h3>
<ul style="line-height: 1.8;">
  <li><strong>อัตราเข้าถึงบริการ:</strong> จำนวนผู้ป่วย SMI-V ที่ลงทะเบียน ÷ ผู้ป่วยประมาณการณ์ × 100</li>
  <li><strong>เป้าหมาย:</strong> HDC กำหนด 40% ต่อปีงบ</li>
  <li><strong>แนวโน้ม:</strong> อัตราการเปลี่ยนแปลงต่อปี (บวก=เพิ่มขึ้น, ลบ=ลดลง)</li>
  <li><strong>ประมาณการ:</strong> ใช้ linear regression จากข้อมูลย้อนหลัง — ความแม่นยำขึ้นอยู่กับความสม่ำเสมอของข้อมูล</li>
</ul>

<?php endif; ?>

<style>
.forecast-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin: 1.5rem 0; }
.forecast-card { background: #f5f5f5; padding: 1.5rem; border-radius: 8px; text-align: center; border-left: 4px solid #1976d2; }
.forecast-card .label { font-size: 0.9em; color: #666; margin-bottom: 0.5rem; }
.forecast-card .value { font-size: 2em; font-weight: bold; line-height: 1; }
</style>

<?php require __DIR__ . '/includes/footer.php'; ?>
