FROM php:8.2-apache-bookworm

RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y libzip-dev zip unzip libpng-dev libjpeg62-turbo-dev libpq-dev \
    && docker-php-ext-configure gd --with-jpeg \
    && docker-php-ext-install pdo pdo_pgsql zip gd \
    && a2enmod rewrite \
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
COPY docker/php/uploads.ini /usr/local/etc/php/conf.d/uploads.ini
COPY docker/php/alias.conf /etc/apache2/conf-enabled/alias.conf
COPY docker/php/start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh

WORKDIR /var/www/html

# ฝัง source + ติดตั้ง dependency ไว้ใน image เอง (สำหรับ deploy บน platform ที่ไม่มี bind mount เช่น Railway/Render)
# ตอน dev ในเครื่อง docker-compose.yml จะ bind mount ./src ทับ path นี้อีกที ไม่กระทบกัน
COPY src/ /var/www/html/
RUN composer install --no-dev --optimize-autoloader --no-interaction \
    && chown -R www-data:www-data /var/www/html

CMD ["/usr/local/bin/start.sh"]
