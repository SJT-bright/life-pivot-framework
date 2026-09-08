PRAGMA defer_foreign_keys = ON;

CREATE TABLE knowledge_candidates_v4 (
  id TEXT PRIMARY KEY NOT NULL,
  source_capture_id TEXT NOT NULL REFERENCES capture_items(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  content TEXT NOT NULL CHECK (length(trim(content)) > 0),
  tags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_knowledge_item_id TEXT REFERENCES knowledge_items(id) ON DELETE RESTRICT,
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

INSERT INTO knowledge_candidates_v4 (
  id,
  source_capture_id,
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
  title,
  content,
  tags_json,
  status,
  decided_knowledge_item_id,
  created_at,
  decided_at
FROM knowledge_candidates;

DROP TABLE knowledge_candidates;
ALTER TABLE knowledge_candidates_v4 RENAME TO knowledge_candidates;

CREATE INDEX knowledge_candidates_status_time_idx
  ON knowledge_candidates (status, created_at DESC, id DESC);

CREATE INDEX knowledge_candidates_source_time_idx
  ON knowledge_candidates (source_capture_id, created_at DESC, id DESC);

UPDATE app_meta SET value = '4' WHERE key = 'schema_version';
