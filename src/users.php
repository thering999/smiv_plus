<?php
require __DIR__ . '/config/base_path.php';
require __DIR__ . '/includes/session_start.php';
require __DIR__ . '/includes/csrf.php';
require __DIR__ . '/config/db.php';
require __DIR__ . '/includes/require_login.php';
require_admin();

$message = '';
$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    verify_csrf();
    $action = $_POST['action'] ?? '';
    if ($action === 'create') {
        $username = trim($_POST['username'] ?? '');
        $displayName = trim($_POST['display_name'] ?? '');
        $password = $_POST['password'] ?? '';
        $role = in_array($_POST['role'] ?? '', ['admin', 'viewer'], true) ? $_POST['role'] : 'viewer';

        if ($username === '' || $displayName === '' || strlen($password) < 8) {
            $error = 'กรอกข้อมูลให้ครบ และรหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร';
        } else {
            try {
                $pdo->prepare('INSERT INTO users (username, password_hash, display_name, role) VALUES (?,?,?,?)')
                    ->execute([$username, password_hash($password, PASSWORD_DEFAULT), $displayName, $role]);
                $message = 'สร้างผู้ใช้แล้ว';
            } catch (PDOException $e) {
                $error = 'ชื่อผู้ใช้นี้มีอยู่แล้ว';
            }
        }
    } elseif ($action === 'delete') {
        $id = (int) ($_POST['id'] ?? 0);
        if ($id === (int) $_SESSION['user_id']) {
            $error = 'ลบบัญชีตัวเองไม่ได้';
        } else {
            $pdo->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);
            $message = 'ลบผู้ใช้แล้ว';
        }
    }
}

$users = $pdo->query('SELECT id, username, display_name, role, locked_until, created_at FROM users ORDER BY id')->fetchAll();

$pageTitle = 'ผู้ใช้งาน - SMI-V Plus';
require __DIR__ . '/includes/header.php';
?>
<h1>จัดการผู้ใช้งาน</h1>
<?php if ($message): ?><div class="alert alert-success"><?= htmlspecialchars($message) ?></div><?php endif; ?>
<?php if ($error): ?><div class="alert"><?= htmlspecialchars($error) ?></div><?php endif; ?>

<form method="post" class="card">
  <?= csrf_field() ?>
  <input type="hidden" name="action" value="create">
  <label>ชื่อผู้ใช้</label>
  <input type="text" name="username" required>
  <label>ชื่อที่แสดง</label>
  <input type="text" name="display_name" required>
  <label>รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)</label>
  <input type="password" name="password" required minlength="8">
  <label>สิทธิ์</label>
  <select name="role">
    <option value="viewer">viewer (ดูรายงานอย่างเดียว)</option>
    <option value="admin">admin</option>
  </select>
  <button type="submit">สร้างผู้ใช้</button>
</form>

<table class="report-table">
  <thead><tr><th>ชื่อผู้ใช้</th><th>ชื่อที่แสดง</th><th>สิทธิ์</th><th>สร้างเมื่อ</th><th></th></tr></thead>
  <tbody>
  <?php foreach ($users as $u): ?>
    <tr>
      <td><?= htmlspecialchars($u['username']) ?></td>
      <td><?= htmlspecialchars($u['display_name']) ?></td>
      <td><?= htmlspecialchars($u['role']) ?></td>
      <td><?= htmlspecialchars($u['created_at']) ?></td>
      <td>
        <?php if ((int) $u['id'] !== (int) $_SESSION['user_id']): ?>
        <form method="post" onsubmit="return confirm('ลบผู้ใช้นี้?')" style="display:inline">
          <?= csrf_field() ?>
          <input type="hidden" name="action" value="delete">
          <input type="hidden" name="id" value="<?= (int) $u['id'] ?>">
          <button type="submit">ลบ</button>
        </form>
        <?php endif; ?>
      </td>
    </tr>
  <?php endforeach; ?>
  </tbody>
</table>
<?php require __DIR__ . '/includes/footer.php'; ?>
