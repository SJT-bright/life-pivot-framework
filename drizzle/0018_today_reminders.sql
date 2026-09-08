CREATE TABLE today_reminders (
  id TEXT PRIMARY KEY NOT NULL,
  business_date TEXT NOT NULL,
  title TEXT NOT NULL,
  scheduled_time TEXT,
  completed INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (date(business_date) IS business_date),
  CHECK (length(trim(title)) BETWEEN 1 AND 240),
  CHECK (
    scheduled_time IS NULL OR (
      scheduled_time GLOB '[0-2][0-9]:[0-5][0-9]'
      AND CAST(substr(scheduled_time, 1, 2) AS INTEGER) BETWEEN 0 AND 23
      AND CAST(substr(scheduled_time, 4, 2) AS INTEGER) BETWEEN 0 AND 59
    )
  ),
  CHECK (completed IN (0, 1)),
  CHECK (
    (completed = 0 AND completed_at IS NULL)
    OR (completed = 1 AND completed_at IS NOT NULL)
  ),
  CHECK (revision >= 1)
);

CREATE INDEX today_reminders_day_status_time_idx
  ON today_reminders (business_date, completed, scheduled_time, created_at, id);

CREATE INDEX today_reminders_updated_idx
  ON today_reminders (updated_at DESC, id DESC);

INSERT INTO app_meta (key, value) VALUES ('schema_version', '19')
ON CONFLICT(key) DO UPDATE SET value = excluded.value;
