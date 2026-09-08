ALTER TABLE sleep_daily_records
  ADD COLUMN awake_episodes INTEGER
  CHECK (
    awake_episodes IS NULL
    OR (typeof(awake_episodes) = 'integer' AND awake_episodes BETWEEN 0 AND 100)
  );

ALTER TABLE sleep_daily_records
  ADD COLUMN awake_minutes INTEGER
  CHECK (
    awake_minutes IS NULL
    OR (typeof(awake_minutes) = 'integer' AND awake_minutes BETWEEN 0 AND 720)
  );

UPDATE app_meta SET value = '24' WHERE key = 'schema_version';
