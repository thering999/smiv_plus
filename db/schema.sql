-- smiv_plus: schema (PostgreSQL)
-- ร้อยละผู้ป่วยจิตเวชสารเสพติดก่อความรุนแรง (SMI-V) เข้าถึงบริการ ได้รับการดูแลต่อเนื่อง ไม่ก่อความรุนแรงซ้ำ

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    role VARCHAR(10) NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'viewer')),
    failed_attempts INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS import_batches (
    id SERIAL PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    imported_by INT NULL REFERENCES users(id) ON DELETE SET NULL,
    row_count INT NOT NULL DEFAULT 0,
    imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ข้อมูลผู้ป่วยดิบจาก exchange_file.xlsx (รายเดียวต่อแถว, latest import ทับแถวเดิมด้วย hoscode+pid)
-- นิยาม "ก่อความรุนแรงซ้ำ" (ยืนยันจากเอกสาร HDC Template): ไม่มี ICD code แยก
-- แต่คือผู้ป่วยที่ถูกลงรหัส b03x (1B030-1B033) มากกว่า 1 ครั้ง (ครั้งถัดจากครั้งแรก = ก่อซ้ำ)
-- ครั้งที่ติดตามแล้วไม่ก่อซ้ำ จะลงรหัสร่วมกับ 1B037 แทน จึงนับจำนวน entry ใน b03x_raw ได้ตรง ๆ
CREATE TABLE IF NOT EXISTS patients (
    id SERIAL PRIMARY KEY,
    import_batch_id INT NULL REFERENCES import_batches(id) ON DELETE SET NULL,
    hoscode VARCHAR(20) NOT NULL,
    hosname VARCHAR(255) NOT NULL,
    pid VARCHAR(30) NOT NULL,
    cid VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    lname VARCHAR(100) NOT NULL,
    birth DATE NULL,
    sex SMALLINT NULL,
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
    has_repeat_violence BOOLEAN NOT NULL DEFAULT FALSE,
    age_at_fy_end INT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (hoscode, pid)
);
CREATE INDEX IF NOT EXISTS idx_ampur_fy ON patients (ampur, fiscal_year_be);
DROP TRIGGER IF EXISTS trg_patients_updated_at ON patients;
CREATE TRIGGER trg_patients_updated_at BEFORE UPDATE ON patients
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- แยกรายครั้งที่มารับบริการ (จาก date_serv_raw ที่คั่นด้วย |) เพื่อนับจำนวนครั้งติดตาม (J/M)
CREATE TABLE IF NOT EXISTS patient_visits (
    id SERIAL PRIMARY KEY,
    patient_id INT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    seq INT NOT NULL,
    visit_date DATE NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_patient ON patient_visits (patient_id);

-- ประชากรกลางปี (15-60 ปี ย้อนหลัง 2 ปี) ต่อปีงบ/อำเภอ — ไม่ได้มาจากไฟล์นำเข้า กรอกเองในระบบ
-- ผู้ป่วยประมาณการณ์ (I) คำนวณอัตโนมัติจาก H ด้วยสูตร: I = H * smi_prevalence_pct/100 * smiv_ratio_pct/100
CREATE TABLE IF NOT EXISTS population_estimates (
    id SERIAL PRIMARY KEY,
    fiscal_year_be INT NOT NULL,
    ampur VARCHAR(10) NOT NULL,
    ampur_name VARCHAR(100) NOT NULL,
    population_15_60 INT NOT NULL DEFAULT 0,
    updated_by INT NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (fiscal_year_be, ampur)
);
DROP TRIGGER IF EXISTS trg_population_updated_at ON population_estimates;
CREATE TRIGGER trg_population_updated_at BEFORE UPDATE ON population_estimates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL
);

-- ค่าความชุก (Prevalence) ตามระบาดวิทยาสุขภาพจิต 2566 ที่ HDC ใช้คำนวณ I ทั่วประเทศ
-- ปรับได้หากกรมสุขภาพจิตประกาศตัวเลขใหม่
INSERT INTO settings (key, value) VALUES
    ('smi_prevalence_pct', '4.37'),
    ('smiv_ratio_pct', '11.92'),
    ('current_fiscal_year_be', '2569'),
    ('max_age_included', '60')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    user_id INT NULL REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    detail TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- สร้างผู้ใช้ admin คนแรกด้วย: docker compose exec web php bin/create_admin.php <username> <password>
