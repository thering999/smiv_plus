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
$dateFrom = trim($_GET['date_from'] ?? '') ?: null;
$dateTo = trim($_GET['date_to'] ?? '') ?: null;
$data = build_smiv_report($pdo, $fy, $level, $dateFrom, $dateTo);
$report = $data['report'];
$totals = $data['totals'];
$level = $data['level'];
$areaLabel = REPORT_LEVELS[$level];

$headers = [
    $areaLabel, 'เก่า (B)', 'ใหม่ (C)', 'รวม (D)', 'อัตราเข้าถึงบริการ E=D/I*100 (%)',
    'ไม่ก่อความรุนแรงซ้ำสะสม (F)', 'ร้อยละต่อเนื่องไม่ก่อซ้ำ G (%)', 'ประชากร 15-60 (H)', 'ประมาณการณ์ผู้ป่วย (I)',
    'ติดตาม 1 ครั้ง (J)', 'J ไม่ก่อซ้ำ (K)', 'L=K/I*100 (%)',
    'ติดตาม≥2ครั้ง (M)', 'M ไม่ก่อซ้ำ (N)', 'O=N/I*100 (%)',
    'ขาดการติดตาม (follow_last ว่าง)',
];

$spreadsheet = new Spreadsheet();
$sheet = $spreadsheet->getActiveSheet();
$sheet->setTitle('SMI-V Report');

$sheet->setCellValue('A1', "รายงาน SMI-V ปีงบประมาณ {$fy} — {$areaLabel}");
$sheet->mergeCells('A1:P1');
$sheet->getStyle('A1')->getFont()->setBold(true)->setSize(14);
if ($dateFrom && $dateTo) {
    $sheet->setCellValue('A2', "ช่วงวันที่มารับบริการครั้งแรก: {$dateFrom} ถึง {$dateTo}");
    $sheet->mergeCells('A2:P2');
}

$headerRow = 4;
foreach ($headers as $i => $h) {
    $col = \PhpOffice\PhpSpreadsheet\Cell\Coordinate::stringFromColumnIndex($i + 1);
    $sheet->setCellValue("{$col}{$headerRow}", $h);
}
$sheet->getStyle("A{$headerRow}:P{$headerRow}")->getFont()->setBold(true);
$sheet->getStyle("A{$headerRow}:P{$headerRow}")->getFill()
    ->setFillType(Fill::FILL_SOLID)->getStartColor()->setRGB('EAF1F5');

$row = $headerRow + 1;
foreach ($report as $r) {
    $sheet->setCellValue("A{$row}", $r['ampur_name']);
    $sheet->setCellValue("B{$row}", $r['b']);
    $sheet->setCellValue("C{$row}", $r['c']);
    $sheet->setCellValue("D{$row}", $r['d']);
    $sheet->setCellValue("E{$row}", $r['e']);
    $sheet->setCellValue("F{$row}", $r['f']);
    $sheet->setCellValue("G{$row}", $r['g']);
    $sheet->setCellValue("H{$row}", $r['h']);
    $sheet->setCellValue("I{$row}", $r['i']);
    $sheet->setCellValue("J{$row}", $r['j']);
    $sheet->setCellValue("K{$row}", $r['k']);
    $sheet->setCellValue("L{$row}", $r['l']);
    $sheet->setCellValue("M{$row}", $r['m']);
    $sheet->setCellValue("N{$row}", $r['n']);
    $sheet->setCellValue("O{$row}", $r['o']);
    $sheet->setCellValue("P{$row}", $r['missing_followup']);
    $row++;
}

$sheet->setCellValue("A{$row}", 'รวม');
$sheet->setCellValue("B{$row}", $totals['b']);
$sheet->setCellValue("C{$row}", $totals['c']);
$sheet->setCellValue("D{$row}", $totals['d']);
$sheet->setCellValue("E{$row}", $totals['e']);
$sheet->setCellValue("F{$row}", $totals['f']);
$sheet->setCellValue("G{$row}", $totals['g']);
$sheet->setCellValue("H{$row}", $totals['h']);
$sheet->setCellValue("I{$row}", $totals['i']);
$sheet->setCellValue("J{$row}", $totals['j']);
$sheet->setCellValue("K{$row}", $totals['k']);
$sheet->setCellValue("L{$row}", $totals['l']);
$sheet->setCellValue("M{$row}", $totals['m']);
$sheet->setCellValue("N{$row}", $totals['n']);
$sheet->setCellValue("O{$row}", $totals['o']);
$sheet->setCellValue("P{$row}", $totals['missing_followup']);
$sheet->getStyle("A{$row}:P{$row}")->getFont()->setBold(true);

foreach (range('A', 'P') as $col) {
    $sheet->getColumnDimension($col)->setAutoSize(true);
}
foreach (['E', 'G', 'L', 'O'] as $pctCol) {
    $sheet->getStyle("{$pctCol}" . ($headerRow + 1) . ":{$pctCol}{$row}")->getNumberFormat()->setFormatCode('0.00"%"');
}

$filename = "smiv_report_{$level}_{$fy}.xlsx";
header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
header('Content-Disposition: attachment;filename="' . $filename . '"');
header('Cache-Control: max-age=0');

$writer = new Xlsx($spreadsheet);
$writer->save('php://output');
exit;
