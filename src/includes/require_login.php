<?php
if (empty($_SESSION['user_id'])) {
    header('Location: ' . url('/login.php'));
    exit;
}

function require_admin(): void
{
    if (($_SESSION['role'] ?? '') !== 'admin') {
        http_response_code(403);
        die('เฉพาะผู้ดูแลระบบเท่านั้น');
    }
}
