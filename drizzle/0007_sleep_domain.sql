CREATE TABLE sleep_plans (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE sleep_plan_versions (
  id TEXT PRIMARY KEY NOT NULL,
  plan_id TEXT NOT NULL REFERENCES sleep_plans(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (typeof(version) = 'integer' AND version > 0),
  timezone TEXT NOT NULL CHECK (length(trim(timezone)) > 0),
  target_duration_min_seconds INTEGER NOT NULL
    CHECK (typeof(target_duration_min_seconds) = 'integer' AND target_duration_min_seconds > 0),
  target_duration_max_seconds INTEGER NOT NULL
    CHECK (typeof(target_duration_max_seconds) = 'integer' AND target_duration_max_seconds > 0),
  valid_from TEXT NOT NULL,
  valid_to_exclusive TEXT,
  normalization_version TEXT NOT NULL CHECK (normalization_version = 'sleep-plan-v1'),
  hash_algorithm TEXT NOT NULL CHECK (hash_algorithm = 'sha256'),
  content_hash TEXT NOT NULL
    CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  normalized_snapshot_json TEXT NOT NULL,
  published_at TEXT NOT NULL,
  terminated_at TEXT,
  UNIQUE (plan_id, version),
  CHECK (target_duration_min_seconds <= target_duration_max_seconds),
  CHECK (valid_to_exclusive IS NULL OR valid_to_exclusive > valid_from)
);

CREATE TABLE sleep_plan_schedule_days (
  id TEXT PRIMARY KEY NOT NULL,
  plan_version_id TEXT NOT NULL REFERENCES sleep_plan_versions(id) ON DELETE RESTRICT,
  wake_weekday INTEGER NOT NULL
    CHECK (typeof(wake_weekday) = 'integer' AND wake_weekday BETWEEN 0 AND 6),
  target_in_bed_minute INTEGER NOT NULL
    CHECK (typeof(target_in_bed_minute) = 'integer' AND target_in_bed_minute BETWEEN 0 AND 1439),
  target_sleep_minute INTEGER NOT NULL
    CHECK (typeof(target_sleep_minute) = 'integer' AND target_sleep_minute BETWEEN 0 AND 1439),
  target_final_wake_minute INTEGER NOT NULL
    CHECK (typeof(target_final_wake_minute) = 'integer' AND target_final_wake_minute BETWEEN 0 AND 1439),
  target_out_of_bed_minute INTEGER NOT NULL
    CHECK (typeof(target_out_of_bed_minute) = 'integer' AND target_out_of_bed_minute BETWEEN 0 AND 1439),
  bed_day_offset INTEGER NOT NULL
    CHECK (typeof(bed_day_offset) = 'integer' AND bed_day_offset IN (-1, 0)),
  early_window_minutes INTEGER NOT NULL
    CHECK (typeof(early_window_minutes) = 'integer' AND early_window_minutes BETWEEN 0 AND 720),
  late_window_minutes INTEGER NOT NULL
    CHECK (typeof(late_window_minutes) = 'integer' AND late_window_minutes BETWEEN 0 AND 720),
  UNIQUE (plan_version_id, wake_weekday)
);

CREATE TABLE sleep_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE sleep_session_events (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sleep_sessions(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('recorded', 'corrected', 'voided')),
  session_kind TEXT NOT NULL CHECK (session_kind IN ('main', 'nap')),
  sleep_date TEXT NOT NULL
    CHECK (sleep_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  timezone TEXT NOT NULL CHECK (length(trim(timezone)) > 0),
  in_bed_at TEXT NOT NULL,
  sleep_onset_at TEXT,
  final_wake_at TEXT,
  out_of_bed_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual', 'import')),
  precision TEXT NOT NULL CHECK (precision IN ('exact', 'estimated')),
  awakening_mode TEXT NOT NULL CHECK (awakening_mode IN ('none', 'intervals', 'summary', 'unknown')),
  awakening_count INTEGER
    CHECK (awakening_count IS NULL OR (typeof(awakening_count) = 'integer' AND awakening_count >= 0)),
  awake_duration_seconds INTEGER
    CHECK (
      awake_duration_seconds IS NULL
      OR (typeof(awake_duration_seconds) = 'integer' AND awake_duration_seconds >= 0)
    ),
  supersedes_event_id TEXT REFERENCES sleep_session_events(id) ON DELETE RESTRICT,
  occurred_at TEXT NOT NULL,
  CHECK (supersedes_event_id IS NULL OR supersedes_event_id <> id),
  CHECK (
    (event_type = 'recorded' AND supersedes_event_id IS NULL)
    OR (event_type IN ('corrected', 'voided') AND supersedes_event_id IS NOT NULL)
  ),
  CHECK (
    (awakening_mode = 'none' AND awakening_count IS 0 AND awake_duration_seconds IS 0)
    OR (awakening_mode = 'intervals' AND awakening_count IS NULL AND awake_duration_seconds IS NULL)
    OR (awakening_mode = 'summary' AND awakening_count IS NOT NULL AND awake_duration_seconds IS NOT NULL)
    OR (awakening_mode = 'unknown' AND awakening_count IS NULL AND awake_duration_seconds IS NULL)
  )
);

CREATE TABLE sleep_awake_intervals (
  id TEXT PRIMARY KEY NOT NULL,
  session_event_id TEXT NOT NULL REFERENCES sleep_session_events(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (typeof(ordinal) = 'integer' AND ordinal >= 0),
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  CHECK (ended_at > started_at),
  UNIQUE (session_event_id, ordinal)
);

CREATE TABLE sleep_checkins (
  id TEXT PRIMARY KEY NOT NULL,
  checkin_date TEXT NOT NULL
    CHECK (checkin_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  session_id TEXT REFERENCES sleep_sessions(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  UNIQUE (checkin_date)
);

CREATE TABLE sleep_checkin_events (
  id TEXT PRIMARY KEY NOT NULL,
  checkin_id TEXT NOT NULL REFERENCES sleep_checkins(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('recorded', 'corrected', 'voided')),
  scale_version TEXT NOT NULL CHECK (scale_version = 'sleep-checkin-v1'),
  quality_score INTEGER
    CHECK (quality_score IS NULL OR (typeof(quality_score) = 'integer' AND quality_score BETWEEN 0 AND 5)),
  restoration_score INTEGER
    CHECK (
      restoration_score IS NULL
      OR (typeof(restoration_score) = 'integer' AND restoration_score BETWEEN 0 AND 5)
    ),
  daytime_sleepiness_score INTEGER
    CHECK (
      daytime_sleepiness_score IS NULL
      OR (typeof(daytime_sleepiness_score) = 'integer' AND daytime_sleepiness_score BETWEEN 0 AND 5)
    ),
  note TEXT NOT NULL,
  supersedes_event_id TEXT REFERENCES sleep_checkin_events(id) ON DELETE RESTRICT,
  occurred_at TEXT NOT NULL,
  CHECK (supersedes_event_id IS NULL OR supersedes_event_id <> id),
  CHECK (
    (event_type = 'recorded' AND supersedes_event_id IS NULL)
    OR (event_type IN ('corrected', 'voided') AND supersedes_event_id IS NOT NULL)
  ),
  CHECK (
    quality_score IS NOT NULL
    OR restoration_score IS NOT NULL
    OR daytime_sleepiness_score IS NOT NULL
    OR length(trim(note)) > 0
  )
);

CREATE INDEX sleep_plan_versions_effective_idx
  ON sleep_plan_versions (valid_from, valid_to_exclusive, id);
CREATE UNIQUE INDEX sleep_plan_schedule_day_unique
  ON sleep_plan_schedule_days (plan_version_id, wake_weekday);
CREATE INDEX sleep_session_events_date_idx
  ON sleep_session_events (sleep_date DESC, occurred_at DESC, id DESC);
CREATE INDEX sleep_session_events_session_idx
  ON sleep_session_events (session_id, occurred_at DESC, id DESC);
CREATE UNIQUE INDEX sleep_session_events_supersedes_unique
  ON sleep_session_events (supersedes_event_id)
  WHERE supersedes_event_id IS NOT NULL;
CREATE UNIQUE INDEX sleep_awake_intervals_event_ordinal_unique
  ON sleep_awake_intervals (session_event_id, ordinal);
CREATE UNIQUE INDEX sleep_checkins_date_unique ON sleep_checkins (checkin_date);
CREATE INDEX sleep_checkin_events_checkin_idx
  ON sleep_checkin_events (checkin_id, occurred_at DESC, id DESC);
CREATE UNIQUE INDEX sleep_checkin_events_supersedes_unique
  ON sleep_checkin_events (supersedes_event_id)
  WHERE supersedes_event_id IS NOT NULL;

CREATE TRIGGER sleep_plan_versions_reject_overlap_insert
BEFORE INSERT ON sleep_plan_versions
WHEN EXISTS (
  SELECT 1
  FROM sleep_plan_versions AS existing
  WHERE NEW.valid_from < COALESCE(existing.valid_to_exclusive, '9999-12-31T23:59:59.999Z')
    AND existing.valid_from < COALESCE(NEW.valid_to_exclusive, '9999-12-31T23:59:59.999Z')
)
BEGIN
  SELECT RAISE(ABORT, 'sleep plan version effective intervals overlap');
END;

CREATE TRIGGER sleep_plan_versions_reject_replace
BEFORE INSERT ON sleep_plan_versions
WHEN EXISTS (
  SELECT 1 FROM sleep_plan_versions
  WHERE id = NEW.id OR (plan_id = NEW.plan_id AND version = NEW.version)
)
BEGIN
  SELECT RAISE(ABORT, 'published sleep plan versions are immutable');
END;

CREATE TRIGGER sleep_plan_versions_reject_published_update
BEFORE UPDATE ON sleep_plan_versions
WHEN NOT (
  NEW.id IS OLD.id
  AND NEW.plan_id IS OLD.plan_id
  AND NEW.version IS OLD.version
  AND NEW.timezone IS OLD.timezone
  AND NEW.target_duration_min_seconds IS OLD.target_duration_min_seconds
  AND NEW.target_duration_max_seconds IS OLD.target_duration_max_seconds
  AND NEW.valid_from IS OLD.valid_from
  AND NEW.normalization_version IS OLD.normalization_version
  AND NEW.hash_algorithm IS OLD.hash_algorithm
  AND NEW.content_hash IS OLD.content_hash
  AND NEW.normalized_snapshot_json IS OLD.normalized_snapshot_json
  AND NEW.published_at IS OLD.published_at
  AND (
    NEW.valid_to_exclusive IS OLD.valid_to_exclusive
    OR (OLD.valid_to_exclusive IS NULL AND NEW.valid_to_exclusive IS NOT NULL)
  )
  AND (
    NEW.terminated_at IS OLD.terminated_at
    OR (OLD.terminated_at IS NULL AND NEW.terminated_at IS NOT NULL)
  )
  AND (
    NEW.valid_to_exclusive IS NOT OLD.valid_to_exclusive
    OR NEW.terminated_at IS NOT OLD.terminated_at
  )
)
BEGIN
  SELECT RAISE(ABORT, 'published sleep plan versions are immutable');
END;

CREATE TRIGGER sleep_plan_versions_reject_delete
BEFORE DELETE ON sleep_plan_versions
BEGIN
  SELECT RAISE(ABORT, 'published sleep plan versions are immutable');
END;

CREATE TRIGGER sleep_plan_schedule_days_reject_update
BEFORE UPDATE ON sleep_plan_schedule_days
BEGIN
  SELECT RAISE(ABORT, 'published sleep plan schedule is immutable');
END;

CREATE TRIGGER sleep_plan_schedule_days_reject_published_insert
BEFORE INSERT ON sleep_plan_schedule_days
WHEN EXISTS (
  SELECT 1 FROM sleep_plan_versions WHERE id = NEW.plan_version_id
)
BEGIN
  SELECT RAISE(ABORT, 'published sleep plan schedule is immutable');
END;

CREATE TRIGGER sleep_plan_schedule_days_reject_delete
BEFORE DELETE ON sleep_plan_schedule_days
BEGIN
  SELECT RAISE(ABORT, 'published sleep plan schedule is immutable');
END;

CREATE TRIGGER sleep_session_events_reject_owner_switch
BEFORE INSERT ON sleep_session_events
WHEN NEW.supersedes_event_id IS NOT NULL
 AND EXISTS (
   SELECT 1 FROM sleep_session_events AS parent
   WHERE parent.id = NEW.supersedes_event_id AND parent.session_id <> NEW.session_id
 )
BEGIN
  SELECT RAISE(ABORT, 'sleep session correction cannot switch session');
END;

CREATE TRIGGER sleep_session_events_reject_cycle
BEFORE INSERT ON sleep_session_events
WHEN NEW.supersedes_event_id IS NOT NULL
 AND EXISTS (
   WITH RECURSIVE ancestors(id) AS (
     SELECT NEW.supersedes_event_id
     UNION
     SELECT event.supersedes_event_id
     FROM sleep_session_events AS event
     JOIN ancestors ON event.id = ancestors.id
     WHERE event.supersedes_event_id IS NOT NULL
   )
   SELECT 1 FROM ancestors WHERE id = NEW.id
 )
BEGIN
  SELECT RAISE(ABORT, 'sleep session event chain cycle');
END;

CREATE TRIGGER sleep_session_events_reject_replace
BEFORE INSERT ON sleep_session_events
WHEN EXISTS (
  SELECT 1 FROM sleep_session_events
  WHERE id = NEW.id
     OR (NEW.supersedes_event_id IS NOT NULL AND supersedes_event_id = NEW.supersedes_event_id)
)
BEGIN
  SELECT RAISE(ABORT, 'sleep session events are immutable');
END;

CREATE TRIGGER sleep_session_events_reject_update
BEFORE UPDATE ON sleep_session_events
BEGIN
  SELECT RAISE(ABORT, 'sleep session events are immutable');
END;

CREATE TRIGGER sleep_session_events_reject_delete
BEFORE DELETE ON sleep_session_events
BEGIN
  SELECT RAISE(ABORT, 'sleep session events are immutable');
END;

CREATE TRIGGER sleep_awake_intervals_require_interval_parent
BEFORE INSERT ON sleep_awake_intervals
WHEN COALESCE(
  (SELECT awakening_mode FROM sleep_session_events WHERE id = NEW.session_event_id),
  ''
) <> 'intervals'
BEGIN
  SELECT RAISE(ABORT, 'sleep awake interval requires an intervals-mode parent');
END;

CREATE TRIGGER sleep_awake_intervals_reject_replace
BEFORE INSERT ON sleep_awake_intervals
WHEN EXISTS (
  SELECT 1 FROM sleep_awake_intervals
  WHERE id = NEW.id
     OR (session_event_id = NEW.session_event_id AND ordinal = NEW.ordinal)
)
BEGIN
  SELECT RAISE(ABORT, 'sleep awake intervals are immutable');
END;

CREATE TRIGGER sleep_awake_intervals_reject_update
BEFORE UPDATE ON sleep_awake_intervals
BEGIN
  SELECT RAISE(ABORT, 'sleep awake intervals are immutable');
END;

CREATE TRIGGER sleep_awake_intervals_reject_delete
BEFORE DELETE ON sleep_awake_intervals
BEGIN
  SELECT RAISE(ABORT, 'sleep awake intervals are immutable');
END;

CREATE TRIGGER sleep_checkin_events_reject_owner_switch
BEFORE INSERT ON sleep_checkin_events
WHEN NEW.supersedes_event_id IS NOT NULL
 AND EXISTS (
   SELECT 1 FROM sleep_checkin_events AS parent
   WHERE parent.id = NEW.supersedes_event_id AND parent.checkin_id <> NEW.checkin_id
 )
BEGIN
  SELECT RAISE(ABORT, 'sleep check-in correction cannot switch check-in');
END;

CREATE TRIGGER sleep_checkin_events_reject_cycle
BEFORE INSERT ON sleep_checkin_events
WHEN NEW.supersedes_event_id IS NOT NULL
 AND EXISTS (
   WITH RECURSIVE ancestors(id) AS (
     SELECT NEW.supersedes_event_id
     UNION
     SELECT event.supersedes_event_id
     FROM sleep_checkin_events AS event
     JOIN ancestors ON event.id = ancestors.id
     WHERE event.supersedes_event_id IS NOT NULL
   )
   SELECT 1 FROM ancestors WHERE id = NEW.id
 )
BEGIN
  SELECT RAISE(ABORT, 'sleep check-in event chain cycle');
END;

CREATE TRIGGER sleep_checkin_events_reject_replace
BEFORE INSERT ON sleep_checkin_events
WHEN EXISTS (
  SELECT 1 FROM sleep_checkin_events
  WHERE id = NEW.id
     OR (NEW.supersedes_event_id IS NOT NULL AND supersedes_event_id = NEW.supersedes_event_id)
)
BEGIN
  SELECT RAISE(ABORT, 'sleep check-in events are immutable');
END;

CREATE TRIGGER sleep_checkin_events_reject_update
BEFORE UPDATE ON sleep_checkin_events
BEGIN
  SELECT RAISE(ABORT, 'sleep check-in events are immutable');
END;

CREATE TRIGGER sleep_checkin_events_reject_delete
BEFORE DELETE ON sleep_checkin_events
BEGIN
  SELECT RAISE(ABORT, 'sleep check-in events are immutable');
END;

UPDATE app_meta SET value = '8' WHERE key = 'schema_version';
