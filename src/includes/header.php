<?php
require_once __DIR__ . '/../config/base_path.php';
$current = basename($_SERVER['SCRIPT_NAME']);

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: strict-origin-when-cross-origin');

$adminPages = ['import_upload.php', 'population_edit.php', 'users.php', 'settings_edit.php'];
?>
<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= $pageTitle ?? 'SMI-V Plus' ?></title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🧠</text></svg>">
<link rel="stylesheet" href="<?= url('/assets/css/style.css') ?>">
</head>
<body>
<header class="topbar">
  <div class="brand">🧠 SMI-V Plus : ร้อยละผู้ป่วยจิตเวชสารเสพติดก่อความรุนแรง</div>
  <nav class="nav">
    <a href="<?= url('/index.php') ?>" class="<?= $current === 'index.php' ? 'active' : '' ?>">Dashboard</a>
    <a href="<?= url('/analysis.php') ?>" class="<?= $current === 'analysis.php' ? 'active' : '' ?>">วิเคราะห์ปัญหา</a>
    <a href="<?= url('/reference.php') ?>" class="<?= $current === 'reference.php' ? 'active' : '' ?>">คู่มือรหัส</a>
    <?php if (($_SESSION['role'] ?? '') === 'admin'): ?>
      <div class="nav-dropdown">
        <span class="nav-dropdown-toggle <?= in_array($current, $adminPages, true) ? 'active' : '' ?>" onclick="this.closest('.nav-dropdown').classList.toggle('open')">ผู้ดูแลระบบ ▾</span>
        <div class="nav-dropdown-menu">
          <a href="<?= url('/import_upload.php') ?>" class="<?= $current === 'import_upload.php' ? 'active' : '' ?>">นำเข้า Excel</a>
          <a href="<?= url('/population_edit.php') ?>" class="<?= $current === 'population_edit.php' ? 'active' : '' ?>">ประชากร/ประมาณการณ์ (H,I)</a>
          <a href="<?= url('/settings_edit.php') ?>" class="<?= $current === 'settings_edit.php' ? 'active' : '' ?>">ตั้งค่ารหัสก่อความรุนแรงซ้ำ</a>
          <a href="<?= url('/users.php') ?>" class="<?= $current === 'users.php' ? 'active' : '' ?>">ผู้ใช้งาน</a>
        </div>
      </div>
    <?php endif; ?>
  </nav>
  <div class="user">
    <?= htmlspecialchars($_SESSION['display_name'] ?? '') ?>
    | <a href="<?= url('/logout.php') ?>">ออกจากระบบ</a>
  </div>
</header>
<main class="content">
