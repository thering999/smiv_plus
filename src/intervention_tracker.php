<?php
require __DIR__ . '/config/base_path.php';
require __DIR__ . '/includes/session_start.php';
require __DIR__ . '/config/db.php';
require __DIR__ . '/config/settings.php';
require __DIR__ . '/includes/require_login.php';
require_admin();
require __DIR__ . '/includes/csrf.php';

// Create interventions table if not exists
try {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS interventions (
            id SERIAL PRIMARY KEY,
            ampur VARCHAR(50) NOT NULL,
            problem_type VARCHAR(100),
            action_taken TEXT,
            responsible_person VARCHAR(100),
            target_date DATE,
            completion_date DATE,
            status VARCHAR(20) DEFAULT 'ongoing',
            notes TEXT,
            created_by INT REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_interventions_ampur ON interventions(ampur);
        CREATE INDEX IF NOT EXISTS idx_interventions_status ON interventions(status);
    ");
} catch (PDOException $e) {
    error_log('Interventions table creation: ' . $e->getMessage());
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';
    verify_csrf();

    if ($action === 'add') {
        $ampur = trim($_POST['ampur'] ?? '');
        $problemType = trim($_POST['problem_type'] ?? '');
        $actionTaken = trim($_POST['action_taken'] ?? '');
        $responsiblePerson = trim($_POST['responsible_person'] ?? '');
        $targetDate = trim($_POST['target_date'] ?? '');

        if ($ampur && $problemType && $actionTaken) {
            $stmt = $pdo->prepare(
                "INSERT INTO interventions (ampur, problem_type, action_taken, responsible_person, target_date, created_by)
                 VALUES (?, ?, ?, ?, ?, ?)"
            );
            $stmt->execute([$ampur, $problemType, $actionTaken, $responsiblePerson, $targetDate ?: null, $_SESSION['user_id']]);
            header('Location: ' . url('/intervention_tracker.php'));
            exit;
        }
    } elseif ($action === 'complete') {
        $id = (int) ($_POST['id'] ?? 0);
        $pdo->prepare('UPDATE interventions SET status = ?, completion_date = NOW() WHERE id = ?')
            ->execute(['completed', $id]);
        header('Location: ' . url('/intervention_tracker.php'));
        exit;
    } elseif ($action === 'delete') {
        $id = (int) ($_POST['id'] ?? 0);
        $pdo->prepare('DELETE FROM interventions WHERE id = ?')->execute([$id]);
        header('Location: ' . url('/intervention_tracker.php'));
        exit;
    }
}

$filter = $_GET['status'] ?? 'ongoing';
// require_admin() ด้านบนแปลว่าปกติเข้าถึงได้เฉพาะ admin (ampur scope = null) แต่กรองซ้ำไว้เผื่ออนาคตเปิดสิทธิ์ให้ viewer
$scopeAmpur = $_SESSION['ampur'] ?? null;
$interventionScopeSql = $scopeAmpur !== null ? ' AND ampur = ?' : '';
$stmt = $pdo->prepare(
    "SELECT id, ampur, problem_type, action_taken, responsible_person, target_date, completion_date, status, created_at
     FROM interventions
     WHERE (status = ? OR ? = 'all') $interventionScopeSql
     ORDER BY target_date ASC NULLS LAST, created_at DESC"
);
$stmt->execute($scopeAmpur !== null ? [$filter, $filter, $scopeAmpur] : [$filter, $filter]);
$interventions = $stmt->fetchAll();

$pageTitle = 'ติดตามการแทรกแซง - SMI-V Plus';
require __DIR__ . '/includes/header.php';
?>
<h1>ติดตามการแทรกแซง</h1>
<p class="note">บันทึกและติดตามการดำเนินการ ต่อเนื่องสำหรับแต่ละพื้นที่</p>

<form method="post" class="intervention-form">
  <?= csrf_field() ?>
  <input type="hidden" name="action" value="add">
  <fieldset style="border: 1px solid #ddd; padding: 1rem; border-radius: 4px; margin-bottom: 1.5rem;">
    <legend>เพิ่มการแทรกแซงใหม่</legend>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
      <div>
        <label>อำเภอ</label>
        <input type="text" name="ampur" required>
      </div>
      <div>
        <label>ประเภทปัญหา</label>
        <select name="problem_type" required>
          <option value="">— เลือก —</option>
          <option>เข้าถึงบริการต่ำ</option>
          <option>ก่อความรุนแรงซ้ำสูง</option>
          <option>ไม่เคยติดตามซ้ำ</option>
          <option>ข้อมูลไม่ครบถ้วน</option>
          <option>อื่นๆ</option>
        </select>
      </div>
      <div style="grid-column: 1/-1;">
        <label>การแนะนำ/ดำเนินการ</label>
        <textarea name="action_taken" required rows="3"></textarea>
      </div>
      <div>
        <label>ผู้รับผิดชอบ</label>
        <input type="text" name="responsible_person" placeholder="ชื่อ/แผนก">
      </div>
      <div>
        <label>เป้าหมาย (วันที่)</label>
        <input type="date" name="target_date">
      </div>
    </div>
    <button type="submit" style="margin-top: 1rem;">บันทึก</button>
  </fieldset>
</form>

<div style="margin-bottom: 1rem;">
  <a href="?status=ongoing" class="<?= $filter === 'ongoing' ? 'active' : '' ?>" style="padding: 0.5rem 1rem; background: #f0f0f0; border-radius: 4px; text-decoration: none; margin-right: 0.5rem; display: inline-block;">
    ดำเนินการอยู่ (<?= count(array_filter($interventions, fn($i) => $i['status'] === 'ongoing')) ?>)
  </a>
  <a href="?status=completed" class="<?= $filter === 'completed' ? 'active' : '' ?>" style="padding: 0.5rem 1rem; background: #f0f0f0; border-radius: 4px; text-decoration: none; margin-right: 0.5rem; display: inline-block;">
    สำเร็จ (<?= count(array_filter($interventions, fn($i) => $i['status'] === 'completed')) ?>)
  </a>
  <a href="?status=all" class="<?= $filter === 'all' ? 'active' : '' ?>" style="padding: 0.5rem 1rem; background: #f0f0f0; border-radius: 4px; text-decoration: none; display: inline-block;">
    ทั้งหมด
  </a>
</div>

<table class="report-table">
  <thead>
    <tr>
      <th>อำเภอ</th>
      <th>ปัญหา</th>
      <th>การดำเนินการ</th>
      <th>ผู้รับผิดชอบ</th>
      <th>เป้า</th>
      <th>สถานะ</th>
      <th></th>
    </tr>
  </thead>
  <tbody>
    <?php foreach ($interventions as $i): ?>
    <tr class="intervention-<?= htmlspecialchars($i['status']) ?>">
      <td><strong><?= htmlspecialchars($i['ampur']) ?></strong></td>
      <td><?= htmlspecialchars($i['problem_type'] ?? '') ?></td>
      <td style="font-size: 0.9em;"><?= htmlspecialchars($i['action_taken']) ?></td>
      <td><?= htmlspecialchars($i['responsible_person'] ?? '-') ?></td>
      <td style="text-align: center; font-size: 0.9em;">
        <?php if ($i['target_date']): ?>
          <?= date('d/m/y', strtotime($i['target_date'])) ?>
        <?php endif; ?>
      </td>
      <td style="text-align: center;">
        <?php if ($i['status'] === 'completed'): ?>
          <span style="background: #c8e6c9; color: #2e7d32; padding: 0.25rem 0.5rem; border-radius: 3px; font-weight: bold;">✓ สำเร็จ</span>
        <?php else: ?>
          <span style="background: #fff3cd; color: #856404; padding: 0.25rem 0.5rem; border-radius: 3px;">ดำเนินการอยู่</span>
        <?php endif; ?>
      </td>
      <td style="text-align: center;">
        <?php if ($i['status'] === 'ongoing'): ?>
        <form method="post" style="display: inline;">
          <?= csrf_field() ?>
          <input type="hidden" name="action" value="complete">
          <input type="hidden" name="id" value="<?= (int) $i['id'] ?>">
          <button type="submit" style="padding: 0.25rem 0.5rem; font-size: 0.85em; background: #4caf50; color: white; border: none; border-radius: 3px; cursor: pointer;">✓</button>
        </form>
        <?php endif; ?>
        <form method="post" style="display: inline;">
          <?= csrf_field() ?>
          <input type="hidden" name="action" value="delete">
          <input type="hidden" name="id" value="<?= (int) $i['id'] ?>">
          <button type="submit" style="padding: 0.25rem 0.5rem; font-size: 0.85em; background: #f44336; color: white; border: none; border-radius: 3px; cursor: pointer;" onclick="return confirm('ลบ?')">✕</button>
        </form>
      </td>
    </tr>
    <?php endforeach; ?>
  </tbody>
</table>

<style>
.intervention-form textarea { font-family: monospace; font-size: 0.9em; }
.intervention-ongoing { background: #fffacd; }
.intervention-completed { background: #e8f5e9; color: #666; }
a.active { background: #1976d2 !important; color: white !important; }
</style>

<?php require __DIR__ . '/includes/footer.php'; ?>
