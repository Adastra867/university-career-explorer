ALTER TABLE turn_requests ADD COLUMN prepared_data TEXT;
INSERT INTO schema_migrations(version,applied_at) VALUES(2,datetime('now'));
