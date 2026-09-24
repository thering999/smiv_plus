<?php
require __DIR__ . '/config/base_path.php';
require __DIR__ . '/includes/session_start.php';
require __DIR__ . '/config/db.php';
require __DIR__ . '/config/settings.php';
require __DIR__ . '/includes/require_login.php';
require_admin();
require __DIR__ . '/includes/csrf.php';
require __DIR__ . '/includes/report_data.php';

// Create report_schedules table if not exists
try {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS report_schedules (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            report_type VARCHAR(50),
            frequency VARCHAR(20),
            email_to TEXT,
            enabled BOOLEAN DEFAULT true,
            last_sent TIMESTAMP,
            next_send TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW()
        );
    ");
} catch (PDOException $e) {
    error_log('Report schedules table: ' . $e->getMessage());
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    verify_csrf();
    $action = $_POST['action'] ?? '';

    if ($action === 'add') {
        $name = trim($_POST['name'] ?? '');
        $reportType = trim($_POST['report_type'] ?? '');
        $frequency = trim($_POST['frequency'] ?? '');
        $emailTo = trim($_POST['email_to'] ?? '');

        if ($name && $reportType && $frequency && $emailTo) {
            $nextSend = null;
            if ($frequency === 'monthly') $nextSend = date('Y-m-01', strtotime('first day of next month'));
            elseif ($frequency === 'quarterly') $nextSend = date('Y-m-01', strtotime('first day of next quarter'));
            elseif ($frequency === 'yearly') $nextSend = date('Y-01-01', strtotime('next year'));

            $stmt = $pdo->prepare(
                "INSERT INTO report_schedules (name, report_type, frequency, email_to, next_send)
                 VALUES (?, ?, ?, ?, ?)"
            );
            $stmt->execute([$name, $reportType, $frequency, $emailTo, $nextSend]);
        }
    } elseif ($action === 'toggle') {
        $id = (int) ($_POST['id'] ?? 0);
        $pdo->prepare('UPDATE report_schedules SET enabled = NOT enabled WHERE id = ?')->execute([$id]);
    } elseif ($action === 'delete') {
        $id = (int) ($_POST['id'] ?? 0);
        $pdo->prepare('DELETE FROM report_schedules WHERE id = ?')->execute([$id]);
    }

    header('Location: ' . url('/report_scheduler.php'));
    exit;
}

$schedules = $pdo->query('SELECT * FROM report_schedules ORDER BY created_at DESC')->fetchAll();

$pageTitle = 'ตัวกำหนดการรายงาน - SMI-V Plus';
require __DIR__ . '/includes/header.php';
?>
<h1>ตัวกำหนดการรายงาน</h1>
<p class="note">ตั้งค่าการสร้างและส่งรายงานอัตโนมัติ (ต้องเปิดใช้ cron: <code>php src/bin/send_scheduled_reports.php</code> ทุก 1 ชั่วโมง)</p>

<form method="post" class="card" style="margin-bottom: 1.5rem;">
  <?= csrf_field() ?>
  <input type="hidden" name="action" value="add">
  <h3>เพิ่มตัวกำหนดการใหม่</h3>
  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
    <div>
      <label>ชื่อ</label>
      <input type="text" name="name" placeholder="เช่น Monthly AMC Report" required>
    </div>
    <div>
      <label>ประเภทรายงาน</label>
      <select name="report_type" required>
        <option value="">— เลือก —</option>
        <option value="ampur">รายงานรายอำเภอ</option>
        <option value="hoscode">รายงานรายหน่วยบริการ</option>
        <option value="summary">สรุปภาพรวม</option>
      </select>
    </div>
    <div>
      <label>ความถี่</label>
      <select name="frequency" required>
        <option value="">— เลือก —</option>
        <option value="monthly">รายเดือน</option>
        <option value="quarterly">รายไตรมาส</option>
        <option value="yearly">รายปี</option>
      </select>
    </div>
    <div>
      <label>ส่งไปอีเมล</label>
      <input type="email" name="email_to" placeholder="admin@example.com" required>
    </div>
  </div>
  <button type="submit" style="margin-top: 1rem;">เพิ่ม</button>
</form>

<table class="report-table">
  <thead>
    <tr>
      <th>ชื่อ</th>
      <th>ประเภท</th>
      <th>ความถี่</th>
      <th>ส่งไปอีเมล</th>
      <th>ส่งครั้งล่าสุด</th>
      <th>ส่งครั้งถัดไป</th>
      <th>สถานะ</th>
      <th></th>
    </tr>
  </thead>
  <tbody>
    <?php foreach ($schedules as $s): ?>
    <tr>
      <td><?= htmlspecialchars($s['name']) ?></td>
      <td><?= htmlspecialchars($s['report_type'] ?? '-') ?></td>
      <td><?= htmlspecialchars($s['frequency'] ?? '-') ?></td>
      <td style="font-size: 0.9em;"><?= htmlspecialchars($s['email_to']) ?></td>
      <td style="font-size: 0.9em;">
        <?php if ($s['last_sent']): ?>
          <?= date('d/m/Y H:i', strtotime($s['last_sent'])) ?>
        <?php else: ?>
          ยังไม่ได้ส่ง
        <?php endif; ?>
      </td>
      <td style="font-size: 0.9em;">
        <?php if ($s['next_send']): ?>
          <?= date('d/m/Y', strtotime($s['next_send'])) ?>
        <?php endif; ?>
      </td>
      <td style="text-align: center;">
        <form method="post" style="display: inline;">
          <?= csrf_field() ?>
          <input type="hidden" name="action" value="toggle">
          <input type="hidden" name="id" value="<?= (int) $s['id'] ?>">
          <button type="submit" style="background: <?= $s['enabled'] ? '#4caf50' : '#999' ?>; color: white; padding: 0.25rem 0.75rem; border: none; border-radius: 3px; cursor: pointer;">
            <?= $s['enabled'] ? '✓ เปิด' : '✕ ปิด' ?>
          </button>
        </form>
      </td>
      <td style="text-align: center;">
        <form method="post" style="display: inline;">
          <?= csrf_field() ?>
          <input type="hidden" name="action" value="delete">
          <input type="hidden" name="id" value="<?= (int) $s['id'] ?>">
          <button type="submit" style="background: #f44336; color: white; padding: 0.25rem 0.5rem; border: none; border-radius: 3px; cursor: pointer;" onclick="return confirm('ลบ?')">✕</button>
        </form>
      </td>
    </tr>
    <?php endforeach; ?>
  </tbody>
</table>

<?php if (empty($schedules)): ?>
<p style="color: #999; text-align: center; margin-top: 2rem;">ยังไม่มีตัวกำหนดการ</p>
<?php endif; ?>

<div style="margin-top: 2rem; padding: 1rem; background: #f0f0f0; border-radius: 6px; font-size: 0.9em;">
  <h3>วิธีการตั้งค่า</h3>
  <ol>
    <li>เพิ่มตัวกำหนดการด้านบน</li>
    <li>ตั้งค่า cron job ให้รันสคริป: <code>php src/bin/send_scheduled_reports.php</code> ทุก 1 ชั่วโมง</li>
    <li>ตัวกำหนดการจะตรวจสอบและส่งรายงานอัตโนมัติ</li>
  </ol>
  <p><strong>Cron entry ตัวอย่าง:</strong> <code>0 * * * * /usr/bin/php /path/to/src/bin/send_scheduled_reports.php</code></p>
</div>

<?php require __DIR__ . '/includes/footer.php'; ?>
