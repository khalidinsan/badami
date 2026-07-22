# valet-server pack contents (MVP Phase A)

```
valet-server/
  server.php                 # HERD_HOME default + require _valet_server.php
  _valet_server.php          # patched router (__DIR__ requires)
  THIRD_PARTY_VALET.md       # MIT attribution
  INCLUDED.md                # this file
  cli/
    includes/require-drivers.php
    templates/404.php
    Valet/
      Server.php
      Drivers/
        ValetDriver.php
        BasicValetDriver.php
        BasicWithPublicValetDriver.php
        LaravelValetDriver.php
        Specific/*.php       # ecosystem drivers (WP, Symfony, …)
```

**Not shipped:** Composer `vendor/`, Valet CLI management code, Adminer,
Herd dump/profiler assets, njs maps.
