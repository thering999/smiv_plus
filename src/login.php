<?php
require __DIR__ . '/config/base_path.php';
require __DIR__ . '/includes/session_start.php';
require __DIR__ . '/includes/csrf.php';
require __DIR__ . '/config/db.php';
require __DIR__ . '/includes/cache.php';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const IP_MAX_ATTEMPTS = 20;
const IP_WINDOW_MINUTES = 15;

$error = '';
$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$ipKey = 'login_attempts_' . preg_replace('/[^0-9a-fA-F:.]/', '_', $ip);
$ipAttempts = (int) (cache_get($ipKey) ?? 0);

if ($ipAttempts >= IP_MAX_ATTEMPTS) {
    $error = "มีการล็อกอินผิดจาก IP นี้มากเกินไป กรุณาลองใหม่ในอีก " . IP_WINDOW_MINUTES . ' นาที';
} elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    verify_csrf();
    $username = trim($_POST['username'] ?? '');
    $password = $_POST['password'] ?? '';

    $stmt = $pdo->prepare('SELECT * FROM users WHERE username = ?');
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    if ($user && $user['locked_until'] && strtotime($user['locked_until']) > time()) {
        $minutesLeft = (int) ceil((strtotime($user['locked_until']) - time()) / 60);
        $error = "บัญชีถูกล็อกชั่วคราวจากการล็อกอินผิดหลายครั้ง กรุณาลองใหม่ในอีก {$minutesLeft} นาที";
    } elseif ($user && password_verify($password, $user['password_hash'])) {
        $pdo->prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?')->execute([$user['id']]);
        cache_set($ipKey, 0, IP_WINDOW_MINUTES * 60);
        session_regenerate_id(true);
        $_SESSION['user_id'] = $user['id'];
        $_SESSION['display_name'] = $user['display_name'];
        $_SESSION['role'] = $user['role'];
        header('Location: ' . url('/index.php'));
        exit;
    } else {
        cache_set($ipKey, $ipAttempts + 1, IP_WINDOW_MINUTES * 60);
        if ($user) {
            $attempts = $user['failed_attempts'] + 1;
            if ($attempts >= MAX_FAILED_ATTEMPTS) {
                $lockedUntil = date('Y-m-d H:i:s', time() + LOCKOUT_MINUTES * 60);
                $pdo->prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?')
                    ->execute([$attempts, $lockedUntil, $user['id']]);
                $error = "ล็อกอินผิดครบ {$attempts} ครั้ง บัญชีถูกล็อกชั่วคราว " . LOCKOUT_MINUTES . ' นาที';
            } else {
                $pdo->prepare('UPDATE users SET failed_attempts = ? WHERE id = ?')->execute([$attempts, $user['id']]);
                $error = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
            }
        } else {
            $error = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
        }
    }
}
?>
<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>เข้าสู่ระบบ - SMI-V Plus</title>
<link rel="stylesheet" href="<?= url('/assets/css/style.css') ?>">
</head>
<body class="login-body">
  <form class="login-box" method="post">
    <h1>🧠 SMI-V Plus</h1>
    <p>ระบบรายงาน SMI-V เขตสุขภาพ</p>
    <?php if ($error): ?><div class="alert"><?= htmlspecialchars($error) ?></div><?php endif; ?>
    <?= csrf_field() ?>
    <label>ชื่อผู้ใช้</label>
    <input type="text" name="username" required autofocus>
    <label>รหัสผ่าน</label>
    <input type="password" name="password" required>
    <button type="submit">เข้าสู่ระบบ</button>
  </form>
</body>
</html>
