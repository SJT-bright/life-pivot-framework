CREATE TABLE sleep_daily_records (
  id TEXT PRIMARY KEY NOT NULL,
  record_date TEXT NOT NULL UNIQUE CHECK (date(record_date) IS record_date),
  asleep_time TEXT NOT NULL CHECK (
    asleep_time GLOB '[0-2][0-9]:[0-5][0-9]' AND
    CAST(substr(asleep_time, 1, 2) AS INTEGER) BETWEEN 0 AND 23 AND
    CAST(substr(asleep_time, 4, 2) AS INTEGER) BETWEEN 0 AND 59
  ),
  wake_time TEXT NOT NULL CHECK (
    wake_time GLOB '[0-2][0-9]:[0-5][0-9]' AND
    CAST(substr(wake_time, 1, 2) AS INTEGER) BETWEEN 0 AND 23 AND
    CAST(substr(wake_time, 4, 2) AS INTEGER) BETWEEN 0 AND 59
  ),
  calculated_duration_minutes INTEGER NOT NULL
    CHECK (calculated_duration_minutes BETWEEN 0 AND 1439),
  confirmed_duration_minutes INTEGER
    CHECK (confirmed_duration_minutes IS NULL OR confirmed_duration_minutes BETWEEN 0 AND 1440),
  quality_text TEXT NOT NULL CHECK (length(trim(quality_text)) BETWEEN 1 AND 500),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 4000),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE health_checklist_templates (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  current_revision INTEGER NOT NULL CHECK (current_revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE health_checklist_versions (
  id TEXT PRIMARY KEY NOT NULL,
  template_id TEXT NOT NULL REFERENCES health_checklist_templates(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  effective_from TEXT NOT NULL CHECK (date(effective_from) IS effective_from),
  change_note TEXT NOT NULL DEFAULT '' CHECK (length(change_note) <= 1000),
  created_at TEXT NOT NULL,
  UNIQUE (template_id, revision)
);

CREATE TABLE health_checklist_template_items (
  id TEXT PRIMARY KEY NOT NULL,
  template_version_id TEXT NOT NULL REFERENCES health_checklist_versions(id) ON DELETE RESTRICT,
  item_key TEXT NOT NULL CHECK (length(trim(item_key)) BETWEEN 1 AND 128),
  group_key TEXT NOT NULL CHECK (length(trim(group_key)) BETWEEN 1 AND 64),
  group_label TEXT NOT NULL CHECK (length(trim(group_label)) BETWEEN 1 AND 80),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  target_text TEXT NOT NULL DEFAULT '' CHECK (length(target_text) <= 500),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  UNIQUE (template_version_id, item_key),
  UNIQUE (template_version_id, ordinal)
);

CREATE TABLE health_checklist_days (
  id TEXT PRIMARY KEY NOT NULL,
  business_date TEXT NOT NULL UNIQUE CHECK (date(business_date) IS business_date),
  template_version_id TEXT NOT NULL REFERENCES health_checklist_versions(id) ON DELETE RESTRICT,
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 4000),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE health_checklist_day_items (
  id TEXT PRIMARY KEY NOT NULL,
  day_id TEXT NOT NULL REFERENCES health_checklist_days(id) ON DELETE RESTRICT,
  item_key TEXT NOT NULL CHECK (length(trim(item_key)) BETWEEN 1 AND 128),
  group_key TEXT NOT NULL CHECK (length(trim(group_key)) BETWEEN 1 AND 64),
  group_label TEXT NOT NULL CHECK (length(trim(group_label)) BETWEEN 1 AND 80),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  target_text TEXT NOT NULL DEFAULT '' CHECK (length(target_text) <= 500),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  completed_at TEXT,
  UNIQUE (day_id, item_key),
  UNIQUE (day_id, ordinal),
  CHECK ((completed = 0 AND completed_at IS NULL) OR (completed = 1 AND completed_at IS NOT NULL))
);

CREATE TABLE personal_daily_notes (
  id TEXT PRIMARY KEY NOT NULL,
  business_date TEXT NOT NULL UNIQUE CHECK (date(business_date) IS business_date),
  content TEXT NOT NULL DEFAULT '' CHECK (length(content) <= 20000),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX sleep_daily_records_date_idx
  ON sleep_daily_records (record_date DESC);
CREATE INDEX health_checklist_versions_effective_idx
  ON health_checklist_versions (template_id, effective_from DESC, revision DESC);
CREATE INDEX health_checklist_days_date_idx
  ON health_checklist_days (business_date DESC);
CREATE INDEX health_checklist_day_items_order_idx
  ON health_checklist_day_items (day_id, ordinal);
CREATE INDEX personal_daily_notes_date_idx
  ON personal_daily_notes (business_date DESC);

CREATE TRIGGER health_checklist_versions_reject_replace
BEFORE INSERT ON health_checklist_versions
WHEN EXISTS (
  SELECT 1 FROM health_checklist_versions
  WHERE id = NEW.id
     OR (template_id = NEW.template_id AND revision = NEW.revision)
)
BEGIN
  SELECT RAISE(ABORT, 'health checklist versions are immutable');
END;

CREATE TRIGGER health_checklist_versions_reject_update
BEFORE UPDATE ON health_checklist_versions
BEGIN
  SELECT RAISE(ABORT, 'health checklist versions are immutable');
END;

CREATE TRIGGER health_checklist_versions_reject_delete
BEFORE DELETE ON health_checklist_versions
BEGIN
  SELECT RAISE(ABORT, 'health checklist versions are immutable');
END;

CREATE TRIGGER health_checklist_template_items_reject_replace
BEFORE INSERT ON health_checklist_template_items
WHEN EXISTS (
  SELECT 1 FROM health_checklist_template_items
  WHERE id = NEW.id
     OR (template_version_id = NEW.template_version_id AND item_key = NEW.item_key)
     OR (template_version_id = NEW.template_version_id AND ordinal = NEW.ordinal)
)
BEGIN
  SELECT RAISE(ABORT, 'health checklist template items are immutable');
END;

CREATE TRIGGER health_checklist_template_items_reject_update
BEFORE UPDATE ON health_checklist_template_items
BEGIN
  SELECT RAISE(ABORT, 'health checklist template items are immutable');
END;

CREATE TRIGGER health_checklist_template_items_reject_delete
BEFORE DELETE ON health_checklist_template_items
BEGIN
  SELECT RAISE(ABORT, 'health checklist template items are immutable');
END;

UPDATE app_meta SET value = '10' WHERE key = 'schema_version';
