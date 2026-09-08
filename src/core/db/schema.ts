import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  blob,
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

function timestamps() {
  return {
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
  };
}

export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const lifeAreas = sqliteTable("life_areas", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  revision: integer("revision").notNull().default(1),
  ...timestamps(),
});

export const goals = sqliteTable("goals", {
  id: text("id").primaryKey(),
  lifeAreaId: text("life_area_id")
    .notNull()
    .references(() => lifeAreas.id, { onDelete: "restrict" }),
  parentGoalId: text("parent_goal_id").references((): AnySQLiteColumn => goals.id, {
    onDelete: "restrict",
  }),
  goalType: text("goal_type", { enum: ["long-term", "stage"] }).notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  startDate: text("start_date"),
  targetDate: text("target_date"),
  progressPercent: integer("progress_percent").notNull().default(0),
  status: text("status", { enum: ["active", "completed", "paused", "archived"] }).notNull(),
  revision: integer("revision").notNull().default(1),
  ...timestamps(),
});

export const actions = sqliteTable(
  "actions",
  {
    id: text("id").primaryKey(),
    goalId: text("goal_id").references(() => goals.id, { onDelete: "restrict" }),
    parentActionId: text("parent_action_id").references(
      (): AnySQLiteColumn => actions.id,
      { onDelete: "restrict" },
    ),
    actionType: text("action_type", { enum: ["weekly", "today"] }).notNull(),
    businessDate: text("business_date"),
    title: text("title").notNull(),
    status: text("status", {
      enum: ["pending", "completed", "skipped", "archived"],
    }).notNull(),
    priority: text("priority", { enum: ["low", "normal", "high"] })
      .notNull()
      .default("normal"),
    estimatedMinutes: integer("estimated_minutes"),
    notes: text("notes").notNull().default(""),
    revision: integer("revision").notNull().default(1),
    ...timestamps(),
  },
  (table) => [
    index("actions_date_status_idx").on(table.businessDate, table.status),
    index("actions_parent_idx").on(table.parentActionId, table.actionType),
  ],
);

export const actionEvents = sqliteTable(
  "action_events",
  {
    id: text("id").primaryKey(),
    actionId: text("action_id")
      .notNull()
      .references(() => actions.id, { onDelete: "restrict" }),
    eventType: text("event_type", {
      enum: ["completed", "skipped", "reopened", "rescheduled"],
    }).notNull(),
    businessDate: text("business_date").notNull(),
    fromBusinessDate: text("from_business_date"),
    toBusinessDate: text("to_business_date"),
    occurredAt: text("occurred_at").notNull(),
    payloadJson: text("payload_json").notNull().default("{}"),
  },
  (table) => [
    index("action_events_action_time_idx").on(
      table.actionId,
      table.occurredAt,
      table.id,
    ),
    index("action_events_business_date_idx").on(
      table.businessDate,
      table.eventType,
      table.occurredAt,
    ),
  ],
);

export const reviews = sqliteTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    reviewType: text("review_type", {
      enum: ["daily", "weekly", "monthly"],
    }).notNull(),
    periodStart: text("period_start").notNull(),
    periodEndExclusive: text("period_end_exclusive").notNull(),
    content: text("content").notNull().default(""),
    revision: integer("revision").notNull().default(1),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("reviews_current_period_unique")
      .on(table.reviewType, table.periodStart, table.periodEndExclusive)
      .where(sql`${table.archivedAt} is null`),
  ],
);

export const reviewRevisions = sqliteTable(
  "review_revisions",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("review_revision_unique").on(table.reviewId, table.revision),
  ],
);

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id").notNull(),
  payloadJson: text("payload_json").notNull(),
  occurredAt: text("occurred_at").notNull(),
});

export const idempotencyKeys = sqliteTable("idempotency_keys", {
  key: text("key").primaryKey(),
  operation: text("operation").notNull(),
  requestHash: text("request_hash").notNull(),
  responseJson: text("response_json").notNull(),
  createdAt: text("created_at").notNull(),
});

export const captureItems = sqliteTable("capture_items", {
  id: text("id").primaryKey(),
  eventType: text("event_type", { enum: ["capture", "correction", "void"] }).notNull(),
  correctsItemId: text("corrects_item_id").references(
    (): AnySQLiteColumn => captureItems.id,
    { onDelete: "restrict" },
  ),
  businessDate: text("business_date").notNull(),
  occurredAt: text("occurred_at").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
});

export const sleepDailyRecords = sqliteTable(
  "sleep_daily_records",
  {
    id: text("id").primaryKey(),
    recordDate: text("record_date").notNull().unique(),
    asleepTime: text("asleep_time").notNull(),
    wakeTime: text("wake_time").notNull(),
    calculatedDurationMinutes: integer("calculated_duration_minutes").notNull(),
    confirmedDurationMinutes: integer("confirmed_duration_minutes"),
    manualQualityScore: integer("manual_quality_score"),
    awakeEpisodes: integer("awake_episodes"),
    awakeMinutes: integer("awake_minutes"),
    qualityText: text("quality_text").notNull(),
    deepSleepMinutes: integer("deep_sleep_minutes"),
    lightSleepMinutes: integer("light_sleep_minutes"),
    remSleepMinutes: integer("rem_sleep_minutes"),
    morningFeeling: integer("morning_feeling"),
    note: text("note").notNull().default(""),
    revision: integer("revision").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("sleep_daily_records_record_date", sql`date(${table.recordDate}) is ${table.recordDate}`),
    check(
      "sleep_daily_records_asleep_time",
      sql`${table.asleepTime} glob '[0-2][0-9]:[0-5][0-9]'
        and cast(substr(${table.asleepTime}, 1, 2) as integer) between 0 and 23
        and cast(substr(${table.asleepTime}, 4, 2) as integer) between 0 and 59`,
    ),
    check(
      "sleep_daily_records_wake_time",
      sql`${table.wakeTime} glob '[0-2][0-9]:[0-5][0-9]'
        and cast(substr(${table.wakeTime}, 1, 2) as integer) between 0 and 23
        and cast(substr(${table.wakeTime}, 4, 2) as integer) between 0 and 59`,
    ),
    check(
      "sleep_daily_records_calculated_duration",
      sql`${table.calculatedDurationMinutes} between 0 and 1439`,
    ),
    check(
      "sleep_daily_records_confirmed_duration",
      sql`${table.confirmedDurationMinutes} is null or ${table.confirmedDurationMinutes} between 0 and 1440`,
    ),
    check(
      "sleep_daily_records_quality_text",
      sql`length(trim(${table.qualityText})) between 1 and 500`,
    ),
    check(
      "sleep_daily_records_deep_sleep",
      sql`${table.deepSleepMinutes} is null or ${table.deepSleepMinutes} between 0 and 1440`,
    ),
    check(
      "sleep_daily_records_light_sleep",
      sql`${table.lightSleepMinutes} is null or ${table.lightSleepMinutes} between 0 and 1440`,
    ),
    check(
      "sleep_daily_records_rem_sleep",
      sql`${table.remSleepMinutes} is null or ${table.remSleepMinutes} between 0 and 1440`,
    ),
    check(
      "sleep_daily_records_morning_feeling",
      sql`${table.morningFeeling} is null or ${table.morningFeeling} between 1 and 5`,
    ),
    check("sleep_daily_records_note", sql`length(${table.note}) <= 4000`),
    check("sleep_daily_records_revision", sql`${table.revision} >= 1`),
    index("sleep_daily_records_date_idx").on(sql`${table.recordDate} desc`),
  ],
);

export const healthChecklistTemplates = sqliteTable(
  "health_checklist_templates",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    currentRevision: integer("current_revision").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "health_checklist_templates_name",
      sql`length(trim(${table.name})) between 1 and 120`,
    ),
    check(
      "health_checklist_templates_revision",
      sql`${table.currentRevision} >= 1`,
    ),
  ],
);

export const healthChecklistVersions = sqliteTable(
  "health_checklist_versions",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id")
      .notNull()
      .references(() => healthChecklistTemplates.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull(),
    effectiveFrom: text("effective_from").notNull(),
    changeNote: text("change_note").notNull().default(""),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check("health_checklist_versions_revision", sql`${table.revision} >= 1`),
    check(
      "health_checklist_versions_effective_from",
      sql`date(${table.effectiveFrom}) is ${table.effectiveFrom}`,
    ),
    check(
      "health_checklist_versions_change_note",
      sql`length(${table.changeNote}) <= 1000`,
    ),
    unique().on(table.templateId, table.revision),
    index("health_checklist_versions_effective_idx").on(
      table.templateId,
      sql`${table.effectiveFrom} desc`,
      sql`${table.revision} desc`,
    ),
  ],
);

export const healthChecklistTemplateItems = sqliteTable(
  "health_checklist_template_items",
  {
    id: text("id").primaryKey(),
    templateVersionId: text("template_version_id")
      .notNull()
      .references(() => healthChecklistVersions.id, { onDelete: "restrict" }),
    itemKey: text("item_key").notNull(),
    groupKey: text("group_key").notNull(),
    groupLabel: text("group_label").notNull(),
    name: text("name").notNull(),
    targetText: text("target_text").notNull().default(""),
    note: text("note").notNull().default(""),
    ordinal: integer("ordinal").notNull(),
  },
  (table) => [
    check(
      "health_checklist_template_items_item_key",
      sql`length(trim(${table.itemKey})) between 1 and 128`,
    ),
    check(
      "health_checklist_template_items_group_key",
      sql`length(trim(${table.groupKey})) between 1 and 64`,
    ),
    check(
      "health_checklist_template_items_group_label",
      sql`length(trim(${table.groupLabel})) between 1 and 80`,
    ),
    check(
      "health_checklist_template_items_name",
      sql`length(trim(${table.name})) between 1 and 160`,
    ),
    check(
      "health_checklist_template_items_target_text",
      sql`length(${table.targetText}) <= 500`,
    ),
    check(
      "health_checklist_template_items_note",
      sql`length(${table.note}) <= 1000`,
    ),
    check("health_checklist_template_items_ordinal", sql`${table.ordinal} >= 0`),
    unique().on(table.templateVersionId, table.itemKey),
    unique().on(table.templateVersionId, table.ordinal),
  ],
);

export const healthChecklistDays = sqliteTable(
  "health_checklist_days",
  {
    id: text("id").primaryKey(),
    businessDate: text("business_date").notNull().unique(),
    templateVersionId: text("template_version_id")
      .notNull()
      .references(() => healthChecklistVersions.id, { onDelete: "restrict" }),
    note: text("note").notNull().default(""),
    revision: integer("revision").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "health_checklist_days_business_date",
      sql`date(${table.businessDate}) is ${table.businessDate}`,
    ),
    check("health_checklist_days_note", sql`length(${table.note}) <= 4000`),
    check("health_checklist_days_revision", sql`${table.revision} >= 1`),
    index("health_checklist_days_date_idx").on(sql`${table.businessDate} desc`),
  ],
);

export const healthChecklistDayItems = sqliteTable(
  "health_checklist_day_items",
  {
    id: text("id").primaryKey(),
    dayId: text("day_id")
      .notNull()
      .references(() => healthChecklistDays.id, { onDelete: "restrict" }),
    itemKey: text("item_key").notNull(),
    groupKey: text("group_key").notNull(),
    groupLabel: text("group_label").notNull(),
    name: text("name").notNull(),
    targetText: text("target_text").notNull().default(""),
    note: text("note").notNull().default(""),
    ordinal: integer("ordinal").notNull(),
    completed: integer("completed", { mode: "boolean" }).notNull().default(false),
    completedAt: text("completed_at"),
  },
  (table) => [
    check(
      "health_checklist_day_items_item_key",
      sql`length(trim(${table.itemKey})) between 1 and 128`,
    ),
    check(
      "health_checklist_day_items_group_key",
      sql`length(trim(${table.groupKey})) between 1 and 64`,
    ),
    check(
      "health_checklist_day_items_group_label",
      sql`length(trim(${table.groupLabel})) between 1 and 80`,
    ),
    check(
      "health_checklist_day_items_name",
      sql`length(trim(${table.name})) between 1 and 160`,
    ),
    check(
      "health_checklist_day_items_target_text",
      sql`length(${table.targetText}) <= 500`,
    ),
    check("health_checklist_day_items_note", sql`length(${table.note}) <= 1000`),
    check("health_checklist_day_items_ordinal", sql`${table.ordinal} >= 0`),
    check("health_checklist_day_items_completed", sql`${table.completed} in (0, 1)`),
    check(
      "health_checklist_day_items_completed_at",
      sql`(${table.completed} = 0 and ${table.completedAt} is null)
        or (${table.completed} = 1 and ${table.completedAt} is not null)`,
    ),
    unique().on(table.dayId, table.itemKey),
    unique().on(table.dayId, table.ordinal),
    index("health_checklist_day_items_order_idx").on(table.dayId, table.ordinal),
  ],
);

export const personalDailyNotes = sqliteTable(
  "personal_daily_notes",
  {
    id: text("id").primaryKey(),
    businessDate: text("business_date").notNull().unique(),
    content: text("content").notNull().default(""),
    revision: integer("revision").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "personal_daily_notes_business_date",
      sql`date(${table.businessDate}) is ${table.businessDate}`,
    ),
    check("personal_daily_notes_content", sql`length(${table.content}) <= 20000`),
    check("personal_daily_notes_revision", sql`${table.revision} >= 1`),
    index("personal_daily_notes_date_idx").on(sql`${table.businessDate} desc`),
  ],
);

export const todayReminders = sqliteTable(
  "today_reminders",
  {
    id: text("id").primaryKey(),
    businessDate: text("business_date").notNull(),
    title: text("title").notNull(),
    scheduledTime: text("scheduled_time"),
    completed: integer("completed", { mode: "boolean" }).notNull().default(false),
    completedAt: text("completed_at"),
    revision: integer("revision").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("today_reminders_business_date", sql`date(${table.businessDate}) is ${table.businessDate}`),
    check("today_reminders_title", sql`length(trim(${table.title})) between 1 and 240`),
    check(
      "today_reminders_scheduled_time",
      sql`${table.scheduledTime} is null or (
        ${table.scheduledTime} glob '[0-2][0-9]:[0-5][0-9]'
        and cast(substr(${table.scheduledTime}, 1, 2) as integer) between 0 and 23
        and cast(substr(${table.scheduledTime}, 4, 2) as integer) between 0 and 59
      )`,
    ),
    check("today_reminders_completed", sql`${table.completed} in (0, 1)`),
    check(
      "today_reminders_completed_at",
      sql`(${table.completed} = 0 and ${table.completedAt} is null)
        or (${table.completed} = 1 and ${table.completedAt} is not null)`,
    ),
    check("today_reminders_revision", sql`${table.revision} >= 1`),
    index("today_reminders_day_status_time_idx").on(
      table.businessDate,
      table.completed,
      table.scheduledTime,
      table.createdAt,
      table.id,
    ),
    index("today_reminders_updated_idx").on(sql`${table.updatedAt} desc`, sql`${table.id} desc`),
  ],
);

export const manualExerciseTemplates = sqliteTable(
  "manual_exercise_templates",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    currentRevision: integer("current_revision").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("manual_exercise_templates_id", sql`length(trim(${table.id})) between 1 and 128`),
    check("manual_exercise_templates_name", sql`length(trim(${table.name})) between 1 and 160`),
    check("manual_exercise_templates_revision", sql`${table.currentRevision} >= 1`),
  ],
);

export const manualExerciseTemplateVersions = sqliteTable(
  "manual_exercise_template_versions",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id")
      .notNull()
      .references(() => manualExerciseTemplates.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull(),
    effectiveFrom: text("effective_from").notNull(),
    changeNote: text("change_note").notNull().default(""),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check("manual_exercise_template_versions_id", sql`length(trim(${table.id})) between 1 and 128`),
    check("manual_exercise_template_versions_revision", sql`${table.revision} >= 1`),
    check("manual_exercise_template_versions_date", sql`date(${table.effectiveFrom}) is ${table.effectiveFrom}`),
    check("manual_exercise_template_versions_note", sql`length(${table.changeNote}) <= 1000`),
    unique().on(table.templateId, table.revision),
    index("manual_exercise_template_versions_effective_idx").on(
      table.templateId,
      sql`${table.effectiveFrom} desc`,
      sql`${table.revision} desc`,
    ),
  ],
);

export const manualExerciseTemplateDays = sqliteTable(
  "manual_exercise_template_days",
  {
    id: text("id").primaryKey(),
    templateVersionId: text("template_version_id")
      .notNull()
      .references(() => manualExerciseTemplateVersions.id, { onDelete: "restrict" }),
    dayKey: text("day_key").notNull(),
    name: text("name").notNull(),
    bodyPart: text("body_part").notNull().default(""),
    isRest: integer("is_rest", { mode: "boolean" }).notNull().default(false),
    note: text("note").notNull().default(""),
    ordinal: integer("ordinal").notNull(),
  },
  (table) => [
    check("manual_exercise_template_days_id", sql`length(trim(${table.id})) between 1 and 128`),
    check("manual_exercise_template_days_key", sql`length(trim(${table.dayKey})) between 1 and 128`),
    check("manual_exercise_template_days_name", sql`length(trim(${table.name})) between 1 and 160`),
    check("manual_exercise_template_days_body_part", sql`length(${table.bodyPart}) <= 160`),
    check("manual_exercise_template_days_rest", sql`${table.isRest} in (0, 1)`),
    check("manual_exercise_template_days_note", sql`length(${table.note}) <= 4000`),
    check("manual_exercise_template_days_ordinal", sql`${table.ordinal} >= 0`),
    unique().on(table.templateVersionId, table.dayKey),
    unique().on(table.templateVersionId, table.ordinal),
    index("manual_exercise_template_days_order_idx").on(table.templateVersionId, table.ordinal),
  ],
);

export const manualExerciseTemplateActions = sqliteTable(
  "manual_exercise_template_actions",
  {
    id: text("id").primaryKey(),
    templateDayId: text("template_day_id")
      .notNull()
      .references(() => manualExerciseTemplateDays.id, { onDelete: "restrict" }),
    actionKey: text("action_key").notNull(),
    name: text("name").notNull(),
    plannedSets: integer("planned_sets").notNull(),
    plannedRepsText: text("planned_reps_text").notNull().default(""),
    plannedWeightText: text("planned_weight_text").notNull().default(""),
    targetText: text("target_text").notNull().default(""),
    note: text("note").notNull().default(""),
    ordinal: integer("ordinal").notNull(),
  },
  (table) => [
    check("manual_exercise_template_actions_id", sql`length(trim(${table.id})) between 1 and 128`),
    check("manual_exercise_template_actions_key", sql`length(trim(${table.actionKey})) between 1 and 128`),
    check("manual_exercise_template_actions_name", sql`length(trim(${table.name})) between 1 and 160`),
    check("manual_exercise_template_actions_sets", sql`${table.plannedSets} >= 0`),
    check("manual_exercise_template_actions_reps", sql`length(${table.plannedRepsText}) <= 500`),
    check("manual_exercise_template_actions_weight", sql`length(${table.plannedWeightText}) <= 500`),
    check("manual_exercise_template_actions_target", sql`length(${table.targetText}) <= 1000`),
    check("manual_exercise_template_actions_note", sql`length(${table.note}) <= 4000`),
    check("manual_exercise_template_actions_ordinal", sql`${table.ordinal} >= 0`),
    unique().on(table.templateDayId, table.actionKey),
    unique().on(table.templateDayId, table.ordinal),
    index("manual_exercise_template_actions_order_idx").on(table.templateDayId, table.ordinal),
  ],
);

export const manualExerciseCycleState = sqliteTable(
  "manual_exercise_cycle_state",
  {
    templateId: text("template_id")
      .primaryKey()
      .references(() => manualExerciseTemplates.id, { onDelete: "restrict" }),
    currentDayKey: text("current_day_key").notNull(),
    revision: integer("revision").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("manual_exercise_cycle_state_key", sql`length(trim(${table.currentDayKey})) between 1 and 128`),
    check("manual_exercise_cycle_state_revision", sql`${table.revision} >= 1`),
  ],
);

export const manualExerciseDays = sqliteTable(
  "manual_exercise_days",
  {
    id: text("id").primaryKey(),
    businessDate: text("business_date").notNull().unique(),
    templateVersionId: text("template_version_id")
      .notNull()
      .references(() => manualExerciseTemplateVersions.id, { onDelete: "restrict" }),
    dayKey: text("day_key").notNull(),
    dayName: text("day_name").notNull(),
    bodyPart: text("body_part").notNull().default(""),
    isRest: integer("is_rest", { mode: "boolean" }).notNull().default(false),
    status: text("status", { enum: ["not-started", "in-progress", "partial", "completed", "skipped"] }).notNull(),
    startedAt: text("started_at"),
    pausedAt: text("paused_at"),
    accumulatedPauseSeconds: integer("accumulated_pause_seconds").notNull().default(0),
    endedAt: text("ended_at"),
    calculatedDurationMinutes: integer("calculated_duration_minutes"),
    confirmedDurationMinutes: integer("confirmed_duration_minutes"),
    manualDurationMinutes: integer("manual_duration_minutes"),
    creatineTaken: integer("creatine_taken", { mode: "boolean" }),
    proteinPowderTaken: integer("protein_powder_taken", { mode: "boolean" }),
    supplementNote: text("supplement_note").notNull().default(""),
    note: text("note").notNull().default(""),
    completionText: text("completion_text").notNull().default(""),
    revision: integer("revision").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("manual_exercise_days_id", sql`length(trim(${table.id})) between 1 and 128`),
    check("manual_exercise_days_date", sql`date(${table.businessDate}) is ${table.businessDate}`),
    check("manual_exercise_days_key", sql`length(trim(${table.dayKey})) between 1 and 128`),
    check("manual_exercise_days_name", sql`length(trim(${table.dayName})) between 1 and 160`),
    check("manual_exercise_days_body_part", sql`length(${table.bodyPart}) <= 160`),
    check("manual_exercise_days_rest", sql`${table.isRest} in (0, 1)`),
    check("manual_exercise_days_status", sql`${table.status} in ('not-started', 'in-progress', 'partial', 'completed', 'skipped')`),
    check("manual_exercise_days_pause_seconds", sql`${table.accumulatedPauseSeconds} >= 0`),
    check("manual_exercise_days_calculated_minutes", sql`${table.calculatedDurationMinutes} is null or ${table.calculatedDurationMinutes} >= 0`),
    check("manual_exercise_days_confirmed_minutes", sql`${table.confirmedDurationMinutes} is null or ${table.confirmedDurationMinutes} >= 0`),
    check("manual_exercise_days_manual_minutes", sql`${table.manualDurationMinutes} is null or (typeof(${table.manualDurationMinutes}) = 'integer' and ${table.manualDurationMinutes} between 0 and 525600)`),
    check("manual_exercise_days_creatine", sql`${table.creatineTaken} is null or ${table.creatineTaken} in (0, 1)`),
    check("manual_exercise_days_protein", sql`${table.proteinPowderTaken} is null or ${table.proteinPowderTaken} in (0, 1)`),
    check("manual_exercise_days_supplement_note", sql`length(${table.supplementNote}) <= 4000`),
    check("manual_exercise_days_note", sql`length(${table.note}) <= 4000`),
    check("manual_exercise_days_completion", sql`length(${table.completionText}) <= 4000`),
    check("manual_exercise_days_revision", sql`${table.revision} >= 1`),
    check("manual_exercise_days_timer", sql`(
      (${table.startedAt} is not null or (${table.pausedAt} is null and ${table.endedAt} is null and ${table.accumulatedPauseSeconds} = 0 and ${table.calculatedDurationMinutes} is null and ${table.confirmedDurationMinutes} is null))
      and (${table.pausedAt} is null or (${table.startedAt} is not null and ${table.endedAt} is null))
      and (${table.endedAt} is null or (${table.startedAt} is not null and ${table.pausedAt} is null))
      and (${table.calculatedDurationMinutes} is null or ${table.endedAt} is not null)
      and (${table.confirmedDurationMinutes} is null or ${table.endedAt} is not null)
    )`),
    index("manual_exercise_days_business_date_idx").on(sql`${table.businessDate} desc`),
  ],
);

export const manualExerciseDayResolutions = sqliteTable(
  "manual_exercise_day_resolutions",
  {
    dayId: text("day_id").primaryKey().notNull()
      .references(() => manualExerciseDays.id, { onDelete: "restrict" }),
    outcome: text("outcome", { enum: ["rest", "skipped", "unrecorded"] }).notNull(),
    note: text("note").notNull().default(""),
    cycleAdvanced: integer("cycle_advanced", { mode: "boolean" }).notNull().default(false),
    resolvedAt: text("resolved_at").notNull(),
    reopenedAt: text("reopened_at"),
  },
  (table) => [
    check("manual_exercise_day_resolutions_outcome", sql`${table.outcome} in ('rest', 'skipped', 'unrecorded')`),
    check("manual_exercise_day_resolutions_note", sql`length(${table.note}) <= 4000`),
    check("manual_exercise_day_resolutions_advanced", sql`${table.cycleAdvanced} in (0, 1)`),
  ],
);

export const manualExerciseDayActions = sqliteTable(
  "manual_exercise_day_actions",
  {
    id: text("id").primaryKey(),
    dayId: text("day_id")
      .notNull()
      .references(() => manualExerciseDays.id, { onDelete: "restrict" }),
    actionKey: text("action_key").notNull(),
    name: text("name").notNull(),
    plannedSets: integer("planned_sets").notNull(),
    plannedRepsText: text("planned_reps_text").notNull().default(""),
    plannedWeightText: text("planned_weight_text").notNull().default(""),
    targetText: text("target_text").notNull().default(""),
    actualSets: integer("actual_sets").notNull().default(0),
    actualRepsText: text("actual_reps_text").notNull().default(""),
    actualWeightText: text("actual_weight_text").notNull().default(""),
    actualText: text("actual_text").notNull().default(""),
    completion: text("completion").notNull().default(""),
    note: text("note").notNull().default(""),
    ordinal: integer("ordinal").notNull(),
  },
  (table) => [
    check("manual_exercise_day_actions_id", sql`length(trim(${table.id})) between 1 and 128`),
    check("manual_exercise_day_actions_key", sql`length(trim(${table.actionKey})) between 1 and 128`),
    check("manual_exercise_day_actions_name", sql`length(trim(${table.name})) between 1 and 160`),
    check("manual_exercise_day_actions_planned_sets", sql`${table.plannedSets} >= 0`),
    check("manual_exercise_day_actions_actual_sets", sql`${table.actualSets} >= 0`),
    check("manual_exercise_day_actions_planned_reps", sql`length(${table.plannedRepsText}) <= 500`),
    check("manual_exercise_day_actions_planned_weight", sql`length(${table.plannedWeightText}) <= 500`),
    check("manual_exercise_day_actions_target", sql`length(${table.targetText}) <= 1000`),
    check("manual_exercise_day_actions_actual_reps", sql`length(${table.actualRepsText}) <= 1000`),
    check("manual_exercise_day_actions_actual_weight", sql`length(${table.actualWeightText}) <= 1000`),
    check("manual_exercise_day_actions_actual", sql`length(${table.actualText}) <= 4000`),
    check("manual_exercise_day_actions_completion", sql`length(${table.completion}) <= 1000`),
    check("manual_exercise_day_actions_note", sql`length(${table.note}) <= 4000`),
    check("manual_exercise_day_actions_ordinal", sql`${table.ordinal} >= 0`),
    unique().on(table.dayId, table.actionKey),
    unique().on(table.dayId, table.ordinal),
    index("manual_exercise_day_actions_order_idx").on(table.dayId, table.ordinal),
  ],
);

export const manualExerciseCycleEvents = sqliteTable(
  "manual_exercise_cycle_events",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id")
      .notNull()
      .references(() => manualExerciseTemplates.id, { onDelete: "restrict" }),
    businessDate: text("business_date").notNull(),
    eventType: text("event_type", { enum: ["started", "advanced", "completed", "reset", "corrected"] }).notNull(),
    fromDayKey: text("from_day_key"),
    toDayKey: text("to_day_key"),
    dayId: text("day_id").references(() => manualExerciseDays.id, { onDelete: "restrict" }),
    note: text("note").notNull().default(""),
    cycleRevisionBefore: integer("cycle_revision_before").notNull(),
    cycleRevisionAfter: integer("cycle_revision_after").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check("manual_exercise_cycle_events_id", sql`length(trim(${table.id})) between 1 and 128`),
    check("manual_exercise_cycle_events_date", sql`date(${table.businessDate}) is ${table.businessDate}`),
    check("manual_exercise_cycle_events_type", sql`${table.eventType} in ('started', 'advanced', 'completed', 'reset', 'corrected')`),
    check("manual_exercise_cycle_events_from", sql`${table.fromDayKey} is null or length(trim(${table.fromDayKey})) between 1 and 128`),
    check("manual_exercise_cycle_events_to", sql`${table.toDayKey} is null or length(trim(${table.toDayKey})) between 1 and 128`),
    check("manual_exercise_cycle_events_note", sql`length(${table.note}) <= 4000`),
    check("manual_exercise_cycle_events_before", sql`${table.cycleRevisionBefore} >= 0`),
    check("manual_exercise_cycle_events_after", sql`${table.cycleRevisionAfter} >= ${table.cycleRevisionBefore}`),
    index("manual_exercise_cycle_events_order_idx").on(
      table.templateId,
      sql`${table.businessDate} desc`,
      sql`${table.createdAt} desc`,
      sql`${table.id} desc`,
    ),
  ],
);

export const manualExerciseProgressDecisions = sqliteTable(
  "manual_exercise_progress_decisions",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id")
      .notNull()
      .references(() => manualExerciseTemplates.id, { onDelete: "restrict" }),
    fromVersionId: text("from_version_id")
      .notNull()
      .references(() => manualExerciseTemplateVersions.id, { onDelete: "restrict" }),
    toVersionId: text("to_version_id")
      .notNull()
      .references(() => manualExerciseTemplateVersions.id, { onDelete: "restrict" }),
    decision: text("decision", { enum: ["tracked", "excluded"] }).notNull(),
    revision: integer("revision").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("manual_exercise_progress_decisions_id", sql`length(trim(${table.id})) between 1 and 128`),
    check("manual_exercise_progress_decisions_versions", sql`${table.fromVersionId} <> ${table.toVersionId}`),
    check("manual_exercise_progress_decisions_decision", sql`${table.decision} in ('tracked', 'excluded')`),
    check("manual_exercise_progress_decisions_revision", sql`${table.revision} >= 1`),
    uniqueIndex("manual_exercise_progress_decisions_transition_unique").on(
      table.templateId,
      table.fromVersionId,
      table.toVersionId,
    ),
    index("manual_exercise_progress_decisions_template_idx").on(
      table.templateId,
      sql`${table.updatedAt} desc`,
    ),
  ],
);

export const manualSkincareProducts = sqliteTable(
  "manual_skincare_products",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    brand: text("brand").notNull().default(""),
    currentPurpose: text("current_purpose").notNull().default(""),
    status: text("status", { enum: ["active", "paused", "finished"] }).notNull(),
    addedOn: text("added_on").notNull(),
    note: text("note").notNull().default(""),
    photoBlob: blob("photo_blob", { mode: "buffer" }),
    photoMime: text("photo_mime", { enum: ["image/jpeg", "image/png", "image/webp"] }),
    revision: integer("revision").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("manual_skincare_products_id", sql`length(trim(${table.id})) between 1 and 128`),
    check("manual_skincare_products_name", sql`length(trim(${table.name})) between 1 and 160`),
    check("manual_skincare_products_brand", sql`length(${table.brand}) <= 160`),
    check("manual_skincare_products_purpose", sql`length(${table.currentPurpose}) <= 500`),
    check("manual_skincare_products_status", sql`${table.status} in ('active', 'paused', 'finished')`),
    check("manual_skincare_products_added_on", sql`date(${table.addedOn}) is ${table.addedOn}`),
    check("manual_skincare_products_note", sql`length(${table.note}) <= 4000`),
    check(
      "manual_skincare_products_photo_blob_size",
      sql`${table.photoBlob} is null or length(${table.photoBlob}) between 1 and 2097152`,
    ),
    check(
      "manual_skincare_products_photo_pair",
      sql`(${table.photoBlob} is null and ${table.photoMime} is null) or (
        ${table.photoBlob} is not null and
        ${table.photoMime} in ('image/jpeg', 'image/png', 'image/webp')
      )`,
    ),
    check("manual_skincare_products_revision", sql`${table.revision} >= 1`),
    index("manual_skincare_products_status_name_idx").on(
      table.status,
      table.name,
      table.id,
    ),
  ],
);

export const manualSkincareRoutineVersions = sqliteTable(
  "manual_skincare_routine_versions",
  {
    id: text("id").primaryKey(),
    revision: integer("revision").notNull().unique(),
    changeNote: text("change_note").notNull().default(""),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check("manual_skincare_routine_versions_id", sql`length(trim(${table.id})) between 1 and 128`),
    check("manual_skincare_routine_versions_revision", sql`${table.revision} >= 1`),
    check("manual_skincare_routine_versions_note", sql`length(${table.changeNote}) <= 1000`),
  ],
);

export const manualSkincareRoutineItems = sqliteTable(
  "manual_skincare_routine_items",
  {
    id: text("id").primaryKey(),
    routineVersionId: text("routine_version_id")
      .notNull()
      .references(() => manualSkincareRoutineVersions.id, { onDelete: "restrict" }),
    itemKey: text("item_key").notNull(),
    slot: text("slot", { enum: ["morning", "evening"] }).notNull(),
    productId: text("product_id")
      .notNull()
      .references(() => manualSkincareProducts.id, { onDelete: "restrict" }),
    productNameSnapshot: text("product_name_snapshot").notNull(),
    brandSnapshot: text("brand_snapshot").notNull().default(""),
    purposeSnapshot: text("purpose_snapshot").notNull().default(""),
    ordinal: integer("ordinal").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check("manual_skincare_routine_items_id", sql`length(trim(${table.id})) between 1 and 128`),
    check("manual_skincare_routine_items_key", sql`length(trim(${table.itemKey})) between 1 and 128`),
    check("manual_skincare_routine_items_slot", sql`${table.slot} in ('morning', 'evening')`),
    check("manual_skincare_routine_items_name", sql`length(trim(${table.productNameSnapshot})) between 1 and 160`),
    check("manual_skincare_routine_items_brand", sql`length(${table.brandSnapshot}) <= 160`),
    check("manual_skincare_routine_items_purpose", sql`length(${table.purposeSnapshot}) <= 500`),
    check("manual_skincare_routine_items_ordinal", sql`${table.ordinal} >= 0`),
    unique().on(table.routineVersionId, table.itemKey),
    unique().on(table.routineVersionId, table.slot, table.ordinal),
    unique().on(table.routineVersionId, table.slot, table.productId),
    index("manual_skincare_routine_items_order_idx").on(
      table.routineVersionId,
      table.slot,
      table.ordinal,
    ),
  ],
);

export const manualSkincareRecoveryPlans = sqliteTable(
  "manual_skincare_recovery_plans",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    note: text("note").notNull().default(""),
    revision: integer("revision").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("manual_skincare_recovery_plans_id", sql`length(trim(${table.id})) between 1 and 128`),
    check("manual_skincare_recovery_plans_name", sql`length(trim(${table.name})) between 1 and 160`),
    check("manual_skincare_recovery_plans_note", sql`length(${table.note}) <= 4000`),
    check("manual_skincare_recovery_plans_revision", sql`${table.revision} >= 1`),
  ],
);

export const manualSkincareRecoveryCycles = sqliteTable(
  "manual_skincare_recovery_cycles",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => manualSkincareRecoveryPlans.id, { onDelete: "restrict" }),
    ordinal: integer("ordinal").notNull(),
    name: text("name").notNull(),
    goal: text("goal").notNull(),
    expectedEndOn: text("expected_end_on"),
    routineVersionId: text("routine_version_id")
      .notNull()
      .references(() => manualSkincareRoutineVersions.id, { onDelete: "restrict" }),
    status: text("status", { enum: ["draft", "active", "completed"] }).notNull(),
    actualStartedOn: text("actual_started_on"),
    actualCompletedOn: text("actual_completed_on"),
    note: text("note").notNull().default(""),
    revision: integer("revision").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("manual_skincare_recovery_cycles_id", sql`length(trim(${table.id})) between 1 and 128`),
    check("manual_skincare_recovery_cycles_ordinal", sql`${table.ordinal} >= 0`),
    check("manual_skincare_recovery_cycles_name", sql`length(trim(${table.name})) between 1 and 160`),
    check("manual_skincare_recovery_cycles_goal", sql`length(trim(${table.goal})) between 1 and 1000`),
    check("manual_skincare_recovery_cycles_expected_end", sql`${table.expectedEndOn} is null or date(${table.expectedEndOn}) is ${table.expectedEndOn}`),
    check("manual_skincare_recovery_cycles_status", sql`${table.status} in ('draft', 'active', 'completed')`),
    check("manual_skincare_recovery_cycles_started", sql`${table.actualStartedOn} is null or date(${table.actualStartedOn}) is ${table.actualStartedOn}`),
    check("manual_skincare_recovery_cycles_completed", sql`${table.actualCompletedOn} is null or date(${table.actualCompletedOn}) is ${table.actualCompletedOn}`),
    check("manual_skincare_recovery_cycles_note", sql`length(${table.note}) <= 4000`),
    check("manual_skincare_recovery_cycles_revision", sql`${table.revision} >= 1`),
    check("manual_skincare_recovery_cycles_dates", sql`(
      (${table.status} = 'draft' and ${table.actualStartedOn} is null and ${table.actualCompletedOn} is null)
      or (${table.status} = 'active' and ${table.actualStartedOn} is not null and ${table.actualCompletedOn} is null)
      or (${table.status} = 'completed' and ${table.actualStartedOn} is not null
        and ${table.actualCompletedOn} is not null
        and ${table.actualCompletedOn} >= ${table.actualStartedOn})
    )`),
    unique().on(table.planId, table.ordinal),
    index("manual_skincare_recovery_cycles_order_idx").on(table.planId, table.ordinal),
    uniqueIndex("manual_skincare_recovery_cycles_one_active")
      .on(sql`1`)
      .where(sql`${table.status} = 'active'`),
  ],
);

export const manualSkincareRoutineActivations = sqliteTable(
  "manual_skincare_routine_activations",
  {
    id: text("id").primaryKey(),
    routineVersionId: text("routine_version_id")
      .notNull()
      .references(() => manualSkincareRoutineVersions.id, { onDelete: "restrict" }),
    recoveryCycleId: text("recovery_cycle_id").references(
      () => manualSkincareRecoveryCycles.id,
      { onDelete: "restrict" },
    ),
    activationSequence: integer("activation_sequence").notNull().unique(),
    effectiveFrom: text("effective_from").notNull(),
    reason: text("reason", {
      enum: ["manual-routine-update", "recovery-cycle-start"],
    }).notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check("manual_skincare_routine_activations_id", sql`length(trim(${table.id})) between 1 and 128`),
    check("manual_skincare_routine_activations_sequence", sql`${table.activationSequence} >= 1`),
    check("manual_skincare_routine_activations_date", sql`date(${table.effectiveFrom}) is ${table.effectiveFrom}`),
    check("manual_skincare_routine_activations_reason", sql`${table.reason} in ('manual-routine-update', 'recovery-cycle-start')`),
    check("manual_skincare_routine_activations_cycle", sql`(
      (${table.reason} = 'manual-routine-update' and ${table.recoveryCycleId} is null)
      or (${table.reason} = 'recovery-cycle-start' and ${table.recoveryCycleId} is not null)
    )`),
    uniqueIndex("manual_skincare_routine_activations_cycle_unique")
      .on(table.recoveryCycleId)
      .where(sql`${table.recoveryCycleId} is not null`),
    index("manual_skincare_routine_activations_effective_idx").on(
      sql`${table.effectiveFrom} desc`,
      sql`${table.activationSequence} desc`,
    ),
  ],
);

export const manualSkincareDays = sqliteTable(
  "manual_skincare_days",
  {
    id: text("id").primaryKey(),
    businessDate: text("business_date").notNull().unique(),
    routineActivationId: text("routine_activation_id").references(
      () => manualSkincareRoutineActivations.id,
      { onDelete: "restrict" },
    ),
    routineVersionId: text("routine_version_id").references(
      () => manualSkincareRoutineVersions.id,
      { onDelete: "restrict" },
    ),
    recoveryCycleId: text("recovery_cycle_id").references(
      () => manualSkincareRecoveryCycles.id,
      { onDelete: "restrict" },
    ),
    recoveryCycleNameSnapshot: text("recovery_cycle_name_snapshot").notNull().default(""),
    morningNote: text("morning_note").notNull().default(""),
    eveningNote: text("evening_note").notNull().default(""),
    overallNote: text("overall_note").notNull().default(""),
    revision: integer("revision").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("manual_skincare_days_id", sql`length(trim(${table.id})) between 1 and 128`),
    check("manual_skincare_days_date", sql`date(${table.businessDate}) is ${table.businessDate}`),
    check("manual_skincare_days_cycle_name", sql`length(${table.recoveryCycleNameSnapshot}) <= 160`),
    check("manual_skincare_days_morning_note", sql`length(${table.morningNote}) <= 4000`),
    check("manual_skincare_days_evening_note", sql`length(${table.eveningNote}) <= 4000`),
    check("manual_skincare_days_overall_note", sql`length(${table.overallNote}) <= 4000`),
    check("manual_skincare_days_revision", sql`${table.revision} >= 1`),
    check("manual_skincare_days_authority", sql`(
      (${table.routineActivationId} is null and ${table.routineVersionId} is null
        and ${table.recoveryCycleId} is null and ${table.recoveryCycleNameSnapshot} = '')
      or (${table.routineActivationId} is not null and ${table.routineVersionId} is not null
        and ((${table.recoveryCycleId} is null and ${table.recoveryCycleNameSnapshot} = '')
          or (${table.recoveryCycleId} is not null
            and length(trim(${table.recoveryCycleNameSnapshot})) between 1 and 160)))
    )`),
    index("manual_skincare_days_business_date_idx").on(sql`${table.businessDate} desc`),
  ],
);

export const manualSkincareDayItems = sqliteTable(
  "manual_skincare_day_items",
  {
    id: text("id").primaryKey(),
    dayId: text("day_id")
      .notNull()
      .references(() => manualSkincareDays.id, { onDelete: "restrict" }),
    itemKey: text("item_key").notNull(),
    slot: text("slot", { enum: ["morning", "evening"] }).notNull(),
    productId: text("product_id")
      .notNull()
      .references(() => manualSkincareProducts.id, { onDelete: "restrict" }),
    productNameSnapshot: text("product_name_snapshot").notNull(),
    brandSnapshot: text("brand_snapshot").notNull().default(""),
    purposeSnapshot: text("purpose_snapshot").notNull().default(""),
    ordinal: integer("ordinal").notNull(),
    used: integer("used", { mode: "boolean" }).notNull().default(false),
    usedAt: text("used_at"),
  },
  (table) => [
    check("manual_skincare_day_items_id", sql`length(trim(${table.id})) between 1 and 128`),
    check("manual_skincare_day_items_key", sql`length(trim(${table.itemKey})) between 1 and 128`),
    check("manual_skincare_day_items_slot", sql`${table.slot} in ('morning', 'evening')`),
    check("manual_skincare_day_items_name", sql`length(trim(${table.productNameSnapshot})) between 1 and 160`),
    check("manual_skincare_day_items_brand", sql`length(${table.brandSnapshot}) <= 160`),
    check("manual_skincare_day_items_purpose", sql`length(${table.purposeSnapshot}) <= 500`),
    check("manual_skincare_day_items_ordinal", sql`${table.ordinal} >= 0`),
    check("manual_skincare_day_items_used", sql`${table.used} in (0, 1)`),
    check("manual_skincare_day_items_used_at", sql`(
      (${table.used} = 0 and ${table.usedAt} is null)
      or (${table.used} = 1 and ${table.usedAt} is not null)
    )`),
    unique().on(table.dayId, table.itemKey),
    unique().on(table.dayId, table.slot, table.ordinal),
    unique().on(table.dayId, table.slot, table.productId),
    index("manual_skincare_day_items_order_idx").on(table.dayId, table.slot, table.ordinal),
  ],
);

export const knowledgeModules = sqliteTable(
  "knowledge_modules",
  {
    moduleId: text("module_id").primaryKey(),
    parentModuleId: text("parent_module_id").references(
      (): AnySQLiteColumn => knowledgeModules.moduleId,
      { onDelete: "restrict" },
    ),
    name: text("name").notNull(),
    goal: text("goal").notNull().default(""),
    currentFocus: text("current_focus").notNull().default(""),
    description: text("description").notNull().default(""),
    status: text("status", {
      enum: ["learning", "paused", "long-term", "archived"],
    }).notNull(),
    ordinal: integer("ordinal").notNull(),
    revision: integer("revision").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "knowledge_modules_id",
      sql`length(trim(${table.moduleId})) between 1 and 128`,
    ),
    check(
      "knowledge_modules_name",
      sql`length(trim(${table.name})) between 1 and 160`,
    ),
    check("knowledge_modules_goal", sql`length(${table.goal}) <= 1000`),
    check(
      "knowledge_modules_current_focus",
      sql`length(${table.currentFocus}) <= 1000`,
    ),
    check(
      "knowledge_modules_description",
      sql`length(${table.description}) <= 4000`,
    ),
    check(
      "knowledge_modules_status",
      sql`${table.status} in ('learning', 'paused', 'long-term', 'archived')`,
    ),
    check("knowledge_modules_ordinal", sql`${table.ordinal} >= 0`),
    check("knowledge_modules_revision", sql`${table.revision} >= 1`),
    index("knowledge_modules_parent_order_idx").on(
      table.parentModuleId,
      table.ordinal,
      table.moduleId,
    ),
    index("knowledge_modules_status_order_idx").on(
      table.status,
      table.ordinal,
      table.moduleId,
    ),
    uniqueIndex("knowledge_modules_active_sibling_name_unique")
      .on(
        sql`coalesce(${table.parentModuleId}, '')`,
        sql`lower(trim(${table.name}))`,
      )
      .where(sql`${table.status} <> 'archived'`),
  ],
);

export const dailyLearningNotes = sqliteTable(
  "daily_learning_notes",
  {
    noteId: text("note_id").primaryKey(),
    businessDate: text("business_date").notNull(),
    title: text("title").notNull(),
    moduleId: text("module_id")
      .notNull()
      .references(() => knowledgeModules.moduleId, { onDelete: "restrict" }),
    content: text("content").notNull(),
    source: text("source").notNull().default(""),
    personalUnderstanding: text("personal_understanding").notNull().default(""),
    openQuestions: text("open_questions").notNull().default(""),
    application: text("application").notNull().default(""),
    status: text("status", { enum: ["active", "archived"] }).notNull(),
    revision: integer("revision").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "daily_learning_notes_id",
      sql`length(trim(${table.noteId})) between 1 and 128`,
    ),
    check(
      "daily_learning_notes_date",
      sql`date(${table.businessDate}) is ${table.businessDate}`,
    ),
    check(
      "daily_learning_notes_title",
      sql`length(trim(${table.title})) between 1 and 160`,
    ),
    check(
      "daily_learning_notes_content",
      sql`length(trim(${table.content})) between 1 and 20000`,
    ),
    check("daily_learning_notes_source", sql`length(${table.source}) <= 4000`),
    check(
      "daily_learning_notes_understanding",
      sql`length(${table.personalUnderstanding}) <= 4000`,
    ),
    check(
      "daily_learning_notes_questions",
      sql`length(${table.openQuestions}) <= 4000`,
    ),
    check(
      "daily_learning_notes_application",
      sql`length(${table.application}) <= 4000`,
    ),
    check(
      "daily_learning_notes_status",
      sql`${table.status} in ('active', 'archived')`,
    ),
    check("daily_learning_notes_revision", sql`${table.revision} >= 1`),
    index("daily_learning_notes_date_idx").on(
      sql`${table.businessDate} desc`,
      sql`${table.updatedAt} desc`,
      table.noteId,
    ),
    index("daily_learning_notes_module_date_idx").on(
      table.moduleId,
      sql`${table.businessDate} desc`,
      table.noteId,
    ),
  ],
);

export const userPins = sqliteTable(
  "user_pins",
  {
    targetType: text("target_type", {
      enum: [
        "knowledge-module",
        "knowledge-item",
        "exercise-template",
        "skincare-plan",
        "health-template",
      ],
    }).notNull(),
    targetId: text("target_id").notNull(),
    pinnedAt: text("pinned_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.targetType, table.targetId] }),
    check(
      "user_pins_target_type_valid",
      sql`${table.targetType} in ('knowledge-module', 'knowledge-item', 'exercise-template', 'skincare-plan', 'health-template')`,
    ),
    check(
      "user_pins_target_id_length",
      sql`length(trim(${table.targetId})) between 1 and 128`,
    ),
    index("user_pins_order_idx").on(
      sql`${table.pinnedAt} desc`,
      table.targetType,
      table.targetId,
    ),
  ],
);


export const readingBooks = sqliteTable(
  "reading_books",
  {
    bookId: text("book_id").primaryKey(),
    title: text("title").notNull(),
    author: text("author").notNull().default(""),
    status: text("status", { enum: ["wishlist", "reading", "finished"] }).notNull(),
    totalPages: integer("total_pages"),
    currentPage: integer("current_page").notNull().default(0),
    rating: integer("rating"),
    pdfStorageKey: text("pdf_storage_key"),
    pdfOriginalName: text("pdf_original_name").notNull().default(""),
    pdfSizeBytes: integer("pdf_size_bytes"),
    pdfAddedAt: text("pdf_added_at"),
    revision: integer("revision").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
  },
  (table) => [
    check("reading_books_book_id", sql`length(trim(${table.bookId})) between 1 and 128`),
    check("reading_books_title", sql`length(trim(${table.title})) between 1 and 200`),
    check("reading_books_author", sql`length(${table.author}) <= 120`),
    check("reading_books_status_valid", sql`${table.status} in ('wishlist', 'reading', 'finished')`),
    check("reading_books_total_pages", sql`${table.totalPages} is null or ${table.totalPages} between 1 and 100000`),
    check("reading_books_current_page", sql`${table.currentPage} >= 0`),
    check("reading_books_rating", sql`${table.rating} is null or ${table.rating} between 1 and 5`),
    check("reading_books_pdf_storage_key", sql`${table.pdfStorageKey} is null or length(${table.pdfStorageKey}) between 1 and 512`),
    check("reading_books_pdf_original_name", sql`length(${table.pdfOriginalName}) <= 255`),
    check("reading_books_pdf_size_bytes", sql`${table.pdfSizeBytes} is null or ${table.pdfSizeBytes} between 1 and 1073741824`),
    check("reading_books_revision", sql`${table.revision} >= 1`),
    index("reading_books_status_updated_idx").on(
      table.status,
      sql`${table.updatedAt} desc`,
      table.bookId,
    ).where(sql`${table.archivedAt} is null`),
    index("reading_books_created_idx").on(sql`${table.createdAt} desc`, table.bookId),
  ],
);

export const readingNotes = sqliteTable(
  "reading_notes",
  {
    noteId: text("note_id").primaryKey(),
    bookId: text("book_id")
      .notNull()
      .references(() => readingBooks.bookId, { onDelete: "restrict" }),
    title: text("title").notNull().default(""),
    content: text("content").notNull(),
    revision: integer("revision").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
  },
  (table) => [
    check("reading_notes_note_id", sql`length(trim(${table.noteId})) between 1 and 128`),
    check("reading_notes_title", sql`length(${table.title}) <= 160`),
    check("reading_notes_content", sql`length(trim(${table.content})) between 1 and 20000`),
    check("reading_notes_revision", sql`${table.revision} >= 1`),
    index("reading_notes_book_updated_idx").on(
      table.bookId,
      sql`${table.updatedAt} desc`,
      table.noteId,
    ).where(sql`${table.archivedAt} is null`),
    index("reading_notes_created_idx").on(sql`${table.createdAt} desc`, table.noteId),
  ],
);

export const readingSessions = sqliteTable(
  "reading_sessions",
  {
    sessionId: text("session_id").primaryKey(),
    bookId: text("book_id")
      .notNull()
      .references(() => readingBooks.bookId, { onDelete: "restrict" }),
    businessDate: text("business_date").notNull(),
    startPage: integer("start_page").notNull(),
    endPage: integer("end_page").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    note: text("note").notNull().default(""),
    revision: integer("revision").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
  },
  (table) => [
    check(
      "reading_sessions_session_id",
      sql`length(trim(${table.sessionId})) between 1 and 128`,
    ),
    check(
      "reading_sessions_business_date",
      sql`length(${table.businessDate}) = 10 and strftime('%Y-%m-%d', ${table.businessDate}) is ${table.businessDate}`,
    ),
    check(
      "reading_sessions_start_page",
      sql`${table.startPage} between 0 and 100000`,
    ),
    check(
      "reading_sessions_end_page",
      sql`${table.endPage} between ${table.startPage} and 100000`,
    ),
    check(
      "reading_sessions_duration",
      sql`${table.durationMinutes} between 1 and 1440`,
    ),
    check("reading_sessions_note", sql`length(${table.note}) <= 5000`),
    check("reading_sessions_revision", sql`${table.revision} >= 1`),
    index("reading_sessions_date_created_idx").on(
      sql`${table.businessDate} desc`,
      sql`${table.createdAt} desc`,
      table.sessionId,
    ).where(sql`${table.archivedAt} is null`),
    index("reading_sessions_book_date_idx").on(
      table.bookId,
      sql`${table.businessDate} desc`,
      sql`${table.createdAt} desc`,
      table.sessionId,
    ).where(sql`${table.archivedAt} is null`),
  ],
);

export const wisdomReminders = sqliteTable(
  "wisdom_reminders",
  {
    id: text("id").primaryKey(),
    content: text("content").notNull(),
    context: text("context").notNull().default(""),
    archivedAt: text("archived_at"),
    revision: integer("revision").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("wisdom_reminders_content", sql`length(trim(${table.content})) between 1 and 500`),
    check("wisdom_reminders_context", sql`length(${table.context}) <= 2000`),
    check("wisdom_reminders_revision", sql`${table.revision} >= 1`),
    index("wisdom_reminders_created_idx").on(sql`${table.createdAt} desc`),
  ],
);

export const schemaVersionQuery = sql<{ value: string }>`
  select value from app_meta where key = 'schema_version'
`;
