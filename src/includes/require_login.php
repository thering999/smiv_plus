<?php
if (empty($_SESSION['user_id'])) {
    header('Location: ' . url('/login.php'));
    exit;
}

// โหลด role/ampur จาก DB ทุก request — admin เปลี่ยนสิทธิ์หรืออำเภอของผู้ใช้แล้วมีผลทันที ไม่ต้องรอ logout
if (isset($pdo)) {
    $authStmt = $pdo->prepare('SELECT role, ampur FROM users WHERE id = ?');
    $authStmt->execute([$_SESSION['user_id']]);
    $authUser = $authStmt->fetch();
    if (!$authUser) {
        $_SESSION = [];
        session_destroy();
        header('Location: ' . url('/login.php'));
        exit;
    }
    $_SESSION['role'] = $authUser['role'];
    $_SESSION['ampur'] = $authUser['role'] === 'admin' ? null : ($authUser['ampur'] ?: null);
}

function require_admin(): void
{
    if (($_SESSION['role'] ?? '') !== 'admin') {
        http_response_code(403);
        die('เฉพาะผู้ดูแลระบบเท่านั้น');
    }
}
