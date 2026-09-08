CREATE TABLE manual_exercise_day_resolutions (
  day_id TEXT PRIMARY KEY NOT NULL REFERENCES manual_exercise_days(id) ON DELETE RESTRICT,
  outcome TEXT NOT NULL CHECK (outcome IN ('rest', 'skipped', 'unrecorded')),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 4000),
  cycle_advanced INTEGER NOT NULL DEFAULT 0 CHECK (cycle_advanced IN (0, 1)),
  resolved_at TEXT NOT NULL,
  reopened_at TEXT
);

ALTER TABLE manual_exercise_days
  ADD COLUMN manual_duration_minutes INTEGER
  CHECK (manual_duration_minutes IS NULL OR (
    typeof(manual_duration_minutes) = 'integer'
    AND manual_duration_minutes BETWEEN 0 AND 525600
  ));

UPDATE app_meta SET value = '25' WHERE key = 'schema_version';
