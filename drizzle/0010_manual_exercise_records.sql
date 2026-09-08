CREATE TABLE manual_exercise_templates (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 128),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  current_revision INTEGER NOT NULL CHECK (current_revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE manual_exercise_template_versions (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 128),
  template_id TEXT NOT NULL REFERENCES manual_exercise_templates(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  effective_from TEXT NOT NULL CHECK (date(effective_from) IS effective_from),
  change_note TEXT NOT NULL DEFAULT '' CHECK (length(change_note) <= 1000),
  created_at TEXT NOT NULL,
  UNIQUE (template_id, revision)
);

CREATE TABLE manual_exercise_template_days (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 128),
  template_version_id TEXT NOT NULL REFERENCES manual_exercise_template_versions(id) ON DELETE RESTRICT,
  day_key TEXT NOT NULL CHECK (length(trim(day_key)) BETWEEN 1 AND 128),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  body_part TEXT NOT NULL DEFAULT '' CHECK (length(body_part) <= 160),
  is_rest INTEGER NOT NULL DEFAULT 0 CHECK (is_rest IN (0, 1)),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 4000),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  UNIQUE (template_version_id, day_key),
  UNIQUE (template_version_id, ordinal)
);

CREATE TABLE manual_exercise_template_actions (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 128),
  template_day_id TEXT NOT NULL REFERENCES manual_exercise_template_days(id) ON DELETE RESTRICT,
  action_key TEXT NOT NULL CHECK (length(trim(action_key)) BETWEEN 1 AND 128),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  planned_sets INTEGER NOT NULL CHECK (planned_sets >= 0),
  planned_reps_text TEXT NOT NULL DEFAULT '' CHECK (length(planned_reps_text) <= 500),
  planned_weight_text TEXT NOT NULL DEFAULT '' CHECK (length(planned_weight_text) <= 500),
  target_text TEXT NOT NULL DEFAULT '' CHECK (length(target_text) <= 1000),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 4000),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  UNIQUE (template_day_id, action_key),
  UNIQUE (template_day_id, ordinal)
);

CREATE TABLE manual_exercise_cycle_state (
  template_id TEXT PRIMARY KEY NOT NULL REFERENCES manual_exercise_templates(id) ON DELETE RESTRICT,
  current_day_key TEXT NOT NULL CHECK (length(trim(current_day_key)) BETWEEN 1 AND 128),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at TEXT NOT NULL
);

CREATE TABLE manual_exercise_days (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 128),
  business_date TEXT NOT NULL UNIQUE CHECK (date(business_date) IS business_date),
  template_version_id TEXT NOT NULL REFERENCES manual_exercise_template_versions(id) ON DELETE RESTRICT,
  day_key TEXT NOT NULL CHECK (length(trim(day_key)) BETWEEN 1 AND 128),
  day_name TEXT NOT NULL CHECK (length(trim(day_name)) BETWEEN 1 AND 160),
  body_part TEXT NOT NULL DEFAULT '' CHECK (length(body_part) <= 160),
  is_rest INTEGER NOT NULL DEFAULT 0 CHECK (is_rest IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('not-started', 'in-progress', 'partial', 'completed', 'skipped')),
  started_at TEXT,
  paused_at TEXT,
  accumulated_pause_seconds INTEGER NOT NULL DEFAULT 0 CHECK (accumulated_pause_seconds >= 0),
  ended_at TEXT,
  calculated_duration_minutes INTEGER CHECK (calculated_duration_minutes IS NULL OR calculated_duration_minutes >= 0),
  confirmed_duration_minutes INTEGER CHECK (confirmed_duration_minutes IS NULL OR confirmed_duration_minutes >= 0),
  creatine_taken INTEGER CHECK (creatine_taken IS NULL OR creatine_taken IN (0, 1)),
  protein_powder_taken INTEGER CHECK (protein_powder_taken IS NULL OR protein_powder_taken IN (0, 1)),
  supplement_note TEXT NOT NULL DEFAULT '' CHECK (length(supplement_note) <= 4000),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 4000),
  completion_text TEXT NOT NULL DEFAULT '' CHECK (length(completion_text) <= 4000),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (started_at IS NOT NULL OR (
      paused_at IS NULL AND ended_at IS NULL AND accumulated_pause_seconds = 0 AND
      calculated_duration_minutes IS NULL AND confirmed_duration_minutes IS NULL
    )) AND
    (paused_at IS NULL OR (started_at IS NOT NULL AND ended_at IS NULL)) AND
    (ended_at IS NULL OR (started_at IS NOT NULL AND paused_at IS NULL)) AND
    (calculated_duration_minutes IS NULL OR ended_at IS NOT NULL) AND
    (confirmed_duration_minutes IS NULL OR ended_at IS NOT NULL)
  )
);

CREATE TABLE manual_exercise_day_actions (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 128),
  day_id TEXT NOT NULL REFERENCES manual_exercise_days(id) ON DELETE RESTRICT,
  action_key TEXT NOT NULL CHECK (length(trim(action_key)) BETWEEN 1 AND 128),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  planned_sets INTEGER NOT NULL CHECK (planned_sets >= 0),
  planned_reps_text TEXT NOT NULL DEFAULT '' CHECK (length(planned_reps_text) <= 500),
  planned_weight_text TEXT NOT NULL DEFAULT '' CHECK (length(planned_weight_text) <= 500),
  target_text TEXT NOT NULL DEFAULT '' CHECK (length(target_text) <= 1000),
  actual_sets INTEGER NOT NULL DEFAULT 0 CHECK (actual_sets >= 0),
  actual_reps_text TEXT NOT NULL DEFAULT '' CHECK (length(actual_reps_text) <= 1000),
  actual_weight_text TEXT NOT NULL DEFAULT '' CHECK (length(actual_weight_text) <= 1000),
  actual_text TEXT NOT NULL DEFAULT '' CHECK (length(actual_text) <= 4000),
  completion TEXT NOT NULL DEFAULT '' CHECK (length(completion) <= 1000),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 4000),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  UNIQUE (day_id, action_key),
  UNIQUE (day_id, ordinal)
);

CREATE TABLE manual_exercise_cycle_events (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 128),
  template_id TEXT NOT NULL REFERENCES manual_exercise_templates(id) ON DELETE RESTRICT,
  business_date TEXT NOT NULL CHECK (date(business_date) IS business_date),
  event_type TEXT NOT NULL CHECK (event_type IN ('started', 'advanced', 'completed', 'reset', 'corrected')),
  from_day_key TEXT CHECK (from_day_key IS NULL OR length(trim(from_day_key)) BETWEEN 1 AND 128),
  to_day_key TEXT CHECK (to_day_key IS NULL OR length(trim(to_day_key)) BETWEEN 1 AND 128),
  day_id TEXT REFERENCES manual_exercise_days(id) ON DELETE RESTRICT,
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 4000),
  cycle_revision_before INTEGER NOT NULL CHECK (cycle_revision_before >= 0),
  cycle_revision_after INTEGER NOT NULL CHECK (cycle_revision_after >= cycle_revision_before),
  created_at TEXT NOT NULL
);

CREATE INDEX manual_exercise_template_versions_effective_idx
  ON manual_exercise_template_versions (template_id, effective_from DESC, revision DESC);
CREATE INDEX manual_exercise_template_days_order_idx
  ON manual_exercise_template_days (template_version_id, ordinal);
CREATE INDEX manual_exercise_template_actions_order_idx
  ON manual_exercise_template_actions (template_day_id, ordinal);
CREATE INDEX manual_exercise_days_business_date_idx
  ON manual_exercise_days (business_date DESC);
CREATE INDEX manual_exercise_day_actions_order_idx
  ON manual_exercise_day_actions (day_id, ordinal);
CREATE INDEX manual_exercise_cycle_events_order_idx
  ON manual_exercise_cycle_events (template_id, business_date DESC, created_at DESC, id DESC);

CREATE TRIGGER manual_exercise_template_versions_reject_replace
BEFORE INSERT ON manual_exercise_template_versions
WHEN EXISTS (
  SELECT 1 FROM manual_exercise_template_versions
  WHERE id = NEW.id OR (template_id = NEW.template_id AND revision = NEW.revision)
)
BEGIN
  SELECT RAISE(ABORT, 'manual exercise template versions are immutable');
END;

CREATE TRIGGER manual_exercise_template_versions_reject_update
BEFORE UPDATE ON manual_exercise_template_versions
BEGIN
  SELECT RAISE(ABORT, 'manual exercise template versions are immutable');
END;

CREATE TRIGGER manual_exercise_template_versions_reject_delete
BEFORE DELETE ON manual_exercise_template_versions
BEGIN
  SELECT RAISE(ABORT, 'manual exercise template versions are immutable');
END;

CREATE TRIGGER manual_exercise_template_days_reject_replace
BEFORE INSERT ON manual_exercise_template_days
WHEN EXISTS (
  SELECT 1 FROM manual_exercise_template_days
  WHERE id = NEW.id
     OR (template_version_id = NEW.template_version_id AND day_key = NEW.day_key)
     OR (template_version_id = NEW.template_version_id AND ordinal = NEW.ordinal)
)
BEGIN
  SELECT RAISE(ABORT, 'manual exercise template days are immutable');
END;

CREATE TRIGGER manual_exercise_template_days_reject_update
BEFORE UPDATE ON manual_exercise_template_days
BEGIN
  SELECT RAISE(ABORT, 'manual exercise template days are immutable');
END;

CREATE TRIGGER manual_exercise_template_days_reject_delete
BEFORE DELETE ON manual_exercise_template_days
BEGIN
  SELECT RAISE(ABORT, 'manual exercise template days are immutable');
END;

CREATE TRIGGER manual_exercise_template_actions_reject_replace
BEFORE INSERT ON manual_exercise_template_actions
WHEN EXISTS (
  SELECT 1 FROM manual_exercise_template_actions
  WHERE id = NEW.id
     OR (template_day_id = NEW.template_day_id AND action_key = NEW.action_key)
     OR (template_day_id = NEW.template_day_id AND ordinal = NEW.ordinal)
)
BEGIN
  SELECT RAISE(ABORT, 'manual exercise template actions are immutable');
END;

CREATE TRIGGER manual_exercise_template_actions_reject_update
BEFORE UPDATE ON manual_exercise_template_actions
BEGIN
  SELECT RAISE(ABORT, 'manual exercise template actions are immutable');
END;

CREATE TRIGGER manual_exercise_template_actions_reject_delete
BEFORE DELETE ON manual_exercise_template_actions
BEGIN
  SELECT RAISE(ABORT, 'manual exercise template actions are immutable');
END;

CREATE TRIGGER manual_exercise_cycle_events_reject_replace
BEFORE INSERT ON manual_exercise_cycle_events
WHEN EXISTS (SELECT 1 FROM manual_exercise_cycle_events WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'manual exercise cycle events are immutable');
END;

CREATE TRIGGER manual_exercise_cycle_events_reject_update
BEFORE UPDATE ON manual_exercise_cycle_events
BEGIN
  SELECT RAISE(ABORT, 'manual exercise cycle events are immutable');
END;

CREATE TRIGGER manual_exercise_cycle_events_reject_delete
BEFORE DELETE ON manual_exercise_cycle_events
BEGIN
  SELECT RAISE(ABORT, 'manual exercise cycle events are immutable');
END;

UPDATE app_meta SET value = '11' WHERE key = 'schema_version';
