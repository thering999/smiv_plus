<?php
// ปีงบประมาณไทย: ต.ค. - ก.ย. (พ.ศ.) เช่น 1 ต.ค. 2568 - 30 ก.ย. 2569 = ปีงบ 2569
function fiscal_year_be(string $dateYmd): int
{
    $ts = strtotime($dateYmd);
    $y = (int) date('Y', $ts) + 543;
    $m = (int) date('n', $ts);
    return $m >= 10 ? $y + 1 : $y;
}

// วันสิ้นปีงบประมาณ (30 ก.ย.) ของปีงบ พ.ศ. ที่กำหนด แปลงเป็น ค.ศ. คืนรูปแบบ Y-m-d
function fiscal_year_end_date(int $fiscalYearBe): string
{
    $ceYear = $fiscalYearBe - 543;
    return sprintf('%04d-09-30', $ceYear);
}

function current_fiscal_year_be(PDO $pdo): int
{
    $stmt = $pdo->prepare("SELECT `value` FROM settings WHERE `key` = 'current_fiscal_year_be'");
    $stmt->execute();
    $v = $stmt->fetchColumn();
    return $v !== false ? (int) $v : fiscal_year_be(date('Y-m-d'));
}

function get_setting(PDO $pdo, string $key, $default = null)
{
    $stmt = $pdo->prepare('SELECT `value` FROM settings WHERE `key` = ?');
    $stmt->execute([$key]);
    $v = $stmt->fetchColumn();
    return $v !== false ? $v : $default;
}

function set_setting(PDO $pdo, string $key, $value): void
{
    $pdo->prepare('INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)')
        ->execute([$key, $value]);
}

// I = H * ความชุก SMI (%) * สัดส่วน SMI-V ในผู้ป่วย SMI (%) — สูตรมาตรฐาน HDC
function estimate_smiv_patients(PDO $pdo, int $population15to60): int
{
    $prevalence = (float) get_setting($pdo, 'smi_prevalence_pct', 4.37);
    $ratio = (float) get_setting($pdo, 'smiv_ratio_pct', 11.92);
    return (int) round($population15to60 * ($prevalence / 100) * ($ratio / 100));
}

function max_age_included(PDO $pdo): int
{
    return (int) get_setting($pdo, 'max_age_included', 60);
}
