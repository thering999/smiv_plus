<?php
function pct($num, $den): float
{
    return $den > 0 ? round($num / $den * 100, 2) : 0.0;
}

function merge_rows_into_bucket(array $rows, array $numericCols, string $groupKey, string $label): array
{
    $bucket = ['group_key' => $groupKey, 'label' => $label, 'ampur_ref' => null];
    foreach ($numericCols as $col) $bucket[$col] = 0;
    foreach ($rows as $r) {
        foreach ($numericCols as $col) $bucket[$col] += (int) $r[$col];
    }
    return $bucket;
}

const TARGET_ACCESS_RATE = 40.0;        // เป้า HDC 2569: อัตราเข้าถึงบริการ >40%
const THRESHOLD_REPEAT_VIOLENCE = 15.0; // อัตราก่อความรุนแรงซ้ำสูงกว่านี้ถือว่าเป็นปัญหา
const THRESHOLD_ZERO_FOLLOWUP = 30.0;   // สัดส่วนไม่เคยติดตามซ้ำสูงกว่านี้ถือว่าเป็นปัญหา

// เกณฑ์เชิงคุณภาพ (6 Building Blocks) ด้านผลกระทบ "การเข้าถึงบริการ" — จากสไลด์กรมสุขภาพจิต
// ระดับ 1-2 เป็นขั้นตอนกระบวนการ (ออกแบบ Template / ขึ้น Dashboard กระทรวง) ไม่ผูกกับ % จึงไม่ประเมินระดับ 1-2 ที่นี่
function quality_level_access(float $ePct): array
{
    if ($ePct >= 40) return ['level' => 5, 'score_range' => '86-100', 'label' => 'ระดับ 5 (ผ่านเกณฑ์ >40%)'];
    if ($ePct >= 35) return ['level' => 4, 'score_range' => '71-85', 'label' => 'ระดับ 4 (>35%)'];
    if ($ePct >= 30) return ['level' => 3, 'score_range' => '56-70', 'label' => 'ระดับ 3 (>30%)'];
    return ['level' => null, 'score_range' => '0-55', 'label' => 'ต่ำกว่าระดับ 3 (<30%) — ยังอยู่ขั้นตอนกระบวนการ (ระดับ 1-2)'];
}

// คะแนนเชิงปริมาณ (1-10) ของตัวชี้วัด G (เข้าถึงบริการต่อเนื่องไม่ก่อซ้ำ) ตามรอบประเมิน 6 เดือน / 10 เดือน
const SCORE_SCALE_6M = [2 => 1, 4 => 2, 6 => 3, 8 => 4, 10 => 5, 12 => 6, 14 => 7, 16 => 8, 18 => 9, 20 => 10];
const SCORE_SCALE_10M = [22 => 1, 24 => 2, 26 => 3, 28 => 4, 30 => 5, 32 => 6, 34 => 7, 36 => 8, 38 => 9, 40 => 10];

function score_quantitative(float $gPct, array $scale): int
{
    $best = 0;
    foreach ($scale as $threshold => $score) {
        if ($gPct >= $threshold) $best = $score;
    }
    return $best;
}

// วิเคราะห์ปัญหาแยกรายพื้นที่ด้วยกฎที่กำหนดชัดเจน (ไม่ใช่ LLM — โปร่งใส ตรวจสอบย้อนกลับได้ทุกข้อสรุป)
function analyze_area(array $r): array
{
    $findings = [];
    $d = $r['d'];
    $repeatRate = pct($r['repeat_violence_count'], $d);
    $zeroFollowRate = pct($r['zero_followup'], $d);

    if ($r['h'] === 0) {
        $findings[] = [
            'level' => 'warn',
            'category' => 'no_population',
            'title' => 'ยังไม่มีข้อมูลประชากร (H)',
            'detail' => 'ไม่สามารถคำนวณอัตราเข้าถึงบริการ (E) และผู้ป่วยประมาณการณ์ (I) ได้ เพราะยังไม่กรอกประชากร 15-60 ปีของพื้นที่นี้',
            'action' => 'กรอกข้อมูลประชากรที่เมนู "ประชากร/ประมาณการณ์"',
        ];
    } elseif ($r['e'] < TARGET_ACCESS_RATE) {
        $findings[] = [
            'level' => 'danger',
            'category' => 'low_access',
            'title' => "อัตราเข้าถึงบริการต่ำกว่าเป้า ({$r['e']}% < " . TARGET_ACCESS_RATE . '%)',
            'detail' => 'จำนวนผู้ป่วย SMI-V ที่ลงทะเบียนแล้ว (D) เทียบกับผู้ป่วยประมาณการณ์ (I) ยังไม่ถึงเป้าหมาย HDC ปีงบ 2569',
            'action' => 'เร่งคัดกรอง 5 สัญญาณเตือน (V-Care) ในพื้นที่ และตรวจสอบว่าส่งข้อมูล 1B030-1B033 เข้า HDC ครบหรือไม่ (มักตกหล่นจากการลงรหัส Z-code ผิดแทน 1B03x — ดูหน้า "คู่มือรหัส")',
        ];
    }

    if ($d > 0 && $repeatRate > THRESHOLD_REPEAT_VIOLENCE) {
        $findings[] = [
            'level' => 'danger',
            'category' => 'high_repeat',
            'title' => "อัตราก่อความรุนแรงซ้ำสูง ({$repeatRate}% ของผู้ป่วย {$r['repeat_violence_count']}/{$d} คน)",
            'detail' => 'ผู้ป่วยกลุ่มนี้เคยถูกลงทะเบียนรหัส SMI-V (1B030-1B033) มากกว่า 1 ครั้ง แปลว่าเกิดเหตุรุนแรงซ้ำหลังติดตามแล้ว',
            'action' => 'จัด Conference ทีมสหวิชาชีพสำหรับเคสกลุ่มนี้ ทำ Individual Care Plan รายบุคคล และเพิ่มความถี่ติดตามเยี่ยมตามระดับความเสี่ยง (สีแดง=ทุก 7 วัน)',
        ];
    }

    if ($d > 0 && $zeroFollowRate > THRESHOLD_ZERO_FOLLOWUP) {
        $findings[] = [
            'level' => 'warn',
            'category' => 'low_followup',
            'title' => "ผู้ป่วยไม่เคยติดตามซ้ำเลยสูง ({$zeroFollowRate}% ของผู้ป่วย {$r['zero_followup']}/{$d} คน)",
            'detail' => 'มารับบริการครั้งแรกแล้วไม่มีการติดตามครั้งถัดไปเลยในข้อมูลที่นำเข้า',
            'action' => 'ประสาน อสม./ทีม รพ.สต. ลงพื้นที่ติดตามเยี่ยมบ้าน และนัดประเมินซ้ำที่สถานบริการ เพื่อให้ครบเกณฑ์ "ติดตามต่อเนื่องอย่างน้อย 2 ครั้ง/ปีงบ"',
        ];
    }

    if (($r['missing_birth'] ?? 0) > 0 || ($r['missing_tambon'] ?? 0) > 0 || ($r['missing_followup'] ?? 0) > 0) {
        $findings[] = [
            'level' => 'info',
            'category' => 'data_quality',
            'title' => 'ข้อมูลไม่ครบถ้วน',
            'detail' => "ไม่มีวันเกิด {$r['missing_birth']} ราย, ไม่มีตำบล {$r['missing_tambon']} ราย, ขาดการติดตาม (follow_last ว่าง) {$r['missing_followup']} ราย",
            'action' => 'ตรวจสอบคุณภาพข้อมูลที่ต้นทาง HIS/43แฟ้ม SPECIALPP ก่อนนำเข้าครั้งถัดไป',
        ];
    }

    if (($r['same_day_followup'] ?? 0) > 0) {
        $findings[] = [
            'level' => 'info',
            'category' => 'same_day',
            'title' => "สงสัยลงรหัสผิด — วันติดตามล่าสุดตรงกับวันแรก ({$r['same_day_followup']} ราย)",
            'detail' => 'follow_last (วันที่ได้รับรหัส 1B037 ล่าสุด) เท่ากับ first_date_serv (วันที่ลงทะเบียน SMI-V ครั้งแรก) ในวันเดียวกัน ซึ่งไม่ควรเกิดขึ้นถ้ามีการติดตามจริงในภายหลัง',
            'action' => 'ตรวจสอบกับหน่วยบริการว่าลงรหัส 1B037 ซ้ำวันเดียวกับ 1B030-1B033 ครั้งแรกโดยไม่ได้ตั้งใจหรือไม่ (ดูหน้า "คู่มือรหัส")',
        ];
    }

    if (!$findings) {
        $findings[] = [
            'level' => 'ok',
            'category' => 'ok',
            'title' => 'ไม่พบปัญหาตามเกณฑ์ที่ตั้งไว้',
            'detail' => 'อัตราเข้าถึงบริการ อัตราก่อซ้ำ และความครบถ้วนของข้อมูล อยู่ในเกณฑ์ที่ยอมรับได้',
            'action' => 'คงมาตรฐานการคัดกรองและติดตามต่อเนื่อง',
        ];
    }
    return $findings;
}

const FINDING_CATEGORY_LABELS = [
    'no_population' => 'ยังไม่มีข้อมูลประชากร',
    'low_access' => 'เข้าถึงบริการต่ำกว่าเป้า',
    'high_repeat' => 'ก่อความรุนแรงซ้ำสูง',
    'low_followup' => 'ไม่เคยติดตามซ้ำสูง',
    'data_quality' => 'ข้อมูลไม่ครบถ้วน',
    'same_day' => 'สงสัยลงรหัสผิด',
    'ok' => 'ไม่พบปัญหา',
];

// นับจำนวนพื้นที่ที่พบปัญหาแต่ละประเภท จาก [['area'=>..,'findings'=>[...]], ...] — ใช้ทำกราฟสรุปแยกประเด็น
function count_findings_by_category(array $areaAnalysis): array
{
    $counts = array_fill_keys(array_keys(FINDING_CATEGORY_LABELS), 0);
    foreach ($areaAnalysis as $item) {
        $seen = [];
        foreach ($item['findings'] as $f) {
            $cat = $f['category'] ?? 'other';
            if (isset($counts[$cat]) && !isset($seen[$cat])) {
                $counts[$cat]++;
                $seen[$cat] = true;
            }
        }
    }
    unset($counts['ok']);
    return array_filter($counts, fn($v) => $v > 0);
}

// รายชื่อผู้ป่วยที่มีปัญหา (สำหรับส่งกลับให้พื้นที่/หน่วยบริการตรวจสอบแก้ไข) — ไม่รวม cid/name เต็ม เพื่อความปลอดภัยข้อมูล ใช้ pid+hoscode ระบุตัวแทน
function get_problem_patients(PDO $pdo, int $fy, string $level = 'ampur', string $areaFilter = '', ?string $dateFrom = null, ?string $dateTo = null): array
{
    $maxAge = max_age_included($pdo);
    $params = ['fy' => $fy, 'max_age' => $maxAge];
    $dateSql = '';
    if ($dateFrom && $dateTo) {
        $dateSql = ' AND p.first_date_serv BETWEEN :date_from AND :date_to';
        $params['date_from'] = $dateFrom;
        $params['date_to'] = $dateTo;
    }
    $areaSql = '';
    if ($areaFilter !== '') {
        $col = $level === 'hoscode' ? 'p.hoscode' : ($level === 'chw_addr' ? 'p.chw_addr' : 'p.ampur');
        $areaSql = " AND $col = :area_filter";
        $params['area_filter'] = $areaFilter;
    }

    $stmt = $pdo->prepare(
        "SELECT p.hoscode, p.hosname, p.pid, p.cid, p.name, p.lname, p.birth, p.sex, p.chw_addr, p.tambon, p.ampur,
                p.first_date_serv, p.date_serv_raw, p.diagcode_raw, p.b03x_raw, p.follow_last,
                p.smiv_code_count, p.has_repeat_violence,
                v.total_visits
         FROM patients p
         JOIN (SELECT patient_id, COUNT(*) total_visits FROM patient_visits GROUP BY patient_id) v ON v.patient_id = p.id
         WHERE p.fiscal_year_be <= :fy
           AND (p.age_at_fy_end IS NULL OR p.age_at_fy_end <= :max_age)
           $dateSql $areaSql
         ORDER BY p.hoscode, p.pid"
    );
    $stmt->execute($params);

    // ปัญหา => คำแนะนำการดำเนินการที่เป็นรูปธรรม (แสดงคู่กันในไฟล์ export ให้พื้นที่ทำงานต่อได้เลย)
    $actionFor = [
        'ก่อความรุนแรงซ้ำ' => 'จัด Conference ทีมสหวิชาชีพ + ทำ Individual Care Plan รายบุคคล เพิ่มความถี่เยี่ยมตามระดับความเสี่ยง',
        'ขาดการติดตาม (follow_last ว่าง)' => 'นัดติดตามอาการ/ลงพื้นที่เยี่ยมบ้านโดยเร็ว และลงรหัส 1B037 เมื่อประเมินแล้ว',
        'ไม่เคยติดตามซ้ำ' => 'ประสาน อสม./รพ.สต. ติดตามเยี่ยมครั้งที่ 2 ให้ครบเกณฑ์ "ติดตามต่อเนื่องอย่างน้อย 2 ครั้ง/ปีงบ"',
        'สงสัยลงรหัสผิด (ติดตาม=วันแรก)' => 'ตรวจสอบกับผู้บันทึกว่าลงรหัส 1B037 ซ้ำวันเดียวกับ 1B030-1B033 ครั้งแรกโดยไม่ได้ตั้งใจหรือไม่ แก้ไขผ่าน Data Correct',
        'ไม่มีวันเกิด' => 'ตรวจสอบและเพิ่มวันเดือนปีเกิดในระบบ HIS ต้นทาง',
        'ไม่มีตำบล' => 'ตรวจสอบและเพิ่มรหัสตำบลที่อยู่ในระบบ HIS ต้นทาง',
    ];

    $out = [];
    foreach ($stmt as $r) {
        $issues = [];
        if ($r['has_repeat_violence']) $issues[] = 'ก่อความรุนแรงซ้ำ';
        if ($r['follow_last'] === null) $issues[] = 'ขาดการติดตาม (follow_last ว่าง)';
        if ((int) $r['total_visits'] === 1) $issues[] = 'ไม่เคยติดตามซ้ำ';
        if ($r['follow_last'] !== null && $r['follow_last'] === $r['first_date_serv']) $issues[] = 'สงสัยลงรหัสผิด (ติดตาม=วันแรก)';
        if ($r['birth'] === null) $issues[] = 'ไม่มีวันเกิด';
        if ($r['tambon'] === null || $r['tambon'] === '') $issues[] = 'ไม่มีตำบล';

        if ($issues) {
            $r['issues'] = implode('; ', $issues);
            $r['recommendations'] = implode(' | ', array_map(fn($i) => $actionFor[$i] ?? '', $issues));
            $r['priority'] = $r['has_repeat_violence'] ? 'สูง' : (count($issues) >= 2 ? 'กลาง' : 'ปกติ');
            $out[] = $r;
        }
    }
    return $out;
}

// เรียก AI ท้องถิ่น (Ollama) ให้สรุปภาพรวมเป็นภาษาไทย ใช้เป็นส่วนเสริมกฎ analyze_area() ไม่ใช่แหล่งความจริงเดียว
// คืนค่า null ถ้าเรียกไม่สำเร็จ (ไม่มี ollama/timeout) — เรียกใช้แบบ fail-soft เสมอ
function ai_summarize(array $totals, string $areaLabel, int $fy, bool $hasPop): ?string
{
    $host = getenv('OLLAMA_HOST') ?: 'http://host.docker.internal:11434';
    $model = getenv('OLLAMA_MODEL') ?: 'qwen2.5-coder:3b';

    $prompt = "คุณเป็นนักวิเคราะห์ข้อมูลสาธารณสุข สรุปสถานการณ์ผู้ป่วย SMI-V (จิตเวชสารเสพติดก่อความรุนแรง) ปีงบประมาณ {$fy} เป็นภาษาไทย 3-4 ประโยค กระชับ ไม่ใช้หัวข้อย่อย จากตัวเลข ({$areaLabel}):\n"
        . "ผู้ป่วยทั้งหมด {$totals['d']} คน (เก่า {$totals['b']} + ใหม่ {$totals['c']})\n"
        . "อัตราเข้าถึงบริการ " . ($hasPop ? number_format($totals['e'], 2) . '%' : 'ยังคำนวณไม่ได้ (ไม่มีข้อมูลประชากร)') . " เป้าหมาย >40%\n"
        . "ผู้ป่วยก่อความรุนแรงซ้ำ {$totals['repeat_violence_count']} คน จาก {$totals['d']} คน\n"
        . "ไม่เคยติดตามซ้ำเลย {$totals['zero_followup']} คน, ขาดการติดตาม (ไม่มีรหัส 1B037) {$totals['missing_followup']} คน\n"
        . "ติดตามครบอย่างน้อย 2 ครั้งและไม่ก่อซ้ำ {$totals['n']} คน\n"
        . 'ให้ระบุจุดที่น่ากังวลที่สุด 1 จุด และข้อเสนอเชิงปฏิบัติ 1 ข้อ ท้ายย่อหน้า';

    $ch = curl_init("$host/api/generate");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_CONNECTTIMEOUT => 2,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS => json_encode([
            'model' => $model,
            'prompt' => $prompt,
            'stream' => false,
        ], JSON_UNESCAPED_UNICODE),
    ]);
    $response = curl_exec($ch);
    $errno = curl_errno($ch);
    curl_close($ch);

    if ($errno || !$response) return null;
    $data = json_decode($response, true);
    return trim($data['response'] ?? '') ?: null;
}

// ข้อมูลเสริมสำหรับกราฟ: สัดส่วนเพศ + แนวโน้มผู้ป่วยใหม่รายเดือน (12 เดือนล่าสุดของปีงบ)
function build_extra_charts(PDO $pdo, int $fy): array
{
    $sexStmt = $pdo->prepare('SELECT sex, COUNT(*) c FROM patients WHERE fiscal_year_be <= ? GROUP BY sex');
    $sexStmt->execute([$fy]);
    $sex = ['ชาย' => 0, 'หญิง' => 0, 'ไม่ระบุ' => 0];
    foreach ($sexStmt as $r) {
        if ((int) $r['sex'] === 1) $sex['ชาย'] += (int) $r['c'];
        elseif ((int) $r['sex'] === 2) $sex['หญิง'] += (int) $r['c'];
        else $sex['ไม่ระบุ'] += (int) $r['c'];
    }

    $ceYearEnd = $fy - 543;
    $rangeStart = date('Y-m-01', strtotime(($ceYearEnd - 1) . '-10-01'));
    $rangeEnd = date('Y-m-t', strtotime($ceYearEnd . '-09-30'));
    $trendStmt = $pdo->prepare(
        "SELECT DATE_FORMAT(first_date_serv, '%Y-%m') AS ym, COUNT(*) c
         FROM patients
         WHERE first_date_serv BETWEEN :start AND :end
         GROUP BY ym ORDER BY ym"
    );
    $trendStmt->execute(['start' => $rangeStart, 'end' => $rangeEnd]);
    $trend = [];
    foreach ($trendStmt as $r) $trend[$r['ym']] = (int) $r['c'];

    return ['sex' => $sex, 'trend' => $trend];
}

const REPORT_LEVELS = [
    'ampur' => 'รายอำเภอ',
    'hoscode' => 'รายหน่วยบริการ',
    'chw_addr' => 'รายจังหวัด (ภูมิลำเนาผู้ป่วย)',
];

// คำนวณตารางรายงาน SMI-V สำหรับปีงบที่กำหนด แยกตามระดับพื้นที่ที่เลือก
// $level: 'ampur' (อำเภอ, มาตรฐาน HDC — มีประชากร H/I), 'hoscode' (หน่วยบริการ), 'chw_addr' (จังหวัดภูมิลำเนาผู้ป่วย)
// คืนค่า ['report' => [...แต่ละพื้นที่...], 'totals' => [...รวม...], 'level' => string]
function build_smiv_report(PDO $pdo, int $fy, string $level = 'ampur', ?string $dateFrom = null, ?string $dateTo = null): array
{
    if (!isset(REPORT_LEVELS[$level])) $level = 'ampur';
    $maxAge = max_age_included($pdo);

    $groupCol = $level === 'hoscode' ? 'p.hoscode' : ($level === 'chw_addr' ? 'p.chw_addr' : 'p.ampur');
    $labelCol = $level === 'hoscode' ? 'MAX(p.hosname)' : ($level === 'chw_addr' ? "CONCAT('จังหวัดรหัส ', p.chw_addr)" : 'p.ampur');
    // ใช้ระบุอำเภอตัวแทนของกลุ่ม เพื่อจับคู่ข้อมูลประชากร (มีความหมายเฉพาะระดับ ampur/hoscode)
    $ampurRefCol = $level === 'hoscode' ? 'MIN(p.ampur)' : ($level === 'chw_addr' ? "''" : 'p.ampur');

    $params = ['fy1' => $fy, 'fy2' => $fy, 'fy3' => $fy, 'max_age' => $maxAge];
    $dateFilterSql = '';
    if ($dateFrom && $dateTo) {
        $dateFilterSql = ' AND p.first_date_serv BETWEEN :date_from AND :date_to';
        $params['date_from'] = $dateFrom;
        $params['date_to'] = $dateTo;
    }

    $stmt = $pdo->prepare(
        "SELECT $groupCol AS group_key, $labelCol AS label, $ampurRefCol AS ampur_ref,
            SUM(p.fiscal_year_be < :fy1) AS b,
            SUM(p.fiscal_year_be = :fy2) AS c,
            COUNT(*) AS d,
            SUM(NOT p.has_repeat_violence) AS f,
            SUM(v.total_visits = 2) AS j,
            SUM(v.total_visits = 2 AND NOT p.has_repeat_violence) AS k,
            SUM(v.total_visits >= 3) AS m,
            SUM(v.total_visits >= 3 AND NOT p.has_repeat_violence) AS n,
            SUM(v.total_visits = 1) AS zero_followup,
            SUM(p.has_repeat_violence) AS repeat_violence_count,
            SUM(p.birth IS NULL) AS missing_birth,
            SUM(p.tambon IS NULL OR p.tambon = '') AS missing_tambon,
            SUM(p.follow_last IS NULL) AS missing_followup,
            SUM(p.follow_last IS NOT NULL AND p.follow_last = p.first_date_serv) AS same_day_followup
         FROM patients p
         JOIN (
            SELECT patient_id, COUNT(*) total_visits
            FROM patient_visits GROUP BY patient_id
         ) v ON v.patient_id = p.id
         WHERE p.fiscal_year_be <= :fy3
           AND (p.age_at_fy_end IS NULL OR p.age_at_fy_end <= :max_age)
           $dateFilterSql
         GROUP BY $groupCol
         ORDER BY d DESC"
    );
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    $popStmt = $pdo->prepare('SELECT ampur, ampur_name, population_15_60 FROM population_estimates WHERE fiscal_year_be = ?');
    $popStmt->execute([$fy]);
    $pop = [];
    foreach ($popStmt as $p) $pop[$p['ampur']] = $p;

    // รวมกลุ่มที่ไม่ใช่พื้นที่หลักเป็น "อื่นๆ" เพื่อไม่ให้กราฟรกด้วย code แปลกปลอม/จำนวนน้อย
    $numericCols = ['b', 'c', 'd', 'f', 'j', 'k', 'm', 'n', 'zero_followup', 'repeat_violence_count', 'missing_birth', 'missing_tambon', 'missing_followup', 'same_day_followup'];
    if ($level === 'ampur') {
        $known = $unknown = [];
        foreach ($rows as $r) {
            if (isset($pop[$r['ampur_ref']])) $known[] = $r; else $unknown[] = $r;
        }
        $rows = $known;
        if ($unknown) $rows[] = merge_rows_into_bucket($unknown, $numericCols, 'other', 'อื่นๆ (นอกอำเภอ/ข้อมูลนอกพื้นที่)');
    } elseif ($level === 'chw_addr') {
        usort($rows, fn($a, $b) => $b['d'] <=> $a['d']);
        $keep = array_slice($rows, 0, 8);
        $rest = array_slice($rows, 8);
        $rows = $keep;
        if ($rest) $rows[] = merge_rows_into_bucket($rest, $numericCols, 'other', 'อื่นๆ (จังหวัดอื่น)');
    }

    $report = [];
    $totals = [
        'b' => 0, 'c' => 0, 'd' => 0, 'f' => 0, 'j' => 0, 'k' => 0, 'm' => 0, 'n' => 0, 'h' => 0, 'i' => 0,
        'zero_followup' => 0, 'repeat_violence_count' => 0, 'missing_birth' => 0, 'missing_tambon' => 0, 'missing_followup' => 0, 'same_day_followup' => 0,
    ];
    $hasPopulationData = false;
    foreach ($rows as $r) {
        $h = 0;
        $ampurName = null;
        if ($level !== 'chw_addr') {
            $popRow = $pop[$r['ampur_ref']] ?? null;
            $h = $popRow ? (int) $popRow['population_15_60'] : 0;
            $ampurName = $popRow['ampur_name'] ?? null;
        }
        $i = $h > 0 ? estimate_smiv_patients($pdo, $h) : 0;
        if ($h > 0) $hasPopulationData = true;

        $label = $level === 'ampur' ? ($ampurName ?: $r['label']) : $r['label'];
        $line = [
            'group_key' => $r['group_key'],
            'ampur' => $r['group_key'],
            'ampur_name' => $label,
            'b' => (int) $r['b'], 'c' => (int) $r['c'], 'd' => (int) $r['d'],
            'e' => pct($r['d'], $i),
            'f' => (int) $r['f'],
            'h' => $h,
            'i' => $i,
            'j' => (int) $r['j'], 'k' => (int) $r['k'], 'l' => pct($r['k'], $i),
            'm' => (int) $r['m'], 'n' => (int) $r['n'], 'o' => pct($r['n'], $i),
            'zero_followup' => (int) $r['zero_followup'],
            'repeat_violence_count' => (int) $r['repeat_violence_count'],
            'missing_birth' => (int) $r['missing_birth'],
            'missing_tambon' => (int) $r['missing_tambon'],
            'missing_followup' => (int) $r['missing_followup'],
            'same_day_followup' => (int) $r['same_day_followup'],
        ];
        $line['g'] = $line['o'];
        $report[] = $line;
        foreach (['b', 'c', 'd', 'f', 'j', 'k', 'm', 'n', 'zero_followup', 'repeat_violence_count', 'missing_birth', 'missing_tambon', 'missing_followup', 'same_day_followup'] as $key) {
            $totals[$key] += $line[$key];
        }
        $totals['h'] += $line['h'];
        $totals['i'] += $line['i'];
    }
    $totals['e'] = pct($totals['d'], $totals['i']);
    $totals['l'] = pct($totals['k'], $totals['i']);
    $totals['o'] = pct($totals['n'], $totals['i']);
    $totals['g'] = $totals['o'];

    return [
        'report' => $report,
        'totals' => $totals,
        'max_age' => $maxAge,
        'level' => $level,
        'has_population_data' => $hasPopulationData,
        'date_from' => $dateFrom,
        'date_to' => $dateTo,
    ];
}
