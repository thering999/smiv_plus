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

// ไตรมาสปีงบ: Q1 ต.ค.-ธ.ค. (ปี ค.ศ. ก่อนปีงบ), Q2 ม.ค.-มี.ค., Q3 เม.ย.-มิ.ย., Q4 ก.ค.-ก.ย.
const FISCAL_QUARTERS = [1 => 'Q1 (ต.ค.-ธ.ค.)', 2 => 'Q2 (ม.ค.-มี.ค.)', 3 => 'Q3 (เม.ย.-มิ.ย.)', 4 => 'Q4 (ก.ค.-ก.ย.)'];

// คืน [วันแรก, วันสุดท้าย] (Y-m-d ค.ศ.) ของไตรมาส $q ในปีงบ พ.ศ. $fyBe
function fiscal_quarter_range(int $fyBe, int $q): array
{
    $ce = $fyBe - 543;
    [$y, $m] = [1 => [$ce - 1, 10], 2 => [$ce, 1], 3 => [$ce, 4], 4 => [$ce, 7]][$q];
    return [sprintf('%04d-%02d-01', $y, $m), date('Y-m-t', mktime(0, 0, 0, $m + 2, 1, $y))];
}

// อ่านตัวกรองช่วงวันที่จาก GET — ถ้าเลือกไตรมาส (q) จะใช้ช่วงของไตรมาสแทนวันที่ที่กรอกเอง
// คืน [dateFrom, dateTo, q]
function resolve_date_filter(int $fyBe): array
{
    $q = (int) ($_GET['q'] ?? 0);
    if (isset(FISCAL_QUARTERS[$q])) {
        return [...fiscal_quarter_range($fyBe, $q), $q];
    }
    $valid = fn($d) => preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) ? $d : null;
    return [$valid(trim($_GET['date_from'] ?? '')), $valid(trim($_GET['date_to'] ?? '')), 0];
}

function quarter_select(int $q): string
{
    $html = '<label>ไตรมาส</label><select name="q"><option value="0">ทั้งปี / ตามช่วงวันที่</option>';
    foreach (FISCAL_QUARTERS as $k => $lbl) {
        $html .= '<option value="' . $k . '"' . ($k === $q ? ' selected' : '') . '>' . $lbl . '</option>';
    }
    return $html . '</select>';
}

function current_fiscal_year_be(PDO $pdo): int
{
    $stmt = $pdo->prepare("SELECT value FROM settings WHERE key = 'current_fiscal_year_be'");
    $stmt->execute();
    $v = $stmt->fetchColumn();
    return $v !== false ? (int) $v : fiscal_year_be(date('Y-m-d'));
}

function get_setting(PDO $pdo, string $key, $default = null)
{
    $stmt = $pdo->prepare('SELECT value FROM settings WHERE key = ?');
    $stmt->execute([$key]);
    $v = $stmt->fetchColumn();
    return $v !== false ? $v : $default;
}

function set_setting(PDO $pdo, string $key, $value): void
{
    $pdo->prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value')
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
