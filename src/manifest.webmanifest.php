<?php
require_once __DIR__ . '/config/base_path.php';
header('Content-Type: application/manifest+json');

$manifest = [
    'name' => 'SMI-V Plus',
    'short_name' => 'SMI-V Plus',
    'description' => 'ร้อยละผู้ป่วยจิตเวชสารเสพติดก่อความรุนแรง',
    'start_url' => url('/index.php'),
    'scope' => url('/'),
    'display' => 'standalone',
    'background_color' => '#f0f4f9',
    'theme_color' => '#2c6e91',
    'lang' => 'th',
    'icons' => [
        [
            'src' => url('/assets/icons/icon-192.svg'),
            'sizes' => '192x192',
            'type' => 'image/svg+xml',
            'purpose' => 'any maskable',
        ],
        [
            'src' => url('/assets/icons/icon-512.svg'),
            'sizes' => '512x512',
            'type' => 'image/svg+xml',
            'purpose' => 'any maskable',
        ],
    ],
];

echo json_encode($manifest, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
