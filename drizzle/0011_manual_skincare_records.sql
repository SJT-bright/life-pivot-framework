CREATE TABLE manual_skincare_products (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 128),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  brand TEXT NOT NULL DEFAULT '' CHECK (length(brand) <= 160),
  current_purpose TEXT NOT NULL DEFAULT '' CHECK (length(current_purpose) <= 500),
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'finished')),
  added_on TEXT NOT NULL CHECK (date(added_on) IS added_on),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 4000),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE manual_skincare_routine_versions (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 128),
  revision INTEGER NOT NULL UNIQUE CHECK (revision >= 1),
  change_note TEXT NOT NULL DEFAULT '' CHECK (length(change_note) <= 1000),
  created_at TEXT NOT NULL
);

CREATE TABLE manual_skincare_routine_items (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 128),
  routine_version_id TEXT NOT NULL REFERENCES manual_skincare_routine_versions(id) ON DELETE RESTRICT,
  item_key TEXT NOT NULL CHECK (length(trim(item_key)) BETWEEN 1 AND 128),
  slot TEXT NOT NULL CHECK (slot IN ('morning', 'evening')),
  product_id TEXT NOT NULL REFERENCES manual_skincare_products(id) ON DELETE RESTRICT,
  product_name_snapshot TEXT NOT NULL CHECK (length(trim(product_name_snapshot)) BETWEEN 1 AND 160),
  brand_snapshot TEXT NOT NULL DEFAULT '' CHECK (length(brand_snapshot) <= 160),
  purpose_snapshot TEXT NOT NULL DEFAULT '' CHECK (length(purpose_snapshot) <= 500),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  created_at TEXT NOT NULL,
  UNIQUE (routine_version_id, item_key),
  UNIQUE (routine_version_id, slot, ordinal),
  UNIQUE (routine_version_id, slot, product_id)
);

CREATE TABLE manual_skincare_recovery_plans (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 128),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 4000),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE manual_skincare_recovery_cycles (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 128),
  plan_id TEXT NOT NULL REFERENCES manual_skincare_recovery_plans(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  goal TEXT NOT NULL CHECK (length(trim(goal)) BETWEEN 1 AND 1000),
  expected_end_on TEXT CHECK (expected_end_on IS NULL OR date(expected_end_on) IS expected_end_on),
  routine_version_id TEXT NOT NULL REFERENCES manual_skincare_routine_versions(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'completed')),
  actual_started_on TEXT CHECK (actual_started_on IS NULL OR date(actual_started_on) IS actual_started_on),
  actual_completed_on TEXT CHECK (actual_completed_on IS NULL OR date(actual_completed_on) IS actual_completed_on),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 4000),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (plan_id, ordinal),
  CHECK (
    (status = 'draft' AND actual_started_on IS NULL AND actual_completed_on IS NULL) OR
    (status = 'active' AND actual_started_on IS NOT NULL AND actual_completed_on IS NULL) OR
    (status = 'completed' AND actual_started_on IS NOT NULL AND actual_completed_on IS NOT NULL
      AND actual_completed_on >= actual_started_on)
  )
);

CREATE TABLE manual_skincare_routine_activations (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 128),
  routine_version_id TEXT NOT NULL REFERENCES manual_skincare_routine_versions(id) ON DELETE RESTRICT,
  recovery_cycle_id TEXT REFERENCES manual_skincare_recovery_cycles(id) ON DELETE RESTRICT,
  activation_sequence INTEGER NOT NULL UNIQUE CHECK (activation_sequence >= 1),
  effective_from TEXT NOT NULL CHECK (date(effective_from) IS effective_from),
  reason TEXT NOT NULL CHECK (reason IN ('manual-routine-update', 'recovery-cycle-start')),
  created_at TEXT NOT NULL,
  CHECK (
    (reason = 'manual-routine-update' AND recovery_cycle_id IS NULL) OR
    (reason = 'recovery-cycle-start' AND recovery_cycle_id IS NOT NULL)
  )
);

CREATE TABLE manual_skincare_days (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 128),
  business_date TEXT NOT NULL UNIQUE CHECK (date(business_date) IS business_date),
  routine_activation_id TEXT REFERENCES manual_skincare_routine_activations(id) ON DELETE RESTRICT,
  routine_version_id TEXT REFERENCES manual_skincare_routine_versions(id) ON DELETE RESTRICT,
  recovery_cycle_id TEXT REFERENCES manual_skincare_recovery_cycles(id) ON DELETE RESTRICT,
  recovery_cycle_name_snapshot TEXT NOT NULL DEFAULT '' CHECK (length(recovery_cycle_name_snapshot) <= 160),
  morning_note TEXT NOT NULL DEFAULT '' CHECK (length(morning_note) <= 4000),
  evening_note TEXT NOT NULL DEFAULT '' CHECK (length(evening_note) <= 4000),
  overall_note TEXT NOT NULL DEFAULT '' CHECK (length(overall_note) <= 4000),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (routine_activation_id IS NULL AND routine_version_id IS NULL AND recovery_cycle_id IS NULL
      AND recovery_cycle_name_snapshot = '') OR
    (routine_activation_id IS NOT NULL AND routine_version_id IS NOT NULL
      AND ((recovery_cycle_id IS NULL AND recovery_cycle_name_snapshot = '') OR
           (recovery_cycle_id IS NOT NULL
             AND length(trim(recovery_cycle_name_snapshot)) BETWEEN 1 AND 160)))
  )
);

CREATE TABLE manual_skincare_day_items (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 128),
  day_id TEXT NOT NULL REFERENCES manual_skincare_days(id) ON DELETE RESTRICT,
  item_key TEXT NOT NULL CHECK (length(trim(item_key)) BETWEEN 1 AND 128),
  slot TEXT NOT NULL CHECK (slot IN ('morning', 'evening')),
  product_id TEXT NOT NULL REFERENCES manual_skincare_products(id) ON DELETE RESTRICT,
  product_name_snapshot TEXT NOT NULL CHECK (length(trim(product_name_snapshot)) BETWEEN 1 AND 160),
  brand_snapshot TEXT NOT NULL DEFAULT '' CHECK (length(brand_snapshot) <= 160),
  purpose_snapshot TEXT NOT NULL DEFAULT '' CHECK (length(purpose_snapshot) <= 500),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  used INTEGER NOT NULL DEFAULT 0 CHECK (used IN (0, 1)),
  used_at TEXT,
  UNIQUE (day_id, item_key),
  UNIQUE (day_id, slot, ordinal),
  UNIQUE (day_id, slot, product_id),
  CHECK ((used = 0 AND used_at IS NULL) OR (used = 1 AND used_at IS NOT NULL))
);

CREATE INDEX manual_skincare_products_status_name_idx
  ON manual_skincare_products (status, name, id);
CREATE INDEX manual_skincare_routine_items_order_idx
  ON manual_skincare_routine_items (routine_version_id, slot, ordinal);
CREATE INDEX manual_skincare_recovery_cycles_order_idx
  ON manual_skincare_recovery_cycles (plan_id, ordinal);
CREATE UNIQUE INDEX manual_skincare_recovery_cycles_one_active
  ON manual_skincare_recovery_cycles ((1))
  WHERE status = 'active';
CREATE UNIQUE INDEX manual_skincare_routine_activations_cycle_unique
  ON manual_skincare_routine_activations (recovery_cycle_id)
  WHERE recovery_cycle_id IS NOT NULL;
CREATE INDEX manual_skincare_routine_activations_effective_idx
  ON manual_skincare_routine_activations (effective_from DESC, activation_sequence DESC);
CREATE INDEX manual_skincare_days_business_date_idx
  ON manual_skincare_days (business_date DESC);
CREATE INDEX manual_skincare_day_items_order_idx
  ON manual_skincare_day_items (day_id, slot, ordinal);

CREATE TRIGGER manual_skincare_products_reject_delete
BEFORE DELETE ON manual_skincare_products
BEGIN
  SELECT RAISE(ABORT, 'manual skincare products require archive status; physical delete is forbidden');
END;

CREATE TRIGGER manual_skincare_routine_versions_reject_replace
BEFORE INSERT ON manual_skincare_routine_versions
WHEN EXISTS (
  SELECT 1 FROM manual_skincare_routine_versions
  WHERE id = NEW.id OR revision = NEW.revision
)
BEGIN
  SELECT RAISE(ABORT, 'manual skincare routine versions are immutable');
END;

CREATE TRIGGER manual_skincare_routine_versions_reject_update
BEFORE UPDATE ON manual_skincare_routine_versions
BEGIN
  SELECT RAISE(ABORT, 'manual skincare routine versions are immutable');
END;

CREATE TRIGGER manual_skincare_routine_versions_reject_delete
BEFORE DELETE ON manual_skincare_routine_versions
BEGIN
  SELECT RAISE(ABORT, 'manual skincare routine versions are immutable');
END;

CREATE TRIGGER manual_skincare_routine_items_reject_replace
BEFORE INSERT ON manual_skincare_routine_items
WHEN EXISTS (
  SELECT 1 FROM manual_skincare_routine_items
  WHERE id = NEW.id
     OR (routine_version_id = NEW.routine_version_id AND item_key = NEW.item_key)
     OR (routine_version_id = NEW.routine_version_id AND slot = NEW.slot AND ordinal = NEW.ordinal)
     OR (routine_version_id = NEW.routine_version_id AND slot = NEW.slot AND product_id = NEW.product_id)
)
BEGIN
  SELECT RAISE(ABORT, 'manual skincare routine items are immutable');
END;

CREATE TRIGGER manual_skincare_routine_items_reject_update
BEFORE UPDATE ON manual_skincare_routine_items
BEGIN
  SELECT RAISE(ABORT, 'manual skincare routine items are immutable');
END;

CREATE TRIGGER manual_skincare_routine_items_reject_delete
BEFORE DELETE ON manual_skincare_routine_items
BEGIN
  SELECT RAISE(ABORT, 'manual skincare routine items are immutable');
END;

CREATE TRIGGER manual_skincare_routine_activations_reject_replace
BEFORE INSERT ON manual_skincare_routine_activations
WHEN EXISTS (
  SELECT 1 FROM manual_skincare_routine_activations
  WHERE id = NEW.id
     OR activation_sequence = NEW.activation_sequence
     OR (NEW.recovery_cycle_id IS NOT NULL AND recovery_cycle_id = NEW.recovery_cycle_id)
)
BEGIN
  SELECT RAISE(ABORT, 'manual skincare routine activations are immutable');
END;

CREATE TRIGGER manual_skincare_routine_activations_reject_update
BEFORE UPDATE ON manual_skincare_routine_activations
BEGIN
  SELECT RAISE(ABORT, 'manual skincare routine activations are immutable');
END;

CREATE TRIGGER manual_skincare_routine_activations_reject_delete
BEFORE DELETE ON manual_skincare_routine_activations
BEGIN
  SELECT RAISE(ABORT, 'manual skincare routine activations are immutable');
END;

UPDATE app_meta SET value = '12' WHERE key = 'schema_version';
