PRAGMA defer_foreign_keys = ON;

CREATE TABLE knowledge_domains (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  display_order INTEGER NOT NULL UNIQUE CHECK (display_order >= 0)
);

INSERT INTO knowledge_domains (key, name, description, display_order) VALUES
  ('general',  '通用', '未特别归类的理念、方法和经验', 0),
  ('skincare', '护肤', '护肤理念、方法和经验', 1),
  ('sleep',    '睡眠', '睡眠理念、方法和经验', 2),
  ('exercise', '运动', '训练理念、方法和经验', 3);

CREATE TABLE knowledge_item_revision_json_v5_guard (
  snapshot_json TEXT NOT NULL
    CHECK (
      json_valid(snapshot_json)
      AND json_type(snapshot_json, '$') = 'object'
      AND (
        json_type(snapshot_json, '$.domainKey') IS NULL
        OR json_type(snapshot_json, '$.domainKey') IN ('null', 'text')
      )
    )
);

INSERT INTO knowledge_item_revision_json_v5_guard (snapshot_json)
SELECT snapshot_json FROM knowledge_item_revisions;

DROP TABLE knowledge_item_revision_json_v5_guard;

DROP TRIGGER knowledge_item_revisions_reject_update;

UPDATE knowledge_item_revisions
SET snapshot_json = json_set(snapshot_json, '$.domainKey', 'general')
WHERE json_type(snapshot_json, '$.domainKey') IS NULL
   OR json_type(snapshot_json, '$.domainKey') = 'null';

CREATE TABLE knowledge_items_v5 (
  id TEXT PRIMARY KEY NOT NULL,
  domain_key TEXT NOT NULL DEFAULT 'general'
    REFERENCES knowledge_domains(key) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  background TEXT NOT NULL DEFAULT '',
  problem TEXT NOT NULL DEFAULT '',
  insight TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  item_type TEXT NOT NULL DEFAULT 'note'
    CHECK (item_type IN ('note', 'principle', 'method', 'decision', 'experience')),
  maturity TEXT NOT NULL DEFAULT 'structured'
    CHECK (maturity IN ('structured', 'asset')),
  tags_json TEXT NOT NULL DEFAULT '[]',
  source_capture_id TEXT REFERENCES capture_items(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

INSERT INTO knowledge_items_v5 (
  id,
  domain_key,
  title,
  background,
  problem,
  insight,
  method,
  content,
  item_type,
  maturity,
  tags_json,
  source_capture_id,
  revision,
  created_at,
  updated_at,
  archived_at
)
SELECT
  id,
  'general',
  title,
  background,
  problem,
  insight,
  method,
  content,
  item_type,
  maturity,
  tags_json,
  source_capture_id,
  revision,
  created_at,
  updated_at,
  archived_at
FROM knowledge_items;

CREATE TABLE knowledge_candidates_v5 (
  id TEXT PRIMARY KEY NOT NULL,
  source_capture_id TEXT NOT NULL REFERENCES capture_items(id) ON DELETE RESTRICT,
  domain_key TEXT NOT NULL DEFAULT 'general'
    REFERENCES knowledge_domains(key) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  content TEXT NOT NULL CHECK (length(trim(content)) > 0),
  tags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_knowledge_item_id TEXT REFERENCES knowledge_items_v5(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  CHECK (
    (status = 'pending' AND decided_knowledge_item_id IS NULL AND decided_at IS NULL)
    OR
    (status = 'approved' AND decided_knowledge_item_id IS NOT NULL AND decided_at IS NOT NULL)
    OR
    (status = 'rejected' AND decided_knowledge_item_id IS NULL AND decided_at IS NOT NULL)
  )
);

INSERT INTO knowledge_candidates_v5 (
  id,
  source_capture_id,
  domain_key,
  title,
  content,
  tags_json,
  status,
  decided_knowledge_item_id,
  created_at,
  decided_at
)
SELECT
  id,
  source_capture_id,
  'general',
  title,
  content,
  tags_json,
  status,
  decided_knowledge_item_id,
  created_at,
  decided_at
FROM knowledge_candidates;

CREATE TABLE knowledge_item_revisions_v5 (
  id TEXT PRIMARY KEY NOT NULL,
  knowledge_item_id TEXT NOT NULL REFERENCES knowledge_items_v5(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (knowledge_item_id, revision)
);

INSERT INTO knowledge_item_revisions_v5 (
  id,
  knowledge_item_id,
  revision,
  snapshot_json,
  created_at
)
SELECT
  id,
  knowledge_item_id,
  revision,
  snapshot_json,
  created_at
FROM knowledge_item_revisions;

CREATE TABLE knowledge_asset_events_v5 (
  id TEXT PRIMARY KEY NOT NULL,
  knowledge_item_id TEXT NOT NULL REFERENCES knowledge_items_v5(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('promoted', 'validated')),
  note TEXT NOT NULL CHECK (length(trim(note)) > 0),
  occurred_at TEXT NOT NULL
);

INSERT INTO knowledge_asset_events_v5 (
  id,
  knowledge_item_id,
  event_type,
  note,
  occurred_at
)
SELECT
  id,
  knowledge_item_id,
  event_type,
  note,
  occurred_at
FROM knowledge_asset_events;

DROP TABLE knowledge_candidates;
DROP TABLE knowledge_item_revisions;
DROP TABLE knowledge_asset_events;
DROP TABLE knowledge_items;

ALTER TABLE knowledge_items_v5 RENAME TO knowledge_items;
ALTER TABLE knowledge_candidates_v5 RENAME TO knowledge_candidates;
ALTER TABLE knowledge_item_revisions_v5 RENAME TO knowledge_item_revisions;
ALTER TABLE knowledge_asset_events_v5 RENAME TO knowledge_asset_events;

CREATE INDEX knowledge_items_maturity_time_idx
  ON knowledge_items (maturity, updated_at DESC, id DESC);
CREATE INDEX knowledge_items_domain_maturity_time_idx
  ON knowledge_items (domain_key, maturity, updated_at DESC, id DESC);

CREATE INDEX knowledge_candidates_status_time_idx
  ON knowledge_candidates (status, created_at DESC, id DESC);
CREATE INDEX knowledge_candidates_source_time_idx
  ON knowledge_candidates (source_capture_id, created_at DESC, id DESC);
CREATE INDEX knowledge_candidates_domain_status_time_idx
  ON knowledge_candidates (domain_key, status, created_at DESC, id DESC);

CREATE INDEX knowledge_asset_events_item_time_idx
  ON knowledge_asset_events (knowledge_item_id, occurred_at, id);

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

UPDATE app_meta SET value = '5' WHERE key = 'schema_version';
