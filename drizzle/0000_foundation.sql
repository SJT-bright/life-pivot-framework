CREATE TABLE app_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

INSERT INTO app_meta (key, value) VALUES
  ('schema_version', '1'),
  ('ownership_mode', 'single-owner');

CREATE TABLE life_areas (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  display_order INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE metric_definitions (
  id TEXT PRIMARY KEY NOT NULL,
  life_area_id TEXT NOT NULL REFERENCES life_areas(id) ON DELETE RESTRICT,
  stable_key TEXT NOT NULL UNIQUE CHECK (length(trim(stable_key)) > 0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE metric_definition_versions (
  id TEXT PRIMARY KEY NOT NULL,
  metric_definition_id TEXT NOT NULL REFERENCES metric_definitions(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version >= 1),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  unit TEXT,
  value_kind TEXT NOT NULL CHECK (value_kind IN ('number', 'text', 'boolean')),
  cardinality TEXT NOT NULL CHECK (cardinality IN ('daily-single', 'event-stream')),
  aggregation TEXT NOT NULL CHECK (aggregation IN ('last', 'sum', 'avg', 'min', 'max', 'none')),
  valid_from TEXT NOT NULL CHECK (valid_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  valid_to TEXT CHECK (valid_to IS NULL OR valid_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at TEXT NOT NULL,
  UNIQUE (metric_definition_id, version),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE TABLE metric_records (
  id TEXT PRIMARY KEY NOT NULL,
  metric_definition_version_id TEXT NOT NULL REFERENCES metric_definition_versions(id) ON DELETE RESTRICT,
  business_date TEXT NOT NULL CHECK (business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  captured_at TEXT,
  numeric_value TEXT,
  text_value TEXT,
  boolean_value INTEGER CHECK (boolean_value IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  supersedes_record_id TEXT REFERENCES metric_records(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (numeric_value IS NOT NULL) +
    (text_value IS NOT NULL) +
    (boolean_value IS NOT NULL) = 1
  )
);

CREATE TABLE daily_entries (
  id TEXT PRIMARY KEY NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('capture', 'diary', 'summary')),
  parent_entry_id TEXT REFERENCES daily_entries(id) ON DELETE SET NULL,
  business_date TEXT NOT NULL CHECK (business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  content TEXT NOT NULL CHECK (length(trim(content)) > 0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  CHECK (parent_entry_id IS NULL OR parent_entry_id <> id)
);

CREATE TABLE goals (
  id TEXT PRIMARY KEY NOT NULL,
  life_area_id TEXT NOT NULL REFERENCES life_areas(id) ON DELETE RESTRICT,
  parent_goal_id TEXT REFERENCES goals(id) ON DELETE RESTRICT,
  goal_type TEXT NOT NULL CHECK (goal_type IN ('long-term', 'stage')),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'paused', 'archived')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  CHECK (parent_goal_id IS NULL OR parent_goal_id <> id),
  CHECK (goal_type <> 'long-term' OR parent_goal_id IS NULL)
);

CREATE TABLE actions (
  id TEXT PRIMARY KEY NOT NULL,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE RESTRICT,
  parent_action_id TEXT REFERENCES actions(id) ON DELETE RESTRICT,
  action_type TEXT NOT NULL CHECK (action_type IN ('weekly', 'today')),
  business_date TEXT CHECK (business_date IS NULL OR business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'skipped', 'archived')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  CHECK (parent_action_id IS NULL OR parent_action_id <> id),
  CHECK (action_type <> 'weekly' OR parent_action_id IS NULL)
);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY NOT NULL,
  review_type TEXT NOT NULL CHECK (review_type IN ('daily', 'weekly', 'monthly')),
  period_start TEXT NOT NULL CHECK (period_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  period_end_exclusive TEXT NOT NULL CHECK (period_end_exclusive GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  content TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  CHECK (period_end_exclusive > period_start)
);

CREATE TABLE knowledge_items (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  background TEXT NOT NULL DEFAULT '',
  problem TEXT NOT NULL DEFAULT '',
  insight TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  event_type TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE TABLE idempotency_keys (
  key TEXT PRIMARY KEY NOT NULL,
  operation TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX metric_records_date_idx ON metric_records (business_date);
CREATE INDEX daily_entries_date_idx ON daily_entries (business_date);
CREATE INDEX actions_date_status_idx ON actions (business_date, status);
CREATE INDEX audit_events_resource_idx ON audit_events (resource_type, resource_id, occurred_at);
