<?php
if (!defined('BASE_PATH')) {
    define('BASE_PATH', rtrim(getenv('APP_BASE_PATH') ?: '', '/'));
}

function url(string $path): string
{
    return BASE_PATH . $path;
}
