<?php
require __DIR__ . '/config/base_path.php';
require __DIR__ . '/includes/session_start.php';
require __DIR__ . '/config/db.php';
require __DIR__ . '/config/settings.php';
require __DIR__ . '/includes/require_login.php';
require __DIR__ . '/includes/report_data.php';

$fy = isset($_GET['fy']) ? (int) $_GET['fy'] : current_fiscal_year_be($pdo);
$data = build_smiv_report($pdo, $fy, 'ampur');
$totals = $data['totals'];

$monthlyTrend = build_monthly_trend($pdo, $fy);
$accessRateTrend = build_access_rate_trend($pdo);
$sexDist = build_sex_distribution($pdo, $fy);

$pageTitle = 'แดชบอร์ด - SMI-V Plus';
require __DIR__ . '/includes/header.php';
?>
<h1>แดชบอร์ด SMI-V (ปีงบ <?= (int) $fy ?>)</h1>

<form method="get" style="margin-bottom: 1rem;">
  <label>ปีงบประมาณ (พ.ศ.)</label>
  <input type="number" name="fy" value="<?= (int) $fy ?>" style="width: 100px;">
  <button type="submit">เปลี่ยน</button>
</form>

<div class="dashboard-stats">
  <div class="stat-card">
    <div class="stat-value" style="color: #1976d2;"><?= number_format($totals['d']) ?></div>
    <div class="stat-label">ผู้ป่วยทั้งหมด (D)</div>
    <div class="stat-detail">เก่า <?= $totals['b'] ?> + ใหม่ <?= $totals['c'] ?></div>
  </div>

  <div class="stat-card">
    <div class="stat-value" style="color: <?= $totals['e'] >= 40 ? '#388e3c' : '#d32f2f'; ?>"><?= number_format($totals['e'], 2) ?>%</div>
    <div class="stat-label">อัตราเข้าถึงบริการ (E)</div>
    <div class="stat-detail">เป้า >40%</div>
  </div>

  <div class="stat-card">
    <div class="stat-value"><?= number_format($totals['n']) ?></div>
    <div class="stat-label">ติดตาม ≥2 ครั้ง + ไม่ก่อซ้ำ (N)</div>
    <div class="stat-detail">อัตรา <?= number_format($totals['o'], 2) ?>%</div>
  </div>

  <div class="stat-card">
    <div class="stat-value" style="color: #d32f2f;"><?= number_format($totals['repeat_violence_count']) ?></div>
    <div class="stat-label">ก่อความรุนแรงซ้ำ</div>
    <div class="stat-detail"><?= number_format(pct($totals['repeat_violence_count'], $totals['d']), 2) ?>% ของผู้ป่วย</div>
  </div>
</div>

<div class="charts-grid">
  <div class="chart-container">
    <h3>แนวโน้มจำนวนผู้ป่วยใหม่ (<?= (int) $fy ?>)</h3>
    <canvas id="monthlyTrendChart" height="80"></canvas>
  </div>

  <div class="chart-container">
    <h3>อัตราเข้าถึงบริการข้ามปีงบ</h3>
    <canvas id="accessRateTrendChart" height="80"></canvas>
  </div>

  <div class="chart-container">
    <h3>สัดส่วนเพศ</h3>
    <canvas id="sexDistChart" height="80"></canvas>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js" integrity="sha384-+0RJ9KiCOF+GISfeQVdSmaf6YcNV3Ng7rdmxVa51y8BNYj+fR2DjqS0zsFCI6KO9" crossorigin="anonymous"></script>
<script>
const chartColor = { blue: '#1976d2', green: '#388e3c', red: '#d32f2f', orange: '#f57c00', gray: '#999' };

// Monthly Trend
const monthlyData = <?= json_encode($monthlyTrend, JSON_UNESCAPED_UNICODE) ?>;
const monthLabels = Object.keys(monthlyData);
const monthValues = Object.values(monthlyData);
new Chart(document.getElementById('monthlyTrendChart'), {
  type: 'bar',
  data: {
    labels: monthLabels,
    datasets: [{
      label: 'ผู้ป่วยใหม่',
      data: monthValues,
      backgroundColor: chartColor.blue,
      borderColor: chartColor.blue,
      borderWidth: 1
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: true,
    plugins: { legend: { display: false } },
    scales: { y: { beginAtZero: true } }
  }
});

// Access Rate Trend
const accessYears = <?= json_encode($accessRateTrend['years']) ?>;
const accessRates = <?= json_encode($accessRateTrend['rates']) ?>;
new Chart(document.getElementById('accessRateTrendChart'), {
  type: 'line',
  data: {
    labels: accessYears,
    datasets: [{
      label: 'อัตราเข้าถึงบริการ (%)',
      data: accessRates,
      borderColor: chartColor.blue,
      backgroundColor: 'rgba(25, 118, 210, 0.1)',
      tension: 0.3,
      fill: true,
      pointRadius: 5,
      pointBackgroundColor: chartColor.blue
    }, {
      label: 'เป้าหมาย 40%',
      data: accessYears.map(() => 40),
      borderColor: chartColor.red,
      borderDash: [5, 5],
      fill: false,
      pointRadius: 0
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: true,
    scales: { y: { beginAtZero: true, max: 100 } }
  }
});

// Sex Distribution
const sexLabels = ['ชาย', 'หญิง', 'ไม่ระบุ'];
const sexData = [<?= $sexDist['ชาย'] ?>, <?= $sexDist['หญิง'] ?>, <?= $sexDist['ไม่ระบุ'] ?>];
new Chart(document.getElementById('sexDistChart'), {
  type: 'doughnut',
  data: {
    labels: sexLabels,
    datasets: [{
      data: sexData,
      backgroundColor: [chartColor.blue, chartColor.green, chartColor.gray]
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: true,
    plugins: { legend: { position: 'bottom' } }
  }
});
</script>

<style>
.dashboard-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin: 1.5rem 0; }
.stat-card { background: #f5f5f5; padding: 1.5rem; border-radius: 8px; border-left: 4px solid #1976d2; }
.stat-value { font-size: 2.5em; font-weight: bold; line-height: 1; margin-bottom: 0.5rem; }
.stat-label { font-size: 0.95em; color: #666; margin-bottom: 0.25rem; }
.stat-detail { font-size: 0.85em; color: #999; }
.charts-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 1.5rem; margin: 2rem 0; }
.chart-container { background: #f9f9f9; padding: 1.5rem; border-radius: 8px; border: 1px solid #e0e0e0; }
.chart-container h3 { margin-top: 0; color: #333; }
canvas { max-height: 250px; }
</style>

<?php require __DIR__ . '/includes/footer.php'; ?>
