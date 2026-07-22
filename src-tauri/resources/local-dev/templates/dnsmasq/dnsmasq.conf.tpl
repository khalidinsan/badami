# Badami Local Dev — dnsmasq (*.{{TLD}} → loopback)
# Generated; regenerate via ld_generate_configs.
# Binding :53 requires privileges (DNS Mode B / D1); this conf is still valid.

listen-address={{LISTEN_ADDRESS}}
bind-interfaces
port={{DNS_PORT}}
no-resolv
no-hosts
address=/.{{TLD}}/{{LOOPBACK}}
