# Badami Local Dev — MariaDB WRAPPER my.cnf
# Reuses the discovered Herd datadir/basedir in-place.
# NEVER run mysql_install_db / mariadb-install-db against a non-empty datadir.
# Generated; regenerate via ld_generate_configs. Paths are parameters only.
# All path values are double-quoted (Application Support has spaces).

[mysqld]
basedir = "{{BASEDIR}}"
datadir = "{{DATADIR}}"
socket = "{{SOCKET}}"
port = {{PORT}}
pid-file = "{{PID_FILE}}"
log-error = "{{LOG_ERROR}}"
bind-address = 127.0.0.1

[client]
socket = "{{SOCKET}}"
port = {{PORT}}

[mysqladmin]
socket = "{{SOCKET}}"
port = {{PORT}}
