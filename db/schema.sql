-- smiv_plus: schema
-- ร้อยละผู้ป่วยจิตเวชสารเสพติดก่อความรุนแรง (SMI-V) เข้าถึงบริการ ได้รับการดูแลต่อเนื่อง ไม่ก่อความรุนแรงซ้ำ

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    role ENUM('admin', 'viewer') NOT NULL DEFAULT 'viewer',
    failed_attempts INT NOT NULL DEFAULT 0,
    locked_until DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS import_batches (
    id INT AUTO_INCREMENT PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    imported_by INT NULL,
    row_count INT NOT NULL DEFAULT 0,
    imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (imported_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ข้อมูลผู้ป่วยดิบจาก exchange_file.xlsx (รายเดียวต่อแถว, latest import ทับแถวเดิมด้วย hoscode+pid)
-- นิยาม "ก่อความรุนแรงซ้ำ" (ยืนยันจากเอกสาร HDC Template): ไม่มี ICD code แยก
-- แต่คือผู้ป่วยที่ถูกลงรหัส b03x (1B030-1B033) มากกว่า 1 ครั้ง (ครั้งถัดจากครั้งแรก = ก่อซ้ำ)
-- ครั้งที่ติดตามแล้วไม่ก่อซ้ำ จะลงรหัสร่วมกับ 1B037 แทน จึงนับจำนวน entry ใน b03x_raw ได้ตรง ๆ
CREATE TABLE IF NOT EXISTS patients (
    id INT AUTO_INCREMENT PRIMARY KEY,
    import_batch_id INT NULL,
    hoscode VARCHAR(20) NOT NULL,
    hosname VARCHAR(255) NOT NULL,
    pid VARCHAR(30) NOT NULL,
    cid VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    lname VARCHAR(100) NOT NULL,
    birth DATE NULL,
    sex TINYINT NULL,
    chw_addr VARCHAR(10) NULL,
    tambon VARCHAR(10) NULL,
    ampur VARCHAR(10) NOT NULL,
    first_date_serv DATE NOT NULL,
    date_serv_raw VARCHAR(500) NOT NULL,
    diagcode_raw VARCHAR(500) NOT NULL,
    b03x_raw VARCHAR(200) NOT NULL,
    follow_last DATE NULL,
    fiscal_year_be INT NOT NULL,
    smiv_code_count INT NOT NULL DEFAULT 0,
    has_repeat_violence TINYINT(1) NOT NULL DEFAULT 0,
    age_at_fy_end INT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_patient (hoscode, pid),
    FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE SET NULL,
    INDEX idx_ampur_fy (ampur, fiscal_year_be)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- แยกรายครั้งที่มารับบริการ (จาก date_serv_raw ที่คั่นด้วย |) เพื่อนับจำนวนครั้งติดตาม (J/M)
CREATE TABLE IF NOT EXISTS patient_visits (
    id INT AUTO_INCREMENT PRIMARY KEY,
    patient_id INT NOT NULL,
    seq INT NOT NULL,
    visit_date DATE NOT NULL,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    INDEX idx_patient (patient_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ประชากรกลางปี (15-60 ปี ย้อนหลัง 2 ปี) ต่อปีงบ/อำเภอ — ไม่ได้มาจากไฟล์นำเข้า กรอกเองในระบบ
-- ผู้ป่วยประมาณการณ์ (I) คำนวณอัตโนมัติจาก H ด้วยสูตร: I = H * smi_prevalence_pct/100 * smiv_ratio_pct/100
CREATE TABLE IF NOT EXISTS population_estimates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    fiscal_year_be INT NOT NULL,
    ampur VARCHAR(10) NOT NULL,
    ampur_name VARCHAR(100) NOT NULL,
    population_15_60 INT NOT NULL DEFAULT 0,
    updated_by INT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_fy_ampur (fiscal_year_be, ampur),
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS settings (
    `key` VARCHAR(100) PRIMARY KEY,
    `value` TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ค่าความชุก (Prevalence) ตามระบาดวิทยาสุขภาพจิต 2566 ที่ HDC ใช้คำนวณ I ทั่วประเทศ
-- ปรับได้หากกรมสุขภาพจิตประกาศตัวเลขใหม่
INSERT INTO settings (`key`, `value`) VALUES
    ('smi_prevalence_pct', '4.37'),
    ('smiv_ratio_pct', '11.92'),
    ('current_fiscal_year_be', '2569'),
    ('max_age_included', '60')
ON DUPLICATE KEY UPDATE `key` = `key`;

CREATE TABLE IF NOT EXISTS audit_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    action VARCHAR(100) NOT NULL,
    detail TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- สร้างผู้ใช้ admin คนแรกด้วย: docker compose exec web php bin/create_admin.php <username> <password>
