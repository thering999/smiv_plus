<?php
require __DIR__ . '/config/base_path.php';
require __DIR__ . '/includes/session_start.php';
require __DIR__ . '/config/db.php';
require __DIR__ . '/config/settings.php';
require __DIR__ . '/includes/require_login.php';
require __DIR__ . '/includes/report_data.php';
require __DIR__ . '/vendor/autoload.php';

use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use PhpOffice\PhpSpreadsheet\Style\Fill;

$fy = isset($_GET['fy']) ? (int) $_GET['fy'] : current_fiscal_year_be($pdo);
$level = $_GET['level'] ?? 'ampur';
$areaFilter = trim($_GET['area'] ?? '');
$dateFrom = trim($_GET['date_from'] ?? '') ?: null;
$dateTo = trim($_GET['date_to'] ?? '') ?: null;

$data = build_smiv_report($pdo, $fy, $level);
$level = $data['level'];
$areaLabel = REPORT_LEVELS[$level];
$areaName = $areaFilter;
foreach ($data['report'] as $r) {
    if ((string) $r['group_key'] === $areaFilter) $areaName = $r['ampur_name'];
}

$rows = get_problem_patients($pdo, $fy, $level, $areaFilter, $dateFrom, $dateTo);
$priorityOrder = ['สูง' => 0, 'กลาง' => 1, 'ปกติ' => 2];
usort($rows, fn($a, $b) => $priorityOrder[$a['priority']] <=> $priorityOrder[$b['priority']]);

$spreadsheet = new Spreadsheet();
$sheet = $spreadsheet->getActiveSheet();
$sheet->setTitle('รายชื่อที่มีปัญหา');

$title = "รายชื่อผู้ป่วยที่มีปัญหาข้อมูล/ต้องติดตาม — ปีงบ {$fy}" . ($areaFilter !== '' ? " — {$areaLabel}: {$areaName}" : " — {$areaLabel} (ทั้งหมด)");
$sheet->setCellValue('A1', $title);
$sheet->mergeCells('A1:I1');
$sheet->getStyle('A1')->getFont()->setBold(true)->setSize(13);

$headers = [
    'hoscode', 'hosname', 'pid', 'cid', 'name', 'lname', 'birth', 'sex', 'chw_addr', 'tambon', 'ampur',
    'first_date_serv', 'date_serv', 'diagcode', 'b03x', 'follow_last',
    'จำนวนรหัส SMI-V สะสม', 'จำนวนครั้งที่มารับบริการ',
    'ความสำคัญ', 'ปัญหาที่ระบบตรวจพบ', 'คำแนะนำการดำเนินการ',
];
$lastCol = \PhpOffice\PhpSpreadsheet\Cell\Coordinate::stringFromColumnIndex(count($headers));
$hr = 3;
foreach ($headers as $i => $h) {
    $col = \PhpOffice\PhpSpreadsheet\Cell\Coordinate::stringFromColumnIndex($i + 1);
    $sheet->setCellValue("{$col}{$hr}", $h);
}
$sheet->getStyle("A{$hr}:{$lastCol}{$hr}")->getFont()->setBold(true);
$sheet->getStyle("A{$hr}:{$lastCol}{$hr}")->getFill()->setFillType(Fill::FILL_SOLID)->getStartColor()->setRGB('FDECEA');

$row = $hr + 1;
foreach ($rows as $r) {
    $sheet->setCellValue("A{$row}", $r['hoscode']);
    $sheet->setCellValue("B{$row}", $r['hosname']);
    $sheet->setCellValue("C{$row}", $r['pid']);
    $sheet->setCellValueExplicit("D{$row}", $r['cid'], \PhpOffice\PhpSpreadsheet\Cell\DataType::TYPE_STRING);
    $sheet->setCellValue("E{$row}", $r['name']);
    $sheet->setCellValue("F{$row}", $r['lname']);
    $sheet->setCellValue("G{$row}", $r['birth']);
    $sheet->setCellValue("H{$row}", $r['sex']);
    $sheet->setCellValue("I{$row}", $r['chw_addr']);
    $sheet->setCellValue("J{$row}", $r['tambon']);
    $sheet->setCellValue("K{$row}", $r['ampur']);
    $sheet->setCellValue("L{$row}", $r['first_date_serv']);
    $sheet->setCellValue("M{$row}", $r['date_serv_raw']);
    $sheet->setCellValue("N{$row}", $r['diagcode_raw']);
    $sheet->setCellValue("O{$row}", $r['b03x_raw']);
    $sheet->setCellValue("P{$row}", $r['follow_last'] ?? 'NULL');
    $sheet->setCellValue("Q{$row}", $r['smiv_code_count']);
    $sheet->setCellValue("R{$row}", $r['total_visits']);
    $sheet->setCellValue("S{$row}", $r['priority']);
    $sheet->setCellValue("T{$row}", $r['issues']);
    $sheet->setCellValue("U{$row}", $r['recommendations']);
    if ($r['priority'] === 'สูง') {
        $sheet->getStyle("A{$row}:U{$row}")->getFill()->setFillType(Fill::FILL_SOLID)->getStartColor()->setRGB('FDECEA');
    }
    $row++;
}

foreach (range('A', $lastCol) as $col) {
    $sheet->getColumnDimension($col)->setAutoSize(true);
}

if (!$rows) {
    $sheet->setCellValue("A{$row}", 'ไม่พบผู้ป่วยที่มีปัญหาตามเกณฑ์ในพื้นที่/ช่วงเวลานี้');
    $sheet->mergeCells("A{$row}:{$lastCol}{$row}");
}

$filename = "smiv_problem_patients_{$level}_{$fy}.xlsx";
header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
header('Content-Disposition: attachment;filename="' . $filename . '"');
header('Cache-Control: max-age=0');

$writer = new Xlsx($spreadsheet);
$writer->save('php://output');
exit;
