# Badami Local Dev — main nginx.conf (Mode A unprivileged default)
# Generated; do not edit by hand (regenerate via ld_generate_configs).
# NO njs. Static sockets only.

{{USER_DIRECTIVE}}

worker_processes auto;
error_log "{{LOGS_DIR}}/nginx-error.log";
pid "{{PIDS_DIR}}/nginx.pid";

events {
    worker_connections 1024;
}

http {
    include "{{NGINX_DIR}}/mime.types";
    default_type application/octet-stream;

    sendfile on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    client_max_body_size 64M;
    server_names_hash_bucket_size 128;

    access_log off;

    include "{{NGINX_DIR}}/sites/*.conf";
    include "{{NGINX_DIR}}/badami.conf";
}
