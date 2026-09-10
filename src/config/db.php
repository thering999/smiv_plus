<?php
$host = getenv('DB_HOST') ?: 'db';
$port = getenv('DB_PORT') ?: '5432';
$name = getenv('DB_NAME') ?: 'smiv_plus';
$user = getenv('DB_USER') ?: 'smiv_user';
$pass = getenv('DB_PASS') ?: 'smiv_pass';

try {
    $pdo = new PDO(
        "pgsql:host=$host;port=$port;dbname=$name",
        $user,
        $pass,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
    );
} catch (PDOException $e) {
    die('DB connection failed: ' . $e->getMessage());
}
