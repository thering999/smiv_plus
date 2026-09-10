<?php
define('CACHE_DIR', sys_get_temp_dir() . '/smiv_cache');

function cache_get(string $key)
{
    $file = CACHE_DIR . '/' . preg_replace('/[^a-zA-Z0-9_\-]/', '_', $key) . '.json';
    if (!is_file($file)) return null;

    $raw = file_get_contents($file);
    $data = json_decode($raw, true);
    if (!is_array($data) || !isset($data['expires'], $data['value'])) return null;
    if ($data['expires'] < time()) {
        @unlink($file);
        return null;
    }
    return $data['value'];
}

function cache_set(string $key, $value, int $ttlSeconds = 300): void
{
    if (!is_dir(CACHE_DIR)) {
        @mkdir(CACHE_DIR, 0775, true);
    }
    $file = CACHE_DIR . '/' . preg_replace('/[^a-zA-Z0-9_\-]/', '_', $key) . '.json';
    $data = ['expires' => time() + $ttlSeconds, 'value' => $value];
    file_put_contents($file, json_encode($data, JSON_UNESCAPED_UNICODE), LOCK_EX);
}

function cache_clear_all(): void
{
    if (!is_dir(CACHE_DIR)) return;
    foreach (glob(CACHE_DIR . '/*.json') as $file) {
        @unlink($file);
    }
}
