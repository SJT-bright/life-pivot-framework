CREATE TABLE user_pins (
  target_type TEXT NOT NULL CHECK (target_type IN (
    'knowledge-module',
    'knowledge-item',
    'exercise-template',
    'skincare-plan',
    'health-template'
  )),
  target_id TEXT NOT NULL CHECK (length(trim(target_id)) BETWEEN 1 AND 128),
  pinned_at TEXT NOT NULL,
  PRIMARY KEY (target_type, target_id)
);

CREATE INDEX user_pins_order_idx
  ON user_pins (pinned_at DESC, target_type, target_id);

UPDATE app_meta SET value = '14' WHERE key = 'schema_version';
