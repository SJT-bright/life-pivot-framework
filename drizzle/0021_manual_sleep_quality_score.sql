ALTER TABLE sleep_daily_records
  ADD COLUMN manual_quality_score INTEGER
  CHECK (
    manual_quality_score IS NULL
    OR (typeof(manual_quality_score) = 'integer' AND manual_quality_score BETWEEN 60 AND 100)
  );

UPDATE app_meta SET value = '22' WHERE key = 'schema_version';
