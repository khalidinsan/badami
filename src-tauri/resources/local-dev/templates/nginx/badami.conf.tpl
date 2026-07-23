# Badami Local Dev — default server (Mode A :8080)
# Static fastcgi_pass only — no njs, no variable socket maps.

server {
    listen {{HTTP_LISTEN}} default_server;
    root /;
    charset utf-8;
    client_max_body_size 64M;

    location / {
        rewrite ^ "{{VALET_SERVER_PHP}}" last;
    }

    location = /favicon.ico { access_log off; log_not_found off; }
    location = /robots.txt  { access_log off; log_not_found off; }

    error_page 404 "{{VALET_SERVER_PHP}}";

    location ~ [^/]\.php(/|$) {
        fastcgi_split_path_info ^(.+\.php)(/.+)$;
        # Quoted: local-dev path may contain spaces (e.g. Application Support).
        fastcgi_pass "unix:{{DEFAULT_PHP_SOCK}}";
        fastcgi_index "{{VALET_SERVER_PHP}}";
        include "{{NGINX_DIR}}/fastcgi_params";
        fastcgi_param SCRIPT_FILENAME "{{VALET_SERVER_PHP}}";
        fastcgi_param HERD_HOME "{{LOCAL_DEV_HOME}}";
        fastcgi_param PATH_INFO $fastcgi_path_info;
    }

    location ~ /\.ht {
        deny all;
    }
}
