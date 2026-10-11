-- Migration 022: Local Dev — TLS (Phase B) for *.{tld} sites.
--
-- Adds the default `https_port` setting that `ld_secure` / `ld_unsecure` and
-- `ld_list_sites` read when composing https URLs. 8443 is Mode A (unprivileged
-- nginx); users on Mode B set this to 443 explicitly via the Settings UI.
--
-- INSERT OR IGNORE preserves any pre-existing override from a previous run.

INSERT OR IGNORE INTO local_dev_settings (key, value) VALUES
  ('https_port', '8443');
