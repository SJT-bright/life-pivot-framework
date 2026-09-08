ALTER TABLE sleep_daily_records
  ADD COLUMN deep_sleep_minutes INTEGER
  CHECK (deep_sleep_minutes IS NULL OR deep_sleep_minutes BETWEEN 0 AND 1440);

ALTER TABLE sleep_daily_records
  ADD COLUMN light_sleep_minutes INTEGER
  CHECK (light_sleep_minutes IS NULL OR light_sleep_minutes BETWEEN 0 AND 1440);

ALTER TABLE sleep_daily_records
  ADD COLUMN rem_sleep_minutes INTEGER
  CHECK (rem_sleep_minutes IS NULL OR rem_sleep_minutes BETWEEN 0 AND 1440);

ALTER TABLE sleep_daily_records
  ADD COLUMN morning_feeling INTEGER
  CHECK (morning_feeling IS NULL OR morning_feeling BETWEEN 1 AND 5);

UPDATE app_meta SET value = '20' WHERE key = 'schema_version';
