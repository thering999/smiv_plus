<?php
// ใช้งาน: docker compose exec web php bin/create_admin.php <username> <password> [display_name]
require __DIR__ . '/../config/db.php';

$username = $argv[1] ?? null;
$password = $argv[2] ?? null;
$displayName = $argv[3] ?? ($username ?: 'ผู้ดูแลระบบ');

if (!$username || !$password) {
    fwrite(STDERR, "usage: php bin/create_admin.php <username> <password> [display_name]\n");
    exit(1);
}
if (strlen($password) < 8) {
    fwrite(STDERR, "รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร\n");
    exit(1);
}

$stmt = $pdo->prepare(
    'INSERT INTO users (username, password_hash, display_name, role) VALUES (?,?,?,\'admin\')
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, display_name = EXCLUDED.display_name'
);
$stmt->execute([$username, password_hash($password, PASSWORD_DEFAULT), $displayName]);

echo "สร้าง/อัปเดตผู้ดูแลระบบ '$username' แล้ว\n";
