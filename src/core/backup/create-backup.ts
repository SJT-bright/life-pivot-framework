import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { APPLICATION_VERSION } from "../application-version";

import {
  type WriteBarrier,
  applicationWriteBarrier,
} from "./write-barrier";

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

type SkincareCountField = keyof typeof skincareCountTables;
type SkincareRecordCounts = Record<SkincareCountField, number | null>;
const skincareCountFields = Object.keys(skincareCountTables) as SkincareCountField[];
const skincareCountEntries = Object.entries(skincareCountTables) as Array<
  [SkincareCountField, string]
>;

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

type SleepCountField = keyof typeof sleepCountTables;
type SleepRecordCounts = Record<SleepCountField, number | null>;
const sleepCountFields = Object.keys(sleepCountTables) as SleepCountField[];
const sleepCountEntries = Object.entries(sleepCountTables) as Array<
  [SleepCountField, string]
>;

const exerciseCountTables = {
  exerciseMovements: "exercise_movements",
  exerciseMovementVariants: "exercise_movement_variants",
  trainingPlans: "training_plans",
  trainingPlanVersions: "training_plan_versions",
  trainingWorkoutTemplates: "training_workout_templates",
  trainingPrescriptions: "training_prescriptions",
  strengthPrescriptions: "strength_prescriptions",
  cardioPrescriptions: "cardio_prescriptions",
  mobilityPrescriptions: "mobility_prescriptions",
  trainingCycles: "training_cycles",
  trainingPlannedOccurrences: "training_planned_occurrences",
  trainingSessions: "training_sessions",
  trainingSessionEvents: "training_session_events",
  strengthSetEvents: "strength_set_events",
  cardioSegmentEvents: "cardio_segment_events",
  mobilityHoldEvents: "mobility_hold_events",
  trainingRecoveryObservations: "training_recovery_observations",
  trainingRecoveryObservationEvents: "training_recovery_observation_events",
} as const;
type ExerciseCountField = keyof typeof exerciseCountTables;
type ExerciseRecordCounts = Record<ExerciseCountField, number | null>;
const exerciseCountFields = Object.keys(exerciseCountTables) as ExerciseCountField[];
const exerciseCountEntries = Object.entries(exerciseCountTables) as Array<[ExerciseCountField, string]>;

const personalAccumulationCountTables = {
  sleepDailyRecords: "sleep_daily_records",
  healthChecklistTemplates: "health_checklist_templates",
  healthChecklistVersions: "health_checklist_versions",
  healthChecklistTemplateItems: "health_checklist_template_items",
  healthChecklistDays: "health_checklist_days",
  healthChecklistDayItems: "health_checklist_day_items",
  personalDailyNotes: "personal_daily_notes",
} as const;
type PersonalAccumulationCountField = keyof typeof personalAccumulationCountTables;
type PersonalAccumulationRecordCounts = Record<
  PersonalAccumulationCountField,
  number | null
>;
const personalAccumulationCountFields = Object.keys(
  personalAccumulationCountTables,
) as PersonalAccumulationCountField[];
const personalAccumulationCountEntries = Object.entries(
  personalAccumulationCountTables,
) as Array<[PersonalAccumulationCountField, string]>;

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
type ManualExerciseCountField = keyof typeof manualExerciseCountTables;
type ManualExerciseRecordCounts = Record<ManualExerciseCountField, number | null>;
const manualExerciseCountFields = Object.keys(
  manualExerciseCountTables,
) as ManualExerciseCountField[];
const manualExerciseCountEntries = Object.entries(manualExerciseCountTables) as Array<
  [ManualExerciseCountField, string]
>;

const manualExerciseProgressCountTables = {
  manualExerciseProgressDecisions: "manual_exercise_progress_decisions",
} as const;
type ManualExerciseProgressCountField = keyof typeof manualExerciseProgressCountTables;
type ManualExerciseProgressRecordCounts = Record<ManualExerciseProgressCountField, number | null>;
const manualExerciseProgressCountFields = Object.keys(
  manualExerciseProgressCountTables,
) as ManualExerciseProgressCountField[];
const manualExerciseProgressCountEntries = Object.entries(
  manualExerciseProgressCountTables,
) as Array<[ManualExerciseProgressCountField, string]>;

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
type ManualSkincareCountField = keyof typeof manualSkincareCountTables;
type ManualSkincareRecordCounts = Record<ManualSkincareCountField, number | null>;
const manualSkincareCountFields = Object.keys(
  manualSkincareCountTables,
) as ManualSkincareCountField[];
const manualSkincareCountEntries = Object.entries(manualSkincareCountTables) as Array<
  [ManualSkincareCountField, string]
>;

const personalKnowledgeCountTables = {
  knowledgeModules: "knowledge_modules",
  dailyLearningNotes: "daily_learning_notes",
  knowledgeItemOrganizations: "knowledge_item_organization",
} as const;
type PersonalKnowledgeCountField = keyof typeof personalKnowledgeCountTables;
type PersonalKnowledgeRecordCounts = Record<PersonalKnowledgeCountField, number | null>;
const personalKnowledgeCountFields = Object.keys(
  personalKnowledgeCountTables,
) as PersonalKnowledgeCountField[];
const personalKnowledgeCountEntries = Object.entries(
  personalKnowledgeCountTables,
) as Array<[PersonalKnowledgeCountField, string]>;

const weeklyReviewPinCountTables = { userPins: "user_pins" } as const;
type WeeklyReviewPinCountField = keyof typeof weeklyReviewPinCountTables;
type WeeklyReviewPinRecordCounts = Record<WeeklyReviewPinCountField, number | null>;
const weeklyReviewPinCountFields = Object.keys(
  weeklyReviewPinCountTables,
) as WeeklyReviewPinCountField[];
const weeklyReviewPinCountEntries = Object.entries(
  weeklyReviewPinCountTables,
) as Array<[WeeklyReviewPinCountField, string]>;

const readingCountTables = {
  readingBooks: "reading_books",
  readingNotes: "reading_notes",
  readingSessions: "reading_sessions",
} as const;
type ReadingCountField = keyof typeof readingCountTables;
type ReadingRecordCounts = Record<ReadingCountField, number | null>;
const readingCountFields = Object.keys(readingCountTables) as ReadingCountField[];
const readingCountEntries = Object.entries(readingCountTables) as Array<
  [ReadingCountField, string]
>;

export interface BackupManifest {
  backupId: string;
  schemaVersion: string;
  applicationVersion: string | null;
  createdAt: string;
  databaseSha256: string;
  databaseBytes: number;
  status: "verified";
  recordCounts: {
    lifeAreas: number | null;
    metricRecords: number | null;
    dailyEntries: number | null;
    captureItems: number | null;
    actionEvents: number | null;
    goals: number | null;
    reviews: number | null;
    knowledgeItems: number | null;
    knowledgeCandidates: number | null;
    knowledgeRevisions: number | null;
    knowledgeAssetEvents: number | null;
    dailySummaries: number | null;
    dailySummaryRevisions: number | null;
    reviewRevisions: number | null;
    evidenceLinks: number | null;
    knowledgeDomains: number | null;
    todayReminders: number | null;
  } & SkincareRecordCounts & SleepRecordCounts & ExerciseRecordCounts &
    PersonalAccumulationRecordCounts & ManualExerciseRecordCounts &
    ManualExerciseProgressRecordCounts & ManualSkincareRecordCounts &
    PersonalKnowledgeRecordCounts &
    WeeklyReviewPinRecordCounts & ReadingRecordCounts;
}

interface CreateVerifiedBackupDependencies {
  sqlite: Database.Database;
  databaseFile: string;
  backupsRoot: string;
  writeBarrier?: WriteBarrier;
  now?: () => Date;
  createId?: () => string;
  calculateHash?: (databaseFile: string) => Promise<string> | string;
  verifyHash?: (databaseFile: string, expectedHash: string) => Promise<boolean> | boolean;
}

const SAFE_BACKUP_ID = /^[A-Za-z0-9_-]{1,100}$/;
const CURRENT_DATABASE_SCHEMA_VERSION = "25";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function parseManifest(value: unknown): BackupManifest | null {
  if (!isRecord(value)) return null;
  const recordCounts = value.recordCounts;
  if (!isRecord(recordCounts)) return null;

  const {
    backupId,
    schemaVersion,
    applicationVersion,
    createdAt,
    databaseSha256,
    databaseBytes,
    status,
  } = value;
  const {
    lifeAreas,
    metricRecords,
    dailyEntries,
    captureItems,
    actionEvents,
    goals,
    reviews,
    knowledgeItems,
    knowledgeCandidates,
    knowledgeRevisions,
    knowledgeAssetEvents,
    dailySummaries,
    dailySummaryRevisions,
    reviewRevisions,
    evidenceLinks,
    knowledgeDomains,
    todayReminders,
  } = recordCounts;
  const skincareRecordCounts = Object.fromEntries(
    skincareCountFields.map((field) => [field, recordCounts[field]]),
  ) as Record<SkincareCountField, unknown>;
  const sleepRecordCounts = Object.fromEntries(
    sleepCountFields.map((field) => [field, recordCounts[field]]),
  ) as Record<SleepCountField, unknown>;
  const exerciseRecordCounts = Object.fromEntries(
    exerciseCountFields.map((field) => [field, recordCounts[field]]),
  ) as Record<ExerciseCountField, unknown>;
  const personalAccumulationRecordCounts = Object.fromEntries(
    personalAccumulationCountFields.map((field) => [field, recordCounts[field]]),
  ) as Record<PersonalAccumulationCountField, unknown>;
  const manualExerciseRecordCounts = Object.fromEntries(
    manualExerciseCountFields.map((field) => [field, recordCounts[field]]),
  ) as Record<ManualExerciseCountField, unknown>;
  const manualExerciseProgressRecordCounts = Object.fromEntries(
    manualExerciseProgressCountFields.map((field) => [field, recordCounts[field]]),
  ) as Record<ManualExerciseProgressCountField, unknown>;
  const manualSkincareRecordCounts = Object.fromEntries(
    manualSkincareCountFields.map((field) => [field, recordCounts[field]]),
  ) as Record<ManualSkincareCountField, unknown>;
  const personalKnowledgeRecordCounts = Object.fromEntries(
    personalKnowledgeCountFields.map((field) => [field, recordCounts[field]]),
  ) as Record<PersonalKnowledgeCountField, unknown>;
  const weeklyReviewPinRecordCounts = Object.fromEntries(
    weeklyReviewPinCountFields.map((field) => [field, recordCounts[field]]),
  ) as Record<WeeklyReviewPinCountField, unknown>;
  const readingRecordCounts = Object.fromEntries(
    readingCountFields.map((field) => [field, recordCounts[field]]),
  ) as Record<ReadingCountField, unknown>;
  const dailyLoopCounts = [
    actionEvents,
    knowledgeCandidates,
    knowledgeRevisions,
    knowledgeAssetEvents,
    dailySummaries,
    dailySummaryRevisions,
    reviewRevisions,
    evidenceLinks,
  ];
  const schemaVersionText = typeof schemaVersion === "string" ? schemaVersion : "";
  const isCurrentSchema = ["18", "19", "20", "21", "22", "23", "24", "25"].includes(schemaVersionText);
  const hasApplicationVersion = schemaVersionText !== "1";
  const hasDailyLoopCounts = ["3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17"].includes(schemaVersionText);
  const hasKnowledgeDomains = ["5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17"].includes(schemaVersionText);
  const hasSkincareCounts = ["6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17"].includes(schemaVersionText);
  const hasSleepCounts = ["8", "9", "10", "11", "12", "13", "14", "15", "16", "17"].includes(schemaVersionText);
  const hasExerciseCounts = ["9", "10", "11", "12", "13", "14", "15", "16", "17"].includes(schemaVersionText);
  const hasPersonalAccumulationCounts = ["10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25"].includes(schemaVersionText);
  const hasManualExerciseCounts = ["11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25"].includes(schemaVersionText);
  const hasManualExerciseProgressCounts = ["17", "18", "19", "20", "21", "22", "23", "24", "25"].includes(schemaVersionText);
  const hasManualSkincareCounts = ["12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25"].includes(schemaVersionText);
  const hasPersonalKnowledgeCounts = ["13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25"].includes(schemaVersionText);
  const hasWeeklyReviewPinCounts =
    ["14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25"].includes(schemaVersionText);
  const hasReadingBookCounts = ["15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25"].includes(schemaVersionText);
  const hasReadingSessionCounts = ["16", "17", "18", "19", "20", "21", "22", "23", "24", "25"].includes(schemaVersionText);
  const hasTodayReminderCounts = ["19", "20", "21", "22", "23", "24", "25"].includes(schemaVersionText);
  const hasUnknownSleepCount = Object.keys(recordCounts).some(
    (field) => field.startsWith("sleep") &&
      !sleepCountFields.includes(field as SleepCountField) &&
      !personalAccumulationCountFields.includes(field as PersonalAccumulationCountField),
  );
  const hasUnknownExerciseCount = Object.keys(recordCounts).some(
    (field) => (field.startsWith("exercise") || field.startsWith("training") || field.endsWith("Events") || field.endsWith("Prescriptions")) &&
      !exerciseCountFields.includes(field as ExerciseCountField) &&
      !sleepCountFields.includes(field as SleepCountField) &&
      !skincareCountFields.includes(field as SkincareCountField) &&
      !manualExerciseCountFields.includes(field as ManualExerciseCountField) &&
      !["actionEvents", "knowledgeAssetEvents"].includes(field),
  );
  const hasUnknownManualExerciseCount = Object.keys(recordCounts).some(
    (field) =>
      field.startsWith("manualExercise") &&
      !manualExerciseCountFields.includes(field as ManualExerciseCountField) &&
      !(hasManualExerciseProgressCounts &&
        manualExerciseProgressCountFields.includes(field as ManualExerciseProgressCountField)),
  );
  const hasUnknownManualSkincareCount = Object.keys(recordCounts).some(
    (field) =>
      field.startsWith("manualSkincare") &&
      !manualSkincareCountFields.includes(field as ManualSkincareCountField),
  );
  const hasUnknownPersonalAccumulationCount = Object.keys(recordCounts).some(
    (field) =>
      (field.startsWith("healthChecklist") ||
        field.startsWith("sleepDaily") ||
        field.startsWith("personalDaily")) &&
      !personalAccumulationCountFields.includes(field as PersonalAccumulationCountField),
  );
  const hasUnknownPersonalKnowledgeCount = Object.keys(recordCounts).some(
    (field) =>
      (field.startsWith("knowledgeModule") ||
        field.startsWith("dailyLearning") ||
        field.startsWith("knowledgeItemOrganization")) &&
      !personalKnowledgeCountFields.includes(field as PersonalKnowledgeCountField),
  );
  const hasUnknownReadingCount = Object.keys(recordCounts).some(
    (field) =>
      field.startsWith("reading") &&
      !readingCountFields.includes(field as ReadingCountField),
  );

  if (
    typeof backupId !== "string" ||
    !SAFE_BACKUP_ID.test(backupId) ||
    typeof schemaVersion !== "string" ||
    schemaVersion.length === 0 ||
    !isIsoTimestamp(createdAt) ||
    typeof databaseSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(databaseSha256) ||
    !isNonNegativeSafeInteger(databaseBytes) ||
    status !== "verified" ||
    (schemaVersion !== "1" &&
      schemaVersion !== "2" &&
      schemaVersion !== "3" &&
      schemaVersion !== "4" &&
      schemaVersion !== "5" &&
      schemaVersion !== "6" &&
      schemaVersion !== "7" &&
      schemaVersion !== "8" &&
      schemaVersion !== "9" &&
      schemaVersion !== "10" &&
       schemaVersion !== "11" &&
       schemaVersion !== "12" &&
       schemaVersion !== "13" &&
       schemaVersion !== "14" &&
       schemaVersion !== "15" &&
       schemaVersion !== "16" &&
       schemaVersion !== "17" &&
       schemaVersion !== "18" &&
       schemaVersion !== "19" &&
       schemaVersion !== "20" &&
       schemaVersion !== "21" &&
       schemaVersion !== "22" &&
       schemaVersion !== "23" &&
       schemaVersion !== "24" && schemaVersion !== "25") ||
    (applicationVersion !== undefined &&
      applicationVersion !== null &&
      typeof applicationVersion !== "string") ||
    !isNonNegativeSafeInteger(lifeAreas) ||
    (isCurrentSchema ? metricRecords !== null : !isNonNegativeSafeInteger(metricRecords)) ||
    (isCurrentSchema ? dailyEntries !== null : !isNonNegativeSafeInteger(dailyEntries)) ||
    !isNonNegativeSafeInteger(goals) ||
    !isNonNegativeSafeInteger(reviews) ||
    (isCurrentSchema ? knowledgeItems !== null : !isNonNegativeSafeInteger(knowledgeItems)) ||
    (captureItems !== undefined &&
      captureItems !== null &&
      !isNonNegativeSafeInteger(captureItems)) ||
    dailyLoopCounts.some(
      (count) => count !== undefined && count !== null && !isNonNegativeSafeInteger(count),
    ) ||
    (hasApplicationVersion &&
      (typeof applicationVersion !== "string" ||
        applicationVersion.trim().length === 0 ||
        !isNonNegativeSafeInteger(captureItems))) ||
    (hasDailyLoopCounts &&
      dailyLoopCounts.some((count) => !isNonNegativeSafeInteger(count))) ||
    (isCurrentSchema &&
      (!isNonNegativeSafeInteger(actionEvents) ||
        !isNonNegativeSafeInteger(reviewRevisions) ||
        [
          knowledgeCandidates, knowledgeRevisions, knowledgeAssetEvents,
          dailySummaries, dailySummaryRevisions, evidenceLinks,
        ].some((count) => count !== null))) ||
    (hasKnowledgeDomains && !isNonNegativeSafeInteger(knowledgeDomains)) ||
    (isCurrentSchema && knowledgeDomains !== null) ||
    (hasSkincareCounts &&
      skincareCountFields.some(
        (field) => !isNonNegativeSafeInteger(skincareRecordCounts[field]),
      )) ||
    (hasSleepCounts &&
      (hasUnknownSleepCount ||
        sleepCountFields.some(
          (field) => !isNonNegativeSafeInteger(sleepRecordCounts[field]),
        ))) ||
    (hasExerciseCounts &&
      (hasUnknownExerciseCount || exerciseCountFields.some(
        (field) => !isNonNegativeSafeInteger(exerciseRecordCounts[field]),
      ))) ||
    (isCurrentSchema &&
      skincareCountFields.some((field) => skincareRecordCounts[field] !== null)) ||
    (isCurrentSchema &&
      sleepCountFields.some((field) => sleepRecordCounts[field] !== null)) ||
    (isCurrentSchema &&
      exerciseCountFields.some((field) => exerciseRecordCounts[field] !== null)) ||
    (hasPersonalAccumulationCounts &&
      (hasUnknownPersonalAccumulationCount ||
        personalAccumulationCountFields.some(
          (field) =>
            !isNonNegativeSafeInteger(personalAccumulationRecordCounts[field]),
        ))) ||
    (hasManualExerciseCounts &&
      (hasUnknownManualExerciseCount ||
        manualExerciseCountFields.some(
          (field) => !isNonNegativeSafeInteger(manualExerciseRecordCounts[field]),
        ))) ||
    (hasManualExerciseProgressCounts &&
      manualExerciseProgressCountFields.some(
        (field) => !isNonNegativeSafeInteger(manualExerciseProgressRecordCounts[field]),
      )) ||
    (hasManualSkincareCounts &&
      (hasUnknownManualSkincareCount ||
        manualSkincareCountFields.some(
          (field) => !isNonNegativeSafeInteger(manualSkincareRecordCounts[field]),
        ))) ||
    (hasPersonalKnowledgeCounts &&
      (hasUnknownPersonalKnowledgeCount ||
        (isCurrentSchema
          ? (["knowledgeModules", "dailyLearningNotes"] as const)
          : personalKnowledgeCountFields
        ).some(
          (field) => !isNonNegativeSafeInteger(personalKnowledgeRecordCounts[field]),
        ))) ||
    (isCurrentSchema &&
      personalKnowledgeRecordCounts.knowledgeItemOrganizations !== null) ||
    (hasWeeklyReviewPinCounts &&
      weeklyReviewPinCountFields.some(
        (field) => !isNonNegativeSafeInteger(weeklyReviewPinRecordCounts[field]),
      )) ||
    ((hasReadingBookCounts || hasReadingSessionCounts) && hasUnknownReadingCount) ||
    (schemaVersionText === "15" &&
      readingRecordCounts.readingSessions !== undefined &&
      readingRecordCounts.readingSessions !== null) ||
    (hasReadingBookCounts &&
      (["readingBooks", "readingNotes"] as const).some(
        (field) => !isNonNegativeSafeInteger(readingRecordCounts[field]),
      )) ||
    (hasReadingSessionCounts &&
      !isNonNegativeSafeInteger(readingRecordCounts.readingSessions)) ||
    (hasTodayReminderCounts && !isNonNegativeSafeInteger(todayReminders))
  ) {
    return null;
  }

  return {
    backupId,
    schemaVersion,
    applicationVersion: applicationVersion ?? null,
    createdAt,
    databaseSha256,
    databaseBytes,
    status,
    recordCounts: {
      lifeAreas,
      metricRecords: isCurrentSchema ? null : metricRecords as number,
      dailyEntries: isCurrentSchema ? null : dailyEntries as number,
      captureItems: captureItems ?? null,
      actionEvents:
        hasDailyLoopCounts || isCurrentSchema
          ? actionEvents as number
          : null,
      goals,
      reviews,
      knowledgeItems: isCurrentSchema ? null : knowledgeItems as number,
      knowledgeCandidates:
        hasDailyLoopCounts
          ? knowledgeCandidates as number
          : null,
      knowledgeRevisions:
        hasDailyLoopCounts
          ? knowledgeRevisions as number
          : null,
      knowledgeAssetEvents:
        hasDailyLoopCounts
          ? knowledgeAssetEvents as number
          : null,
      dailySummaries:
        hasDailyLoopCounts
          ? dailySummaries as number
          : null,
      dailySummaryRevisions:
        hasDailyLoopCounts
          ? dailySummaryRevisions as number
          : null,
      reviewRevisions:
        hasDailyLoopCounts || isCurrentSchema
          ? reviewRevisions as number
          : null,
      evidenceLinks:
        hasDailyLoopCounts
          ? evidenceLinks as number
          : null,
      knowledgeDomains: hasKnowledgeDomains ? knowledgeDomains as number : null,
      todayReminders: hasTodayReminderCounts ? todayReminders as number : null,
      ...Object.fromEntries(
        skincareCountFields.map((field) => [
          field,
          hasSkincareCounts
            ? skincareRecordCounts[field] as number
            : null,
        ]),
      ) as SkincareRecordCounts,
      ...Object.fromEntries(
        sleepCountFields.map((field) => [
          field,
          hasSleepCounts ? sleepRecordCounts[field] as number : null,
        ]),
      ) as SleepRecordCounts,
      ...Object.fromEntries(
        exerciseCountFields.map((field) => [
          field,
          hasExerciseCounts ? exerciseRecordCounts[field] as number : null,
        ]),
      ) as ExerciseRecordCounts,
      ...Object.fromEntries(
        personalAccumulationCountFields.map((field) => [
          field,
          hasPersonalAccumulationCounts
            ? personalAccumulationRecordCounts[field] as number
            : null,
        ]),
      ) as PersonalAccumulationRecordCounts,
      ...Object.fromEntries(
        manualExerciseCountFields.map((field) => [
          field,
          hasManualExerciseCounts ? manualExerciseRecordCounts[field] as number : null,
        ]),
      ) as ManualExerciseRecordCounts,
      ...Object.fromEntries(
        manualExerciseProgressCountFields.map((field) => [
          field,
          hasManualExerciseProgressCounts
            ? manualExerciseProgressRecordCounts[field] as number
            : null,
        ]),
      ) as ManualExerciseProgressRecordCounts,
      ...Object.fromEntries(
        manualSkincareCountFields.map((field) => [
          field,
          hasManualSkincareCounts ? manualSkincareRecordCounts[field] as number : null,
        ]),
      ) as ManualSkincareRecordCounts,
      ...Object.fromEntries(
        personalKnowledgeCountFields.map((field) => [
          field,
          hasPersonalKnowledgeCounts
            ? field === "knowledgeItemOrganizations" && isCurrentSchema
              ? null
              : personalKnowledgeRecordCounts[field] as number
            : null,
        ]),
      ) as PersonalKnowledgeRecordCounts,
      ...Object.fromEntries(
        weeklyReviewPinCountFields.map((field) => [
          field,
          hasWeeklyReviewPinCounts
            ? weeklyReviewPinRecordCounts[field] as number
            : null,
        ]),
      ) as WeeklyReviewPinRecordCounts,
      ...Object.fromEntries(
        readingCountFields.map((field) => [
          field,
          field === "readingSessions"
            ? hasReadingSessionCounts
              ? readingRecordCounts[field] as number
              : null
            : hasReadingBookCounts
              ? readingRecordCounts[field] as number
              : null,
        ]),
      ) as ReadingRecordCounts,
    },
  };
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}


// 0017 迁移删除的旧域表：当前 schema 下允许缺失（计数记为 null）
const OPTIONAL_AT_CURRENT_SCHEMA = new Set([
  "metric_definitions", "metric_definition_versions", "metric_records", "daily_entries",
  "daily_summaries", "daily_summary_revisions",
  "knowledge_domains", "knowledge_items", "knowledge_candidates",
  "knowledge_item_revisions", "knowledge_asset_events", "evidence_links",
  "knowledge_item_organization",
  "skincare_products", "skincare_formulations", "skincare_ingredients",
  "skincare_formulation_ingredients", "skincare_product_units",
  "skincare_ingredient_sensitivities", "skincare_formulation_conflicts",
  "skincare_tolerance_events", "skincare_plans", "skincare_plan_versions",
  "skincare_phases", "skincare_steps", "skincare_cycles",
  "skincare_safety_assessments", "skincare_plan_version_events",
  "skincare_usage_events", "skin_observation_events", "skincare_adverse_events",
  "skincare_adverse_usage_links",
  "sleep_plans", "sleep_plan_versions", "sleep_plan_schedule_days",
  "sleep_sessions", "sleep_session_events", "sleep_awake_intervals",
  "sleep_checkins", "sleep_checkin_events",
  "exercise_movements", "exercise_movement_variants", "training_plans",
  "training_plan_versions", "training_workout_templates", "training_prescriptions",
  "strength_prescriptions", "cardio_prescriptions", "mobility_prescriptions",
  "training_cycles", "training_planned_occurrences", "training_sessions",
  "training_session_events", "strength_set_events", "cardio_segment_events",
  "mobility_hold_events", "training_recovery_observations",
  "training_recovery_observation_events",
]);

function countRows(sqlite: Database.Database, table: string): number | null {
  const exists = sqlite
    .prepare("select 1 from sqlite_master where type = 'table' and name = ?")
    .get(table) !== undefined;
  if (!exists) {
    if (OPTIONAL_AT_CURRENT_SCHEMA.has(table)) return null;
    throw new Error(`no such table: ${table}`);
  }
  const row = sqlite.prepare(`select count(*) as count from ${table}`).get() as {
    count: unknown;
  };
  if (!isNonNegativeSafeInteger(row.count)) {
    throw new Error(`Invalid row count for ${table}`);
  }
  return row.count;
}

function removePendingDirectory(backupsRoot: string, pendingDirectory: string): void {
  const root = path.resolve(backupsRoot);
  const pending = path.resolve(pendingDirectory);
  const relative = path.relative(root, pending);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    !path.basename(pending).startsWith(".pending-")
  ) {
    throw new Error("拒绝清理无法确认的备份临时目录");
  }
  fs.rmSync(pending, { recursive: true, force: true });
}

function readManifest(manifestFile: string): BackupManifest | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    return parseManifest(value);
  } catch (error) {
    if (process.env.BACKUP_DEBUG) console.error("THROW:", String(error));
    return null;
  }
}

export function findLatestVerifiedBackup(backupsRoot: string): BackupManifest | null {
  return listVerifiedBackups(backupsRoot)[0] ?? null;
}

export function listVerifiedBackups(backupsRoot: string): BackupManifest[] {
  if (!fs.existsSync(backupsRoot)) return [];

  return fs
    .readdirSync(backupsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => {
      const directory = path.join(backupsRoot, entry.name);
      const manifest = readManifest(path.join(directory, "manifest.json"));
      if (
        !manifest ||
        manifest.backupId !== entry.name ||
        !fs.existsSync(path.join(directory, "life-pivot.sqlite"))
      ) {
        return null;
      }
      return manifest;
    })
    .filter((manifest): manifest is BackupManifest => manifest !== null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function createVerifiedBackup(
  dependencies: CreateVerifiedBackupDependencies,
): Promise<BackupManifest> {
  const writeBarrier = dependencies.writeBarrier ?? applicationWriteBarrier;
  const now = dependencies.now ?? (() => new Date());
  const createId = dependencies.createId ?? randomUUID;
  const calculateHash = dependencies.calculateHash ?? sha256File;
  const verifyHash =
    dependencies.verifyHash ??
    (async (file: string, expected: string) => (await sha256File(file)) === expected);

  return writeBarrier.runBackup(async () => {
    if (!fs.existsSync(dependencies.databaseFile)) {
      throw new Error("找不到当前数据库文件");
    }

    const backupId = createId();
    if (!SAFE_BACKUP_ID.test(backupId)) {
      throw new Error("备份标识格式不正确");
    }

    fs.mkdirSync(dependencies.backupsRoot, { recursive: true });
    const pendingDirectory = path.join(dependencies.backupsRoot, `.pending-${backupId}`);
    const finalDirectory = path.join(dependencies.backupsRoot, backupId);
    if (fs.existsSync(pendingDirectory) || fs.existsSync(finalDirectory)) {
      throw new Error("备份标识已存在");
    }
    fs.mkdirSync(pendingDirectory);

    try {
      const backupDatabaseFile = path.join(pendingDirectory, "life-pivot.sqlite");
      await dependencies.sqlite.backup(backupDatabaseFile);

      const copy = new Database(backupDatabaseFile, {
        readonly: true,
        fileMustExist: true,
      });
      let schemaVersion: string;
      let recordCounts: BackupManifest["recordCounts"];
      try {
        if (copy.pragma("integrity_check", { simple: true }) !== "ok") {
          throw new Error("备份数据库完整性检查失败");
        }
        const foreignKeyViolations = copy.pragma("foreign_key_check") as unknown[];
        if (foreignKeyViolations.length > 0) {
          throw new Error("Backup foreign key verification failed");
        }
        const schema = copy
          .prepare("select value from app_meta where key = 'schema_version'")
          .get() as { value: string } | undefined;
        if (!schema) throw new Error("备份缺少结构版本");
        if (schema.value !== CURRENT_DATABASE_SCHEMA_VERSION) {
          throw new Error("Unsupported database schema version");
        }
        schemaVersion = schema.value;
        recordCounts = {
          lifeAreas: countRows(copy, "life_areas"),
          metricRecords: countRows(copy, "metric_records"),
          dailyEntries: countRows(copy, "daily_entries"),
          captureItems: countRows(copy, "capture_items"),
          actionEvents: countRows(copy, "action_events"),
          goals: countRows(copy, "goals"),
          reviews: countRows(copy, "reviews"),
          knowledgeItems: countRows(copy, "knowledge_items"),
          knowledgeCandidates: countRows(copy, "knowledge_candidates"),
          knowledgeRevisions: countRows(copy, "knowledge_item_revisions"),
          knowledgeAssetEvents: countRows(copy, "knowledge_asset_events"),
          dailySummaries: countRows(copy, "daily_summaries"),
          dailySummaryRevisions: countRows(copy, "daily_summary_revisions"),
          reviewRevisions: countRows(copy, "review_revisions"),
          evidenceLinks: countRows(copy, "evidence_links"),
          knowledgeDomains: countRows(copy, "knowledge_domains"),
          todayReminders: countRows(copy, "today_reminders"),
          ...Object.fromEntries(
            skincareCountEntries.map(([field, table]) => [field, countRows(copy, table)]),
          ) as SkincareRecordCounts,
          ...Object.fromEntries(
            sleepCountEntries.map(([field, table]) => [field, countRows(copy, table)]),
          ) as SleepRecordCounts,
          ...Object.fromEntries(
            exerciseCountEntries.map(([field, table]) => [field, countRows(copy, table)]),
          ) as ExerciseRecordCounts,
          ...Object.fromEntries(
            personalAccumulationCountEntries.map(([field, table]) => [
              field,
              countRows(copy, table),
            ]),
          ) as PersonalAccumulationRecordCounts,
          ...Object.fromEntries(
            manualExerciseCountEntries.map(([field, table]) => [
              field,
              countRows(copy, table),
            ]),
          ) as ManualExerciseRecordCounts,
          ...Object.fromEntries(
            manualExerciseProgressCountEntries.map(([field, table]) => [
              field,
              countRows(copy, table),
            ]),
          ) as ManualExerciseProgressRecordCounts,
          ...Object.fromEntries(
            manualSkincareCountEntries.map(([field, table]) => [
              field,
              countRows(copy, table),
            ]),
          ) as ManualSkincareRecordCounts,
          ...Object.fromEntries(
            personalKnowledgeCountEntries.map(([field, table]) => [
              field,
              countRows(copy, table),
            ]),
          ) as PersonalKnowledgeRecordCounts,
          ...Object.fromEntries(
            weeklyReviewPinCountEntries.map(([field, table]) => [
              field,
              countRows(copy, table),
            ]),
          ) as WeeklyReviewPinRecordCounts,
          ...Object.fromEntries(
            readingCountEntries.map(([field, table]) => [
              field,
              countRows(copy, table),
            ]),
          ) as ReadingRecordCounts,
        };
      } finally {
        copy.close();
      }

      const databaseSha256 = await calculateHash(backupDatabaseFile);
      if (!(await verifyHash(backupDatabaseFile, databaseSha256))) {
        throw new Error("备份文件哈希验证失败");
      }

      const manifest: BackupManifest = {
        backupId,
        schemaVersion,
        applicationVersion: APPLICATION_VERSION,
        createdAt: now().toISOString(),
        databaseSha256,
        databaseBytes: fs.statSync(backupDatabaseFile).size,
        status: "verified",
        recordCounts,
      };
      fs.writeFileSync(
        path.join(pendingDirectory, "manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8",
      );
      fs.renameSync(pendingDirectory, finalDirectory);
      return manifest;
    } catch (error) {
      removePendingDirectory(dependencies.backupsRoot, pendingDirectory);
      throw error;
    }
  });
}
