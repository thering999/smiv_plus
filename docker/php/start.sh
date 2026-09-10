#!/bin/sh
# platform อย่าง Render กำหนดพอร์ตผ่าน $PORT — ถ้าไม่มี (dev ในเครื่อง) ใช้ 80 ตามเดิม
PORT="${PORT:-80}"
sed -i "s/Listen 80/Listen ${PORT}/" /etc/apache2/ports.conf
sed -i "s/:80>/:${PORT}>/" /etc/apache2/sites-enabled/000-default.conf
exec apache2-foreground
