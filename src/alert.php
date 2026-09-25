<?php
require __DIR__ . '/config/base_path.php';
require __DIR__ . '/includes/session_start.php';
require __DIR__ . '/config/db.php';
require __DIR__ . '/config/settings.php';
require __DIR__ . '/includes/require_login.php';
require __DIR__ . '/includes/report_data.php';

// Create alerts table if not exists
try {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS alerts (
            id SERIAL PRIMARY KEY,
            ampur TEXT NOT NULL,
            alert_type TEXT NOT NULL,
            message TEXT,
            severity TEXT,
            fiscal_year_be INT,
            metric_value FLOAT,
            threshold FLOAT,
            created_at TIMESTAMP DEFAULT NOW(),
            dismissed_at TIMESTAMP,
            dismissed_by INT
        );
        CREATE INDEX IF NOT EXISTS idx_alerts_fy_ampur ON alerts(fiscal_year_be, ampur);
        CREATE INDEX IF NOT EXISTS idx_alerts_dismissed ON alerts(dismissed_at);
    ");
} catch (PDOException $e) {
    error_log('Alert table creation: ' . $e->getMessage());
}

$fy = isset($_GET['fy']) ? (int) $_GET['fy'] : current_fiscal_year_be($pdo);
$data = build_smiv_report($pdo, $fy, 'ampur');
$report = $data['report'];

// Detect alerts based on thresholds
$newAlerts = [];
foreach ($report as $r) {
    if ($r['h'] === 0) {
        $newAlerts[] = [
            'ampur' => $r['group_key'],
            'alert_type' => 'no_population',
            'message' => "ไม่มีข้อมูลประชากร (H)",
            'severity' => 'warn',
            'metric_value' => 0,
            'threshold' => 1,
        ];
    } elseif ($r['e'] < TARGET_ACCESS_RATE) {
        $newAlerts[] = [
            'ampur' => $r['group_key'],
            'alert_type' => 'low_access',
            'message' => "อัตราเข้าถึงบริการต่ำ: {$r['e']}% < " . TARGET_ACCESS_RATE . "%",
            'severity' => 'danger',
            'metric_value' => $r['e'],
            'threshold' => TARGET_ACCESS_RATE,
        ];
    }

    $repeatRate = pct($r['repeat_violence_count'], $r['d']);
    if ($r['d'] > 0 && $repeatRate > THRESHOLD_REPEAT_VIOLENCE) {
        $newAlerts[] = [
            'ampur' => $r['group_key'],
            'alert_type' => 'high_repeat',
            'message' => "ก่อความรุนแรงซ้ำสูง: {$repeatRate}%",
            'severity' => 'danger',
            'metric_value' => $repeatRate,
            'threshold' => THRESHOLD_REPEAT_VIOLENCE,
        ];
    }

    $zeroFollowRate = pct($r['zero_followup'], $r['d']);
    if ($r['d'] > 0 && $zeroFollowRate > THRESHOLD_ZERO_FOLLOWUP) {
        $newAlerts[] = [
            'ampur' => $r['group_key'],
            'alert_type' => 'low_followup',
            'message' => "ไม่เคยติดตามซ้ำสูง: {$zeroFollowRate}%",
            'severity' => 'warn',
            'metric_value' => $zeroFollowRate,
            'threshold' => THRESHOLD_ZERO_FOLLOWUP,
        ];
    }
}

// Insert new alerts (avoid duplicates) + send email
foreach ($newAlerts as $alert) {
    $exists = $pdo->prepare(
        "SELECT 1 FROM alerts
         WHERE ampur = ? AND alert_type = ? AND fiscal_year_be = ? AND dismissed_at IS NULL
         LIMIT 1"
    );
    $exists->execute([$alert['ampur'], $alert['alert_type'], $fy]);
    if (!$exists->fetch()) {
        $ins = $pdo->prepare(
            "INSERT INTO alerts (ampur, alert_type, message, severity, fiscal_year_be, metric_value, threshold)
             VALUES (?, ?, ?, ?, ?, ?, ?)"
        );
        $ins->execute([
            $alert['ampur'], $alert['alert_type'], $alert['message'], $alert['severity'],
            $fy, $alert['metric_value'], $alert['threshold']
        ]);
        send_alert_email($alert);
        send_alert_line($alert);
    }
}

// Handle dismiss action
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';
    if ($action === 'dismiss') {
        $alertId = (int) ($_POST['alert_id'] ?? 0);
        // ผู้ใช้ระดับอำเภอ dismiss ได้เฉพาะ alert ของอำเภอตัวเอง (กัน IDOR ผ่าน alert_id)
        $dismissAmpur = get_scope_ampur();
        $pdo->prepare('UPDATE alerts SET dismissed_at = NOW(), dismissed_by = ? WHERE id = ?' . ($dismissAmpur !== null ? ' AND ampur = ?' : ''))
            ->execute($dismissAmpur !== null ? [$_SESSION['user_id'], $alertId, $dismissAmpur] : [$_SESSION['user_id'], $alertId]);
        header('Location: ' . url('/alert.php') . '?fy=' . $fy);
        exit;
    }
}

// Fetch active alerts (จำกัดเฉพาะอำเภอของผู้ใช้ถ้าถูกจำกัดสิทธิ์ — ป้องกัน alert เก่าก่อนเปิดใช้ ampur scope หลุดมาแสดง)
$scopeAmpur = get_scope_ampur();
$alertParams = [$fy];
$alertScopeSql = '';
if ($scopeAmpur !== null) {
    $alertScopeSql = ' AND ampur = ?';
    $alertParams[] = $scopeAmpur;
}
$alertStmt = $pdo->prepare(
    "SELECT id, ampur, alert_type, message, severity, metric_value, threshold, created_at
     FROM alerts
     WHERE fiscal_year_be = ? AND dismissed_at IS NULL $alertScopeSql
     ORDER BY CASE severity WHEN 'danger' THEN 1 WHEN 'warn' THEN 2 ELSE 3 END, created_at DESC"
);
$alertStmt->execute($alertParams);
$alerts = $alertStmt->fetchAll();

$pageTitle = 'การแจ้งเตือน - SMI-V Plus';
require __DIR__ . '/includes/header.php';
?>
<h1>การแจ้งเตือน (ปีงบ <?= (int) $fy ?>)</h1>
<p class="note">แจ้งเตือนอัตโนมัติเมื่อพื้นที่ breach เกณฑ์ HDC</p>

<form method="get" style="margin-bottom: 1rem;">
  <label>ปีงบประมาณ (พ.ศ.)</label>
  <input type="number" name="fy" value="<?= (int) $fy ?>" style="width: 100px;">
  <button type="submit">เปลี่ยน</button>
</form>

<?php if (!$alerts): ?>
<div class="alert alert-success">ไม่มีการแจ้งเตือนในปีงบนี้ — ทุกพื้นที่ผ่านเกณฑ์</div>
<?php else: ?>

<div class="alerts-list">
  <?php foreach ($alerts as $a): ?>
  <div class="alert-item alert-<?= htmlspecialchars($a['severity']) ?>">
    <div class="alert-header">
      <span class="alert-type"><?= htmlspecialchars($a['alert_type']) ?></span>
      <span class="alert-ampur"><?= htmlspecialchars($a['ampur']) ?></span>
      <span class="alert-time"><?= date('d/m/Y H:i', strtotime($a['created_at'])) ?></span>
    </div>
    <div class="alert-message"><?= htmlspecialchars($a['message']) ?></div>
    <div class="alert-metric">
      ค่าปัจจุบัน: <strong><?= number_format($a['metric_value'], 2) ?></strong>
      | เกณฑ์: <strong><?= number_format($a['threshold'], 2) ?></strong>
    </div>
    <form method="post" class="alert-action">
      <input type="hidden" name="action" value="dismiss">
      <input type="hidden" name="alert_id" value="<?= (int) $a['id'] ?>">
      <button type="submit" class="btn-dismiss">ยืนยันแล้ว</button>
    </form>
  </div>
  <?php endforeach; ?>
</div>

<?php endif; ?>

<style>
.alerts-list { display: flex; flex-direction: column; gap: 1rem; margin-top: 1.5rem; }
.alert-item { padding: 1rem; border-radius: 6px; border-left: 4px solid; }
.alert-item.alert-danger { background: #ffebee; border-color: #d32f2f; }
.alert-item.alert-warn { background: #fff3e0; border-color: #f57c00; }
.alert-item.alert-info { background: #e3f2fd; border-color: #1976d2; }
.alert-header { display: flex; gap: 1rem; margin-bottom: 0.5rem; align-items: center; font-size: 0.9em; }
.alert-type { background: rgba(0,0,0,0.1); padding: 0.25rem 0.5rem; border-radius: 3px; font-weight: bold; }
.alert-ampur { color: #333; font-weight: bold; }
.alert-time { color: #999; font-size: 0.85em; }
.alert-message { font-size: 1.05em; margin-bottom: 0.5rem; color: #333; }
.alert-metric { font-size: 0.9em; color: #666; margin-bottom: 1rem; }
.alert-action { display: flex; gap: 0.5rem; }
.btn-dismiss { padding: 0.4rem 0.8rem; background: #d32f2f; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.9em; }
.btn-dismiss:hover { background: #b71c1c; }
.alert-success { background: #e8f5e9; border-left: 4px solid #388e3c; padding: 1rem; border-radius: 4px; color: #2e7d32; }
</style>

<?php require __DIR__ . '/includes/footer.php'; ?>
