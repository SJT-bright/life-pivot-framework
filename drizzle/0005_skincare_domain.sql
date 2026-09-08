PRAGMA defer_foreign_keys = ON;

CREATE TABLE skincare_products (
  id TEXT PRIMARY KEY NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  model TEXT NOT NULL DEFAULT '',
  specification TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE skincare_formulations (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES skincare_products(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  version_label TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('draft', 'published')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  payload_schema_version TEXT,
  canonicalization_version TEXT,
  hash_algorithm TEXT,
  content_sha256 TEXT,
  snapshot_json TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  UNIQUE (id, product_id),
  CHECK (
    state = 'draft'
    OR (
      payload_schema_version IS NOT NULL
      AND canonicalization_version IS NOT NULL
      AND hash_algorithm = 'sha256'
      AND content_sha256 IS NOT NULL
      AND length(content_sha256) = 64
      AND content_sha256 NOT GLOB '*[^0-9a-f]*'
      AND snapshot_json IS NOT NULL
      AND json_valid(snapshot_json)
      AND published_at IS NOT NULL
    )
  )
);

CREATE TABLE skincare_ingredients (
  id TEXT PRIMARY KEY NOT NULL,
  canonical_name TEXT NOT NULL CHECK (length(trim(canonical_name)) > 0),
  normalized_name TEXT NOT NULL CHECK (length(trim(normalized_name)) > 0),
  category_key TEXT NOT NULL CHECK (
    category_key IN (
      'retinoid',
      'exfoliating_acid',
      'benzoyl_peroxide',
      'vitamin_c',
      'other_active',
      'supportive',
      'unknown'
    )
  ),
  aliases_json TEXT NOT NULL CHECK (json_valid(aliases_json)),
  source_note TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE skincare_formulation_ingredients (
  formulation_id TEXT NOT NULL REFERENCES skincare_formulations(id) ON DELETE RESTRICT,
  ingredient_id TEXT NOT NULL REFERENCES skincare_ingredients(id) ON DELETE RESTRICT,
  display_order INTEGER NOT NULL CHECK (display_order >= 0),
  is_key_active INTEGER NOT NULL CHECK (is_key_active IN (0, 1)),
  concentration_state TEXT NOT NULL CHECK (concentration_state IN ('unknown', 'known')),
  concentration_text TEXT,
  function_tags_json TEXT NOT NULL CHECK (json_valid(function_tags_json)),
  label_warnings_json TEXT NOT NULL CHECK (json_valid(label_warnings_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (formulation_id, ingredient_id),
  CHECK (
    (concentration_state = 'unknown' AND concentration_text IS NULL)
    OR (
      concentration_state = 'known'
      AND concentration_text IS NOT NULL
      AND length(trim(concentration_text)) > 0
    )
  )
);

CREATE TABLE skincare_product_units (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES skincare_products(id) ON DELETE RESTRICT,
  formulation_id TEXT NOT NULL,
  batch_note TEXT NOT NULL DEFAULT '',
  purchased_on TEXT,
  opened_on TEXT,
  expires_on TEXT,
  pao_months INTEGER CHECK (pao_months IS NULL OR pao_months BETWEEN 1 AND 120),
  status TEXT NOT NULL CHECK (status IN ('available', 'paused', 'depleted', 'expired', 'archived')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  UNIQUE (id, formulation_id),
  FOREIGN KEY (formulation_id, product_id)
    REFERENCES skincare_formulations(id, product_id) ON DELETE RESTRICT
);

CREATE TABLE skincare_ingredient_sensitivities (
  id TEXT PRIMARY KEY NOT NULL,
  ingredient_id TEXT NOT NULL REFERENCES skincare_ingredients(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('allergy', 'avoid')),
  note TEXT NOT NULL CHECK (length(trim(note)) > 0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE skincare_formulation_conflicts (
  id TEXT PRIMARY KEY NOT NULL,
  left_formulation_id TEXT NOT NULL REFERENCES skincare_formulations(id) ON DELETE RESTRICT,
  right_formulation_id TEXT NOT NULL REFERENCES skincare_formulations(id) ON DELETE RESTRICT,
  severity TEXT NOT NULL CHECK (severity IN ('block', 'acknowledgement')),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  source_note TEXT NOT NULL CHECK (length(trim(source_note)) > 0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  CHECK (left_formulation_id < right_formulation_id)
);

CREATE TABLE skincare_tolerance_events (
  id TEXT PRIMARY KEY NOT NULL,
  formulation_id TEXT NOT NULL REFERENCES skincare_formulations(id) ON DELETE RESTRICT,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('recorded', 'corrected', 'voided')),
  supersedes_event_id TEXT REFERENCES skincare_tolerance_events(id) ON DELETE RESTRICT,
  assessment_type TEXT NOT NULL CHECK (assessment_type IN ('patch_test', 'routine')),
  outcome TEXT NOT NULL CHECK (outcome IN ('tolerated', 'uncertain', 'adverse')),
  business_date TEXT NOT NULL CHECK (business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  note TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (supersedes_event_id),
  CHECK (supersedes_event_id IS NULL OR id <> supersedes_event_id),
  CHECK (
    (event_kind = 'recorded' AND supersedes_event_id IS NULL)
    OR (event_kind IN ('corrected', 'voided') AND supersedes_event_id IS NOT NULL)
  )
);

CREATE TABLE skincare_plans (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  scope TEXT NOT NULL CHECK (scope = 'face'),
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE skincare_plan_versions (
  id TEXT PRIMARY KEY NOT NULL,
  plan_id TEXT NOT NULL REFERENCES skincare_plans(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version >= 1),
  state TEXT NOT NULL CHECK (state IN ('draft', 'published', 'retired')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  effective_from TEXT,
  effective_to_exclusive TEXT,
  payload_schema_version TEXT,
  canonicalization_version TEXT,
  hash_algorithm TEXT,
  content_sha256 TEXT,
  snapshot_json TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    state = 'draft'
    OR (
      effective_from IS NOT NULL
      AND payload_schema_version IS NOT NULL
      AND canonicalization_version IS NOT NULL
      AND hash_algorithm = 'sha256'
      AND content_sha256 IS NOT NULL
      AND length(content_sha256) = 64
      AND content_sha256 NOT GLOB '*[^0-9a-f]*'
      AND snapshot_json IS NOT NULL
      AND json_valid(snapshot_json)
      AND published_at IS NOT NULL
    )
  ),
  CHECK (
    effective_to_exclusive IS NULL
    OR (effective_from IS NOT NULL AND effective_to_exclusive > effective_from)
  )
);

CREATE TABLE skincare_phases (
  id TEXT PRIMARY KEY NOT NULL,
  plan_version_id TEXT NOT NULL REFERENCES skincare_plan_versions(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  display_order INTEGER NOT NULL CHECK (display_order >= 0),
  start_day INTEGER NOT NULL CHECK (start_day >= 0),
  end_day_exclusive INTEGER NOT NULL CHECK (end_day_exclusive > start_day),
  created_at TEXT NOT NULL
);

CREATE TABLE skincare_steps (
  id TEXT PRIMARY KEY NOT NULL,
  phase_id TEXT NOT NULL REFERENCES skincare_phases(id) ON DELETE RESTRICT,
  slot TEXT NOT NULL CHECK (slot IN ('morning', 'evening')),
  display_order INTEGER NOT NULL CHECK (display_order >= 0),
  formulation_id TEXT NOT NULL REFERENCES skincare_formulations(id) ON DELETE RESTRICT,
  suggested_unit_id TEXT,
  area_key TEXT NOT NULL CHECK (
    area_key IN ('face', 'forehead', 'cheeks', 'nose', 'chin', 'eye_area', 'other')
  ),
  amount_text TEXT NOT NULL CHECK (length(trim(amount_text)) > 0),
  frequency_kind TEXT NOT NULL CHECK (frequency_kind IN ('daily', 'weekdays', 'interval')),
  weekday_mask INTEGER,
  every_days INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (suggested_unit_id, formulation_id)
    REFERENCES skincare_product_units(id, formulation_id) ON DELETE RESTRICT,
  CHECK (
    (frequency_kind = 'daily' AND weekday_mask IS NULL AND every_days IS NULL)
    OR (
      frequency_kind = 'weekdays'
      AND weekday_mask BETWEEN 1 AND 127
      AND every_days IS NULL
    )
    OR (
      frequency_kind = 'interval'
      AND every_days BETWEEN 1 AND 365
      AND weekday_mask IS NULL
    )
  )
);

CREATE TABLE skincare_cycles (
  id TEXT PRIMARY KEY NOT NULL,
  plan_version_id TEXT NOT NULL REFERENCES skincare_plan_versions(id) ON DELETE RESTRICT,
  start_date TEXT NOT NULL CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  end_date_exclusive TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'stopped')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (end_date_exclusive IS NULL OR end_date_exclusive > start_date)
);

CREATE TABLE skincare_safety_assessments (
  id TEXT PRIMARY KEY NOT NULL,
  plan_version_id TEXT NOT NULL REFERENCES skincare_plan_versions(id) ON DELETE RESTRICT,
  rules_version TEXT NOT NULL CHECK (length(trim(rules_version)) > 0),
  input_hash TEXT NOT NULL CHECK (
    length(input_hash) = 64 AND input_hash NOT GLOB '*[^0-9a-f]*'
  ),
  plan_content_hash TEXT NOT NULL CHECK (
    length(plan_content_hash) = 64 AND plan_content_hash NOT GLOB '*[^0-9a-f]*'
  ),
  result TEXT NOT NULL CHECK (result IN ('BLOCK', 'ACKNOWLEDGEMENT_REQUIRED', 'ALLOW')),
  findings_json TEXT NOT NULL CHECK (json_valid(findings_json)),
  evaluated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE skincare_plan_version_events (
  id TEXT PRIMARY KEY NOT NULL,
  plan_version_id TEXT NOT NULL REFERENCES skincare_plan_versions(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('activated', 'closed', 'stopped')),
  safety_assessment_id TEXT REFERENCES skincare_safety_assessments(id) ON DELETE RESTRICT,
  acknowledgements_json TEXT NOT NULL CHECK (json_valid(acknowledgements_json)),
  business_date TEXT NOT NULL CHECK (business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE skincare_usage_events (
  id TEXT PRIMARY KEY NOT NULL,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('recorded', 'corrected', 'voided')),
  supersedes_event_id TEXT REFERENCES skincare_usage_events(id) ON DELETE RESTRICT,
  outcome TEXT NOT NULL CHECK (outcome IN ('used', 'skipped', 'extra')),
  plan_version_id TEXT REFERENCES skincare_plan_versions(id) ON DELETE RESTRICT,
  step_id TEXT REFERENCES skincare_steps(id) ON DELETE RESTRICT,
  business_date TEXT NOT NULL CHECK (business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  slot TEXT NOT NULL CHECK (slot IN ('morning', 'evening')),
  formulation_id TEXT NOT NULL REFERENCES skincare_formulations(id) ON DELETE RESTRICT,
  product_unit_id TEXT,
  occurred_at TEXT NOT NULL,
  amount_text TEXT NOT NULL DEFAULT '',
  snapshot_schema_version TEXT NOT NULL CHECK (length(trim(snapshot_schema_version)) > 0),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  created_at TEXT NOT NULL,
  UNIQUE (supersedes_event_id),
  FOREIGN KEY (product_unit_id, formulation_id)
    REFERENCES skincare_product_units(id, formulation_id) ON DELETE RESTRICT,
  CHECK (supersedes_event_id IS NULL OR id <> supersedes_event_id),
  CHECK (
    (event_kind = 'recorded' AND supersedes_event_id IS NULL)
    OR (event_kind IN ('corrected', 'voided') AND supersedes_event_id IS NOT NULL)
  ),
  CHECK (
    (outcome = 'extra' AND plan_version_id IS NULL AND step_id IS NULL)
    OR (outcome IN ('used', 'skipped') AND plan_version_id IS NOT NULL AND step_id IS NOT NULL)
  ),
  CHECK (
    (outcome IN ('used', 'extra') AND product_unit_id IS NOT NULL)
    OR outcome = 'skipped'
  )
);

CREATE TABLE skin_observation_events (
  id TEXT PRIMARY KEY NOT NULL,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('recorded', 'corrected', 'voided')),
  supersedes_event_id TEXT REFERENCES skin_observation_events(id) ON DELETE RESTRICT,
  business_date TEXT NOT NULL CHECK (business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  occurred_at TEXT NOT NULL,
  area_key TEXT NOT NULL CHECK (
    area_key IN ('face', 'forehead', 'cheeks', 'nose', 'chin', 'eye_area', 'other')
  ),
  dryness INTEGER,
  oiliness INTEGER,
  redness INTEGER,
  acne INTEGER,
  stinging INTEGER,
  overall INTEGER,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (supersedes_event_id),
  CHECK (supersedes_event_id IS NULL OR id <> supersedes_event_id),
  CHECK (
    (event_kind = 'recorded' AND supersedes_event_id IS NULL)
    OR (event_kind IN ('corrected', 'voided') AND supersedes_event_id IS NOT NULL)
  ),
  CHECK (dryness IS NULL OR (typeof(dryness) = 'integer' AND dryness BETWEEN 0 AND 5)),
  CHECK (oiliness IS NULL OR (typeof(oiliness) = 'integer' AND oiliness BETWEEN 0 AND 5)),
  CHECK (redness IS NULL OR (typeof(redness) = 'integer' AND redness BETWEEN 0 AND 5)),
  CHECK (acne IS NULL OR (typeof(acne) = 'integer' AND acne BETWEEN 0 AND 5)),
  CHECK (stinging IS NULL OR (typeof(stinging) = 'integer' AND stinging BETWEEN 0 AND 5)),
  CHECK (overall IS NULL OR (typeof(overall) = 'integer' AND overall BETWEEN 0 AND 5)),
  CHECK (
    event_kind = 'voided'
    OR dryness IS NOT NULL
    OR oiliness IS NOT NULL
    OR redness IS NOT NULL
    OR acne IS NOT NULL
    OR stinging IS NOT NULL
    OR overall IS NOT NULL
    OR length(trim(note)) > 0
  )
);

CREATE TABLE skincare_adverse_events (
  id TEXT PRIMARY KEY NOT NULL,
  case_id TEXT NOT NULL CHECK (length(trim(case_id)) > 0),
  event_kind TEXT NOT NULL CHECK (event_kind IN ('recorded', 'corrected', 'voided')),
  supersedes_event_id TEXT REFERENCES skincare_adverse_events(id) ON DELETE RESTRICT,
  business_date TEXT NOT NULL CHECK (business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  occurred_at TEXT NOT NULL,
  description TEXT NOT NULL CHECK (length(trim(description)) > 0),
  severity TEXT NOT NULL CHECK (severity IN ('mild', 'moderate', 'severe')),
  handling_status TEXT NOT NULL CHECK (handling_status IN ('open', 'monitoring', 'resolved')),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (supersedes_event_id),
  CHECK (
    (event_kind = 'recorded' AND supersedes_event_id IS NULL)
    OR (event_kind IN ('corrected', 'voided') AND supersedes_event_id IS NOT NULL)
  )
);

CREATE TABLE skincare_adverse_usage_links (
  id TEXT PRIMARY KEY NOT NULL,
  adverse_case_id TEXT NOT NULL CHECK (length(trim(adverse_case_id)) > 0),
  usage_event_id TEXT REFERENCES skincare_usage_events(id) ON DELETE RESTRICT,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('linked', 'voided')),
  relation_type TEXT NOT NULL CHECK (relation_type IN ('temporal', 'suspected_by_user')),
  supersedes_link_id TEXT REFERENCES skincare_adverse_usage_links(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  UNIQUE (supersedes_link_id),
  CHECK (
    (event_kind = 'linked' AND supersedes_link_id IS NULL)
    OR (event_kind = 'voided' AND supersedes_link_id IS NOT NULL)
  )
);

CREATE INDEX skincare_products_status_name_idx
  ON skincare_products (status, name);
CREATE UNIQUE INDEX skincare_formulations_product_version_unique
  ON skincare_formulations (product_id, version_number);
CREATE UNIQUE INDEX skincare_formulations_one_draft_per_product
  ON skincare_formulations (product_id)
  WHERE state = 'draft' AND archived_at IS NULL;
CREATE UNIQUE INDEX skincare_ingredients_normalized_name_unique
  ON skincare_ingredients (normalized_name);
CREATE UNIQUE INDEX skincare_formulation_ingredients_order_unique
  ON skincare_formulation_ingredients (formulation_id, display_order);
CREATE INDEX skincare_product_units_status_product_idx
  ON skincare_product_units (status, product_id);
CREATE INDEX skincare_product_units_expiry_idx
  ON skincare_product_units (expires_on);
CREATE UNIQUE INDEX skincare_ingredient_sensitivities_active_unique
  ON skincare_ingredient_sensitivities (ingredient_id, kind)
  WHERE archived_at IS NULL;
CREATE UNIQUE INDEX skincare_formulation_conflicts_pair_unique
  ON skincare_formulation_conflicts (left_formulation_id, right_formulation_id)
  WHERE archived_at IS NULL;
CREATE INDEX skincare_tolerance_events_formulation_date_idx
  ON skincare_tolerance_events (formulation_id, business_date, occurred_at, id);
CREATE INDEX skincare_plans_status_updated_idx
  ON skincare_plans (status, updated_at DESC, id DESC);
CREATE UNIQUE INDEX skincare_plan_versions_plan_version_unique
  ON skincare_plan_versions (plan_id, version);
CREATE INDEX skincare_plan_versions_effective_idx
  ON skincare_plan_versions (plan_id, effective_from, effective_to_exclusive);
CREATE INDEX skincare_phases_version_range_idx
  ON skincare_phases (plan_version_id, start_day, end_day_exclusive);
CREATE UNIQUE INDEX skincare_steps_phase_slot_order_unique
  ON skincare_steps (phase_id, slot, display_order);
CREATE UNIQUE INDEX skincare_cycles_one_active
  ON skincare_cycles ((1))
  WHERE status = 'active';
CREATE INDEX skincare_safety_assessments_version_time_idx
  ON skincare_safety_assessments (plan_version_id, evaluated_at DESC, id DESC);
CREATE INDEX skincare_plan_version_events_version_time_idx
  ON skincare_plan_version_events (plan_version_id, occurred_at DESC, id DESC);
CREATE INDEX skincare_usage_events_date_slot_time_idx
  ON skincare_usage_events (business_date, slot, occurred_at DESC, id DESC);
CREATE INDEX skincare_usage_events_step_date_idx
  ON skincare_usage_events (step_id, business_date, occurred_at DESC, id DESC);
CREATE INDEX skin_observation_events_date_time_idx
  ON skin_observation_events (business_date, occurred_at DESC, id DESC);
CREATE INDEX skincare_adverse_events_status_date_idx
  ON skincare_adverse_events (handling_status, business_date, occurred_at DESC, id DESC);
CREATE INDEX skincare_adverse_usage_links_case_usage_idx
  ON skincare_adverse_usage_links (adverse_case_id, usage_event_id, id);

CREATE TRIGGER skincare_phases_reject_overlap_insert
BEFORE INSERT ON skincare_phases
WHEN EXISTS (
  SELECT 1
  FROM skincare_phases AS existing
  WHERE existing.plan_version_id = NEW.plan_version_id
    AND NEW.start_day < existing.end_day_exclusive
    AND existing.start_day < NEW.end_day_exclusive
)
BEGIN
  SELECT RAISE(ABORT, 'skincare phase ranges overlap');
END;

CREATE TRIGGER skincare_phases_reject_overlap_update
BEFORE UPDATE OF plan_version_id, start_day, end_day_exclusive ON skincare_phases
WHEN EXISTS (
  SELECT 1
  FROM skincare_phases AS existing
  WHERE existing.plan_version_id = NEW.plan_version_id
    AND existing.id <> OLD.id
    AND NEW.start_day < existing.end_day_exclusive
    AND existing.start_day < NEW.end_day_exclusive
)
BEGIN
  SELECT RAISE(ABORT, 'skincare phase ranges overlap');
END;

CREATE TRIGGER skincare_adverse_events_reject_case_switch
BEFORE INSERT ON skincare_adverse_events
WHEN NEW.supersedes_event_id IS NOT NULL
 AND COALESCE(
   (SELECT case_id FROM skincare_adverse_events WHERE id = NEW.supersedes_event_id),
   ''
 ) <> NEW.case_id
BEGIN
  SELECT RAISE(ABORT, 'adverse event correction cannot switch case');
END;

CREATE TRIGGER skincare_adverse_usage_links_require_current_case_leaf
BEFORE INSERT ON skincare_adverse_usage_links
WHEN NOT EXISTS (
  SELECT 1
  FROM skincare_adverse_events AS current_event
  WHERE current_event.case_id = NEW.adverse_case_id
    AND current_event.event_kind <> 'voided'
    AND NOT EXISTS (
      SELECT 1
      FROM skincare_adverse_events AS successor
      WHERE successor.supersedes_event_id = current_event.id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'adverse usage link requires a current non-void case leaf');
END;

CREATE TRIGGER skincare_adverse_usage_links_reject_case_switch
BEFORE INSERT ON skincare_adverse_usage_links
WHEN NEW.supersedes_link_id IS NOT NULL
 AND COALESCE(
   (SELECT adverse_case_id FROM skincare_adverse_usage_links WHERE id = NEW.supersedes_link_id),
   ''
 ) <> NEW.adverse_case_id
BEGIN
  SELECT RAISE(ABORT, 'adverse usage link cannot switch case');
END;

CREATE TRIGGER skincare_tolerance_events_reject_cycle
BEFORE INSERT ON skincare_tolerance_events
WHEN NEW.supersedes_event_id IS NOT NULL
 AND EXISTS (
   WITH RECURSIVE ancestors(id) AS (
     SELECT NEW.supersedes_event_id
     UNION
     SELECT event.supersedes_event_id
     FROM skincare_tolerance_events AS event
     JOIN ancestors ON event.id = ancestors.id
     WHERE event.supersedes_event_id IS NOT NULL
   )
   SELECT 1 FROM ancestors WHERE id = NEW.id
 )
BEGIN
  SELECT RAISE(ABORT, 'skincare tolerance event chain cycle');
END;

CREATE TRIGGER skincare_tolerance_events_reject_replace
BEFORE INSERT ON skincare_tolerance_events
WHEN EXISTS (
  SELECT 1
  FROM skincare_tolerance_events
  WHERE id = NEW.id
     OR (
       NEW.supersedes_event_id IS NOT NULL
       AND supersedes_event_id = NEW.supersedes_event_id
     )
)
BEGIN
  SELECT RAISE(ABORT, 'skincare tolerance events are immutable');
END;

CREATE TRIGGER skincare_tolerance_events_reject_update
BEFORE UPDATE ON skincare_tolerance_events
BEGIN
  SELECT RAISE(ABORT, 'skincare tolerance events are immutable');
END;

CREATE TRIGGER skincare_tolerance_events_reject_delete
BEFORE DELETE ON skincare_tolerance_events
BEGIN
  SELECT RAISE(ABORT, 'skincare tolerance events are immutable');
END;

CREATE TRIGGER skincare_safety_assessments_reject_replace
BEFORE INSERT ON skincare_safety_assessments
WHEN EXISTS (SELECT 1 FROM skincare_safety_assessments WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'skincare safety assessments are immutable');
END;

CREATE TRIGGER skincare_safety_assessments_reject_update
BEFORE UPDATE ON skincare_safety_assessments
BEGIN
  SELECT RAISE(ABORT, 'skincare safety assessments are immutable');
END;

CREATE TRIGGER skincare_safety_assessments_reject_delete
BEFORE DELETE ON skincare_safety_assessments
BEGIN
  SELECT RAISE(ABORT, 'skincare safety assessments are immutable');
END;

CREATE TRIGGER skincare_plan_version_events_reject_replace
BEFORE INSERT ON skincare_plan_version_events
WHEN EXISTS (SELECT 1 FROM skincare_plan_version_events WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'skincare plan version events are immutable');
END;

CREATE TRIGGER skincare_plan_version_events_reject_update
BEFORE UPDATE ON skincare_plan_version_events
BEGIN
  SELECT RAISE(ABORT, 'skincare plan version events are immutable');
END;

CREATE TRIGGER skincare_plan_version_events_reject_delete
BEFORE DELETE ON skincare_plan_version_events
BEGIN
  SELECT RAISE(ABORT, 'skincare plan version events are immutable');
END;

CREATE TRIGGER skincare_usage_events_reject_cycle
BEFORE INSERT ON skincare_usage_events
WHEN NEW.supersedes_event_id IS NOT NULL
 AND EXISTS (
   WITH RECURSIVE ancestors(id) AS (
     SELECT NEW.supersedes_event_id
     UNION
     SELECT event.supersedes_event_id
     FROM skincare_usage_events AS event
     JOIN ancestors ON event.id = ancestors.id
     WHERE event.supersedes_event_id IS NOT NULL
   )
   SELECT 1 FROM ancestors WHERE id = NEW.id
 )
BEGIN
  SELECT RAISE(ABORT, 'skincare usage event chain cycle');
END;

CREATE TRIGGER skincare_usage_events_reject_replace
BEFORE INSERT ON skincare_usage_events
WHEN EXISTS (
  SELECT 1
  FROM skincare_usage_events
  WHERE id = NEW.id
     OR (
       NEW.supersedes_event_id IS NOT NULL
       AND supersedes_event_id = NEW.supersedes_event_id
     )
)
BEGIN
  SELECT RAISE(ABORT, 'skincare usage events are immutable');
END;

CREATE TRIGGER skincare_usage_events_reject_update
BEFORE UPDATE ON skincare_usage_events
BEGIN
  SELECT RAISE(ABORT, 'skincare usage events are immutable');
END;

CREATE TRIGGER skincare_usage_events_reject_delete
BEFORE DELETE ON skincare_usage_events
BEGIN
  SELECT RAISE(ABORT, 'skincare usage events are immutable');
END;

CREATE TRIGGER skin_observation_events_reject_cycle
BEFORE INSERT ON skin_observation_events
WHEN NEW.supersedes_event_id IS NOT NULL
 AND EXISTS (
   WITH RECURSIVE ancestors(id) AS (
     SELECT NEW.supersedes_event_id
     UNION
     SELECT event.supersedes_event_id
     FROM skin_observation_events AS event
     JOIN ancestors ON event.id = ancestors.id
     WHERE event.supersedes_event_id IS NOT NULL
   )
   SELECT 1 FROM ancestors WHERE id = NEW.id
 )
BEGIN
  SELECT RAISE(ABORT, 'skin observation event chain cycle');
END;

CREATE TRIGGER skin_observation_events_reject_replace
BEFORE INSERT ON skin_observation_events
WHEN EXISTS (
  SELECT 1
  FROM skin_observation_events
  WHERE id = NEW.id
     OR (
       NEW.supersedes_event_id IS NOT NULL
       AND supersedes_event_id = NEW.supersedes_event_id
     )
)
BEGIN
  SELECT RAISE(ABORT, 'skin observation events are immutable');
END;

CREATE TRIGGER skin_observation_events_reject_update
BEFORE UPDATE ON skin_observation_events
BEGIN
  SELECT RAISE(ABORT, 'skin observation events are immutable');
END;

CREATE TRIGGER skin_observation_events_reject_delete
BEFORE DELETE ON skin_observation_events
BEGIN
  SELECT RAISE(ABORT, 'skin observation events are immutable');
END;

CREATE TRIGGER skincare_adverse_events_reject_replace
BEFORE INSERT ON skincare_adverse_events
WHEN EXISTS (
  SELECT 1
  FROM skincare_adverse_events
  WHERE id = NEW.id
     OR (
       NEW.supersedes_event_id IS NOT NULL
       AND supersedes_event_id = NEW.supersedes_event_id
     )
)
BEGIN
  SELECT RAISE(ABORT, 'skincare adverse events are immutable');
END;

CREATE TRIGGER skincare_adverse_events_reject_update
BEFORE UPDATE ON skincare_adverse_events
BEGIN
  SELECT RAISE(ABORT, 'skincare adverse events are immutable');
END;

CREATE TRIGGER skincare_adverse_events_reject_delete
BEFORE DELETE ON skincare_adverse_events
BEGIN
  SELECT RAISE(ABORT, 'skincare adverse events are immutable');
END;

CREATE TRIGGER skincare_adverse_usage_links_reject_replace
BEFORE INSERT ON skincare_adverse_usage_links
WHEN EXISTS (
  SELECT 1
  FROM skincare_adverse_usage_links
  WHERE id = NEW.id
     OR (
       NEW.supersedes_link_id IS NOT NULL
       AND supersedes_link_id = NEW.supersedes_link_id
     )
)
BEGIN
  SELECT RAISE(ABORT, 'skincare adverse usage links are immutable');
END;

CREATE TRIGGER skincare_adverse_usage_links_reject_update
BEFORE UPDATE ON skincare_adverse_usage_links
BEGIN
  SELECT RAISE(ABORT, 'skincare adverse usage links are immutable');
END;

CREATE TRIGGER skincare_adverse_usage_links_reject_delete
BEFORE DELETE ON skincare_adverse_usage_links
BEGIN
  SELECT RAISE(ABORT, 'skincare adverse usage links are immutable');
END;

CREATE TRIGGER skincare_formulations_reject_published_update
BEFORE UPDATE ON skincare_formulations
WHEN OLD.state = 'published'
BEGIN
  SELECT RAISE(ABORT, 'published skincare formulation is immutable');
END;

CREATE TRIGGER skincare_formulations_reject_published_delete
BEFORE DELETE ON skincare_formulations
WHEN OLD.state = 'published'
BEGIN
  SELECT RAISE(ABORT, 'published skincare formulation is immutable');
END;

CREATE TRIGGER skincare_formulations_reject_published_replace
BEFORE INSERT ON skincare_formulations
WHEN EXISTS (
  SELECT 1
  FROM skincare_formulations AS existing
  WHERE existing.state = 'published'
    AND (
      existing.id = NEW.id
      OR (
        existing.product_id = NEW.product_id
        AND existing.version_number = NEW.version_number
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'published skincare formulation is immutable');
END;

CREATE TRIGGER skincare_formulation_ingredients_reject_published_insert
BEFORE INSERT ON skincare_formulation_ingredients
WHEN EXISTS (
  SELECT 1 FROM skincare_formulations
  WHERE id = NEW.formulation_id AND state = 'published'
)
OR EXISTS (
  SELECT 1
  FROM skincare_formulation_ingredients AS existing
  JOIN skincare_formulations AS formulation ON formulation.id = existing.formulation_id
  WHERE formulation.state = 'published'
    AND (
      (existing.formulation_id = NEW.formulation_id AND existing.ingredient_id = NEW.ingredient_id)
      OR (existing.formulation_id = NEW.formulation_id AND existing.display_order = NEW.display_order)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'published skincare formulation content is immutable');
END;

CREATE TRIGGER skincare_formulation_ingredients_reject_published_update
BEFORE UPDATE ON skincare_formulation_ingredients
WHEN EXISTS (
  SELECT 1 FROM skincare_formulations
  WHERE id IN (OLD.formulation_id, NEW.formulation_id) AND state = 'published'
)
BEGIN
  SELECT RAISE(ABORT, 'published skincare formulation content is immutable');
END;

CREATE TRIGGER skincare_formulation_ingredients_reject_published_delete
BEFORE DELETE ON skincare_formulation_ingredients
WHEN EXISTS (
  SELECT 1 FROM skincare_formulations
  WHERE id = OLD.formulation_id AND state = 'published'
)
BEGIN
  SELECT RAISE(ABORT, 'published skincare formulation content is immutable');
END;

CREATE TRIGGER skincare_plan_versions_reject_published_update
BEFORE UPDATE ON skincare_plan_versions
WHEN OLD.state IN ('published', 'retired')
BEGIN
  SELECT RAISE(ABORT, 'published skincare plan version is immutable');
END;

CREATE TRIGGER skincare_plan_versions_reject_published_delete
BEFORE DELETE ON skincare_plan_versions
WHEN OLD.state IN ('published', 'retired')
BEGIN
  SELECT RAISE(ABORT, 'published skincare plan version is immutable');
END;

CREATE TRIGGER skincare_plan_versions_reject_published_replace
BEFORE INSERT ON skincare_plan_versions
WHEN EXISTS (
  SELECT 1
  FROM skincare_plan_versions AS existing
  WHERE existing.state IN ('published', 'retired')
    AND (
      existing.id = NEW.id
      OR (existing.plan_id = NEW.plan_id AND existing.version = NEW.version)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'published skincare plan version is immutable');
END;

CREATE TRIGGER skincare_phases_reject_published_insert
BEFORE INSERT ON skincare_phases
WHEN EXISTS (
  SELECT 1 FROM skincare_plan_versions
  WHERE id = NEW.plan_version_id AND state IN ('published', 'retired')
)
OR EXISTS (
  SELECT 1
  FROM skincare_phases AS existing
  JOIN skincare_plan_versions ON skincare_plan_versions.id = existing.plan_version_id
  WHERE existing.id = NEW.id
    AND skincare_plan_versions.state IN ('published', 'retired')
)
BEGIN
  SELECT RAISE(ABORT, 'published skincare plan content is immutable');
END;

CREATE TRIGGER skincare_phases_reject_published_update
BEFORE UPDATE ON skincare_phases
WHEN EXISTS (
  SELECT 1 FROM skincare_plan_versions
  WHERE id IN (OLD.plan_version_id, NEW.plan_version_id) AND state IN ('published', 'retired')
)
BEGIN
  SELECT RAISE(ABORT, 'published skincare plan content is immutable');
END;

CREATE TRIGGER skincare_phases_reject_published_delete
BEFORE DELETE ON skincare_phases
WHEN EXISTS (
  SELECT 1 FROM skincare_plan_versions
  WHERE id = OLD.plan_version_id AND state IN ('published', 'retired')
)
BEGIN
  SELECT RAISE(ABORT, 'published skincare plan content is immutable');
END;

CREATE TRIGGER skincare_steps_reject_published_insert
BEFORE INSERT ON skincare_steps
WHEN EXISTS (
  SELECT 1
  FROM skincare_phases
  JOIN skincare_plan_versions ON skincare_plan_versions.id = skincare_phases.plan_version_id
  WHERE skincare_phases.id = NEW.phase_id
    AND skincare_plan_versions.state IN ('published', 'retired')
)
OR EXISTS (
  SELECT 1
  FROM skincare_steps AS existing
  JOIN skincare_phases ON skincare_phases.id = existing.phase_id
  JOIN skincare_plan_versions ON skincare_plan_versions.id = skincare_phases.plan_version_id
  WHERE skincare_plan_versions.state IN ('published', 'retired')
    AND (
      existing.id = NEW.id
      OR (
        existing.phase_id = NEW.phase_id
        AND existing.slot = NEW.slot
        AND existing.display_order = NEW.display_order
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'published skincare plan content is immutable');
END;

CREATE TRIGGER skincare_steps_reject_published_update
BEFORE UPDATE ON skincare_steps
WHEN EXISTS (
  SELECT 1
  FROM skincare_phases
  JOIN skincare_plan_versions ON skincare_plan_versions.id = skincare_phases.plan_version_id
  WHERE skincare_phases.id IN (OLD.phase_id, NEW.phase_id)
    AND skincare_plan_versions.state IN ('published', 'retired')
)
BEGIN
  SELECT RAISE(ABORT, 'published skincare plan content is immutable');
END;

CREATE TRIGGER skincare_steps_reject_published_delete
BEFORE DELETE ON skincare_steps
WHEN EXISTS (
  SELECT 1
  FROM skincare_phases
  JOIN skincare_plan_versions ON skincare_plan_versions.id = skincare_phases.plan_version_id
  WHERE skincare_phases.id = OLD.phase_id
    AND skincare_plan_versions.state IN ('published', 'retired')
)
BEGIN
  SELECT RAISE(ABORT, 'published skincare plan content is immutable');
END;

UPDATE app_meta SET value = '6' WHERE key = 'schema_version';
