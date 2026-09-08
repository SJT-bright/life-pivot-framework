INSERT INTO life_areas
  (id, name, display_order, revision, created_at, updated_at, archived_at)
SELECT
  'life-area-general',
  '个人成长',
  0,
  1,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  NULL
WHERE NOT EXISTS (SELECT 1 FROM life_areas);

ALTER TABLE goals ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE goals ADD COLUMN start_date TEXT
  CHECK (start_date IS NULL OR start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
ALTER TABLE goals ADD COLUMN target_date TEXT
  CHECK (target_date IS NULL OR target_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
ALTER TABLE goals ADD COLUMN progress_percent INTEGER NOT NULL DEFAULT 0
  CHECK (progress_percent BETWEEN 0 AND 100);

PRAGMA defer_foreign_keys = ON;

CREATE TABLE actions_v3 (
  id TEXT PRIMARY KEY NOT NULL,
  goal_id TEXT REFERENCES goals(id) ON DELETE RESTRICT,
  parent_action_id TEXT REFERENCES actions_v3(id) ON DELETE RESTRICT,
  action_type TEXT NOT NULL CHECK (action_type IN ('weekly', 'today')),
  business_date TEXT
    CHECK (
      business_date IS NULL
      OR business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    ),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'skipped', 'archived')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  estimated_minutes INTEGER
    CHECK (estimated_minutes IS NULL OR estimated_minutes BETWEEN 1 AND 1440),
  notes TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  CHECK (parent_action_id IS NULL OR parent_action_id <> id),
  CHECK (action_type <> 'weekly' OR parent_action_id IS NULL)
);

INSERT INTO actions_v3
  (id, goal_id, parent_action_id, action_type, business_date, title, status,
   priority, estimated_minutes, notes, revision, created_at, updated_at, archived_at)
SELECT
  id,
  goal_id,
  parent_action_id,
  action_type,
  business_date,
  title,
  status,
  'normal',
  NULL,
  '',
  revision,
  created_at,
  updated_at,
  archived_at
FROM actions;

DROP TABLE actions;
ALTER TABLE actions_v3 RENAME TO actions;

CREATE INDEX actions_date_status_idx ON actions (business_date, status);
CREATE INDEX actions_parent_idx ON actions (parent_action_id, action_type);

CREATE TRIGGER actions_require_today_business_date_insert
BEFORE INSERT ON actions
WHEN NEW.action_type = 'today' AND NEW.business_date IS NULL
BEGIN
  SELECT RAISE(ABORT, 'today actions require a business date');
END;

CREATE TRIGGER actions_require_today_business_date_update
BEFORE UPDATE ON actions
WHEN NEW.action_type = 'today' AND NEW.business_date IS NULL
BEGIN
  SELECT RAISE(ABORT, 'today actions require a business date');
END;

CREATE TABLE action_events (
  id TEXT PRIMARY KEY NOT NULL,
  action_id TEXT NOT NULL REFERENCES actions(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('completed', 'skipped', 'reopened', 'rescheduled')),
  business_date TEXT NOT NULL
    CHECK (business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  from_business_date TEXT
    CHECK (
      from_business_date IS NULL
      OR from_business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    ),
  to_business_date TEXT
    CHECK (
      to_business_date IS NULL
      OR to_business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    ),
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  CHECK (
    (event_type = 'rescheduled' AND from_business_date IS NOT NULL AND to_business_date IS NOT NULL)
    OR
    (event_type <> 'rescheduled' AND from_business_date IS NULL AND to_business_date IS NULL)
  )
);

CREATE INDEX action_events_action_time_idx
  ON action_events (action_id, occurred_at, id);
CREATE INDEX action_events_business_date_idx
  ON action_events (business_date, event_type, occurred_at);

CREATE TABLE knowledge_candidates (
  id TEXT PRIMARY KEY NOT NULL,
  source_capture_id TEXT NOT NULL REFERENCES capture_items(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  content TEXT NOT NULL CHECK (length(trim(content)) > 0),
  tags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_knowledge_item_id TEXT REFERENCES knowledge_items(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  UNIQUE (source_capture_id),
  CHECK (
    (status = 'pending' AND decided_knowledge_item_id IS NULL AND decided_at IS NULL)
    OR
    (status = 'approved' AND decided_knowledge_item_id IS NOT NULL AND decided_at IS NOT NULL)
    OR
    (status = 'rejected' AND decided_knowledge_item_id IS NULL AND decided_at IS NOT NULL)
  )
);

CREATE INDEX knowledge_candidates_status_time_idx
  ON knowledge_candidates (status, created_at DESC, id DESC);

ALTER TABLE knowledge_items ADD COLUMN content TEXT NOT NULL DEFAULT '';
ALTER TABLE knowledge_items ADD COLUMN item_type TEXT NOT NULL DEFAULT 'note'
  CHECK (item_type IN ('note', 'principle', 'method', 'decision', 'experience'));
ALTER TABLE knowledge_items ADD COLUMN maturity TEXT NOT NULL DEFAULT 'structured'
  CHECK (maturity IN ('structured', 'asset'));
ALTER TABLE knowledge_items ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE knowledge_items ADD COLUMN source_capture_id TEXT
  REFERENCES capture_items(id) ON DELETE RESTRICT;

UPDATE knowledge_items
SET content = trim(
  CASE WHEN background <> '' THEN background || char(10) ELSE '' END ||
  CASE WHEN problem <> '' THEN problem || char(10) ELSE '' END ||
  CASE WHEN insight <> '' THEN insight || char(10) ELSE '' END ||
  method
)
WHERE content = '';

CREATE INDEX knowledge_items_maturity_time_idx
  ON knowledge_items (maturity, updated_at DESC, id DESC);

CREATE TABLE knowledge_item_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  knowledge_item_id TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (knowledge_item_id, revision)
);

INSERT INTO knowledge_item_revisions
  (id, knowledge_item_id, revision, snapshot_json, created_at)
SELECT
  'legacy-knowledge-revision-' || id,
  id,
  revision,
  json_object(
    'id', id,
    'title', title,
    'content', content,
    'itemType', item_type,
    'maturity', maturity,
    'tags', json(tags_json),
    'sourceCaptureId', source_capture_id,
    'revision', revision
  ),
  updated_at
FROM knowledge_items;

CREATE TABLE knowledge_asset_events (
  id TEXT PRIMARY KEY NOT NULL,
  knowledge_item_id TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('promoted', 'validated')),
  note TEXT NOT NULL CHECK (length(trim(note)) > 0),
  occurred_at TEXT NOT NULL
);

CREATE INDEX knowledge_asset_events_item_time_idx
  ON knowledge_asset_events (knowledge_item_id, occurred_at, id);

CREATE TABLE daily_summaries (
  id TEXT PRIMARY KEY NOT NULL,
  business_date TEXT NOT NULL UNIQUE
    CHECK (business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  important_events TEXT NOT NULL DEFAULT '',
  biggest_gain TEXT NOT NULL DEFAULT '',
  blockers TEXT NOT NULL DEFAULT '',
  tomorrow_focus TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO daily_summaries
  (id, business_date, important_events, biggest_gain, blockers, tomorrow_focus,
   revision, created_at, updated_at)
SELECT
  id,
  business_date,
  content,
  '',
  '',
  '',
  revision,
  created_at,
  updated_at
FROM (
  SELECT
    daily_entries.*,
    row_number() OVER (
      PARTITION BY business_date
      ORDER BY updated_at DESC, revision DESC, id DESC
    ) AS summary_rank
  FROM daily_entries
  WHERE entry_type = 'summary' AND archived_at IS NULL
)
WHERE summary_rank = 1;

CREATE TABLE daily_summary_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  daily_summary_id TEXT NOT NULL REFERENCES daily_summaries(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (daily_summary_id, revision)
);

INSERT INTO daily_summary_revisions
  (id, daily_summary_id, revision, snapshot_json, created_at)
SELECT
  'legacy-daily-summary-revision-' || id,
  id,
  revision,
  json_object(
    'id', id,
    'businessDate', business_date,
    'importantEvents', important_events,
    'biggestGain', biggest_gain,
    'blockers', blockers,
    'tomorrowFocus', tomorrow_focus,
    'revision', revision
  ),
  updated_at
FROM daily_summaries;

CREATE INDEX daily_summaries_updated_idx
  ON daily_summaries (business_date, updated_at DESC);

CREATE TABLE review_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (review_id, revision)
);

INSERT INTO review_revisions
  (id, review_id, revision, snapshot_json, created_at)
SELECT
  'legacy-review-revision-' || id,
  id,
  revision,
  json_object(
    'id', id,
    'reviewType', review_type,
    'periodStart', period_start,
    'periodEndExclusive', period_end_exclusive,
    'content', content,
    'revision', revision
  ),
  updated_at
FROM reviews;

UPDATE reviews
SET content = json_object(
  'highlights', content,
  'blockers', '',
  'lessons', '',
  'adjustments', '',
  'nextFocus', ''
);

UPDATE reviews
SET archived_at = updated_at
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      row_number() OVER (
        PARTITION BY review_type, period_start, period_end_exclusive
        ORDER BY updated_at DESC, revision DESC, id DESC
      ) AS current_rank
    FROM reviews
    WHERE archived_at IS NULL
  )
  WHERE current_rank > 1
);

CREATE UNIQUE INDEX reviews_current_period_unique
  ON reviews (review_type, period_start, period_end_exclusive)
  WHERE archived_at IS NULL;

CREATE TABLE evidence_links (
  id TEXT PRIMARY KEY NOT NULL,
  target_type TEXT NOT NULL
    CHECK (target_type IN ('daily_summary', 'review', 'knowledge_item')),
  target_id TEXT NOT NULL,
  target_revision INTEGER NOT NULL CHECK (target_revision >= 1),
  source_type TEXT NOT NULL
    CHECK (source_type IN ('capture', 'action_event', 'knowledge_item', 'daily_summary')),
  source_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (target_type, target_id, target_revision, source_type, source_id)
);

CREATE INDEX evidence_links_target_idx
  ON evidence_links (target_type, target_id, target_revision);
CREATE INDEX evidence_links_source_idx
  ON evidence_links (source_type, source_id);

CREATE TRIGGER capture_items_reject_replace
BEFORE INSERT ON capture_items
WHEN EXISTS (SELECT 1 FROM capture_items WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'capture_items are immutable');
END;

CREATE TRIGGER action_events_reject_replace
BEFORE INSERT ON action_events
WHEN EXISTS (SELECT 1 FROM action_events WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'action_events are immutable');
END;

CREATE TRIGGER action_events_reject_update
BEFORE UPDATE ON action_events
BEGIN
  SELECT RAISE(ABORT, 'action_events are immutable');
END;

CREATE TRIGGER action_events_reject_delete
BEFORE DELETE ON action_events
BEGIN
  SELECT RAISE(ABORT, 'action_events are immutable');
END;

CREATE TRIGGER knowledge_item_revisions_reject_replace
BEFORE INSERT ON knowledge_item_revisions
WHEN EXISTS (
  SELECT 1
  FROM knowledge_item_revisions
  WHERE id = NEW.id
     OR (knowledge_item_id = NEW.knowledge_item_id AND revision = NEW.revision)
)
BEGIN
  SELECT RAISE(ABORT, 'knowledge_item_revisions are immutable');
END;

CREATE TRIGGER knowledge_item_revisions_reject_update
BEFORE UPDATE ON knowledge_item_revisions
BEGIN
  SELECT RAISE(ABORT, 'knowledge_item_revisions are immutable');
END;

CREATE TRIGGER knowledge_item_revisions_reject_delete
BEFORE DELETE ON knowledge_item_revisions
BEGIN
  SELECT RAISE(ABORT, 'knowledge_item_revisions are immutable');
END;

CREATE TRIGGER knowledge_asset_events_reject_replace
BEFORE INSERT ON knowledge_asset_events
WHEN EXISTS (SELECT 1 FROM knowledge_asset_events WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'knowledge_asset_events are immutable');
END;

CREATE TRIGGER knowledge_asset_events_reject_update
BEFORE UPDATE ON knowledge_asset_events
BEGIN
  SELECT RAISE(ABORT, 'knowledge_asset_events are immutable');
END;

CREATE TRIGGER knowledge_asset_events_reject_delete
BEFORE DELETE ON knowledge_asset_events
BEGIN
  SELECT RAISE(ABORT, 'knowledge_asset_events are immutable');
END;

CREATE TRIGGER daily_summary_revisions_reject_replace
BEFORE INSERT ON daily_summary_revisions
WHEN EXISTS (
  SELECT 1
  FROM daily_summary_revisions
  WHERE id = NEW.id
     OR (daily_summary_id = NEW.daily_summary_id AND revision = NEW.revision)
)
BEGIN
  SELECT RAISE(ABORT, 'daily_summary_revisions are immutable');
END;

CREATE TRIGGER daily_summary_revisions_reject_update
BEFORE UPDATE ON daily_summary_revisions
BEGIN
  SELECT RAISE(ABORT, 'daily_summary_revisions are immutable');
END;

CREATE TRIGGER daily_summary_revisions_reject_delete
BEFORE DELETE ON daily_summary_revisions
BEGIN
  SELECT RAISE(ABORT, 'daily_summary_revisions are immutable');
END;

CREATE TRIGGER review_revisions_reject_replace
BEFORE INSERT ON review_revisions
WHEN EXISTS (
  SELECT 1
  FROM review_revisions
  WHERE id = NEW.id
     OR (review_id = NEW.review_id AND revision = NEW.revision)
)
BEGIN
  SELECT RAISE(ABORT, 'review_revisions are immutable');
END;

CREATE TRIGGER review_revisions_reject_update
BEFORE UPDATE ON review_revisions
BEGIN
  SELECT RAISE(ABORT, 'review_revisions are immutable');
END;

CREATE TRIGGER review_revisions_reject_delete
BEFORE DELETE ON review_revisions
BEGIN
  SELECT RAISE(ABORT, 'review_revisions are immutable');
END;

CREATE TRIGGER evidence_links_reject_replace
BEFORE INSERT ON evidence_links
WHEN EXISTS (
  SELECT 1
  FROM evidence_links
  WHERE id = NEW.id
     OR (
       target_type = NEW.target_type
       AND target_id = NEW.target_id
       AND target_revision = NEW.target_revision
       AND source_type = NEW.source_type
       AND source_id = NEW.source_id
     )
)
BEGIN
  SELECT RAISE(ABORT, 'evidence_links are immutable');
END;

CREATE TRIGGER evidence_links_reject_update
BEFORE UPDATE ON evidence_links
BEGIN
  SELECT RAISE(ABORT, 'evidence_links are immutable');
END;

CREATE TRIGGER evidence_links_reject_delete
BEFORE DELETE ON evidence_links
BEGIN
  SELECT RAISE(ABORT, 'evidence_links are immutable');
END;

UPDATE app_meta SET value = '3' WHERE key = 'schema_version';
