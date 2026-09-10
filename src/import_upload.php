<?php
require __DIR__ . '/config/base_path.php';
require __DIR__ . '/includes/session_start.php';
require __DIR__ . '/includes/csrf.php';
require __DIR__ . '/config/db.php';
require __DIR__ . '/includes/require_login.php';
require_admin();
require __DIR__ . '/import/importer.php';

$message = '';
$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    verify_csrf();
    if (empty($_FILES['xlsx']) || $_FILES['xlsx']['error'] !== UPLOAD_ERR_OK) {
        $error = 'กรุณาเลือกไฟล์ .xlsx ที่ถูกต้อง';
    } else {
        $tmpPath = $_FILES['xlsx']['tmp_name'];
        $originalName = basename($_FILES['xlsx']['name']);
        if (!preg_match('/\.xlsx$/i', $originalName)) {
            $error = 'รองรับเฉพาะไฟล์ .xlsx';
        } else {
            try {
                $result = import_smiv_file($pdo, $tmpPath, $originalName, $_SESSION['user_id']);
                $pdo->prepare('INSERT INTO audit_log (user_id, action, detail) VALUES (?, ?, ?)')
                    ->execute([$_SESSION['user_id'], 'import', "นำเข้า {$originalName} จำนวน {$result['row_count']} แถว (batch #{$result['batch_id']})"]);
                $message = "นำเข้าสำเร็จ {$result['row_count']} แถว";
            } catch (InvalidArgumentException $e) {
                $error = "ไฟล์ไม่ถูกต้อง:\n" . $e->getMessage();
            } catch (Throwable $e) {
                $error = 'นำเข้าล้มเหลว: ' . $e->getMessage();
            }
        }
    }
}

$pageTitle = 'นำเข้า Excel - SMI-V Plus';
require __DIR__ . '/includes/header.php';
?>
<h1>นำเข้าข้อมูลจาก Excel (exchange_file.xlsx)</h1>
<p>ไฟล์ต้องมีชีตชื่อ <code>Data</code> หัวคอลัมน์ A-P ตรงตามรูปแบบมาตรฐาน HDC (hoscode, hosname, pid, cid, name, lname, birth, sex, chw_addr, tambon, ampur, first_date_serv, date_serv, diagcode, b03x, follow_last)</p>

<?php if ($message): ?><div class="alert alert-success"><?= htmlspecialchars($message) ?></div><?php endif; ?>
<?php if ($error): ?><div class="alert"><pre><?= htmlspecialchars($error) ?></pre></div><?php endif; ?>

<form method="post" enctype="multipart/form-data" class="card">
  <?= csrf_field() ?>
  <label>ไฟล์ .xlsx</label>
  <input type="file" name="xlsx" accept=".xlsx" required>
  <button type="submit">นำเข้าข้อมูล</button>
</form>

<h2>ประวัตินำเข้าล่าสุด</h2>
<table class="report-table">
  <thead><tr><th>วันที่</th><th>ไฟล์</th><th>จำนวนแถว</th></tr></thead>
  <tbody>
  <?php
  $stmt = $pdo->query('SELECT filename, row_count, imported_at FROM import_batches ORDER BY id DESC LIMIT 20');
  foreach ($stmt as $b): ?>
    <tr>
      <td><?= htmlspecialchars($b['imported_at']) ?></td>
      <td><?= htmlspecialchars($b['filename']) ?></td>
      <td><?= (int) $b['row_count'] ?></td>
    </tr>
  <?php endforeach; ?>
  </tbody>
</table>
<?php require __DIR__ . '/includes/footer.php'; ?>
