CREATE TABLE knowledge_modules (
  module_id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(module_id)) BETWEEN 1 AND 128),
  parent_module_id TEXT REFERENCES knowledge_modules(module_id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  goal TEXT NOT NULL DEFAULT '' CHECK (length(goal) <= 1000),
  current_focus TEXT NOT NULL DEFAULT '' CHECK (length(current_focus) <= 1000),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
  status TEXT NOT NULL CHECK (status IN ('learning', 'paused', 'long-term', 'archived')),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE daily_learning_notes (
  note_id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(note_id)) BETWEEN 1 AND 128),
  business_date TEXT NOT NULL CHECK (date(business_date) IS business_date),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  module_id TEXT NOT NULL REFERENCES knowledge_modules(module_id) ON DELETE RESTRICT,
  content TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 20000),
  source TEXT NOT NULL DEFAULT '' CHECK (length(source) <= 4000),
  personal_understanding TEXT NOT NULL DEFAULT '' CHECK (length(personal_understanding) <= 4000),
  open_questions TEXT NOT NULL DEFAULT '' CHECK (length(open_questions) <= 4000),
  application TEXT NOT NULL DEFAULT '' CHECK (length(application) <= 4000),
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE knowledge_item_organization (
  knowledge_item_id TEXT PRIMARY KEY NOT NULL
    REFERENCES knowledge_items(id) ON DELETE RESTRICT,
  module_id TEXT REFERENCES knowledge_modules(module_id) ON DELETE RESTRICT,
  source_daily_note_id TEXT REFERENCES daily_learning_notes(note_id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX knowledge_modules_parent_order_idx
  ON knowledge_modules (parent_module_id, ordinal, module_id);
CREATE INDEX knowledge_modules_status_order_idx
  ON knowledge_modules (status, ordinal, module_id);
CREATE UNIQUE INDEX knowledge_modules_active_sibling_name_unique
  ON knowledge_modules (coalesce(parent_module_id, ''), lower(trim(name)))
  WHERE status <> 'archived';
CREATE INDEX daily_learning_notes_date_idx
  ON daily_learning_notes (business_date DESC, updated_at DESC, note_id);
CREATE INDEX daily_learning_notes_module_date_idx
  ON daily_learning_notes (module_id, business_date DESC, note_id);
CREATE INDEX knowledge_item_organization_module_idx
  ON knowledge_item_organization (module_id, knowledge_item_id)
  WHERE module_id IS NOT NULL;
CREATE INDEX knowledge_item_organization_source_note_idx
  ON knowledge_item_organization (source_daily_note_id, knowledge_item_id)
  WHERE source_daily_note_id IS NOT NULL;

CREATE TRIGGER knowledge_modules_reject_delete
BEFORE DELETE ON knowledge_modules
BEGIN
  SELECT RAISE(ABORT, 'knowledge modules require archive status; physical delete is forbidden');
END;

CREATE TRIGGER daily_learning_notes_reject_delete
BEFORE DELETE ON daily_learning_notes
BEGIN
  SELECT RAISE(ABORT, 'daily learning notes require archive status; physical delete is forbidden');
END;

UPDATE app_meta SET value = '13' WHERE key = 'schema_version';
