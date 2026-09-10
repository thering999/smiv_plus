<?php
require __DIR__ . '/config/base_path.php';
require __DIR__ . '/includes/session_start.php';
require __DIR__ . '/includes/csrf.php';
require __DIR__ . '/config/db.php';
require __DIR__ . '/config/settings.php';
require __DIR__ . '/includes/require_login.php';
require_admin();

$fy = isset($_GET['fy']) ? (int) $_GET['fy'] : current_fiscal_year_be($pdo);
$message = '';
$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    verify_csrf();
    $ampur = trim($_POST['ampur'] ?? '');
    $ampurName = trim($_POST['ampur_name'] ?? '');
    $pop = (int) ($_POST['population_15_60'] ?? 0);
    $postFy = (int) ($_POST['fiscal_year_be'] ?? $fy);

    if ($ampur === '' || $ampurName === '') {
        $error = 'กรุณากรอกรหัสอำเภอและชื่ออำเภอ';
    } else {
        $pdo->prepare(
            'INSERT INTO population_estimates (fiscal_year_be, ampur, ampur_name, population_15_60, updated_by)
             VALUES (?,?,?,?,?)
             ON CONFLICT (fiscal_year_be, ampur) DO UPDATE SET ampur_name=EXCLUDED.ampur_name, population_15_60=EXCLUDED.population_15_60,
                updated_by=EXCLUDED.updated_by'
        )->execute([$postFy, $ampur, $ampurName, $pop, $_SESSION['user_id']]);
        $pdo->prepare('INSERT INTO audit_log (user_id, action, detail) VALUES (?, ?, ?)')
            ->execute([$_SESSION['user_id'], 'population_edit', "ปีงบ $postFy อำเภอ $ampur ประชากร=$pop"]);
        $message = 'บันทึกแล้ว';
        $fy = $postFy;
    }
}

$stmt = $pdo->prepare('SELECT * FROM population_estimates WHERE fiscal_year_be = ? ORDER BY ampur');
$stmt->execute([$fy]);
$list = $stmt->fetchAll();

$pageTitle = 'ประชากร/ประมาณการณ์ - SMI-V Plus';
require __DIR__ . '/includes/header.php';
?>
<h1>ประชากรกลางปี (H) — ผู้ป่วยประมาณการณ์ (I) คำนวณอัตโนมัติ</h1>
<p>H = ประชากรกลางปี 15-60 ปี ย้อนหลัง 2 ปี ก่อนปีงบปัจจุบัน — ข้อมูลระบาดวิทยา/ทะเบียนราษฎร์ ไม่ได้มาจากไฟล์นำเข้า ต้องกรอกเองต่อปีงบ/อำเภอ<br>
I คำนวณจากสูตร HDC: H × 4.37% (ความชุก SMI) × 11.92% (สัดส่วน SMI-V) — ปรับค่าคงที่ได้ที่เมนู "ตั้งค่าระบบ"</p>

<form method="get" class="filter-bar">
  <label>ปีงบประมาณ (พ.ศ.)</label>
  <input type="number" name="fy" value="<?= (int) $fy ?>">
  <button type="submit">แสดง</button>
</form>

<?php if ($message): ?><div class="alert alert-success"><?= htmlspecialchars($message) ?></div><?php endif; ?>
<?php if ($error): ?><div class="alert"><?= htmlspecialchars($error) ?></div><?php endif; ?>

<form method="post" class="card">
  <?= csrf_field() ?>
  <input type="hidden" name="fiscal_year_be" value="<?= (int) $fy ?>">
  <label>รหัสอำเภอ (ampur)</label>
  <input type="text" name="ampur" required maxlength="10">
  <label>ชื่ออำเภอ</label>
  <input type="text" name="ampur_name" required maxlength="100">
  <label>ประชากร 15-60 ปี (H)</label>
  <input type="number" name="population_15_60" required min="0">
  <button type="submit">บันทึก</button>
</form>

<table class="report-table">
  <thead><tr><th>รหัส</th><th>อำเภอ</th><th>ประชากร 15-60 (H)</th><th>ประมาณการณ์ (I) คำนวณอัตโนมัติ</th></tr></thead>
  <tbody>
  <?php foreach ($list as $p): ?>
    <tr>
      <td><?= htmlspecialchars($p['ampur']) ?></td>
      <td><?= htmlspecialchars($p['ampur_name']) ?></td>
      <td><?= number_format($p['population_15_60']) ?></td>
      <td><?= number_format(estimate_smiv_patients($pdo, (int) $p['population_15_60'])) ?></td>
    </tr>
  <?php endforeach; ?>
  </tbody>
</table>
<?php require __DIR__ . '/includes/footer.php'; ?>
