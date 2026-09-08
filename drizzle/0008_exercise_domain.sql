CREATE TABLE exercise_movements (
  id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  category TEXT NOT NULL CHECK(category IN ('strength','cardio','mobility')),
  revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision > 0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT
);
CREATE TABLE exercise_movement_variants (
  id TEXT PRIMARY KEY NOT NULL, movement_id TEXT NOT NULL REFERENCES exercise_movements(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK(length(trim(name)) > 0), equipment TEXT NOT NULL,
  laterality TEXT NOT NULL CHECK(laterality IN ('none','left-right','bilateral')),
  measure_kind TEXT NOT NULL CHECK(measure_kind IN ('strength','cardio','mobility')),
  default_display_unit TEXT NOT NULL CHECK(default_display_unit IN ('kg','lb','meter','second','none')),
  revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision > 0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT
);
CREATE TABLE training_plans (
  id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT
);
CREATE TABLE training_plan_versions (
  id TEXT PRIMARY KEY NOT NULL, plan_id TEXT NOT NULL REFERENCES training_plans(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version > 0),
  cycle_length_days INTEGER NOT NULL CHECK(typeof(cycle_length_days)='integer' AND cycle_length_days BETWEEN 1 AND 365),
  normalization_version TEXT NOT NULL CHECK(normalization_version='training-plan-v1'),
  hash_algorithm TEXT NOT NULL CHECK(hash_algorithm='sha256'),
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  normalized_snapshot_json TEXT NOT NULL, published_at TEXT NOT NULL,
  UNIQUE(plan_id,version)
);
CREATE TABLE training_workout_templates (
  id TEXT PRIMARY KEY NOT NULL, plan_version_id TEXT NOT NULL REFERENCES training_plan_versions(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK(length(trim(name)) > 0), day_offset INTEGER NOT NULL CHECK(typeof(day_offset)='integer' AND day_offset >= 0),
  ordinal INTEGER NOT NULL CHECK(typeof(ordinal)='integer' AND ordinal >= 0),
  UNIQUE(plan_version_id,day_offset,ordinal)
);
CREATE TABLE training_prescriptions (
  id TEXT PRIMARY KEY NOT NULL, workout_template_id TEXT NOT NULL REFERENCES training_workout_templates(id) ON DELETE RESTRICT,
  movement_variant_id TEXT NOT NULL REFERENCES exercise_movement_variants(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK(typeof(ordinal)='integer' AND ordinal >= 0),
  measure_kind TEXT NOT NULL CHECK(measure_kind IN ('strength','cardio','mobility')),
  rest_seconds INTEGER CHECK(rest_seconds IS NULL OR (typeof(rest_seconds)='integer' AND rest_seconds BETWEEN 0 AND 86400)),
  note TEXT NOT NULL, UNIQUE(workout_template_id,ordinal)
);
CREATE TABLE strength_prescriptions (
  prescription_id TEXT PRIMARY KEY NOT NULL REFERENCES training_prescriptions(id) ON DELETE RESTRICT,
  target_sets INTEGER NOT NULL CHECK(typeof(target_sets)='integer' AND target_sets > 0),
  reps_min INTEGER NOT NULL CHECK(typeof(reps_min)='integer' AND reps_min >= 0),
  reps_max INTEGER NOT NULL CHECK(typeof(reps_max)='integer' AND reps_max >= reps_min),
  load_strategy TEXT NOT NULL CHECK(load_strategy IN ('fixed','rpe-target','rir-target','bodyweight','assisted','machine-level','user-choice')),
  target_load_value INTEGER CHECK(target_load_value IS NULL OR (typeof(target_load_value)='integer' AND target_load_value > 0)),
  rpe_min_x2 INTEGER CHECK(rpe_min_x2 IS NULL OR (typeof(rpe_min_x2)='integer' AND rpe_min_x2 BETWEEN 0 AND 20)),
  rpe_max_x2 INTEGER CHECK(rpe_max_x2 IS NULL OR (typeof(rpe_max_x2)='integer' AND rpe_max_x2 BETWEEN 0 AND 20)),
  rir_min_x2 INTEGER CHECK(rir_min_x2 IS NULL OR (typeof(rir_min_x2)='integer' AND rir_min_x2 BETWEEN 0 AND 20)),
  rir_max_x2 INTEGER CHECK(rir_max_x2 IS NULL OR (typeof(rir_max_x2)='integer' AND rir_max_x2 BETWEEN 0 AND 20)),
  CHECK(rpe_min_x2 IS NULL OR rpe_max_x2 IS NULL OR rpe_min_x2 <= rpe_max_x2),
  CHECK(rir_min_x2 IS NULL OR rir_max_x2 IS NULL OR rir_min_x2 <= rir_max_x2)
);
CREATE TABLE cardio_prescriptions (
  prescription_id TEXT PRIMARY KEY NOT NULL REFERENCES training_prescriptions(id) ON DELETE RESTRICT,
  duration_min_seconds INTEGER NOT NULL CHECK(typeof(duration_min_seconds)='integer' AND duration_min_seconds > 0),
  duration_max_seconds INTEGER NOT NULL CHECK(typeof(duration_max_seconds)='integer' AND duration_max_seconds >= duration_min_seconds),
  distance_min_meters INTEGER CHECK(distance_min_meters IS NULL OR (typeof(distance_min_meters)='integer' AND distance_min_meters > 0)),
  distance_max_meters INTEGER CHECK(distance_max_meters IS NULL OR (typeof(distance_max_meters)='integer' AND distance_max_meters > 0)),
  intensity_min_x2 INTEGER CHECK(intensity_min_x2 IS NULL OR (typeof(intensity_min_x2)='integer' AND intensity_min_x2 BETWEEN 0 AND 20)),
  intensity_max_x2 INTEGER CHECK(intensity_max_x2 IS NULL OR (typeof(intensity_max_x2)='integer' AND intensity_max_x2 BETWEEN 0 AND 20)),
  CHECK(distance_min_meters IS NULL OR distance_max_meters IS NULL OR distance_min_meters <= distance_max_meters),
  CHECK(intensity_min_x2 IS NULL OR intensity_max_x2 IS NULL OR intensity_min_x2 <= intensity_max_x2)
);
CREATE TABLE mobility_prescriptions (
  prescription_id TEXT PRIMARY KEY NOT NULL REFERENCES training_prescriptions(id) ON DELETE RESTRICT,
  target_holds INTEGER NOT NULL CHECK(typeof(target_holds)='integer' AND target_holds > 0),
  duration_min_seconds INTEGER NOT NULL CHECK(typeof(duration_min_seconds)='integer' AND duration_min_seconds > 0),
  duration_max_seconds INTEGER NOT NULL CHECK(typeof(duration_max_seconds)='integer' AND duration_max_seconds >= duration_min_seconds),
  side TEXT NOT NULL CHECK(side IN ('left','right','both','none')),
  intensity_min_x2 INTEGER CHECK(intensity_min_x2 IS NULL OR (typeof(intensity_min_x2)='integer' AND intensity_min_x2 BETWEEN 0 AND 20)),
  intensity_max_x2 INTEGER CHECK(intensity_max_x2 IS NULL OR (typeof(intensity_max_x2)='integer' AND intensity_max_x2 BETWEEN 0 AND 20)),
  CHECK(intensity_min_x2 IS NULL OR intensity_max_x2 IS NULL OR intensity_min_x2 <= intensity_max_x2)
);
CREATE TABLE training_cycles (
  id TEXT PRIMARY KEY NOT NULL, plan_version_id TEXT NOT NULL REFERENCES training_plan_versions(id) ON DELETE RESTRICT,
  start_date TEXT NOT NULL CHECK(start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  end_exclusive TEXT NOT NULL CHECK(end_exclusive GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND end_exclusive > start_date),
  status TEXT NOT NULL CHECK(status IN ('active','completed','terminated')), created_at TEXT NOT NULL, ended_at TEXT
);
CREATE TABLE training_planned_occurrences (
  id TEXT PRIMARY KEY NOT NULL, cycle_id TEXT NOT NULL REFERENCES training_cycles(id) ON DELETE RESTRICT,
  workout_template_id TEXT NOT NULL REFERENCES training_workout_templates(id) ON DELETE RESTRICT,
  original_business_date TEXT NOT NULL CHECK(original_business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  current_business_date TEXT NOT NULL CHECK(current_business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  disposition TEXT NOT NULL CHECK(disposition IN ('scheduled','skipped')),
  revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision > 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(cycle_id,workout_template_id,original_business_date)
);
CREATE TABLE training_sessions (
  id TEXT PRIMARY KEY NOT NULL, occurrence_id TEXT REFERENCES training_planned_occurrences(id) ON DELETE RESTRICT,
  business_date TEXT NOT NULL CHECK(business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'), created_at TEXT NOT NULL
);
CREATE TABLE training_session_events (
  id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL REFERENCES training_sessions(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK(event_type IN ('started','completed','abandoned','corrected','voided')),
  effective_status TEXT NOT NULL CHECK(effective_status IN ('in-progress','completed','abandoned','voided')),
  started_at TEXT NOT NULL, ended_at TEXT, note TEXT NOT NULL,
  supersedes_event_id TEXT REFERENCES training_session_events(id) ON DELETE RESTRICT, occurred_at TEXT NOT NULL,
  CHECK(supersedes_event_id IS NULL OR supersedes_event_id <> id),
  CHECK((event_type='started' AND supersedes_event_id IS NULL AND effective_status='in-progress' AND ended_at IS NULL) OR
        (event_type IN ('completed','abandoned','corrected','voided') AND supersedes_event_id IS NOT NULL)),
  CHECK(ended_at IS NULL OR ended_at >= started_at)
);
CREATE TABLE strength_set_events (
  id TEXT PRIMARY KEY NOT NULL, result_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('recorded','corrected','voided')),
  session_id TEXT NOT NULL REFERENCES training_sessions(id) ON DELETE RESTRICT,
  prescription_id TEXT REFERENCES training_prescriptions(id) ON DELETE RESTRICT,
  movement_variant_id TEXT NOT NULL REFERENCES exercise_movement_variants(id) ON DELETE RESTRICT,
  movement_snapshot_json TEXT NOT NULL, ordinal INTEGER NOT NULL CHECK(typeof(ordinal)='integer' AND ordinal >= 0),
  reps INTEGER NOT NULL CHECK(typeof(reps)='integer' AND reps >= 0),
  load_mode TEXT NOT NULL CHECK(load_mode IN ('external','bodyweight','assisted','machine-level','unloaded')),
  load_value INTEGER, display_load_unit TEXT CHECK(display_load_unit IS NULL OR display_load_unit IN ('kg','lb')),
  rpe_x2 INTEGER CHECK(rpe_x2 IS NULL OR (typeof(rpe_x2)='integer' AND rpe_x2 BETWEEN 0 AND 20)),
  rir_x2 INTEGER CHECK(rir_x2 IS NULL OR (typeof(rir_x2)='integer' AND rir_x2 BETWEEN 0 AND 20)),
  rest_seconds INTEGER CHECK(rest_seconds IS NULL OR (typeof(rest_seconds)='integer' AND rest_seconds >= 0)),
  supersedes_event_id TEXT REFERENCES strength_set_events(id) ON DELETE RESTRICT, occurred_at TEXT NOT NULL,
  CHECK((event_type='recorded' AND supersedes_event_id IS NULL) OR (event_type IN ('corrected','voided') AND supersedes_event_id IS NOT NULL)),
  CHECK((load_mode IN ('external','assisted') AND typeof(load_value)='integer' AND load_value > 0 AND display_load_unit IN ('kg','lb')) OR
        (load_mode='machine-level' AND typeof(load_value)='integer' AND load_value > 0 AND display_load_unit IS NULL) OR
        (load_mode IN ('bodyweight','unloaded') AND load_value IS NULL AND display_load_unit IS NULL))
);
CREATE TABLE cardio_segment_events (
  id TEXT PRIMARY KEY NOT NULL, result_id TEXT NOT NULL, event_type TEXT NOT NULL CHECK(event_type IN ('recorded','corrected','voided')),
  session_id TEXT NOT NULL REFERENCES training_sessions(id) ON DELETE RESTRICT, prescription_id TEXT REFERENCES training_prescriptions(id) ON DELETE RESTRICT,
  movement_variant_id TEXT NOT NULL REFERENCES exercise_movement_variants(id) ON DELETE RESTRICT, movement_snapshot_json TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(typeof(ordinal)='integer' AND ordinal >= 0),
  duration_seconds INTEGER NOT NULL CHECK(typeof(duration_seconds)='integer' AND duration_seconds > 0),
  distance_meters INTEGER CHECK(distance_meters IS NULL OR (typeof(distance_meters)='integer' AND distance_meters > 0)),
  intensity_x2 INTEGER CHECK(intensity_x2 IS NULL OR (typeof(intensity_x2)='integer' AND intensity_x2 BETWEEN 0 AND 20)),
  supersedes_event_id TEXT REFERENCES cardio_segment_events(id) ON DELETE RESTRICT, occurred_at TEXT NOT NULL,
  CHECK((event_type='recorded' AND supersedes_event_id IS NULL) OR (event_type IN ('corrected','voided') AND supersedes_event_id IS NOT NULL))
);
CREATE TABLE mobility_hold_events (
  id TEXT PRIMARY KEY NOT NULL, result_id TEXT NOT NULL, event_type TEXT NOT NULL CHECK(event_type IN ('recorded','corrected','voided')),
  session_id TEXT NOT NULL REFERENCES training_sessions(id) ON DELETE RESTRICT, prescription_id TEXT REFERENCES training_prescriptions(id) ON DELETE RESTRICT,
  movement_variant_id TEXT NOT NULL REFERENCES exercise_movement_variants(id) ON DELETE RESTRICT, movement_snapshot_json TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(typeof(ordinal)='integer' AND ordinal >= 0),
  duration_seconds INTEGER NOT NULL CHECK(typeof(duration_seconds)='integer' AND duration_seconds > 0),
  side TEXT NOT NULL CHECK(side IN ('left','right','both','none')),
  intensity_x2 INTEGER CHECK(intensity_x2 IS NULL OR (typeof(intensity_x2)='integer' AND intensity_x2 BETWEEN 0 AND 20)),
  supersedes_event_id TEXT REFERENCES mobility_hold_events(id) ON DELETE RESTRICT, occurred_at TEXT NOT NULL,
  CHECK((event_type='recorded' AND supersedes_event_id IS NULL) OR (event_type IN ('corrected','voided') AND supersedes_event_id IS NOT NULL))
);
CREATE TABLE training_recovery_observations (id TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE training_recovery_observation_events (
  id TEXT PRIMARY KEY NOT NULL, observation_id TEXT NOT NULL REFERENCES training_recovery_observations(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK(event_type IN ('recorded','corrected','voided')),
  business_date TEXT NOT NULL CHECK(business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  scale_version TEXT NOT NULL CHECK(scale_version='training-recovery-v1'),
  fatigue_score INTEGER CHECK(fatigue_score IS NULL OR (typeof(fatigue_score)='integer' AND fatigue_score BETWEEN 0 AND 5)),
  soreness_score INTEGER CHECK(soreness_score IS NULL OR (typeof(soreness_score)='integer' AND soreness_score BETWEEN 0 AND 5)),
  readiness_score INTEGER CHECK(readiness_score IS NULL OR (typeof(readiness_score)='integer' AND readiness_score BETWEEN 0 AND 5)),
  pain_region TEXT, pain_severity INTEGER CHECK(pain_severity IS NULL OR (typeof(pain_severity)='integer' AND pain_severity BETWEEN 0 AND 5)), note TEXT NOT NULL,
  supersedes_event_id TEXT REFERENCES training_recovery_observation_events(id) ON DELETE RESTRICT, occurred_at TEXT NOT NULL,
  CHECK((event_type='recorded' AND supersedes_event_id IS NULL) OR (event_type IN ('corrected','voided') AND supersedes_event_id IS NOT NULL)),
  CHECK(pain_severity IS NULL OR length(trim(pain_region)) > 0),
  CHECK(fatigue_score IS NOT NULL OR soreness_score IS NOT NULL OR readiness_score IS NOT NULL OR pain_severity IS NOT NULL OR length(trim(COALESCE(pain_region,''))) > 0 OR length(trim(note)) > 0)
);

CREATE INDEX exercise_movements_active_name_idx ON exercise_movements(archived_at,name,id);
CREATE INDEX exercise_variants_movement_idx ON exercise_movement_variants(movement_id,archived_at,id);
CREATE UNIQUE INDEX training_plan_versions_version_unique ON training_plan_versions(plan_id,version);
CREATE UNIQUE INDEX training_templates_day_ordinal_unique ON training_workout_templates(plan_version_id,day_offset,ordinal);
CREATE UNIQUE INDEX training_prescriptions_ordinal_unique ON training_prescriptions(workout_template_id,ordinal);
CREATE INDEX training_cycles_range_idx ON training_cycles(start_date,end_exclusive,status,id);
CREATE UNIQUE INDEX training_cycles_one_active ON training_cycles(status) WHERE status='active';
CREATE INDEX training_occurrences_date_idx ON training_planned_occurrences(current_business_date,disposition,id);
CREATE UNIQUE INDEX training_occurrences_coordinate_unique ON training_planned_occurrences(cycle_id,workout_template_id,original_business_date);
CREATE UNIQUE INDEX training_sessions_occurrence_unique ON training_sessions(occurrence_id) WHERE occurrence_id IS NOT NULL;
CREATE INDEX training_sessions_date_idx ON training_sessions(business_date DESC,id DESC);
CREATE INDEX training_session_events_session_idx ON training_session_events(session_id,occurred_at DESC,id DESC);
CREATE UNIQUE INDEX training_session_events_supersedes_unique ON training_session_events(supersedes_event_id) WHERE supersedes_event_id IS NOT NULL;
CREATE INDEX strength_set_events_session_idx ON strength_set_events(session_id,ordinal,occurred_at,id);
CREATE UNIQUE INDEX strength_set_events_supersedes_unique ON strength_set_events(supersedes_event_id) WHERE supersedes_event_id IS NOT NULL;
CREATE INDEX cardio_segment_events_session_idx ON cardio_segment_events(session_id,ordinal,occurred_at,id);
CREATE UNIQUE INDEX cardio_segment_events_supersedes_unique ON cardio_segment_events(supersedes_event_id) WHERE supersedes_event_id IS NOT NULL;
CREATE INDEX mobility_hold_events_session_idx ON mobility_hold_events(session_id,ordinal,occurred_at,id);
CREATE UNIQUE INDEX mobility_hold_events_supersedes_unique ON mobility_hold_events(supersedes_event_id) WHERE supersedes_event_id IS NOT NULL;
CREATE INDEX training_recovery_events_date_idx ON training_recovery_observation_events(business_date DESC,occurred_at DESC,id DESC);
CREATE UNIQUE INDEX training_recovery_events_supersedes_unique ON training_recovery_observation_events(supersedes_event_id) WHERE supersedes_event_id IS NOT NULL;

CREATE TRIGGER training_templates_day_in_cycle BEFORE INSERT ON training_workout_templates
WHEN NEW.day_offset >= (SELECT cycle_length_days FROM training_plan_versions WHERE id=NEW.plan_version_id)
BEGIN SELECT RAISE(ABORT,'training template day outside cycle'); END;
CREATE TRIGGER training_prescriptions_kind_match BEFORE INSERT ON training_prescriptions
WHEN NEW.measure_kind <> (SELECT measure_kind FROM exercise_movement_variants WHERE id=NEW.movement_variant_id)
BEGIN SELECT RAISE(ABORT,'training prescription variant kind mismatch'); END;
CREATE TRIGGER strength_prescriptions_kind BEFORE INSERT ON strength_prescriptions
WHEN (SELECT measure_kind FROM training_prescriptions WHERE id=NEW.prescription_id) <> 'strength'
 OR EXISTS(SELECT 1 FROM cardio_prescriptions WHERE prescription_id=NEW.prescription_id)
 OR EXISTS(SELECT 1 FROM mobility_prescriptions WHERE prescription_id=NEW.prescription_id)
BEGIN SELECT RAISE(ABORT,'strength prescription kind mismatch'); END;
CREATE TRIGGER cardio_prescriptions_kind BEFORE INSERT ON cardio_prescriptions
WHEN (SELECT measure_kind FROM training_prescriptions WHERE id=NEW.prescription_id) <> 'cardio'
 OR EXISTS(SELECT 1 FROM strength_prescriptions WHERE prescription_id=NEW.prescription_id)
 OR EXISTS(SELECT 1 FROM mobility_prescriptions WHERE prescription_id=NEW.prescription_id)
BEGIN SELECT RAISE(ABORT,'cardio prescription kind mismatch'); END;
CREATE TRIGGER mobility_prescriptions_kind BEFORE INSERT ON mobility_prescriptions
WHEN (SELECT measure_kind FROM training_prescriptions WHERE id=NEW.prescription_id) <> 'mobility'
 OR EXISTS(SELECT 1 FROM strength_prescriptions WHERE prescription_id=NEW.prescription_id)
 OR EXISTS(SELECT 1 FROM cardio_prescriptions WHERE prescription_id=NEW.prescription_id)
BEGIN SELECT RAISE(ABORT,'mobility prescription kind mismatch'); END;

CREATE TRIGGER training_plan_versions_immutable BEFORE UPDATE ON training_plan_versions BEGIN SELECT RAISE(ABORT,'training plan versions are immutable'); END;
CREATE TRIGGER training_plan_versions_no_delete BEFORE DELETE ON training_plan_versions BEGIN SELECT RAISE(ABORT,'training plan versions are immutable'); END;
CREATE TRIGGER training_workout_templates_immutable BEFORE UPDATE ON training_workout_templates BEGIN SELECT RAISE(ABORT,'training templates are immutable'); END;
CREATE TRIGGER training_prescriptions_immutable BEFORE UPDATE ON training_prescriptions BEGIN SELECT RAISE(ABORT,'training prescriptions are immutable'); END;
CREATE TRIGGER training_session_events_immutable_update BEFORE UPDATE ON training_session_events BEGIN SELECT RAISE(ABORT,'training session events are immutable'); END;
CREATE TRIGGER training_session_events_immutable_delete BEFORE DELETE ON training_session_events BEGIN SELECT RAISE(ABORT,'training session events are immutable'); END;
CREATE TRIGGER strength_set_events_immutable_update BEFORE UPDATE ON strength_set_events BEGIN SELECT RAISE(ABORT,'strength events are immutable'); END;
CREATE TRIGGER strength_set_events_immutable_delete BEFORE DELETE ON strength_set_events BEGIN SELECT RAISE(ABORT,'strength events are immutable'); END;
CREATE TRIGGER cardio_segment_events_immutable_update BEFORE UPDATE ON cardio_segment_events BEGIN SELECT RAISE(ABORT,'cardio events are immutable'); END;
CREATE TRIGGER cardio_segment_events_immutable_delete BEFORE DELETE ON cardio_segment_events BEGIN SELECT RAISE(ABORT,'cardio events are immutable'); END;
CREATE TRIGGER mobility_hold_events_immutable_update BEFORE UPDATE ON mobility_hold_events BEGIN SELECT RAISE(ABORT,'mobility events are immutable'); END;
CREATE TRIGGER mobility_hold_events_immutable_delete BEFORE DELETE ON mobility_hold_events BEGIN SELECT RAISE(ABORT,'mobility events are immutable'); END;
CREATE TRIGGER training_recovery_events_immutable_update BEFORE UPDATE ON training_recovery_observation_events BEGIN SELECT RAISE(ABORT,'recovery events are immutable'); END;
CREATE TRIGGER training_recovery_events_immutable_delete BEFORE DELETE ON training_recovery_observation_events BEGIN SELECT RAISE(ABORT,'recovery events are immutable'); END;

UPDATE app_meta SET value='9' WHERE key='schema_version';
