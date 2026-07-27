<?php
/**
 * Badami Local Dev front controller wrapper.
 *
 * Sets HERD_HOME (Valet contract) to the local-dev root when nginx/FPM
 * did not inject it, then loads the patched Valet body.
 *
 * Layout:
 *   {HERD_HOME}/config/valet/config.json   ← parks / links / tld
 *   {HERD_HOME}/valet-server/server.php    ← this file
 */

if (empty($_SERVER['HERD_HOME'])) {
    // valet-server is a child of the local-dev (HERD_HOME) root
    $_SERVER['HERD_HOME'] = dirname(__DIR__);
}

require __DIR__ . '/_valet_server.php';
