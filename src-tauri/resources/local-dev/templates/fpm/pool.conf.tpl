; Badami Local Dev — PHP-FPM pool for {{PHP_VERSION}}
; Generated; regenerate via ld_generate_configs.
; Key Decision 24: chdir MUST be valet-server so relative requires work.
; Path values are quoted (Application Support has spaces).

[global]
pid = "{{PIDS_DIR}}/php{{PHP_TAG}}-fpm.pid"
error_log = "{{LOGS_DIR}}/php-fpm-{{PHP_TAG}}.log"
daemonize = yes

[badami]
user = {{USERNAME}}
group = {{GROUP}}
listen = "{{SOCKS_DIR}}/php{{PHP_TAG}}.sock"
listen.owner = {{USERNAME}}
listen.group = {{GROUP}}
listen.mode = 0666

; Mandatory: script directory for Valet router (KD24)
chdir = "{{VALET_SERVER_DIR}}"

pm = dynamic
pm.max_children = 5
pm.start_servers = 2
pm.min_spare_servers = 1
pm.max_spare_servers = 3

php_admin_value[error_log] = "{{LOGS_DIR}}/php-fpm-{{PHP_TAG}}-php.log"
php_admin_flag[log_errors] = on
