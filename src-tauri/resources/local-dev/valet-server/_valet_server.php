<?php
/**
 * Patched Valet/Herd-style request router body.
 *
 * Key Decision 24: all requires use __DIR__ so php-fpm works even when
 * process cwd is not the script directory. FPM pools also set
 * `chdir = …/valet-server` as belt-and-suspenders.
 *
 * Derived from Laravel Valet (MIT) / Laravel Herd valet server.php.
 */

require_once __DIR__ . '/cli/includes/require-drivers.php';
require_once __DIR__ . '/cli/Valet/Server.php';

use Valet\Drivers\ValetDriver;
use Valet\Server;

/**
 * Define the user's valet config path (HERD_HOME contract).
 */
define('VALET_HOME_PATH', $_SERVER['HERD_HOME'] . '/config/valet');
define('VALET_STATIC_PREFIX', '41c270e4-5535-4daa-b23e-c269744c2f45');

/**
 * Load the Valet configuration.
 */
$configFile = VALET_HOME_PATH . '/config.json';
if (! is_readable($configFile)) {
    http_response_code(500);
    echo 'Badami Local Dev: missing valet config at ' . htmlspecialchars($configFile);
    exit(1);
}

$valetConfig = json_decode(file_get_contents($configFile), true);
if (! is_array($valetConfig)) {
    http_response_code(500);
    echo 'Badami Local Dev: invalid valet config.json';
    exit(1);
}

/**
 * If the HTTP_HOST is an IP address, check the start of the REQUEST_URI for a
 * valid hostname, extract and use it as the effective HTTP_HOST in place
 * of the IP. It enables the use of Valet in a local network.
 */
if (Server::hostIsIpAddress($_SERVER['HTTP_HOST'] ?? '')) {
    $uriForIpAddressExtraction = ltrim($_SERVER['REQUEST_URI'] ?? '/', '/');

    if ($host = Server::valetSiteFromIpAddressUri($uriForIpAddressExtraction, $valetConfig['tld'] ?? 'test')) {
        $_SERVER['HTTP_HOST'] = $host;
        $_SERVER['REQUEST_URI'] = str_replace($host, '', $uriForIpAddressExtraction);
    }
}

$server = new Server($valetConfig);

/**
 * Parse the URI and site / host for the incoming request.
 */
$uri = Server::uriFromRequestUri($_SERVER['REQUEST_URI'] ?? '/');
$siteName = $server->siteNameFromHttpHost($_SERVER['HTTP_HOST'] ?? 'localhost');
$valetSitePath = $server->sitePath($siteName);

if (is_null($valetSitePath) && is_null($valetSitePath = $server->defaultSitePath())) {
    Server::show404(
        'The site "' . $siteName . '" could not be found in your parked or linked sites.'
        . '<br>Please ensure that the folder is within your parked paths.'
    );
}

$valetSitePath = realpath($valetSitePath);

/**
 * Find the appropriate Valet driver for the request.
 */
$valetDriver = ValetDriver::assign($valetSitePath, $siteName, $uri);

if (! $valetDriver) {
    Server::show404('Badami Local Dev could not find a valid driver to serve the "' . $siteName . '" project.');
}

/**
 * ngrok uses the X-Original-Host to store the forwarded hostname.
 */
if (isset($_SERVER['HTTP_X_ORIGINAL_HOST']) && ! isset($_SERVER['HTTP_X_FORWARDED_HOST'])) {
    $_SERVER['HTTP_X_FORWARDED_HOST'] = $_SERVER['HTTP_X_ORIGINAL_HOST'];
}

/**
 * Attempt to load server environment variables.
 */
$valetDriver->loadServerEnvironmentVariables(
    $valetSitePath, $siteName
);

/**
 * Allow driver to mutate incoming URL.
 */
$uri = $valetDriver->mutateUri($uri);

/**
 * Determine if the incoming request is for a static file.
 */
$isPhpFile = pathinfo($uri, PATHINFO_EXTENSION) === 'php';

if ($uri !== '/' && ! $isPhpFile && $staticFilePath = $valetDriver->isStaticFile($valetSitePath, $siteName, $uri)) {
    return $valetDriver->serveStaticFile($staticFilePath, $valetSitePath, $siteName, $uri);
}

/**
 * Allow for drivers to take pre-loading actions (e.g. setting server variables).
 */
$valetDriver->beforeLoading($valetSitePath, $siteName, $uri);

/**
 * Attempt to dispatch to a front controller.
 */
$frontControllerPath = $valetDriver->frontControllerPath(
    $valetSitePath, $siteName, $uri
);

if (! $frontControllerPath) {
    if (isset($valetConfig['directory-listing']) && $valetConfig['directory-listing'] == 'on') {
        Server::showDirectoryListing($valetSitePath, $uri);
    }

    Server::show404('Badami Local Dev could not find a valid PHP file to serve the "' . $siteName . '" project.');
}

chdir(dirname($frontControllerPath));

$_SERVER['HERD_SITE_PATH'] = $valetSitePath;

require $frontControllerPath;
