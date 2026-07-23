# Badami Local Dev — dnsmasq (*.{{TLD}} → loopback)
# Generated; regenerate via ld_generate_configs.
# Mode A default: port 53535 (no root). Port 53 needs Mode B / admin.
# macOS /etc/resolver/{{TLD}} must include: nameserver {{LOOPBACK}} + port {{DNS_PORT}}

listen-address={{LISTEN_ADDRESS}}
bind-interfaces
port={{DNS_PORT}}
no-resolv
no-hosts
address=/.{{TLD}}/{{LOOPBACK}}
pid-file={{PIDS_DIR}}/dnsmasq.pid
log-facility={{LOGS_DIR}}/dnsmasq.log
