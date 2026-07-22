<?php
/**
 * Load Valet drivers. Paths are __DIR__-relative (Key Decision 24).
 */

require_once __DIR__ . '/../Valet/Drivers/ValetDriver.php';

$driversDir = __DIR__ . '/../Valet/Drivers';
foreach (scandir($driversDir) as $file) {
    $path = $driversDir . '/' . $file;
    if (substr($file, 0, 1) !== '.' && ! is_dir($path)) {
        require_once $path;
    }
}
