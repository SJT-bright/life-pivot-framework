CREATE TABLE wisdom_reminders (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '',
  archived_at TEXT,
  revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(trim(content)) BETWEEN 1 AND 500),
  CHECK (length(context) <= 2000),
  CHECK (revision >= 1)
);

CREATE INDEX wisdom_reminders_created_idx ON wisdom_reminders (created_at DESC);

UPDATE app_meta SET value = '23' WHERE key = 'schema_version';
