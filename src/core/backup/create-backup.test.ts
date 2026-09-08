import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { migrateDatabase } from "@/core/db/migrate";
import { migrationManifest } from "@/core/db/migration-manifest";

import {
  createVerifiedBackup,
  findLatestVerifiedBackup,
} from "./create-backup";
import { WriteBarrier } from "./write-barrier";

const temporaryRoots: string[] = [];
const databases: Database.Database[] = [];

function setup(options: { stopAtLegacySchema?: boolean } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "life-pivot-backup-test-"));
  temporaryRoots.push(root);
  const databaseFile = path.join(root, "data", "life-pivot.sqlite");
  fs.mkdirSync(path.dirname(databaseFile), { recursive: true });
  const sqlite = new Database(databaseFile);
  databases.push(sqlite);
  if (options.stopAtLegacySchema) {
    // 停在 0016（删表迁移之前），用于构造历史 schema 的数据库夹具
    for (const migration of migrationManifest) {
      if (migration.id === "0017_drop_legacy_tables") break;
      sqlite.exec(
        fs.readFileSync(path.join(process.cwd(), "drizzle", migration.filename), "utf8"),
      );
    }
    sqlite
      .prepare(
        `insert into daily_entries
          (id, entry_type, parent_entry_id, business_date, content, revision,
           created_at, updated_at, archived_at)
         values ('entry-1', 'capture', null, '2026-08-09', '备份里的记录', 1, ?, ?, null)`,
      )
      .run("2026-08-09T12:00:00.000Z", "2026-08-09T12:00:00.000Z");
  } else {
    migrateDatabase(sqlite);
  }
  sqlite
    .prepare(
      `insert into capture_items
        (id, event_type, corrects_item_id, business_date, occurred_at, content, created_at)
       values ('capture-1', 'capture', null, '2026-08-09', ?, '备份中的捕获记录', ?)`,
    )
    .run("2026-08-09T12:00:00.000Z", "2026-08-09T12:00:00.000Z");
  return {
    root,
    sqlite,
    databaseFile,
    backupsRoot: path.join(root, "backups"),
  };
}

function createLegacyManifest(backupId = "legacy-backup"): Record<string, unknown> {
  return {
    backupId,
    schemaVersion: "1",
    createdAt: "2026-08-09T12:00:00.000Z",
    databaseSha256: "a".repeat(64),
    databaseBytes: 11,
    status: "verified",
    recordCounts: {
      lifeAreas: 0,
      metricRecords: 0,
      dailyEntries: 1,
      goals: 0,
      reviews: 0,
      knowledgeItems: 0,
    },
  };
}

function createV2Manifest(backupId = "v2-backup"): Record<string, unknown> {
  const manifest = createLegacyManifest(backupId);
  manifest.schemaVersion = "2";
  manifest.applicationVersion = "0.1.0";
  recordCountsOf(manifest).captureItems = 1;
  return manifest;
}

const v3CountFields = [
  "actionEvents",
  "knowledgeCandidates",
  "knowledgeRevisions",
  "knowledgeAssetEvents",
  "dailySummaries",
  "dailySummaryRevisions",
  "reviewRevisions",
  "evidenceLinks",
] as const;

const skincareCountTables = {
  skincareProducts: "skincare_products",
  skincareFormulations: "skincare_formulations",
  skincareIngredients: "skincare_ingredients",
  skincareFormulationIngredients: "skincare_formulation_ingredients",
  skincareProductUnits: "skincare_product_units",
  skincareIngredientSensitivities: "skincare_ingredient_sensitivities",
  skincareFormulationConflicts: "skincare_formulation_conflicts",
  skincareToleranceEvents: "skincare_tolerance_events",
  skincarePlans: "skincare_plans",
  skincarePlanVersions: "skincare_plan_versions",
  skincarePhases: "skincare_phases",
  skincareSteps: "skincare_steps",
  skincareCycles: "skincare_cycles",
  skincareSafetyAssessments: "skincare_safety_assessments",
  skincarePlanVersionEvents: "skincare_plan_version_events",
  skincareUsageEvents: "skincare_usage_events",
  skinObservationEvents: "skin_observation_events",
  skincareAdverseEvents: "skincare_adverse_events",
  skincareAdverseUsageLinks: "skincare_adverse_usage_links",
} as const;

const skincareCountFields = Object.keys(skincareCountTables) as Array<
  keyof typeof skincareCountTables
>;
const nullSkincareRecordCounts = Object.fromEntries(
  skincareCountFields.map((field) => [field, null]),
);

const sleepCountTables = {
  sleepPlans: "sleep_plans",
  sleepPlanVersions: "sleep_plan_versions",
  sleepPlanScheduleDays: "sleep_plan_schedule_days",
  sleepSessions: "sleep_sessions",
  sleepSessionEvents: "sleep_session_events",
  sleepAwakeIntervals: "sleep_awake_intervals",
  sleepCheckins: "sleep_checkins",
  sleepCheckinEvents: "sleep_checkin_events",
} as const;

const sleepCountFields = Object.keys(sleepCountTables) as Array<
  keyof typeof sleepCountTables
>;
const nullSleepRecordCounts = Object.fromEntries(
  sleepCountFields.map((field) => [field, null]),
);
const exerciseCountFields = [
  "exerciseMovements", "exerciseMovementVariants", "trainingPlans", "trainingPlanVersions",
  "trainingWorkoutTemplates", "trainingPrescriptions", "strengthPrescriptions",
  "cardioPrescriptions", "mobilityPrescriptions", "trainingCycles",
  "trainingPlannedOccurrences", "trainingSessions", "trainingSessionEvents",
  "strengthSetEvents", "cardioSegmentEvents", "mobilityHoldEvents",
  "trainingRecoveryObservations", "trainingRecoveryObservationEvents",
] as const;
const nullExerciseRecordCounts = Object.fromEntries(exerciseCountFields.map((field) => [field, null]));

const personalAccumulationCountTables = {
  sleepDailyRecords: "sleep_daily_records",
  healthChecklistTemplates: "health_checklist_templates",
  healthChecklistVersions: "health_checklist_versions",
  healthChecklistTemplateItems: "health_checklist_template_items",
  healthChecklistDays: "health_checklist_days",
  healthChecklistDayItems: "health_checklist_day_items",
  personalDailyNotes: "personal_daily_notes",
} as const;
const personalAccumulationCountFields = Object.keys(
  personalAccumulationCountTables,
) as Array<keyof typeof personalAccumulationCountTables>;
const nullPersonalAccumulationRecordCounts = Object.fromEntries(
  personalAccumulationCountFields.map((field) => [field, null]),
);

const manualExerciseCountTables = {
  manualExerciseTemplates: "manual_exercise_templates",
  manualExerciseTemplateVersions: "manual_exercise_template_versions",
  manualExerciseTemplateDays: "manual_exercise_template_days",
  manualExerciseTemplateActions: "manual_exercise_template_actions",
  manualExerciseCycleState: "manual_exercise_cycle_state",
  manualExerciseDays: "manual_exercise_days",
  manualExerciseDayActions: "manual_exercise_day_actions",
  manualExerciseCycleEvents: "manual_exercise_cycle_events",
} as const;
const manualExerciseCountFields = Object.keys(manualExerciseCountTables) as Array<
  keyof typeof manualExerciseCountTables
>;
const nullManualExerciseRecordCounts = Object.fromEntries(
  manualExerciseCountFields.map((field) => [field, null]),
);
const manualExerciseProgressCountTables = {
  manualExerciseProgressDecisions: "manual_exercise_progress_decisions",
} as const;
const manualExerciseProgressCountFields = Object.keys(
  manualExerciseProgressCountTables,
) as Array<keyof typeof manualExerciseProgressCountTables>;
const nullManualExerciseProgressRecordCounts = Object.fromEntries(
  manualExerciseProgressCountFields.map((field) => [field, null]),
);

const manualSkincareCountTables = {
  manualSkincareProducts: "manual_skincare_products",
  manualSkincareRoutineVersions: "manual_skincare_routine_versions",
  manualSkincareRoutineItems: "manual_skincare_routine_items",
  manualSkincareRoutineActivations: "manual_skincare_routine_activations",
  manualSkincareDays: "manual_skincare_days",
  manualSkincareDayItems: "manual_skincare_day_items",
  manualSkincareRecoveryPlans: "manual_skincare_recovery_plans",
  manualSkincareRecoveryCycles: "manual_skincare_recovery_cycles",
} as const;
const manualSkincareCountFields = Object.keys(manualSkincareCountTables) as Array<
  keyof typeof manualSkincareCountTables
>;
const nullManualSkincareRecordCounts = Object.fromEntries(
  manualSkincareCountFields.map((field) => [field, null]),
);

const personalKnowledgeCountTables = {
  knowledgeModules: "knowledge_modules",
  dailyLearningNotes: "daily_learning_notes",
  knowledgeItemOrganizations: "knowledge_item_organization",
} as const;
const personalKnowledgeCountFields = Object.keys(
  personalKnowledgeCountTables,
) as Array<keyof typeof personalKnowledgeCountTables>;
const nullPersonalKnowledgeRecordCounts = Object.fromEntries(
  personalKnowledgeCountFields.map((field) => [field, null]),
);
const nullWeeklyReviewPinRecordCounts = { userPins: null };
const nullReadingRecordCounts = {
  readingBooks: null,
  readingNotes: null,
  readingSessions: null,
};

function createV3Manifest(backupId = "v3-backup"): Record<string, unknown> {
  const manifest = createV2Manifest(backupId);
  manifest.schemaVersion = "3";
  for (const field of v3CountFields) recordCountsOf(manifest)[field] = 0;
  return manifest;
}

function createV4Manifest(backupId = "v4-backup"): Record<string, unknown> {
  const manifest = createV3Manifest(backupId);
  manifest.schemaVersion = "4";
  return manifest;
}

function createV5Manifest(backupId = "v5-backup"): Record<string, unknown> {
  const manifest = createV4Manifest(backupId);
  manifest.schemaVersion = "5";
  recordCountsOf(manifest).knowledgeDomains = 4;
  return manifest;
}

function createV6Manifest(backupId = "v6-backup"): Record<string, unknown> {
  const manifest = createV5Manifest(backupId);
  manifest.schemaVersion = "6";
  for (const field of skincareCountFields) recordCountsOf(manifest)[field] = 1;
  return manifest;
}

function createV7Manifest(backupId = "v7-backup"): Record<string, unknown> {
  const manifest = createV6Manifest(backupId);
  manifest.schemaVersion = "7";
  return manifest;
}

function createV8Manifest(backupId = "v8-backup"): Record<string, unknown> {
  const manifest = createV7Manifest(backupId);
  manifest.schemaVersion = "8";
  for (const field of sleepCountFields) recordCountsOf(manifest)[field] = 1;
  return manifest;
}

function createV9Manifest(backupId = "v9-backup"): Record<string, unknown> {
  const manifest = createV8Manifest(backupId);
  manifest.schemaVersion = "9";
  for (const field of exerciseCountFields) recordCountsOf(manifest)[field] = 1;
  return manifest;
}

function createV10Manifest(backupId = "v10-backup"): Record<string, unknown> {
  const manifest = createV9Manifest(backupId);
  manifest.schemaVersion = "10";
  for (const field of personalAccumulationCountFields) {
    recordCountsOf(manifest)[field] = 1;
  }
  return manifest;
}

function createV11Manifest(backupId = "v11-backup"): Record<string, unknown> {
  const manifest = createV10Manifest(backupId);
  manifest.schemaVersion = "11";
  for (const field of manualExerciseCountFields) recordCountsOf(manifest)[field] = 1;
  return manifest;
}

function createV12Manifest(backupId = "v12-backup"): Record<string, unknown> {
  const manifest = createV11Manifest(backupId);
  manifest.schemaVersion = "12";
  for (const field of manualSkincareCountFields) recordCountsOf(manifest)[field] = 1;
  return manifest;
}

function createV13Manifest(backupId = "v13-backup"): Record<string, unknown> {
  const manifest = createV12Manifest(backupId);
  manifest.schemaVersion = "13";
  for (const field of personalKnowledgeCountFields) recordCountsOf(manifest)[field] = 1;
  return manifest;
}

function createV14Manifest(backupId = "v14-backup"): Record<string, unknown> {
  const manifest = createV13Manifest(backupId);
  manifest.schemaVersion = "14";
  recordCountsOf(manifest).userPins = 1;
  return manifest;
}

function createV15Manifest(backupId = "v15-backup"): Record<string, unknown> {
  const manifest = createV14Manifest(backupId);
  manifest.schemaVersion = "15";
  recordCountsOf(manifest).readingBooks = 1;
  recordCountsOf(manifest).readingNotes = 1;
  return manifest;
}

function createV16Manifest(backupId = "v16-backup"): Record<string, unknown> {
  const manifest = createV15Manifest(backupId);
  manifest.schemaVersion = "16";
  recordCountsOf(manifest).readingSessions = 1;
  return manifest;
}

function createV17Manifest(backupId = "v17-backup"): Record<string, unknown> {
  const manifest = createV16Manifest(backupId);
  manifest.schemaVersion = "17";
  for (const field of manualExerciseProgressCountFields) recordCountsOf(manifest)[field] = 1;
  return manifest;
}

function createV18Manifest(backupId = "v18-backup"): Record<string, unknown> {
  const manifest = createV17Manifest(backupId);
  manifest.schemaVersion = "18";
  const counts = recordCountsOf(manifest);
  for (const field of [
    "metricRecords", "dailyEntries", "knowledgeItems", "knowledgeCandidates",
    "knowledgeRevisions", "knowledgeAssetEvents", "dailySummaries",
    "dailySummaryRevisions", "evidenceLinks", "knowledgeDomains",
  ]) counts[field] = null;
  for (const field of skincareCountFields) counts[field] = null;
  for (const field of sleepCountFields) counts[field] = null;
  for (const field of exerciseCountFields) counts[field] = null;
  counts.knowledgeItemOrganizations = null;
  return manifest;
}

const legacyManifestFactories = [
  ["1", createLegacyManifest],
  ["2", createV2Manifest],
  ["3", createV3Manifest],
  ["4", createV4Manifest],
  ["5", createV5Manifest],
] as const;

const predecessorManifestFactories = [
  ...legacyManifestFactories,
  ["6", createV6Manifest],
  ["7", createV7Manifest],
] as const;

const preV10ManifestFactories = [
  ...predecessorManifestFactories,
  ["8", createV8Manifest],
  ["9", createV9Manifest],
] as const;

const preV11ManifestFactories = [
  ...preV10ManifestFactories,
  ["10", createV10Manifest],
] as const;

const preV12ManifestFactories = [
  ...preV11ManifestFactories,
  ["11", createV11Manifest],
] as const;

const preV13ManifestFactories = [
  ...preV12ManifestFactories,
  ["12", createV12Manifest],
] as const;

const preV14ManifestFactories = [
  ...preV13ManifestFactories,
  ["13", createV13Manifest],
] as const;

const preV15ManifestFactories = [
  ...preV14ManifestFactories,
  ["14", createV14Manifest],
] as const;

function seedPersonalAccumulationRows(sqlite: Database.Database): void {
  const timestamp = "2026-08-12T00:00:00.000Z";
  sqlite.exec(`
    insert into sleep_daily_records
      (id, record_date, asleep_time, wake_time, calculated_duration_minutes,
       confirmed_duration_minutes, quality_text, note, revision, created_at, updated_at)
    values ('sleep-daily-backup', '2026-08-12', '23:30', '07:00', 450, null,
            'Good', '', 1, '${timestamp}', '${timestamp}');
    insert into health_checklist_templates
      (id, name, current_revision, created_at, updated_at)
    values ('health-template-backup', 'Daily health', 1, '${timestamp}', '${timestamp}');
    insert into health_checklist_versions
      (id, template_id, revision, effective_from, change_note, created_at)
    values ('health-version-backup', 'health-template-backup', 1, '2026-08-12', '', '${timestamp}');
    insert into health_checklist_template_items
      (id, template_version_id, item_key, group_key, group_label, name,
       target_text, note, ordinal)
    values ('health-template-item-backup', 'health-version-backup', 'water-item',
            'all-day', 'All day', 'Drink water', '', '', 0);
    insert into health_checklist_days
      (id, business_date, template_version_id, note, revision, created_at, updated_at)
    values ('health-day-backup', '2026-08-12', 'health-version-backup', '', 1,
            '${timestamp}', '${timestamp}');
    insert into health_checklist_day_items
      (id, day_id, item_key, group_key, group_label, name, target_text, note,
       ordinal, completed, completed_at)
    values ('health-day-item-backup', 'health-day-backup', 'water-item', 'all-day',
            'All day', 'Drink water', '', '', 0, 0, null);
    insert into personal_daily_notes
      (id, business_date, content, revision, created_at, updated_at)
    values ('personal-note-backup', '2026-08-12', 'Keep this note', 1,
            '${timestamp}', '${timestamp}');
  `);
}

function seedManualExerciseRows(sqlite: Database.Database): void {
  const timestamp = "2026-08-13T00:00:00.000Z";
  sqlite.exec(`
    insert into manual_exercise_templates
      (id, name, current_revision, created_at, updated_at)
    values ('manual-template-backup', 'Backup plan', 1, '${timestamp}', '${timestamp}');
    insert into manual_exercise_template_versions
      (id, template_id, revision, effective_from, change_note, created_at)
    values ('manual-version-backup', 'manual-template-backup', 1, '2026-08-13', '', '${timestamp}');
    insert into manual_exercise_template_days
      (id, template_version_id, day_key, name, body_part, is_rest, note, ordinal)
    values ('manual-template-day-backup', 'manual-version-backup', 'push', 'Push', 'chest', 0, '', 0);
    insert into manual_exercise_template_actions
      (id, template_day_id, action_key, name, planned_sets, planned_reps_text,
       planned_weight_text, target_text, note, ordinal)
    values ('manual-template-action-backup', 'manual-template-day-backup', 'bench', 'Bench press',
            3, '8', '60kg', '', '', 0);
    insert into manual_exercise_cycle_state
      (template_id, current_day_key, revision, updated_at)
    values ('manual-template-backup', 'push', 1, '${timestamp}');
    insert into manual_exercise_days
      (id, business_date, template_version_id, day_key, day_name, body_part, is_rest,
       status, started_at, paused_at, accumulated_pause_seconds, ended_at,
       calculated_duration_minutes, confirmed_duration_minutes, creatine_taken,
       protein_powder_taken, supplement_note, note, completion_text, revision,
       created_at, updated_at)
    values ('manual-day-backup', '2026-08-13', 'manual-version-backup', 'push', 'Push', 'chest',
            0, 'completed', null, null, 0, null, null, null, null, null, '', '', '', 1,
            '${timestamp}', '${timestamp}');
    insert into manual_exercise_day_actions
      (id, day_id, action_key, name, planned_sets, planned_reps_text, planned_weight_text,
       target_text, actual_sets, actual_reps_text, actual_weight_text, actual_text,
       completion, note, ordinal)
    values ('manual-day-action-backup', 'manual-day-backup', 'bench', 'Bench press', 3, '8',
            '60kg', '', 3, '8,8,8', '60kg', '', '', '', 0);
    insert into manual_exercise_cycle_events
      (id, template_id, business_date, event_type, from_day_key, to_day_key, day_id,
       note, cycle_revision_before, cycle_revision_after, created_at)
    values ('manual-cycle-event-backup', 'manual-template-backup', '2026-08-13', 'completed',
            'push', null, 'manual-day-backup', '', 0, 1, '${timestamp}');
  `);
}

function seedManualSkincareRows(sqlite: Database.Database): void {
  const timestamp = "2026-08-13T08:00:00.000Z";
  sqlite.exec(`
    insert into manual_skincare_products
      (id, name, brand, current_purpose, status, added_on, note, revision,
       created_at, updated_at)
    values ('manual-skin-product-backup', 'Gentle cleanser', 'Simple', 'Cleanse',
            'active', '2026-08-13', '', 1, '${timestamp}', '${timestamp}');
    insert into manual_skincare_routine_versions
      (id, revision, change_note, created_at)
    values ('manual-skin-routine-backup', 1, '', '${timestamp}');
    insert into manual_skincare_routine_items
      (id, routine_version_id, item_key, slot, product_id, product_name_snapshot,
       brand_snapshot, purpose_snapshot, ordinal, created_at)
    values ('manual-skin-routine-item-backup', 'manual-skin-routine-backup',
            'cleanser-am', 'morning', 'manual-skin-product-backup', 'Gentle cleanser',
            'Simple', 'Cleanse', 0, '${timestamp}');
    insert into manual_skincare_recovery_plans
      (id, name, note, revision, created_at, updated_at)
    values ('manual-skin-plan-backup', 'Recovery', '', 1, '${timestamp}', '${timestamp}');
    insert into manual_skincare_recovery_cycles
      (id, plan_id, ordinal, name, goal, expected_end_on, routine_version_id,
       status, actual_started_on, actual_completed_on, note, revision, created_at, updated_at)
    values ('manual-skin-cycle-backup', 'manual-skin-plan-backup', 0, 'Week one',
            'Calm', '2026-08-20', 'manual-skin-routine-backup', 'draft', null, null,
            '', 1, '${timestamp}', '${timestamp}');
    insert into manual_skincare_routine_activations
      (id, routine_version_id, recovery_cycle_id, activation_sequence,
       effective_from, reason, created_at)
    values ('manual-skin-activation-backup', 'manual-skin-routine-backup', null, 1,
            '2026-08-13', 'manual-routine-update', '${timestamp}');
    insert into manual_skincare_days
      (id, business_date, routine_activation_id, routine_version_id,
       recovery_cycle_id, recovery_cycle_name_snapshot, morning_note, evening_note,
       overall_note, revision, created_at, updated_at)
    values ('manual-skin-day-backup', '2026-08-13', 'manual-skin-activation-backup',
            'manual-skin-routine-backup', null, '', '', '', '', 1,
            '${timestamp}', '${timestamp}');
    insert into manual_skincare_day_items
      (id, day_id, item_key, slot, product_id, product_name_snapshot, brand_snapshot,
       purpose_snapshot, ordinal, used, used_at)
    values ('manual-skin-day-item-backup', 'manual-skin-day-backup', 'cleanser-am',
            'morning', 'manual-skin-product-backup', 'Gentle cleanser', 'Simple',
            'Cleanse', 0, 0, null);
  `);
  sqlite.prepare(`update manual_skincare_products
    set photo_blob = ?, photo_mime = 'image/png'
    where id = 'manual-skin-product-backup'`)
    .run(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function seedPersonalKnowledgeRows(sqlite: Database.Database): void {
  const timestamp = "2026-08-13T08:00:00.000Z";
  sqlite.exec(`
    insert into knowledge_modules
      (module_id, parent_module_id, name, goal, current_focus, description, status,
       ordinal, revision, created_at, updated_at)
    values ('knowledge-module-backup', null, 'Databases', '', '', '', 'learning',
            0, 1, '${timestamp}', '${timestamp}');
    insert into daily_learning_notes
      (note_id, business_date, title, module_id, content, source,
       personal_understanding, open_questions, application, status, revision,
       created_at, updated_at)
    values ('daily-learning-note-backup', '2026-08-13', 'SQLite',
            'knowledge-module-backup', 'Learned content', '', '', '', '', 'active',
            1, '${timestamp}', '${timestamp}');
  `);
}

function seedDailyLoopRecords(sqlite: Database.Database): void {
  const timestamp = "2026-08-09T13:00:00.000Z";
  sqlite.exec(`
    insert into actions
      (id, goal_id, parent_action_id, action_type, business_date, title, status,
       priority, estimated_minutes, notes, revision, created_at, updated_at, archived_at)
    values
      ('action-1', null, null, 'today', '2026-08-09', '完成备份测试', 'completed',
       'normal', null, '', 1, '${timestamp}', '${timestamp}', null);

    insert into action_events
      (id, action_id, event_type, business_date, from_business_date,
       to_business_date, occurred_at, payload_json)
    values
      ('action-event-1', 'action-1', 'completed', '2026-08-09', null, null,
       '${timestamp}', '{}');

    insert into reviews
      (id, review_type, period_start, period_end_exclusive, content, revision,
       created_at, updated_at, archived_at)
    values
      ('review-1', 'daily', '2026-08-09', '2026-08-10', '{}', 1,
       '${timestamp}', '${timestamp}', null);

    insert into review_revisions
      (id, review_id, revision, snapshot_json, created_at)
    values
      ('review-revision-1', 'review-1', 1, '{}', '${timestamp}');

  `);
}

function recordCountsOf(manifest: Record<string, unknown>): Record<string, unknown> {
  return manifest.recordCounts as Record<string, unknown>;
}

function publishManifestFixture(
  manifest: unknown,
  directoryName = "legacy-backup",
): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "life-pivot-manifest-test-"));
  temporaryRoots.push(root);
  const backupsRoot = path.join(root, "backups");
  const backupDirectory = path.join(backupsRoot, directoryName);
  fs.mkdirSync(backupDirectory, { recursive: true });
  fs.writeFileSync(path.join(backupDirectory, "life-pivot.sqlite"), "legacy copy");
  fs.writeFileSync(
    path.join(backupDirectory, "manifest.json"),
    `${JSON.stringify(manifest)}\n`,
    "utf8",
  );
  return backupsRoot;
}

type ManifestMutation = (manifest: Record<string, unknown>) => void;

const malformedManifestCases: Array<[string, ManifestMutation]> = [
  ["a missing backup ID", (manifest) => delete manifest.backupId],
  ["an unsafe backup ID", (manifest) => { manifest.backupId = "bad id"; }],
  ["a missing schema version", (manifest) => delete manifest.schemaVersion],
  ["a non-string schema version", (manifest) => { manifest.schemaVersion = 1; }],
  ["a non-ISO creation time", (manifest) => { manifest.createdAt = "2026-08-09"; }],
  ["an invalid database hash", (manifest) => { manifest.databaseSha256 = "not-a-hash"; }],
  ["a negative database size", (manifest) => { manifest.databaseBytes = -1; }],
  ["a fractional database size", (manifest) => { manifest.databaseBytes = 1.5; }],
  [
    "an unsafe database size",
    (manifest) => { manifest.databaseBytes = Number.MAX_SAFE_INTEGER + 1; },
  ],
  ["a non-verified status", (manifest) => { manifest.status = "pending"; }],
  ["missing record counts", (manifest) => delete manifest.recordCounts],
  ["an invalid application version", (manifest) => { manifest.applicationVersion = 1; }],
  [
    "a negative capture count",
    (manifest) => { recordCountsOf(manifest).captureItems = -1; },
  ],
  [
    "a fractional capture count",
    (manifest) => { recordCountsOf(manifest).captureItems = 1.5; },
  ],
  [
    "an unsafe capture count",
    (manifest) => {
      recordCountsOf(manifest).captureItems = Number.MAX_SAFE_INTEGER + 1;
    },
  ],
  [
    "a non-numeric capture count",
    (manifest) => { recordCountsOf(manifest).captureItems = "1"; },
  ],
  ...(
    [
      "lifeAreas",
      "metricRecords",
      "dailyEntries",
      "goals",
      "reviews",
      "knowledgeItems",
    ] as const
  ).map<[string, ManifestMutation]>((field) => [
    `a negative ${field} count`,
    (manifest) => { recordCountsOf(manifest)[field] = -1; },
  ]),
  [
    "a fractional legacy count",
    (manifest) => { recordCountsOf(manifest).dailyEntries = 1.5; },
  ],
  [
    "an unsafe legacy count",
    (manifest) => {
      recordCountsOf(manifest).dailyEntries = Number.MAX_SAFE_INTEGER + 1;
    },
  ],
];

const invalidV2ManifestCases: Array<[string, ManifestMutation]> = [
  ["a missing application version", (manifest) => delete manifest.applicationVersion],
  ["a null application version", (manifest) => { manifest.applicationVersion = null; }],
  ["an empty application version", (manifest) => { manifest.applicationVersion = ""; }],
  ["a blank application version", (manifest) => { manifest.applicationVersion = "   "; }],
  [
    "a missing capture count",
    (manifest) => { delete recordCountsOf(manifest).captureItems; },
  ],
  [
    "a null capture count",
    (manifest) => { recordCountsOf(manifest).captureItems = null; },
  ],
];

const invalidV3ManifestCases: Array<[string, ManifestMutation]> = v3CountFields.flatMap(
  (field) => [
    [`a missing ${field} count`, (manifest) => { delete recordCountsOf(manifest)[field]; }],
    [`a null ${field} count`, (manifest) => { recordCountsOf(manifest)[field] = null; }],
    [`an invalid ${field} count`, (manifest) => { recordCountsOf(manifest)[field] = -1; }],
    [`a fractional ${field} count`, (manifest) => { recordCountsOf(manifest)[field] = 1.5; }],
    [`an unsafe ${field} count`, (manifest) => {
      recordCountsOf(manifest)[field] = Number.MAX_SAFE_INTEGER + 1;
    }],
    [`a non-numeric ${field} count`, (manifest) => { recordCountsOf(manifest)[field] = "1"; }],
  ] as Array<[string, ManifestMutation]>,
);

const invalidV4ManifestCases = [
  ...invalidV2ManifestCases,
  ...invalidV3ManifestCases,
];

const invalidV5ManifestCases: Array<[string, ManifestMutation]> = [
  ...invalidV4ManifestCases,
  [
    "a missing knowledgeDomains count",
    (manifest) => { delete recordCountsOf(manifest).knowledgeDomains; },
  ],
  [
    "a null knowledgeDomains count",
    (manifest) => { recordCountsOf(manifest).knowledgeDomains = null; },
  ],
  [
    "a negative knowledgeDomains count",
    (manifest) => { recordCountsOf(manifest).knowledgeDomains = -1; },
  ],
  [
    "a fractional knowledgeDomains count",
    (manifest) => { recordCountsOf(manifest).knowledgeDomains = 1.5; },
  ],
  [
    "an unsafe knowledgeDomains count",
    (manifest) => {
      recordCountsOf(manifest).knowledgeDomains = Number.MAX_SAFE_INTEGER + 1;
    },
  ],
  [
    "a non-numeric knowledgeDomains count",
    (manifest) => { recordCountsOf(manifest).knowledgeDomains = "4"; },
  ],
];

const invalidV6ManifestCases: Array<[string, ManifestMutation]> = [
  ...invalidV5ManifestCases,
  ["a missing skincareProducts count", (manifest) => { delete recordCountsOf(manifest).skincareProducts; }],
  ["a null skincareProducts count", (manifest) => { recordCountsOf(manifest).skincareProducts = null; }],
  ["a negative skincareProducts count", (manifest) => { recordCountsOf(manifest).skincareProducts = -1; }],
  ["a fractional skincareProducts count", (manifest) => { recordCountsOf(manifest).skincareProducts = 1.5; }],
  [
    "an unsafe skincareProducts count",
    (manifest) => { recordCountsOf(manifest).skincareProducts = Number.MAX_SAFE_INTEGER + 1; },
  ],
  ["a non-numeric skincareProducts count", (manifest) => { recordCountsOf(manifest).skincareProducts = "1"; }],
];

const invalidV8SleepManifestCases: Array<[string, ManifestMutation]> = [
  ["a missing sleepPlans count", (manifest) => { delete recordCountsOf(manifest).sleepPlans; }],
  ["a null sleepSessionEvents count", (manifest) => { recordCountsOf(manifest).sleepSessionEvents = null; }],
  ["a negative sleepAwakeIntervals count", (manifest) => { recordCountsOf(manifest).sleepAwakeIntervals = -1; }],
  ["a fractional sleepCheckins count", (manifest) => { recordCountsOf(manifest).sleepCheckins = 1.5; }],
  ["an unsafe sleepCheckinEvents count", (manifest) => {
    recordCountsOf(manifest).sleepCheckinEvents = Number.MAX_SAFE_INTEGER + 1;
  }],
  ["an extra Sleep count", (manifest) => { recordCountsOf(manifest).sleepUnknown = 1; }],
];

const invalidV10PersonalAccumulationManifestCases: Array<
  [string, ManifestMutation]
> = personalAccumulationCountFields.flatMap((field) => [
  [`a missing ${field} count`, (manifest) => { delete recordCountsOf(manifest)[field]; }],
  [`a null ${field} count`, (manifest) => { recordCountsOf(manifest)[field] = null; }],
  [`a negative ${field} count`, (manifest) => { recordCountsOf(manifest)[field] = -1; }],
  [`a fractional ${field} count`, (manifest) => { recordCountsOf(manifest)[field] = 1.5; }],
  [`an unsafe ${field} count`, (manifest) => {
    recordCountsOf(manifest)[field] = Number.MAX_SAFE_INTEGER + 1;
  }],
  [`a string ${field} count`, (manifest) => { recordCountsOf(manifest)[field] = "1"; }],
] as Array<[string, ManifestMutation]>);

const invalidV11ManualExerciseManifestCases: Array<[string, ManifestMutation]> =
  manualExerciseCountFields.flatMap((field) => [
    [`a missing ${field} count`, (manifest) => { delete recordCountsOf(manifest)[field]; }],
    [`a negative ${field} count`, (manifest) => { recordCountsOf(manifest)[field] = -1; }],
    [`a fractional ${field} count`, (manifest) => { recordCountsOf(manifest)[field] = 1.5; }],
    [`an unsafe ${field} count`, (manifest) => {
      recordCountsOf(manifest)[field] = Number.MAX_SAFE_INTEGER + 1;
    }],
    [`a string ${field} count`, (manifest) => { recordCountsOf(manifest)[field] = "1"; }],
  ] as Array<[string, ManifestMutation]>);

const invalidV12ManualSkincareManifestCases: Array<[string, ManifestMutation]> =
  manualSkincareCountFields.flatMap((field) => [
    [`a missing ${field} count`, (manifest) => { delete recordCountsOf(manifest)[field]; }],
    [`a null ${field} count`, (manifest) => { recordCountsOf(manifest)[field] = null; }],
    [`a negative ${field} count`, (manifest) => { recordCountsOf(manifest)[field] = -1; }],
    [`a fractional ${field} count`, (manifest) => { recordCountsOf(manifest)[field] = 1.5; }],
    [`an unsafe ${field} count`, (manifest) => {
      recordCountsOf(manifest)[field] = Number.MAX_SAFE_INTEGER + 1;
    }],
    [`a string ${field} count`, (manifest) => { recordCountsOf(manifest)[field] = "1"; }],
  ] as Array<[string, ManifestMutation]>);

const invalidV13PersonalKnowledgeManifestCases: Array<[string, ManifestMutation]> =
  personalKnowledgeCountFields.flatMap((field) => [
    [`a missing ${field} count`, (manifest) => { delete recordCountsOf(manifest)[field]; }],
    [`a null ${field} count`, (manifest) => { recordCountsOf(manifest)[field] = null; }],
    [`a negative ${field} count`, (manifest) => { recordCountsOf(manifest)[field] = -1; }],
    [`a fractional ${field} count`, (manifest) => { recordCountsOf(manifest)[field] = 1.5; }],
    [`an unsafe ${field} count`, (manifest) => {
      recordCountsOf(manifest)[field] = Number.MAX_SAFE_INTEGER + 1;
    }],
    [`a string ${field} count`, (manifest) => { recordCountsOf(manifest)[field] = "1"; }],
  ] as Array<[string, ManifestMutation]>);

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root?.startsWith(os.tmpdir())) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("createVerifiedBackup", () => {

  it("accepts schema v18 with null deleted-domain counts and numeric retained counts", () => {
    const manifest = createV18Manifest();
    const backupsRoot = publishManifestFixture(manifest, "v18-backup");

    const result = findLatestVerifiedBackup(backupsRoot);
    expect(result?.schemaVersion).toBe("18");
    expect(result?.recordCounts).toMatchObject({
      metricRecords: null,
      dailyEntries: null,
      knowledgeItems: null,
      knowledgeItemOrganizations: null,
      actionEvents: 0,
      reviewRevisions: 0,
      manualExerciseProgressDecisions: 1,
      readingSessions: 1,
    });
  });

  it.each([
    ["a non-null deleted count", "metricRecords", 1],
    ["a missing deleted count", "knowledgeItems", undefined],
    ["a null retained count", "actionEvents", null],
    ["a missing retained count", "reviewRevisions", undefined],
  ])("rejects schema v18 with %s", (_label, field, value) => {
    const manifest = createV18Manifest("invalid-v18");
    const counts = recordCountsOf(manifest);
    if (value === undefined) delete counts[field];
    else counts[field] = value;
    expect(findLatestVerifiedBackup(publishManifestFixture(manifest, "invalid-v18"))).toBeNull();
  });
  it("accepts a v14 manifest with a strict user-pins count and normalizes it for v1-v13", () => {
    const v14 = createV14Manifest();
    const v14BackupsRoot = publishManifestFixture(v14, "v14-backup");
    expect(findLatestVerifiedBackup(v14BackupsRoot)).toMatchObject({
      schemaVersion: "14",
      recordCounts: { userPins: 1 },
    });

    for (const [schemaVersion, createManifest] of preV14ManifestFactories) {
      const backupId = `pins-legacy-v${schemaVersion}`;
      const manifest = createManifest(backupId);
      recordCountsOf(manifest).userPins = 99;
      const backupsRoot = publishManifestFixture(manifest, backupId);
      expect(findLatestVerifiedBackup(backupsRoot)).toMatchObject({
        schemaVersion,
        recordCounts: { userPins: null },
      });
    }
  });

  it.each([undefined, null, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1"])(
    "rejects a v14 manifest with an invalid user-pins count: %p",
    (userPins) => {
      const manifest = createV14Manifest("v14-invalid-pins");
      if (userPins === undefined) delete recordCountsOf(manifest).userPins;
      else recordCountsOf(manifest).userPins = userPins;
      const backupsRoot = publishManifestFixture(manifest, "v14-invalid-pins");
      expect(findLatestVerifiedBackup(backupsRoot)).toBeNull();
    },
  );

  it("copies and verifies the v14 user-pins count before hashing", async () => {
    const { sqlite, databaseFile, backupsRoot } = setup();
    sqlite.prepare(
      "insert into user_pins (target_type, target_id, pinned_at) values (?, ?, ?)",
    ).run("knowledge-item", "pinned-item", "2026-08-13T10:00:00.000Z");
    const originalBackup = sqlite.backup.bind(sqlite);
    vi.spyOn(sqlite, "backup").mockImplementation(async (destination) => {
      const result = await originalBackup(destination);
      sqlite.prepare(
        "insert into user_pins (target_type, target_id, pinned_at) values (?, ?, ?)",
      ).run("knowledge-module", "after-copy", "2026-08-13T10:01:00.000Z");
      return result;
    });

    const manifest = await createVerifiedBackup({
      sqlite,
      databaseFile,
      backupsRoot,
      writeBarrier: new WriteBarrier(),
      createId: () => "backup-pins-v14",
    });

    expect(manifest).toMatchObject({
      schemaVersion: "25",
      recordCounts: { userPins: 1 },
    });
    expect(sqlite.prepare("select count(*) from user_pins").pluck().get()).toBe(2);
  });

  it("accepts a v15 manifest with strict reading counts and normalizes them for v1-v14", () => {
    const v15 = createV15Manifest();
    const v15BackupsRoot = publishManifestFixture(v15, "v15-backup");
    expect(findLatestVerifiedBackup(v15BackupsRoot)).toMatchObject({
      schemaVersion: "15",
      recordCounts: { readingBooks: 1, readingNotes: 1, readingSessions: null },
    });

    for (const [schemaVersion, createManifest] of preV15ManifestFactories) {
      const backupId = `reading-legacy-v${schemaVersion}`;
      const manifest = createManifest(backupId);
      recordCountsOf(manifest).readingBooks = 99;
      recordCountsOf(manifest).readingNotes = 99;
      const backupsRoot = publishManifestFixture(manifest, backupId);
      expect(findLatestVerifiedBackup(backupsRoot)).toMatchObject({
        schemaVersion,
        recordCounts: nullReadingRecordCounts,
      });
    }
  });

  it.each([undefined, null, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1"])(
    "rejects a v15 manifest with an invalid reading count: %p",
    (readingBooks) => {
      const manifest = createV15Manifest("v15-invalid-reading");
      if (readingBooks === undefined) delete recordCountsOf(manifest).readingBooks;
      else recordCountsOf(manifest).readingBooks = readingBooks;
      const backupsRoot = publishManifestFixture(manifest, "v15-invalid-reading");
      expect(findLatestVerifiedBackup(backupsRoot)).toBeNull();
    },
  );

  it("accepts a v17 manifest with a strict progress-decision count", () => {
    const manifest = createV17Manifest();
    const backupsRoot = publishManifestFixture(manifest, "v17-backup");

    expect(findLatestVerifiedBackup(backupsRoot)).toMatchObject({
      schemaVersion: "17",
      recordCounts: Object.fromEntries(manualExerciseProgressCountFields.map((field) => [field, 1])),
    });
  });

  it.each([undefined, null, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1"])(
    "rejects a v17 manifest with an invalid progress-decision count: %p",
    (progressCount) => {
      const manifest = createV17Manifest("v17-invalid-progress");
      if (progressCount === undefined) {
        delete recordCountsOf(manifest).manualExerciseProgressDecisions;
      } else {
        recordCountsOf(manifest).manualExerciseProgressDecisions = progressCount;
      }
      const backupsRoot = publishManifestFixture(manifest, "v17-invalid-progress");
      expect(findLatestVerifiedBackup(backupsRoot)).toBeNull();
    },
  );

  it("rejects a v16-only session count in a v15 manifest", () => {
    const manifest = createV15Manifest("v15-unknown-reading");
    recordCountsOf(manifest).readingSessions = 1;
    const backupsRoot = publishManifestFixture(manifest, "v15-unknown-reading");
    expect(findLatestVerifiedBackup(backupsRoot)).toBeNull();
  });

  it.each([undefined, null, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1"])(
    "rejects a v16 manifest with an invalid reading-session count: %p",
    (readingSessions) => {
      const manifest = createV16Manifest("v16-invalid-reading-session");
      if (readingSessions === undefined) delete recordCountsOf(manifest).readingSessions;
      else recordCountsOf(manifest).readingSessions = readingSessions;
      const backupsRoot = publishManifestFixture(manifest, "v16-invalid-reading-session");
      expect(findLatestVerifiedBackup(backupsRoot)).toBeNull();
    },
  );

  it("copies and verifies the v15 reading counts before hashing", async () => {
    const { sqlite, databaseFile, backupsRoot } = setup();
    sqlite.prepare(
      "insert into reading_books (book_id, title, author, status, current_page, revision, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("reading-book-0001", "测试书", "", "wishlist", 0, 1, "2026-08-13T10:00:00.000Z", "2026-08-13T10:00:00.000Z");
    sqlite.prepare(
      "insert into reading_notes (note_id, book_id, title, content, revision, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)",
    ).run("reading-note-0001", "reading-book-0001", "", "读后感", 1, "2026-08-13T10:00:00.000Z", "2026-08-13T10:00:00.000Z");
    sqlite.prepare(`insert into reading_sessions
      (session_id, book_id, business_date, start_page, end_page, duration_minutes,
       note, revision, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(
        "reading-session-backup-0001",
        "reading-book-0001",
        "2026-08-13",
        0,
        20,
        30,
        "",
        "2026-08-13T10:00:00.000Z",
        "2026-08-13T10:00:00.000Z",
      );
    const originalBackup = sqlite.backup.bind(sqlite);
    vi.spyOn(sqlite, "backup").mockImplementation(async (destination) => {
      const result = await originalBackup(destination);
      sqlite.prepare(
        "insert into reading_books (book_id, title, author, status, current_page, revision, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run("reading-book-after-copy", "After copy", "", "wishlist", 0, 1, "2026-08-13T10:01:00.000Z", "2026-08-13T10:01:00.000Z");
      return result;
    });

    const manifest = await createVerifiedBackup({
      sqlite,
      databaseFile,
      backupsRoot,
      writeBarrier: new WriteBarrier(),
      createId: () => "backup-reading-v15",
    });

    expect(manifest).toMatchObject({
      schemaVersion: "25",
      recordCounts: { readingBooks: 1, readingNotes: 1, readingSessions: 1 },
    });
    expect(sqlite.prepare("select count(*) from reading_books").pluck().get()).toBe(2);
  });

  it("accepts a complete v13 manifest with exactly three strict personal-knowledge counts", () => {
    const manifest = createV13Manifest();
    const backupsRoot = publishManifestFixture(manifest, "v13-backup");

    const parsed = findLatestVerifiedBackup(backupsRoot);
    expect(parsed).toMatchObject({
      schemaVersion: "13",
      recordCounts: Object.fromEntries(
        personalKnowledgeCountFields.map((field) => [field, 1]),
      ),
    });
    expect(
      Object.keys(parsed?.recordCounts ?? {}).filter((field) =>
        personalKnowledgeCountFields.includes(
          field as keyof typeof personalKnowledgeCountTables,
        ),
      ),
    ).toEqual(personalKnowledgeCountFields);
  });

  it.each(invalidV13PersonalKnowledgeManifestCases)(
    "rejects a v13 personal knowledge manifest with %s",
    (_name, mutate) => {
      const manifest = createV13Manifest();
      mutate(manifest);
      const backupsRoot = publishManifestFixture(manifest, "v13-backup");

      expect(findLatestVerifiedBackup(backupsRoot)).toBeNull();
    },
  );

  it.each(preV13ManifestFactories)(
    "normalizes all three personal-knowledge counts to null from a v%s manifest",
    (schemaVersion, createManifest) => {
      const backupId = `personal-knowledge-legacy-v${schemaVersion}`;
      const manifest = createManifest(backupId);
      for (const field of personalKnowledgeCountFields) {
        recordCountsOf(manifest)[field] = 99;
      }
      const backupsRoot = publishManifestFixture(manifest, backupId);

      expect(findLatestVerifiedBackup(backupsRoot)).toMatchObject({
        schemaVersion,
        recordCounts: nullPersonalKnowledgeRecordCounts,
      });
    },
  );

  it("publishes schema v13 with copied-database personal-knowledge counts", async () => {
    const { sqlite, databaseFile, backupsRoot } = setup();
    seedPersonalKnowledgeRows(sqlite);
    const originalBackup = sqlite.backup.bind(sqlite);
    vi.spyOn(sqlite, "backup").mockImplementation(async (destination) => {
      const result = await originalBackup(destination);
      sqlite.prepare(`insert into knowledge_modules
        (module_id, parent_module_id, name, goal, current_focus, description, status,
         ordinal, revision, created_at, updated_at)
        values ('knowledge-module-after-copy', null, 'Later', '', '', '', 'learning',
                1, 1, '2026-08-13T09:00:00.000Z', '2026-08-13T09:00:00.000Z')`).run();
      return result;
    });

    const manifest = await createVerifiedBackup({
      sqlite,
      databaseFile,
      backupsRoot,
      writeBarrier: new WriteBarrier(),
      now: () => new Date("2026-08-13T10:00:00.000Z"),
      createId: () => "backup-personal-knowledge-v13",
    });

    expect(manifest.schemaVersion).toBe("25");
    expect(manifest.recordCounts).toMatchObject({
      knowledgeModules: 1,
      dailyLearningNotes: 1,
      knowledgeItemOrganizations: null,
    });
    expect(sqlite.prepare("select count(*) from knowledge_modules").pluck().get()).toBe(2);
  });

  it.each(Object.entries(personalKnowledgeCountTables).filter(([, table]) => table !== "knowledge_item_organization"))(
    "fails before hashing and publishes nothing when a v13 database lacks %s",
    async (_field, table) => {
      const { sqlite, databaseFile, backupsRoot } = setup();
      sqlite.exec(`drop table ${table}`);
      const calculateHash = vi.fn();
      const verifyHash = vi.fn();

      await expect(createVerifiedBackup({
        sqlite,
        databaseFile,
        backupsRoot,
        writeBarrier: new WriteBarrier(),
        createId: () => `missing-${table.replaceAll("_", "-")}`,
        calculateHash,
        verifyHash,
      })).rejects.toThrow(new RegExp(table));
      expect(calculateHash).not.toHaveBeenCalled();
      expect(verifyHash).not.toHaveBeenCalled();
      expect(findLatestVerifiedBackup(backupsRoot)).toBeNull();
      expect(fs.readdirSync(backupsRoot)).toEqual([]);
    },
  );

  it("accepts a complete v12 manifest with strict manual-skincare counts", () => {
    const manifest = createV12Manifest();
    const backupsRoot = publishManifestFixture(manifest, "v12-backup");

    expect(findLatestVerifiedBackup(backupsRoot)).toMatchObject({
      schemaVersion: "12",
      recordCounts: Object.fromEntries(
        manualSkincareCountFields.map((field) => [field, 1]),
      ),
    });
  });

  it.each(invalidV12ManualSkincareManifestCases)(
    "rejects a v12 manifest with %s",
    (_name, mutate) => {
      const manifest = createV12Manifest();
      mutate(manifest);
      const backupsRoot = publishManifestFixture(manifest, "v12-backup");

      expect(findLatestVerifiedBackup(backupsRoot)).toBeNull();
    },
  );

  it.each(preV12ManifestFactories)(
    "normalizes every manual-skincare count to null from a v%s manifest",
    (schemaVersion, createManifest) => {
      const backupId = `manual-skincare-legacy-v${schemaVersion}`;
      const manifest = createManifest(backupId);
      for (const field of manualSkincareCountFields) {
        recordCountsOf(manifest)[field] = 99;
      }
      const backupsRoot = publishManifestFixture(manifest, backupId);

      expect(findLatestVerifiedBackup(backupsRoot)).toMatchObject({
        schemaVersion,
        recordCounts: nullManualSkincareRecordCounts,
      });
    },
  );

  it("publishes schema v13 with exact manual-skincare counts from the copied database", async () => {
    const { sqlite, databaseFile, backupsRoot } = setup();
    seedManualSkincareRows(sqlite);
    const originalBackup = sqlite.backup.bind(sqlite);
    vi.spyOn(sqlite, "backup").mockImplementation(async (destination) => {
      const result = await originalBackup(destination);
      sqlite.prepare(`insert into manual_skincare_products
        (id, name, brand, current_purpose, status, added_on, note, revision,
         created_at, updated_at)
        values ('manual-skin-product-after-copy', 'Later product', '', '', 'active',
                '2026-08-14', '', 1, '2026-08-13T09:00:00.000Z',
                '2026-08-13T09:00:00.000Z')`).run();
      return result;
    });

    const manifest = await createVerifiedBackup({
      sqlite,
      databaseFile,
      backupsRoot,
      writeBarrier: new WriteBarrier(),
      now: () => new Date("2026-08-13T10:00:00.000Z"),
      createId: () => "backup-manual-skincare-v12",
    });

    expect(manifest.schemaVersion).toBe("25");
    expect(manifest.recordCounts).toMatchObject(
      Object.fromEntries(manualSkincareCountFields.map((field) => [field, 1])),
    );
    const backupSqlite = new Database(path.join(
      backupsRoot,
      manifest.backupId,
      "life-pivot.sqlite",
    ), { readonly: true });
    databases.push(backupSqlite);
    expect(backupSqlite.prepare(`select photo_blob, photo_mime
      from manual_skincare_products where id = 'manual-skin-product-backup'`).get())
      .toEqual({
        photo_blob: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        photo_mime: "image/png",
      });
    expect(sqlite.prepare("select count(*) from manual_skincare_products").pluck().get()).toBe(2);
  });

  it.each(Object.entries(manualSkincareCountTables))(
    "fails before hashing and publishes nothing when a v13 database lacks %s",
    async (_field, table) => {
      const { sqlite, databaseFile, backupsRoot } = setup();
      sqlite.exec(`drop table ${table}`);
      const calculateHash = vi.fn();
      const verifyHash = vi.fn();

      await expect(createVerifiedBackup({
        sqlite,
        databaseFile,
        backupsRoot,
        writeBarrier: new WriteBarrier(),
        createId: () => `missing-${table.replaceAll("_", "-")}`,
        calculateHash,
        verifyHash,
      })).rejects.toThrow(new RegExp(table));
      expect(calculateHash).not.toHaveBeenCalled();
      expect(verifyHash).not.toHaveBeenCalled();
      expect(findLatestVerifiedBackup(backupsRoot)).toBeNull();
      expect(fs.readdirSync(backupsRoot)).toEqual([]);
    },
  );

  it("accepts a complete v11 manifest with strict manual-exercise counts", () => {
    const manifest = createV11Manifest();
    const backupsRoot = publishManifestFixture(manifest, "v11-backup");

    expect(findLatestVerifiedBackup(backupsRoot)).toMatchObject({
      schemaVersion: "11",
      recordCounts: Object.fromEntries(
        manualExerciseCountFields.map((field) => [field, 1]),
      ),
    });
  });

  it.each(invalidV11ManualExerciseManifestCases)(
    "rejects a v11 manifest with %s",
    (_name, mutate) => {
      const manifest = createV11Manifest();
      mutate(manifest);
      const backupsRoot = publishManifestFixture(manifest, "v11-backup");

      expect(findLatestVerifiedBackup(backupsRoot)).toBeNull();
    },
  );

  it.each(preV11ManifestFactories)(
    "normalizes every manual-exercise count to null from a v%s manifest",
    (schemaVersion, createManifest) => {
      const backupId = `manual-exercise-legacy-v${schemaVersion}`;
      const manifest = createManifest(backupId);
      for (const field of manualExerciseCountFields) {
        recordCountsOf(manifest)[field] = 99;
      }
      const backupsRoot = publishManifestFixture(manifest, backupId);

      expect(findLatestVerifiedBackup(backupsRoot)).toMatchObject({
        schemaVersion,
        recordCounts: nullManualExerciseRecordCounts,
      });
    },
  );

  it("publishes schema v13 with exact manual-exercise counts from the copied database", async () => {
    const { sqlite, databaseFile, backupsRoot } = setup();
    seedManualExerciseRows(sqlite);
    const originalBackup = sqlite.backup.bind(sqlite);
    vi.spyOn(sqlite, "backup").mockImplementation(async (destination) => {
      const result = await originalBackup(destination);
      sqlite.prepare(`insert into manual_exercise_cycle_events
        (id, template_id, business_date, event_type, from_day_key, to_day_key, day_id,
         note, cycle_revision_before, cycle_revision_after, created_at)
        values ('manual-event-after-copy', 'manual-template-backup', '2026-08-14', 'advanced',
                'push', 'push', 'manual-day-backup', '', 1, 2, '2026-08-13T01:00:00.000Z')`).run();
      return result;
    });

    const manifest = await createVerifiedBackup({
      sqlite,
      databaseFile,
      backupsRoot,
      writeBarrier: new WriteBarrier(),
      now: () => new Date("2026-08-13T02:00:00.000Z"),
      createId: () => "backup-manual-exercise-v11",
    });

    expect(manifest.schemaVersion).toBe("25");
    expect(manifest.recordCounts).toMatchObject(
      Object.fromEntries(manualExerciseCountFields.map((field) => [field, 1])),
    );
    expect(manifest.recordCounts.manualExerciseProgressDecisions).toBe(0);
    expect(sqlite.prepare("select count(*) from manual_exercise_cycle_events").pluck().get()).toBe(2);
  });

  it.each(Object.entries(manualExerciseCountTables))(
    "fails before hashing and publishes nothing when a v13 database lacks %s",
    async (_field, table) => {
      const { sqlite, databaseFile, backupsRoot } = setup();
      sqlite.exec(`drop table ${table}`);
      const calculateHash = vi.fn();
      const verifyHash = vi.fn();

      await expect(createVerifiedBackup({
        sqlite,
        databaseFile,
        backupsRoot,
        writeBarrier: new WriteBarrier(),
        createId: () => `missing-${table.replaceAll("_", "-")}`,
        calculateHash,
        verifyHash,
      })).rejects.toThrow(new RegExp(table));
      expect(calculateHash).not.toHaveBeenCalled();
      expect(verifyHash).not.toHaveBeenCalled();
      expect(findLatestVerifiedBackup(backupsRoot)).toBeNull();
      expect(fs.readdirSync(backupsRoot)).toEqual([]);
    },
  );

  it.each(Object.entries(manualExerciseProgressCountTables))(
    "fails before hashing and publishes nothing when a v17 database lacks %s",
    async (_field, table) => {
      const { sqlite, databaseFile, backupsRoot } = setup();
      sqlite.exec(`drop table ${table}`);
      const calculateHash = vi.fn();
      const verifyHash = vi.fn();

      await expect(createVerifiedBackup({
        sqlite,
        databaseFile,
        backupsRoot,
        writeBarrier: new WriteBarrier(),
        createId: () => `missing-${table.replaceAll("_", "-")}`,
        calculateHash,
        verifyHash,
      })).rejects.toThrow(new RegExp(table));
      expect(calculateHash).not.toHaveBeenCalled();
      expect(verifyHash).not.toHaveBeenCalled();
      expect(findLatestVerifiedBackup(backupsRoot)).toBeNull();
      expect(fs.readdirSync(backupsRoot)).toEqual([]);
    },
  );

  it("accepts a complete v10 manifest with strict personal-accumulation counts", () => {
    const manifest = createV10Manifest();
    const backupsRoot = publishManifestFixture(manifest, "v10-backup");

    expect(findLatestVerifiedBackup(backupsRoot)).toMatchObject({
      schemaVersion: "10",
      recordCounts: Object.fromEntries(
        personalAccumulationCountFields.map((field) => [field, 1]),
      ),
    });
  });

  it.each(invalidV10PersonalAccumulationManifestCases)(
    "rejects a v10 manifest with %s",
    (_name, mutate) => {
      const manifest = createV10Manifest();
      mutate(manifest);
      const backupsRoot = publishManifestFixture(manifest, "v10-backup");

      expect(findLatestVerifiedBackup(backupsRoot)).toBeNull();
    },
  );

  it.each([
    "healthChecklistAnything",
    "sleepDailyAnything",
    "personalDailyAnything",
    "personalDailyNotesUnexpected",
  ])("rejects an unknown v10 personal-accumulation count: %s", (field) => {
    const manifest = createV10Manifest();
    recordCountsOf(manifest)[field] = 1;
    const backupsRoot = publishManifestFixture(manifest, "v10-backup");

    expect(findLatestVerifiedBackup(backupsRoot)).toBeNull();
  });

  it.each(preV10ManifestFactories)(
    "normalizes every personal-accumulation count to null from a v%s manifest",
    (schemaVersion, createManifest) => {
      const backupId = `personal-legacy-v${schemaVersion}`;
      const manifest = createManifest(backupId);
      for (const field of personalAccumulationCountFields) {
        recordCountsOf(manifest)[field] = 99;
      }
      const backupsRoot = publishManifestFixture(manifest, backupId);

      expect(findLatestVerifiedBackup(backupsRoot)).toMatchObject({
        schemaVersion,
        recordCounts: nullPersonalAccumulationRecordCounts,
      });
    },
  );

  it("publishes schema v13 with exact personal-accumulation counts from the copied database", async () => {
    const { sqlite, databaseFile, backupsRoot } = setup();
    seedPersonalAccumulationRows(sqlite);
    const originalBackup = sqlite.backup.bind(sqlite);
    vi.spyOn(sqlite, "backup").mockImplementation(async (destination) => {
      const result = await originalBackup(destination);
      sqlite.prepare(`insert into personal_daily_notes
        (id, business_date, content, revision, created_at, updated_at)
        values ('personal-note-after-copy', '2026-08-13', 'Later live row', 1,
                '2026-08-12T01:00:00.000Z', '2026-08-12T01:00:00.000Z')`).run();
      return result;
    });

    const manifest = await createVerifiedBackup({
      sqlite,
      databaseFile,
      backupsRoot,
      writeBarrier: new WriteBarrier(),
      now: () => new Date("2026-08-12T02:00:00.000Z"),
      createId: () => "backup-personal-v10",
    });

    expect(manifest.schemaVersion).toBe("25");
    expect(manifest.recordCounts).toMatchObject(
      Object.fromEntries(personalAccumulationCountFields.map((field) => [field, 1])),
    );
    expect(sqlite.prepare("select count(*) from personal_daily_notes").pluck().get()).toBe(2);
  });

  it.each(Object.entries(personalAccumulationCountTables))(
    "fails before hashing and publishes nothing when a v10 database lacks %s",
    async (_field, table) => {
      const { sqlite, databaseFile, backupsRoot } = setup();
      sqlite.exec(`drop table ${table}`);
      const calculateHash = vi.fn();
      const verifyHash = vi.fn();

      await expect(createVerifiedBackup({
        sqlite,
        databaseFile,
        backupsRoot,
        writeBarrier: new WriteBarrier(),
        createId: () => `missing-${table.replaceAll("_", "-")}`,
        calculateHash,
        verifyHash,
      })).rejects.toThrow(new RegExp(table));
      expect(calculateHash).not.toHaveBeenCalled();
      expect(verifyHash).not.toHaveBeenCalled();
      expect(findLatestVerifiedBackup(backupsRoot)).toBeNull();
      expect(fs.readdirSync(backupsRoot)).toEqual([]);
    },
  );


  it("fails closed and cleans pending output for an unknown future database schema", async () => {
    const { sqlite, databaseFile, backupsRoot } = setup();
    sqlite.prepare("update app_meta set value = '999' where key = 'schema_version'").run();

    await expect(
      createVerifiedBackup({
        sqlite,
        databaseFile,
        backupsRoot,
        writeBarrier: new WriteBarrier(),
        now: () => new Date("2026-08-09T12:00:00.000Z"),
        createId: () => "backup-unsupported-schema",
      }),
    ).rejects.toThrow(/unsupported database schema/i);
    expect(findLatestVerifiedBackup(backupsRoot)).toBeNull();
    expect(fs.readdirSync(backupsRoot)).toEqual([]);
  });


  it("fails closed and cleans pending output when the first v7 authoritative count table is absent", async () => {
    const { sqlite, databaseFile, backupsRoot } = setup();
    expect(
      sqlite.prepare("select value from app_meta where key = 'schema_version'").pluck().get(),
    ).toBe("25");
    sqlite.exec("drop table action_events");

    await expect(
      createVerifiedBackup({
        sqlite,
        databaseFile,
        backupsRoot,
        writeBarrier: new WriteBarrier(),
        now: () => new Date("2026-08-09T12:00:00.000Z"),
        createId: () => "backup-missing-action-events",
      }),
    ).rejects.toThrow(/no such table: action_events/);
    expect(findLatestVerifiedBackup(backupsRoot)).toBeNull();
    expect(fs.readdirSync(backupsRoot)).toEqual([]);
  });





  it("accepts explicit null evidence fields in a v1 manifest", () => {
    const manifest = createLegacyManifest();
    manifest.applicationVersion = null;
    recordCountsOf(manifest).captureItems = null;
    const backupsRoot = publishManifestFixture(manifest);

    expect(findLatestVerifiedBackup(backupsRoot)).toMatchObject({
      schemaVersion: "1",
      applicationVersion: null,
      recordCounts: { captureItems: null },
    });
  });

  it.each(invalidV2ManifestCases)("rejects a v2 manifest with %s", (_name, mutate) => {
    const manifest = createV2Manifest();
    mutate(manifest);
    const backupsRoot = publishManifestFixture(manifest, "v2-backup");

    expect(findLatestVerifiedBackup(backupsRoot)).toBeNull();
  });

  it.each(legacyManifestFactories)(
    "normalizes every skincare count to null from a v%s manifest",
    (_schemaVersion, createManifest) => {
      for (const [index, rawSkincareCount] of [
        undefined,
        null,
        99,
        -1,
        1.5,
        "legacy",
        {},
      ].entries()) {
        const backupId = `legacy-v${_schemaVersion}-${index}`;
        const manifest = createManifest(backupId);
        for (const field of skincareCountFields) {
          if (rawSkincareCount === undefined) {
            delete recordCountsOf(manifest)[field];
          } else {
            recordCountsOf(manifest)[field] = rawSkincareCount;
          }
        }
        const backupsRoot = publishManifestFixture(manifest, backupId);

        expect(findLatestVerifiedBackup(backupsRoot)).toMatchObject({
          schemaVersion: _schemaVersion,
          recordCounts: nullSkincareRecordCounts,
        });
      }
    },
  );

  it.each(predecessorManifestFactories)(
    "normalizes every Sleep count to null from a v%s manifest",
    (_schemaVersion, createManifest) => {
      const manifest = createManifest(`sleep-legacy-v${_schemaVersion}`);
      for (const field of sleepCountFields) recordCountsOf(manifest)[field] = 99;
      const backupsRoot = publishManifestFixture(manifest, `sleep-legacy-v${_schemaVersion}`);

      expect(findLatestVerifiedBackup(backupsRoot)).toMatchObject({
        schemaVersion: _schemaVersion,
        recordCounts: nullSleepRecordCounts,
      });
    },
  );

  it("normalizes absent v3-only counts from a v2 manifest", () => {
    const manifest = createV2Manifest();
    const backupsRoot = publishManifestFixture(manifest, "v2-backup");

    expect(findLatestVerifiedBackup(backupsRoot)).toMatchObject({
      schemaVersion: "2",
      recordCounts: Object.fromEntries(v3CountFields.map((field) => [field, null])),
    });
  });

  it.each(invalidV3ManifestCases)("rejects a v3 manifest with %s", (_name, mutate) => {
    const manifest = createV3Manifest();
    mutate(manifest);
    const backupsRoot = publishManifestFixture(manifest, "v3-backup");

    expect(findLatestVerifiedBackup(backupsRoot)).toBeNull();
  });

  it.each(invalidV4ManifestCases)("rejects a v4 manifest with %s", (_name, mutate) => {
    const manifest = createV4Manifest();
    mutate(manifest);
    const backupsRoot = publishManifestFixture(manifest, "v4-backup");

    expect(findLatestVerifiedBackup(backupsRoot)).toBeNull();
  });

  it.each([0, Number.MAX_SAFE_INTEGER])(
    "accepts a v5 manifest with knowledgeDomains=%s at the inclusive safe-integer boundary",
    (knowledgeDomains) => {
      const manifest = createV5Manifest(`v5-backup-${knowledgeDomains}`);
      recordCountsOf(manifest).knowledgeDomains = knowledgeDomains;
      const backupsRoot = publishManifestFixture(manifest, `v5-backup-${knowledgeDomains}`);

      expect(findLatestVerifiedBackup(backupsRoot)).toMatchObject({
        schemaVersion: "5",
        recordCounts: { knowledgeDomains },
      });
    },
  );

  it.each(invalidV5ManifestCases)("rejects a v5 manifest with %s", (_name, mutate) => {
    const manifest = createV5Manifest();
    mutate(manifest);
    const backupsRoot = publishManifestFixture(manifest, "v5-backup");

    expect(findLatestVerifiedBackup(backupsRoot)).toBeNull();
  });

  it("accepts a complete v6 manifest with all skincare counts", () => {
    const manifest = createV6Manifest();
    const backupsRoot = publishManifestFixture(manifest, "v6-backup");

    const parsed = findLatestVerifiedBackup(backupsRoot);
    expect(parsed).toMatchObject({
      schemaVersion: "6",
      recordCounts: Object.fromEntries(skincareCountFields.map((field) => [field, 1])),
    });
    expect(
      Object.keys(parsed?.recordCounts ?? {}).filter((field) => skincareCountFields.includes(field as keyof typeof skincareCountTables)),
    ).toEqual(skincareCountFields);
  });

  it.each(invalidV6ManifestCases)("rejects a v6 manifest with %s", (_name, mutate) => {
    const manifest = createV6Manifest();
    mutate(manifest);
    const backupsRoot = publishManifestFixture(manifest, "v6-backup");

    expect(findLatestVerifiedBackup(backupsRoot)).toBeNull();
  });

  it("accepts a complete v7 manifest with the same strict skincare counts as v6", () => {
    const manifest = createV7Manifest();
    const backupsRoot = publishManifestFixture(manifest, "v7-backup");

    expect(findLatestVerifiedBackup(backupsRoot)).toMatchObject({
      schemaVersion: "7",
      recordCounts: Object.fromEntries(skincareCountFields.map((field) => [field, 1])),
    });
  });

  it.each(invalidV6ManifestCases)("rejects a v7 manifest with %s", (_name, mutate) => {
    const manifest = createV7Manifest();
    mutate(manifest);
    const backupsRoot = publishManifestFixture(manifest, "v7-backup");

    expect(findLatestVerifiedBackup(backupsRoot)).toBeNull();
  });

  it("accepts a complete v8 manifest with strict Sleep counts", () => {
    const manifest = createV8Manifest();
    const backupsRoot = publishManifestFixture(manifest, "v8-backup");

    expect(findLatestVerifiedBackup(backupsRoot)).toMatchObject({
      schemaVersion: "8",
      recordCounts: Object.fromEntries(sleepCountFields.map((field) => [field, 1])),
    });
  });

  it.each(invalidV8SleepManifestCases)("rejects a v8 manifest with %s", (_name, mutate) => {
    const manifest = createV8Manifest();
    mutate(manifest);
    const backupsRoot = publishManifestFixture(manifest, "v8-backup");

    expect(findLatestVerifiedBackup(backupsRoot)).toBeNull();
  });

  it("rejects manifests from an unknown schema version", () => {
    const manifest = createV2Manifest("unknown-version");
    manifest.schemaVersion = "999";
    const backupsRoot = publishManifestFixture(manifest, "unknown-version");

    expect(findLatestVerifiedBackup(backupsRoot)).toBeNull();
  });

  it("returns a sanitized manifest without unknown JSON properties", () => {
    const manifest = createLegacyManifest("sanitized-backup");
    manifest.applicationVersion = "0.1.0";
    manifest.unexpected = "untrusted";
    recordCountsOf(manifest).captureItems = 2;
    recordCountsOf(manifest).unexpected = 99;
    const backupsRoot = publishManifestFixture(manifest, "sanitized-backup");

    expect(findLatestVerifiedBackup(backupsRoot)).toEqual({
      backupId: "sanitized-backup",
      schemaVersion: "1",
      applicationVersion: "0.1.0",
      createdAt: "2026-08-09T12:00:00.000Z",
      databaseSha256: "a".repeat(64),
      databaseBytes: 11,
      status: "verified",
      recordCounts: {
        lifeAreas: 0,
        metricRecords: 0,
        dailyEntries: 1,
        captureItems: 2,
        actionEvents: null,
        knowledgeCandidates: null,
        knowledgeRevisions: null,
        knowledgeAssetEvents: null,
        dailySummaries: null,
        dailySummaryRevisions: null,
        reviewRevisions: null,
        evidenceLinks: null,
        knowledgeDomains: null,
        todayReminders: null,
        ...nullSkincareRecordCounts,
        ...nullSleepRecordCounts,
        ...nullExerciseRecordCounts,
        ...nullPersonalAccumulationRecordCounts,
        ...nullManualExerciseRecordCounts,
        ...nullManualExerciseProgressRecordCounts,
        ...nullManualSkincareRecordCounts,
        ...nullPersonalKnowledgeRecordCounts,
        ...nullWeeklyReviewPinRecordCounts,
        ...nullReadingRecordCounts,
        goals: 0,
        reviews: 0,
        knowledgeItems: 0,
      },
    });
  });

  it.each(malformedManifestCases)("rejects a manifest with %s", (_name, mutate) => {
    const manifest = createLegacyManifest();
    mutate(manifest);
    const directoryName = manifest.backupId === "bad id" ? "bad id" : "legacy-backup";
    const backupsRoot = publishManifestFixture(manifest, directoryName);

    expect(findLatestVerifiedBackup(backupsRoot)).toBeNull();
  });

  it("removes the pending directory and publishes nothing when verification fails", async () => {
    const { sqlite, databaseFile, backupsRoot } = setup();

    await expect(
      createVerifiedBackup({
        sqlite,
        databaseFile,
        backupsRoot,
        writeBarrier: new WriteBarrier(),
        now: () => new Date("2026-08-09T12:00:00.000Z"),
        createId: () => "backup-1",
        verifyHash: () => false,
      }),
    ).rejects.toThrow("备份文件哈希验证失败");

    expect(findLatestVerifiedBackup(backupsRoot)).toBeNull();
    expect(fs.readdirSync(backupsRoot)).toEqual([]);
  });

  it("uses the default SHA-256 verifier to reject a wrong 64-character calculated hash", async () => {
    const { sqlite, databaseFile, backupsRoot } = setup();
    const preserved = await createVerifiedBackup({
      sqlite,
      databaseFile,
      backupsRoot,
      writeBarrier: new WriteBarrier(),
      now: () => new Date("2026-08-09T12:00:00.000Z"),
      createId: () => "backup-prior",
    });
    const calculateHash = vi.fn(async () => "0".repeat(64));

    await expect(
      createVerifiedBackup({
        sqlite,
        databaseFile,
        backupsRoot,
        writeBarrier: new WriteBarrier(),
        now: () => new Date("2026-08-09T13:00:00.000Z"),
        createId: () => "backup-default-hash-mismatch",
        calculateHash,
      }),
    ).rejects.toThrow("备份文件哈希验证失败");

    expect(calculateHash).toHaveBeenCalledWith(
      path.join(backupsRoot, ".pending-backup-default-hash-mismatch", "life-pivot.sqlite"),
    );
    expect(findLatestVerifiedBackup(backupsRoot)).toEqual(preserved);
    expect(fs.readdirSync(backupsRoot)).toEqual(["backup-prior"]);
  });

  it("records every authoritative daily-loop table in a verified v6 manifest", async () => {
    const { sqlite, databaseFile, backupsRoot } = setup();
    seedDailyLoopRecords(sqlite);

    const manifest = await createVerifiedBackup({
      sqlite,
      databaseFile,
      backupsRoot,
      writeBarrier: new WriteBarrier(),
      now: () => new Date("2026-08-09T14:00:00.000Z"),
      createId: () => "backup-daily-loop",
    });

    expect(manifest.recordCounts).toMatchObject({
      actionEvents: 1,
      reviewRevisions: 1,
      knowledgeCandidates: null,
      knowledgeRevisions: null,
      dailySummaries: null,
      evidenceLinks: null,
      knowledgeDomains: null,
    });
  });
});
