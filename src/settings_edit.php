<?php
require __DIR__ . '/config/base_path.php';
require __DIR__ . '/includes/session_start.php';
require __DIR__ . '/includes/csrf.php';
require __DIR__ . '/config/db.php';
require __DIR__ . '/config/settings.php';
require __DIR__ . '/includes/require_login.php';
require_admin();

$message = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    verify_csrf();
    set_setting($pdo, 'smi_prevalence_pct', (float) ($_POST['smi_prevalence_pct'] ?? 4.37));
    set_setting($pdo, 'smiv_ratio_pct', (float) ($_POST['smiv_ratio_pct'] ?? 11.92));
    set_setting($pdo, 'max_age_included', (int) ($_POST['max_age_included'] ?? 60));
    set_setting($pdo, 'current_fiscal_year_be', (int) ($_POST['current_fiscal_year_be'] ?? 0));
    $pdo->prepare('INSERT INTO audit_log (user_id, action, detail) VALUES (?, ?, ?)')
        ->execute([$_SESSION['user_id'], 'settings_edit', json_encode($_POST, JSON_UNESCAPED_UNICODE)]);
    $message = 'บันทึกแล้ว';
}

$pageTitle = 'ตั้งค่าระบบ - SMI-V Plus';
require __DIR__ . '/includes/header.php';
?>
<h1>ตั้งค่าระบบ</h1>
<?php if ($message): ?><div class="alert alert-success"><?= htmlspecialchars($message) ?></div><?php endif; ?>

<form method="post" class="card">
  <?= csrf_field() ?>
  <label>ความชุก SMI (%) — สูตรคำนวณ I</label>
  <input type="number" step="0.01" name="smi_prevalence_pct" value="<?= htmlspecialchars(get_setting($pdo, 'smi_prevalence_pct', 4.37)) ?>">
  <label>สัดส่วน SMI-V ในผู้ป่วย SMI (%) — สูตรคำนวณ I</label>
  <input type="number" step="0.01" name="smiv_ratio_pct" value="<?= htmlspecialchars(get_setting($pdo, 'smiv_ratio_pct', 11.92)) ?>">
  <label>ตัดผู้ป่วยอายุเกิน (ปี) ณ สิ้นปีงบ ออกจากตัวนับ</label>
  <input type="number" name="max_age_included" value="<?= htmlspecialchars(get_setting($pdo, 'max_age_included', 60)) ?>">
  <label>ปีงบประมาณปัจจุบัน (พ.ศ.)</label>
  <input type="number" name="current_fiscal_year_be" value="<?= htmlspecialchars(get_setting($pdo, 'current_fiscal_year_be', '')) ?>">
  <button type="submit">บันทึก</button>
</form>
<p class="note">"ก่อความรุนแรงซ้ำ" คำนวณอัตโนมัติจากจำนวนรหัส b03x (1B030-1B033) ที่ผู้ป่วยถูกลงทะเบียนมากกว่า 1 ครั้ง (ไม่มีค่าตั้งค่าให้ปรับ) — นิยามตามเอกสาร HDC Template</p>
<?php require __DIR__ . '/includes/footer.php'; ?>
