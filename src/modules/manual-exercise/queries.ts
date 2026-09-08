import type Database from "better-sqlite3";

import { isBusinessDate, toShanghaiBusinessDate } from "@/core/time/business-date";

import { deriveManualExerciseElapsed } from "../../app/exercise/exercise-timer";
import type {
  ManualExerciseActionSnapshot,
  ManualExerciseDaySnapshot,
  ManualExerciseDayResolution,
  ManualExerciseSnapshot,
  ManualExerciseTemplateSnapshot,
} from "./service";
import { cycleDayKeyForDate } from "./cycle-date";

const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 100;

interface TemplateVersionRow {
  template_id: string;
  template_name: string;
  revision: number;
  version_id: string;
  effective_from: string;
  change_note: string;
}

interface TemplateDayRow {
  id: string;
  day_key: string;
  name: string;
  body_part: string;
  is_rest: number;
  note: string;
  ordinal: number;
}

interface TemplateActionRow {
  action_key: string;
  name: string;
  planned_sets: number;
  planned_reps_text: string;
  planned_weight_text: string;
  target_text: string;
  note: string;
  ordinal: number;
}

interface DayRow {
  id: string;
  business_date: string;
  template_version_id: string;
  day_key: string;
  day_name: string;
  body_part: string;
  is_rest: number;
  status: ManualExerciseDaySnapshot["status"];
  started_at: string | null;
  paused_at: string | null;
  accumulated_pause_seconds: number;
  ended_at: string | null;
  calculated_duration_minutes: number | null;
  confirmed_duration_minutes: number | null;
  creatine_taken: number | null;
  protein_powder_taken: number | null;
  supplement_note: string;
  note: string;
  completion_text: string;
  revision: number;
}

interface DayActionRow {
  action_key: string;
  name: string;
  planned_sets: number;
  planned_reps_text: string;
  planned_weight_text: string;
  target_text: string;
  planned_note: string;
  actual_sets: number;
  actual_reps_text: string;
  actual_weight_text: string;
  actual_text: string;
  completion: string;
  actual_note: string;
  ordinal: number;
}

interface PreviousActualRow {
  business_date: string;
  actual_sets: number;
  actual_reps_text: string;
  actual_weight_text: string;
  actual_text: string;
}

function nullableText(value: string): string | null {
  return value === "" ? null : value;
}

function nullableBoolean(value: number | null): boolean | null {
  return value === null ? null : value === 1;
}

function readEffectiveTemplateVersion(
  sqlite: Database.Database,
  businessDate: string,
): TemplateVersionRow | undefined {
  return sqlite.prepare(
    `select t.id as template_id, t.name as template_name, v.revision,
            v.id as version_id, v.effective_from, v.change_note
     from manual_exercise_templates t
     join manual_exercise_template_versions v on v.template_id = t.id
     where v.effective_from <= ?
     order by t.updated_at desc, v.effective_from desc, v.revision desc
     limit 1`,
  ).get(businessDate) as TemplateVersionRow | undefined;
}

function readTemplate(
  sqlite: Database.Database,
  version: TemplateVersionRow,
): ManualExerciseTemplateSnapshot {
  const days = sqlite.prepare(
    `select id, day_key, name, body_part, is_rest, note, ordinal
     from manual_exercise_template_days
     where template_version_id = ? order by ordinal`,
  ).all(version.version_id) as TemplateDayRow[];

  const actionStatement = sqlite.prepare(
    `select action_key, name, planned_sets, planned_reps_text,
            planned_weight_text, target_text, note, ordinal
     from manual_exercise_template_actions
     where template_day_id = ? order by ordinal`,
  );

  return {
    id: version.template_id,
    name: version.template_name,
    revision: version.revision,
    versionId: version.version_id,
    effectiveFrom: version.effective_from,
    changeNote: version.change_note,
    days: days.map((day) => ({
      dayKey: day.day_key,
      name: day.name,
      bodyPart: nullableText(day.body_part),
      isRest: day.is_rest === 1,
      note: nullableText(day.note),
      actions: (actionStatement.all(day.id) as TemplateActionRow[]).map((action) => ({
        actionKey: action.action_key,
        name: action.name,
        plannedSets: action.planned_sets,
        plannedRepsText: nullableText(action.planned_reps_text),
        plannedWeightText: nullableText(action.planned_weight_text),
        targetText: nullableText(action.target_text),
        note: nullableText(action.note),
      })),
    })),
  };
}

function readPreviousActual(
  sqlite: Database.Database,
  businessDate: string,
  actionKey: string,
): ManualExerciseActionSnapshot["previousActualReference"] {
  const row = sqlite.prepare(
    `select d.business_date, a.actual_sets, a.actual_reps_text,
            a.actual_weight_text, a.actual_text
     from manual_exercise_day_actions a
     join manual_exercise_days d on d.id = a.day_id
     where d.business_date < ? and a.action_key = ?
       and d.status <> 'skipped'
       and (a.actual_sets > 0 or a.actual_reps_text <> ''
            or a.actual_weight_text <> '' or a.actual_text <> '')
     order by d.business_date desc limit 1`,
  ).get(businessDate, actionKey) as PreviousActualRow | undefined;

  return row ? {
    businessDate: row.business_date,
    sets: row.actual_sets,
    repsText: nullableText(row.actual_reps_text),
    weightText: nullableText(row.actual_weight_text),
    text: nullableText(row.actual_text),
  } : null;
}

function actionSnapshot(
  sqlite: Database.Database,
  businessDate: string,
  row: DayActionRow,
): ManualExerciseActionSnapshot {
  return {
    actionKey: row.action_key,
    name: row.name,
    planned: {
      sets: row.planned_sets,
      repsText: nullableText(row.planned_reps_text),
      weightText: nullableText(row.planned_weight_text),
      targetText: nullableText(row.target_text),
      note: nullableText(row.planned_note),
    },
    actual: {
      sets: row.actual_sets,
      repsText: nullableText(row.actual_reps_text),
      weightText: nullableText(row.actual_weight_text),
      text: nullableText(row.actual_text),
      completion: row.completion === "completed",
      note: nullableText(row.actual_note),
    },
    previousActualReference: readPreviousActual(sqlite, businessDate, row.action_key),
  };
}

function readResolution(sqlite: Database.Database, row: DayRow): ManualExerciseDayResolution | null {
  const resolution = sqlite.prepare(
    `select outcome, note, cycle_advanced from manual_exercise_day_resolutions
     where day_id = ? and reopened_at is null`,
  ).get(row.id) as { outcome: ManualExerciseDayResolution["outcome"]; note: string; cycle_advanced: number } | undefined;
  if (resolution) return {
    outcome: resolution.outcome, note: nullableText(resolution.note),
    cycleAdvanced: resolution.cycle_advanced === 1,
  };
  if (row.status === "skipped") return {
    outcome: "skipped", note: nullableText(row.note),
    cycleAdvanced: Boolean(sqlite.prepare(
      "select 1 from manual_exercise_cycle_events where day_id = ? and event_type = 'advanced'",
    ).get(row.id)),
  };
  return null;
}

function readMaterializedDay(
  sqlite: Database.Database,
  row: DayRow,
  now: Date,
): ManualExerciseDaySnapshot {
  const actions = sqlite.prepare(
    `select a.action_key, a.name, a.planned_sets, a.planned_reps_text,
            a.planned_weight_text, a.target_text, ta.note as planned_note,
            a.actual_sets, a.actual_reps_text, a.actual_weight_text,
            a.actual_text, a.completion, a.note as actual_note, a.ordinal
     from manual_exercise_day_actions a
     join manual_exercise_template_days td
       on td.template_version_id = ? and td.day_key = ?
     join manual_exercise_template_actions ta
       on ta.template_day_id = td.id and ta.action_key = a.action_key
     where a.day_id = ? order by a.ordinal`,
  ).all(row.template_version_id, row.day_key, row.id) as DayActionRow[];
  const elapsed = deriveManualExerciseElapsed(now, {
    startedAt: row.started_at,
    pausedAt: row.paused_at,
    accumulatedPauseSeconds: row.accumulated_pause_seconds,
    endedAt: row.ended_at,
    confirmedDurationMinutes: row.confirmed_duration_minutes,
  });

  return {
    id: row.id,
    businessDate: row.business_date,
    materialized: true,
    templateVersionId: row.template_version_id,
    dayKey: row.day_key,
    name: row.day_name,
    bodyPart: nullableText(row.body_part),
    isRest: row.is_rest === 1,
    status: row.status,
    resolution: readResolution(sqlite, row),
    revision: row.revision,
    actions: actions.map((action) => actionSnapshot(sqlite, row.business_date, action)),
    timer: {
      startedAt: row.started_at,
      pausedAt: row.paused_at,
      accumulatedPauseSeconds: row.accumulated_pause_seconds,
      endedAt: row.ended_at,
      elapsedSeconds: elapsed.elapsedSeconds,
      calculatedDurationMinutes: row.calculated_duration_minutes
        ?? elapsed.calculatedDurationMinutes,
      confirmedDurationMinutes: row.confirmed_duration_minutes,
    },
    supplements: {
      creatineTaken: nullableBoolean(row.creatine_taken),
      proteinPowderTaken: nullableBoolean(row.protein_powder_taken),
      note: nullableText(row.supplement_note),
    },
    note: nullableText(row.note),
    completionText: nullableText(row.completion_text),
  };
}

function plannedDay(
  sqlite: Database.Database,
  businessDate: string,
  template: ManualExerciseTemplateSnapshot,
  currentDayKey: string,
): ManualExerciseDaySnapshot | null {
  const day = template.days.find((candidate) => candidate.dayKey === currentDayKey);
  if (!day) return null;
  return {
    id: null,
    businessDate,
    materialized: false,
    templateVersionId: template.versionId,
    dayKey: day.dayKey,
    name: day.name,
    bodyPart: day.bodyPart,
    isRest: day.isRest,
    status: "not-started",
    resolution: null,
    revision: 0,
    actions: day.actions.map((action) => ({
      actionKey: action.actionKey,
      name: action.name,
      planned: {
        sets: action.plannedSets,
        repsText: action.plannedRepsText,
        weightText: action.plannedWeightText,
        targetText: action.targetText,
        note: action.note,
      },
      actual: {
        sets: 0,
        repsText: null,
        weightText: null,
        text: null,
        completion: false,
        note: null,
      },
      previousActualReference: readPreviousActual(sqlite, businessDate, action.actionKey),
    })),
    timer: {
      startedAt: null,
      pausedAt: null,
      accumulatedPauseSeconds: 0,
      endedAt: null,
      elapsedSeconds: 0,
      calculatedDurationMinutes: 0,
      confirmedDurationMinutes: null,
    },
    supplements: { creatineTaken: null, proteinPowderTaken: null, note: null },
    note: null,
    completionText: null,
  };
}

export function getManualExerciseSnapshot(
  sqlite: Database.Database,
  input: { businessDate: string; historyLimit?: number; historyOffset?: number },
  now = new Date(),
): ManualExerciseSnapshot {
  const historyLimit = input.historyLimit ?? DEFAULT_HISTORY_LIMIT;
  const historyOffset = input.historyOffset ?? 0;
  if (
    !isBusinessDate(input.businessDate)
    || !Number.isSafeInteger(historyLimit)
    || historyLimit < 1
    || historyLimit > MAX_HISTORY_LIMIT
    || !Number.isSafeInteger(historyOffset)
    || historyOffset < 0
  ) {
    throw new RangeError("Invalid manual exercise snapshot input");
  }

  const version = readEffectiveTemplateVersion(sqlite, input.businessDate);
  const template = version ? readTemplate(sqlite, version) : null;
  const cycleRow = template ? sqlite.prepare(
    `select template_id, current_day_key, revision
     from manual_exercise_cycle_state where template_id = ?`,
  ).get(template.id) as { template_id: string; current_day_key: string; revision: number } | undefined : undefined;
  const cycle = cycleRow ? {
    templateId: cycleRow.template_id,
    currentDayKey: cycleRow.current_day_key,
    revision: cycleRow.revision,
  } : null;
  const dayRow = sqlite.prepare(
    `select id, business_date, template_version_id, day_key, day_name,
            body_part, is_rest, status, started_at, paused_at,
            accumulated_pause_seconds, ended_at, calculated_duration_minutes,
            coalesce(manual_duration_minutes, confirmed_duration_minutes) as confirmed_duration_minutes,
            creatine_taken, protein_powder_taken,
            supplement_note, note, completion_text, revision
     from manual_exercise_days where business_date = ?`,
  ).get(input.businessDate) as DayRow | undefined;
  const selectedDay = dayRow
    ? readMaterializedDay(sqlite, dayRow, now)
    : template && cycle
      ? plannedDay(sqlite, input.businessDate, template, cycleDayKeyForDate(
        sqlite, template.id, template.versionId, input.businessDate,
        toShanghaiBusinessDate(now), cycle.currentDayKey,
      ))
      : null;
  const historyRows = sqlite.prepare(
    `select id, business_date, template_version_id, day_key, day_name,
            body_part, is_rest, status, started_at, paused_at,
            accumulated_pause_seconds, ended_at, calculated_duration_minutes,
            coalesce(manual_duration_minutes, confirmed_duration_minutes) as confirmed_duration_minutes,
            creatine_taken, protein_powder_taken,
            supplement_note, note, completion_text, revision
     from manual_exercise_days order by business_date desc limit ? offset ?`,
  ).all(historyLimit, historyOffset) as DayRow[];
  const selectedWeekStart = new Date(`${input.businessDate}T12:00:00.000Z`);
  selectedWeekStart.setUTCDate(selectedWeekStart.getUTCDate() - (selectedWeekStart.getUTCDay() + 6) % 7);
  const selectedWeekEnd = new Date(selectedWeekStart);
  selectedWeekEnd.setUTCDate(selectedWeekEnd.getUTCDate() + 6);
  const calendarRows = sqlite.prepare(
    `select id, business_date, day_key, day_name, is_rest, status, note,
            calculated_duration_minutes,
            coalesce(manual_duration_minutes, confirmed_duration_minutes) as confirmed_duration_minutes
     from manual_exercise_days where business_date >= ? and business_date <= ?
     order by business_date`,
  ).all(selectedWeekStart.toISOString().slice(0, 10), selectedWeekEnd.toISOString().slice(0, 10)) as DayRow[];
  const summarizeDay = (row: DayRow): ManualExerciseSnapshot["history"][number] => ({
    businessDate: row.business_date,
    dayKey: row.day_key,
    name: row.day_name,
    status: row.status,
    isRest: row.is_rest === 1,
    resolution: readResolution(sqlite, row),
    calculatedDurationMinutes: row.calculated_duration_minutes,
    confirmedDurationMinutes: row.confirmed_duration_minutes,
  });
  const templateHistory = sqlite.prepare(
    `select t.id as templateId, t.name, v.revision, v.effective_from as effectiveFrom,
            v.change_note as changeNote, v.created_at as createdAt
     from manual_exercise_template_versions v
     join manual_exercise_templates t on t.id = v.template_id
     order by v.created_at desc, v.revision desc`,
  ).all() as ManualExerciseSnapshot["templateHistory"];

  return {
    businessDate: input.businessDate,
    template,
    cycle,
    selectedDay,
    history: historyRows.map(summarizeDay),
    calendarRecords: calendarRows.map(summarizeDay),
    templateHistory,
  };
}

export function countManualExerciseHistory(sqlite: Database.Database): number {
  const row = sqlite.prepare(
    "select count(*) as count from manual_exercise_days",
  ).get() as { count: number };
  return row.count;
}
