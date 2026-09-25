<?php
require __DIR__ . '/config/base_path.php';
require __DIR__ . '/includes/session_start.php';
require __DIR__ . '/includes/csrf.php';
require __DIR__ . '/config/db.php';
require __DIR__ . '/includes/require_login.php';
require_admin();

function log_audit(PDO $pdo, int $userId, string $action, string $detail = ''): void {
    $pdo->prepare('INSERT INTO audit_log (user_id, action, detail) VALUES (?,?,?)')
        ->execute([$userId, $action, $detail]);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    verify_csrf();
    $action = $_POST['action'] ?? '';
    $actorId = (int) $_SESSION['user_id'];

    if ($action === 'create') {
        $username = trim($_POST['username'] ?? '');
        $displayName = trim($_POST['display_name'] ?? '');
        $password = $_POST['password'] ?? '';
        $role = in_array($_POST['role'] ?? '', ['admin', 'viewer'], true) ? $_POST['role'] : 'viewer';

        if ($username === '' || $displayName === '' || strlen($password) < 8) {
            $_SESSION['users_flash_error'] = 'กรอกข้อมูลให้ครบ และรหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร';
        } else {
            try {
                $pdo->prepare('INSERT INTO users (username, password_hash, display_name, role) VALUES (?,?,?,?)')
                    ->execute([$username, password_hash($password, PASSWORD_DEFAULT), $displayName, $role]);
                log_audit($pdo, $actorId, 'user_create', "username={$username}, role={$role}");
                $_SESSION['users_flash_message'] = 'สร้างผู้ใช้แล้ว';
            } catch (PDOException $e) {
                $_SESSION['users_flash_error'] = 'ชื่อผู้ใช้นี้มีอยู่แล้ว';
            }
        }
    } elseif ($action === 'update') {
        $id = (int) ($_POST['id'] ?? 0);
        $displayName = trim($_POST['display_name'] ?? '');
        $role = in_array($_POST['role'] ?? '', ['admin', 'viewer'], true) ? $_POST['role'] : 'viewer';
        $newPassword = $_POST['new_password'] ?? '';

        if ($id === $actorId && $role !== 'admin') {
            $_SESSION['users_flash_error'] = 'ลดสิทธิ์บัญชีตัวเองไม่ได้';
        } elseif ($displayName === '') {
            $_SESSION['users_flash_error'] = 'กรอกชื่อที่แสดง';
        } elseif ($newPassword !== '' && strlen($newPassword) < 8) {
            $_SESSION['users_flash_error'] = 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร';
        } else {
            if ($newPassword !== '') {
                $pdo->prepare('UPDATE users SET display_name = ?, role = ?, password_hash = ? WHERE id = ?')
                    ->execute([$displayName, $role, password_hash($newPassword, PASSWORD_DEFAULT), $id]);
                log_audit($pdo, $actorId, 'user_update', "id={$id}, role={$role}, password_reset=1");
            } else {
                $pdo->prepare('UPDATE users SET display_name = ?, role = ? WHERE id = ?')
                    ->execute([$displayName, $role, $id]);
                log_audit($pdo, $actorId, 'user_update', "id={$id}, role={$role}");
            }
            $_SESSION['users_flash_message'] = 'แก้ไขผู้ใช้แล้ว';
        }
    } elseif ($action === 'delete') {
        $id = (int) ($_POST['id'] ?? 0);
        if ($id === $actorId) {
            $_SESSION['users_flash_error'] = 'ลบบัญชีตัวเองไม่ได้';
        } else {
            $target = $pdo->prepare('SELECT username FROM users WHERE id = ?');
            $target->execute([$id]);
            $targetUsername = $target->fetchColumn();
            $pdo->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);
            log_audit($pdo, $actorId, 'user_delete', "id={$id}, username=" . ($targetUsername ?: '?'));
            $_SESSION['users_flash_message'] = 'ลบผู้ใช้แล้ว';
        }
    }

    header('Location: ' . url('/users.php'));
    exit;
}

$message = $_SESSION['users_flash_message'] ?? '';
$error = $_SESSION['users_flash_error'] ?? '';
unset($_SESSION['users_flash_message'], $_SESSION['users_flash_error']);

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
  <thead><tr><th>ชื่อผู้ใช้</th><th>ชื่อที่แสดง / สิทธิ์ / รหัสผ่านใหม่</th><th>สร้างเมื่อ</th><th></th></tr></thead>
  <tbody>
  <?php foreach ($users as $u): ?>
    <tr>
      <td><?= htmlspecialchars($u['username']) ?></td>
      <td>
        <form method="post" class="inline-edit-form">
          <?= csrf_field() ?>
          <input type="hidden" name="action" value="update">
          <input type="hidden" name="id" value="<?= (int) $u['id'] ?>">
          <input type="text" name="display_name" value="<?= htmlspecialchars($u['display_name']) ?>" required>
          <select name="role">
            <option value="viewer" <?= $u['role'] === 'viewer' ? 'selected' : '' ?>>viewer</option>
            <option value="admin" <?= $u['role'] === 'admin' ? 'selected' : '' ?>>admin</option>
          </select>
          <input type="password" name="new_password" placeholder="รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)" minlength="8">
          <button type="submit">บันทึก</button>
        </form>
      </td>
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
