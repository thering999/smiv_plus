<?php
require __DIR__ . '/config/base_path.php';
require __DIR__ . '/includes/session_start.php';
require __DIR__ . '/config/db.php';
require __DIR__ . '/config/settings.php';
require __DIR__ . '/includes/require_login.php';
require __DIR__ . '/includes/report_data.php';

$fy = isset($_GET['fy']) ? (int) $_GET['fy'] : current_fiscal_year_be($pdo);
$level = $_GET['level'] ?? 'ampur';
$area = trim($_GET['area'] ?? '');
$dateFrom = trim($_GET['date_from'] ?? '') ?: null;
$dateTo = trim($_GET['date_to'] ?? '') ?: null;

$patients = get_problem_patients($pdo, $fy, $level, $area, $dateFrom, $dateTo);
$areaLabel = REPORT_LEVELS[$level];

$pageTitle = 'รายชื่อผู้ป่วยต้องติดตาม - SMI-V Plus';
require __DIR__ . '/includes/header.php';
?>
<h1>รายชื่อผู้ป่วยต้องติดตาม (ปีงบ <?= (int) $fy ?>)</h1>
<p class="note">ผู้ป่วยที่มีปัญหา: ก่อความรุนแรงซ้ำ, ขาดการติดตาม, ไม่เคยติดตามซ้ำ, หรือข้อมูลไม่ครบถ้วน</p>

<form method="get" class="filter-bar">
  <label>ปีงบประมาณ (พ.ศ.)</label>
  <input type="number" name="fy" value="<?= (int) $fy ?>">
  <label>มุมมอง</label>
  <select name="level" onchange="this.form.area.value=''; this.form.submit()">
    <?php foreach (REPORT_LEVELS as $lv => $lbl): ?>
      <option value="<?= $lv ?>" <?= $lv === $level ? 'selected' : '' ?>><?= htmlspecialchars($lbl) ?></option>
    <?php endforeach; ?>
  </select>
  <?php if ($level !== 'chw_addr'): ?>
  <label>ช่วงวันที่มารับบริการ</label>
  <input type="date" name="date_from" value="<?= htmlspecialchars($dateFrom ?? '') ?>">
  <input type="date" name="date_to" value="<?= htmlspecialchars($dateTo ?? '') ?>">
  <?php endif; ?>
  <button type="submit">ค้นหา</button>
  <?php if ($dateFrom || $dateTo): ?>
  <a href="<?= url('/action_list.php') ?>" class="btn-secondary">ล้างตัวกรอง</a>
  <?php endif; ?>
</form>

<?php if (!$patients): ?>
  <p class="alert">ไม่พบผู้ป่วยที่มีปัญหาในข้อมูลนี้</p>
<?php else: ?>
<div class="stats-row">
  <div class="stat-box">
    <div class="stat-number" style="color: #d32f2f;"><?= count($patients) ?></div>
    <div class="stat-label">ผู้ป่วยต้องติดตาม</div>
  </div>
  <div class="stat-box">
    <div class="stat-number" style="color: #d32f2f;"><?= count(array_filter($patients, fn($p) => $p['priority'] === 'สูง')) ?></div>
    <div class="stat-label">สิทธิ์สูง (repeat violence)</div>
  </div>
  <div class="stat-box">
    <div class="stat-number"><?= count(array_filter($patients, fn($p) => $p['priority'] === 'กลาง')) ?></div>
    <div class="stat-label">สิทธิ์กลาง (2+ ปัญหา)</div>
  </div>
</div>

<table class="report-table">
  <thead>
    <tr>
      <th>หน่วยบริการ</th>
      <th>PID</th>
      <th>ชื่อ-นามสกุล</th>
      <th>ปัญหา</th>
      <th>สิทธิ์</th>
      <th>การแนะนำ</th>
    </tr>
  </thead>
  <tbody>
    <?php foreach ($patients as $p): ?>
    <tr class="priority-<?= htmlspecialchars($p['priority']) ?>">
      <td><?= htmlspecialchars($p['hosname'] ?? '') ?></td>
      <td class="mono"><?= htmlspecialchars($p['pid'] ?? '') ?></td>
      <td><?= htmlspecialchars(($p['name'] ?? '') . ' ' . ($p['lname'] ?? '')) ?></td>
      <td style="font-size: 0.85em;">
        <?php
        $issues = explode('; ', $p['issues']);
        foreach ($issues as $issue): ?>
          <span class="badge">
            <?= htmlspecialchars($issue) ?>
          </span>
        <?php endforeach; ?>
      </td>
      <td><?= htmlspecialchars($p['priority']) ?></td>
      <td style="font-size: 0.85em;"><?= htmlspecialchars($p['recommendations'] ?? '') ?></td>
    </tr>
    <?php endforeach; ?>
  </tbody>
</table>
<?php endif; ?>

<style>
.stats-row { display: flex; gap: 1rem; margin: 1rem 0; }
.stat-box { background: #f5f5f5; padding: 1rem; border-radius: 4px; flex: 1; text-align: center; }
.stat-number { font-size: 2em; font-weight: bold; margin-bottom: 0.25rem; }
.stat-label { font-size: 0.9em; color: #666; }
.mono { font-family: monospace; }
.badge { display: inline-block; padding: 0.25rem 0.5rem; background: #e3f2fd; color: #1976d2; border-radius: 3px; margin-right: 0.25rem; margin-bottom: 0.25rem; font-size: 0.85em; }
tr.priority-สูง { background-color: #ffebee; }
tr.priority-กลาง { background-color: #fff3e0; }
tr.priority-ปกติ { background-color: #f9f9f9; }
.btn-secondary { display: inline-block; padding: 0.5rem 1rem; background: #999; color: white; text-decoration: none; border-radius: 4px; }
.btn-secondary:hover { background: #666; }
</style>

<?php require __DIR__ . '/includes/footer.php'; ?>
