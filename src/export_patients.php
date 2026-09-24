<?php
require __DIR__ . '/config/base_path.php';
require __DIR__ . '/includes/session_start.php';
require __DIR__ . '/config/db.php';
require __DIR__ . '/config/settings.php';
require __DIR__ . '/includes/require_login.php';
require __DIR__ . '/includes/report_data.php';

$fy = isset($_GET['fy']) ? (int) $_GET['fy'] : current_fiscal_year_be($pdo);
$level = $_GET['level'] ?? 'ampur';
$area = trim($_GET['area'] ?? '');
$dateFrom = trim($_GET['date_from'] ?? '') ?: null;
$dateTo = trim($_GET['date_to'] ?? '') ?: null;

$patients = get_problem_patients($pdo, $fy, $level, $area, $dateFrom, $dateTo);

$filename = "problem_patients_fy{$fy}_" . date('YmdHis') . ".csv";
header('Content-Type: text/csv; charset=utf-8');
header('Content-Disposition: attachment; filename="' . $filename . '"');
header('Cache-Control: max-age=0');

$output = fopen('php://output', 'w');
fputcsv($output, ['หน่วยบริการ', 'PID', 'ชื่อ-นามสกุล', 'ปัญหา', 'สิทธิ์', 'การแนะนำ'], ',', '"');

foreach ($patients as $p) {
    fputcsv($output, [
        $p['hosname'] ?? '',
        $p['pid'] ?? '',
        ($p['name'] ?? '') . ' ' . ($p['lname'] ?? ''),
        $p['issues'] ?? '',
        $p['priority'] ?? '',
        $p['recommendations'] ?? '',
    ], ',', '"');
}

fclose($output);
exit;
