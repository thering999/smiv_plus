<?php
// นำเข้า exchange_file.xlsx (sheet "Data") -> patients + patient_visits
// คอลัมน์: hoscode,hosname,pid,cid,name,lname,birth,sex,chw_addr,tambon,ampur,
//          first_date_serv,date_serv,diagcode,b03x,follow_last
// date_serv คั่นด้วย "|" = วันที่มารับบริการแต่ละครั้ง (ใช้นับจำนวนครั้งติดตาม J/M)
// b03x คั่นด้วย "|" = รหัส SMI-V (1B030-1B033) ที่เคยถูกลงทะเบียนสะสม (ไม่ใช่รายครั้งของ date_serv)
//   ตามนิยาม HDC: ถ้ามีมากกว่า 1 entry = เคย "ก่อความรุนแรงซ้ำ" (ครั้งถัดจากครั้งแรกคือการก่อซ้ำ)
//   ครั้งที่ติดตามแล้วไม่ก่อซ้ำจะลงรหัสร่วมกับ 1B037 แยกต่างหาก ไม่เพิ่ม entry ใน b03x

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/../config/settings.php';

use PhpOffice\PhpSpreadsheet\IOFactory;

const EXPECTED_HEADERS = [
    'A' => 'hoscode', 'B' => 'hosname', 'C' => 'pid', 'D' => 'cid', 'E' => 'name',
    'F' => 'lname', 'G' => 'birth', 'H' => 'sex', 'I' => 'chw_addr', 'J' => 'tambon',
    'K' => 'ampur', 'L' => 'first_date_serv', 'M' => 'date_serv', 'N' => 'diagcode',
    'O' => 'b03x', 'P' => 'follow_last',
];

function validate_smiv_sheet(\PhpOffice\PhpSpreadsheet\Worksheet\Worksheet $sheet): array
{
    $errors = [];
    foreach (EXPECTED_HEADERS as $col => $expected) {
        $actual = trim((string) $sheet->getCell($col . '1')->getValue());
        if ($actual !== $expected) {
            $errors[] = "หัวคอลัมน์ $col ต้องเป็น '$expected' แต่พบ '$actual'";
        }
    }
    if ($errors) return $errors;

    $highestRow = $sheet->getHighestRow();
    if ($highestRow < 2) {
        $errors[] = 'ชีต Data ไม่มีข้อมูล (แถวว่าง)';
        return $errors;
    }
    for ($r = 2; $r <= $highestRow; $r++) {
        $hoscode = trim((string) $sheet->getCell("A$r")->getValue());
        if ($hoscode === '') continue;
        $pid = trim((string) $sheet->getCell("C$r")->getValue());
        $ampur = trim((string) $sheet->getCell("K$r")->getValue());
        $firstDate = trim((string) $sheet->getCell("L$r")->getValue());
        if ($pid === '') $errors[] = "แถว $r: ไม่มี pid";
        if ($ampur === '') $errors[] = "แถว $r: ไม่มี ampur";
        if ($firstDate === '' || !strtotime($firstDate)) $errors[] = "แถว $r: first_date_serv '$firstDate' อ่านเป็นวันที่ไม่ได้";
    }
    return $errors;
}

function parse_dates_pipe(string $raw): array
{
    $out = [];
    foreach (explode('|', $raw) as $part) {
        $part = trim($part);
        if ($part === '' || $part === 'NULL' || !strtotime($part)) continue;
        $out[] = date('Y-m-d', strtotime($part));
    }
    return $out;
}

function parse_codes_pipe(string $raw): array
{
    $out = [];
    foreach (explode('|', $raw) as $part) {
        $part = trim($part);
        if ($part === '' || $part === 'NULL') continue;
        $out[] = $part;
    }
    return $out;
}

function age_at(string $birthYmd, string $atYmd): int
{
    $birth = new DateTime($birthYmd);
    $at = new DateTime($atYmd);
    return (int) $birth->diff($at)->y;
}

// นำเข้าไฟล์ xlsx เข้า DB ในธุรกรรมเดียว คืนค่า ['row_count' => int, 'batch_id' => int]
function import_smiv_file(PDO $pdo, string $filePath, string $originalName, ?int $userId): array
{
    $spreadsheet = IOFactory::load($filePath);
    $sheet = $spreadsheet->getSheetByName('Data') ?? $spreadsheet->getActiveSheet();

    $errors = validate_smiv_sheet($sheet);
    if ($errors) {
        throw new InvalidArgumentException(implode("\n", $errors));
    }

    $highestRow = $sheet->getHighestRow();

    $pdo->beginTransaction();
    try {
        $pdo->prepare('INSERT INTO import_batches (filename, imported_by, row_count) VALUES (?, ?, 0)')
            ->execute([$originalName, $userId]);
        $batchId = (int) $pdo->lastInsertId();

        $insertPatient = $pdo->prepare(
            'INSERT INTO patients
                (import_batch_id, hoscode, hosname, pid, cid, name, lname, birth, sex, chw_addr, tambon, ampur,
                 first_date_serv, date_serv_raw, diagcode_raw, b03x_raw, follow_last, fiscal_year_be,
                 smiv_code_count, has_repeat_violence, age_at_fy_end)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT (hoscode, pid) DO UPDATE SET
                import_batch_id = EXCLUDED.import_batch_id, hosname = EXCLUDED.hosname, cid = EXCLUDED.cid,
                name = EXCLUDED.name, lname = EXCLUDED.lname, birth = EXCLUDED.birth, sex = EXCLUDED.sex,
                chw_addr = EXCLUDED.chw_addr, tambon = EXCLUDED.tambon, ampur = EXCLUDED.ampur,
                first_date_serv = EXCLUDED.first_date_serv, date_serv_raw = EXCLUDED.date_serv_raw,
                diagcode_raw = EXCLUDED.diagcode_raw, b03x_raw = EXCLUDED.b03x_raw,
                follow_last = EXCLUDED.follow_last, fiscal_year_be = EXCLUDED.fiscal_year_be,
                smiv_code_count = EXCLUDED.smiv_code_count, has_repeat_violence = EXCLUDED.has_repeat_violence,
                age_at_fy_end = EXCLUDED.age_at_fy_end'
        );
        $selectPatientId = $pdo->prepare('SELECT id FROM patients WHERE hoscode = ? AND pid = ?');
        $deleteVisits = $pdo->prepare('DELETE FROM patient_visits WHERE patient_id = ?');
        $insertVisit = $pdo->prepare('INSERT INTO patient_visits (patient_id, seq, visit_date) VALUES (?,?,?)');

        $rowCount = 0;
        for ($r = 2; $r <= $highestRow; $r++) {
            $hoscode = trim((string) $sheet->getCell("A$r")->getValue());
            if ($hoscode === '') continue;

            $birthRaw = trim((string) $sheet->getCell("G$r")->getValue());
            $followLastRaw = trim((string) $sheet->getCell("P$r")->getValue());
            $firstDateServ = date('Y-m-d', strtotime((string) $sheet->getCell("L$r")->getValue()));
            $fy = fiscal_year_be($firstDateServ);
            $birth = ($birthRaw !== '' && strtotime($birthRaw)) ? date('Y-m-d', strtotime($birthRaw)) : null;
            $ageAtFyEnd = $birth ? age_at($birth, fiscal_year_end_date($fy)) : null;

            $b03xCodes = parse_codes_pipe(trim((string) $sheet->getCell("O$r")->getValue()));
            $smivCodeCount = count($b03xCodes);
            $hasRepeatViolence = $smivCodeCount > 1 ? 1 : 0;

            $insertPatient->execute([
                $batchId,
                $hoscode,
                trim((string) $sheet->getCell("B$r")->getValue()),
                trim((string) $sheet->getCell("C$r")->getValue()),
                trim((string) $sheet->getCell("D$r")->getValue()),
                trim((string) $sheet->getCell("E$r")->getValue()),
                trim((string) $sheet->getCell("F$r")->getValue()),
                $birth,
                (int) $sheet->getCell("H$r")->getValue() ?: null,
                trim((string) $sheet->getCell("I$r")->getValue()) ?: null,
                trim((string) $sheet->getCell("J$r")->getValue()) ?: null,
                trim((string) $sheet->getCell("K$r")->getValue()),
                $firstDateServ,
                trim((string) $sheet->getCell("M$r")->getValue()),
                trim((string) $sheet->getCell("N$r")->getValue()),
                trim((string) $sheet->getCell("O$r")->getValue()),
                ($followLastRaw !== '' && strtotime($followLastRaw)) ? date('Y-m-d', strtotime($followLastRaw)) : null,
                $fy,
                $smivCodeCount,
                $hasRepeatViolence,
                $ageAtFyEnd,
            ]);

            $selectPatientId->execute([$hoscode, trim((string) $sheet->getCell("C$r")->getValue())]);
            $patientId = (int) $selectPatientId->fetchColumn();

            $dates = parse_dates_pipe(trim((string) $sheet->getCell("M$r")->getValue()));
            $deleteVisits->execute([$patientId]);
            foreach ($dates as $i => $visitDate) {
                $insertVisit->execute([$patientId, $i + 1, $visitDate]);
            }

            $rowCount++;
        }

        $pdo->prepare('UPDATE import_batches SET row_count = ? WHERE id = ?')->execute([$rowCount, $batchId]);
        $pdo->commit();

        return ['row_count' => $rowCount, 'batch_id' => $batchId];
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}
