CREATE TABLE capture_items (
  id TEXT PRIMARY KEY NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('capture', 'correction', 'void')),
  corrects_item_id TEXT REFERENCES capture_items(id) ON DELETE RESTRICT,
  business_date TEXT NOT NULL CHECK (business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  occurred_at TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (corrects_item_id IS NULL OR corrects_item_id <> id),
  CHECK (
    (event_type = 'capture' AND corrects_item_id IS NULL AND length(trim(content)) > 0)
    OR
    (event_type IN ('correction', 'void') AND corrects_item_id IS NOT NULL AND length(trim(content)) > 0)
  )
);

CREATE INDEX capture_items_timeline_idx
  ON capture_items (business_date, occurred_at DESC, created_at DESC, id DESC);

CREATE INDEX capture_items_correction_idx
  ON capture_items (corrects_item_id, created_at, id);

CREATE TRIGGER capture_items_reject_update
BEFORE UPDATE ON capture_items
BEGIN
  SELECT RAISE(ABORT, 'capture_items are immutable');
END;

CREATE TRIGGER capture_items_reject_delete
BEFORE DELETE ON capture_items
BEGIN
  SELECT RAISE(ABORT, 'capture_items are immutable');
END;

INSERT INTO capture_items
  (id, event_type, corrects_item_id, business_date, occurred_at, content, created_at)
SELECT id, 'capture', NULL, business_date, created_at, content, created_at
FROM daily_entries
WHERE entry_type = 'capture';

INSERT INTO capture_items
  (id, event_type, corrects_item_id, business_date, occurred_at, content, created_at)
SELECT lower(hex(randomblob(16))), 'void', id, business_date, archived_at,
       '由旧版归档状态迁移', archived_at
FROM daily_entries
WHERE entry_type = 'capture' AND archived_at IS NOT NULL;

UPDATE app_meta SET value = '2' WHERE key = 'schema_version';
