<?php
header('Content-Type: text/plain; charset=utf-8');
header('Access-Control-Allow-Origin: *');
$ok = is_writable(__DIR__ . '/data');
echo $ok ? "Ironfall server OK\n" : "Ironfall server: folderul data/ nu are drept de scriere\n";
echo "PHP " . PHP_VERSION . "\n"; echo "versiune server: 2\n";
