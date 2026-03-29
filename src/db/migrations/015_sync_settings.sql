-- Phase 14: Sync settings defaults
INSERT OR IGNORE INTO settings (key, value) VALUES ('sync_enabled', 'false');
INSERT OR IGNORE INTO settings (key, value) VALUES ('sync_turso_url', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('sync_interval_minutes', '5');
INSERT OR IGNORE INTO settings (key, value) VALUES ('sync_on_launch', 'true');
INSERT OR IGNORE INTO settings (key, value) VALUES ('sync_on_close', 'true');
INSERT OR IGNORE INTO settings (key, value) VALUES ('sync_show_status', 'true')
