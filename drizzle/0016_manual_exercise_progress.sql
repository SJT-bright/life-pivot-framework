CREATE TABLE manual_exercise_progress_decisions (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 128),
  template_id TEXT NOT NULL REFERENCES manual_exercise_templates(id) ON DELETE RESTRICT,
  from_version_id TEXT NOT NULL REFERENCES manual_exercise_template_versions(id) ON DELETE RESTRICT,
  to_version_id TEXT NOT NULL REFERENCES manual_exercise_template_versions(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('tracked', 'excluded')),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (from_version_id <> to_version_id),
  UNIQUE (template_id, from_version_id, to_version_id)
);

CREATE INDEX manual_exercise_progress_decisions_template_idx
  ON manual_exercise_progress_decisions (template_id, updated_at DESC);

CREATE TRIGGER manual_exercise_progress_decisions_reject_delete
BEFORE DELETE ON manual_exercise_progress_decisions
BEGIN
  SELECT RAISE(ABORT, 'manual exercise progress decisions require revisioned updates');
END;

UPDATE app_meta SET value = '17' WHERE key = 'schema_version';
