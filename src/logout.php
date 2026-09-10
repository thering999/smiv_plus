<?php
require __DIR__ . '/config/base_path.php';
require __DIR__ . '/includes/session_start.php';
$_SESSION = [];
session_destroy();
header('Location: ' . url('/login.php'));
exit;
