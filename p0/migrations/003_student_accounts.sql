CREATE TABLE IF NOT EXISTS student_accounts (
  owner_id TEXT PRIMARY KEY REFERENCES guests(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS student_sessions (
  token_hash TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES student_accounts(owner_id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS student_sessions_owner ON student_sessions(owner_id);
CREATE INDEX IF NOT EXISTS student_sessions_expiry ON student_sessions(expires_at);
INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (3, datetime('now'));
