import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import {
  type IdempotentCommandOptions,
  runIdempotentCommand,
} from "@/core/db/idempotent-command";
import { assertExpectedRevision } from "@/core/mutations/revision";
import { toShanghaiBusinessDate } from "@/core/time/business-date";

import { deriveManualExerciseElapsed } from "../../app/exercise/exercise-timer";
import {
  type ManualExerciseCommand,
  type ManualExerciseStatus,
  type ManualExerciseDayOutcome,
  manualExerciseCommandSchema,
} from "./contracts";
import { getManualExerciseSnapshot } from "./queries";
import { cycleDayKeyForDate } from "./cycle-date";

export type { ManualExerciseCommand } from "./contracts";

export class ManualExerciseConflictError extends Error {
  constructor(message = "Manual exercise state changed.") {
    super(message);
    this.name = "ManualExerciseConflictError";
  }
}

export class ManualExerciseValidationError extends Error {
  constructor(message = "Invalid manual exercise command.") {
    super(message);
    this.name = "ManualExerciseValidationError";
  }
}

export interface ManualExerciseTemplateActionSnapshot {
  actionKey: string;
  name: string;
  plannedSets: number;
  plannedRepsText: string | null;
  plannedWeightText: string | null;
  targetText: string | null;
  note: string | null;
}

export interface ManualExerciseTemplateDaySnapshot {
  dayKey: string;
  name: string;
  bodyPart: string | null;
  isRest: boolean;
  note: string | null;
  actions: ManualExerciseTemplateActionSnapshot[];
}

export interface ManualExerciseTemplateSnapshot {
  id: string;
  name: string;
  revision: number;
  versionId: string;
  effectiveFrom: string;
  changeNote: string;
  days: ManualExerciseTemplateDaySnapshot[];
}

export interface ManualExerciseActionSnapshot {
  actionKey: string;
  name: string;
  planned: {
    sets: number;
    repsText: string | null;
    weightText: string | null;
    targetText: string | null;
    note: string | null;
  };
  actual: {
    sets: number;
    repsText: string | null;
    weightText: string | null;
    text: string | null;
    completion: boolean;
    note: string | null;
  };
  previousActualReference: {
    businessDate: string;
    sets: number;
    repsText: string | null;
    weightText: string | null;
    text: string | null;
  } | null;
}

export interface ManualExerciseDayResolution {
  outcome: ManualExerciseDayOutcome;
  note: string | null;
  cycleAdvanced: boolean;
}

export interface ManualExerciseDaySnapshot {
  id: string | null;
  businessDate: string;
  materialized: boolean;
  templateVersionId: string;
  dayKey: string;
  name: string;
  bodyPart: string | null;
  isRest: boolean;
  status: ManualExerciseStatus;
  resolution?: ManualExerciseDayResolution | null;
  revision: number;
  actions: ManualExerciseActionSnapshot[];
  timer: {
    startedAt: string | null;
    pausedAt: string | null;
    accumulatedPauseSeconds: number;
    endedAt: string | null;
    elapsedSeconds: number;
    calculatedDurationMinutes: number;
    confirmedDurationMinutes: number | null;
  };
  supplements: {
    creatineTaken: boolean | null;
    proteinPowderTaken: boolean | null;
    note: string | null;
  };
  note: string | null;
  completionText: string | null;
}

export interface ManualExerciseHistoryEntry {
  businessDate: string;
  dayKey: string;
  name: string;
  status: ManualExerciseStatus;
  isRest?: boolean;
  resolution?: ManualExerciseDayResolution | null;
  calculatedDurationMinutes: number | null;
  confirmedDurationMinutes: number | null;
}

export interface ManualExerciseSnapshot {
  businessDate: string;
  template: ManualExerciseTemplateSnapshot | null;
  cycle: { templateId: string; currentDayKey: string; revision: number } | null;
  selectedDay: ManualExerciseDaySnapshot | null;
  history: ManualExerciseHistoryEntry[];
  calendarRecords?: ManualExerciseHistoryEntry[];
  templateHistory: Array<{
    templateId: string;
    name: string;
    revision: number;
    effectiveFrom: string;
    changeNote: string;
    createdAt: string;
  }>;
}

export interface ManualExerciseServiceDependencies {
  now?: () => Date;
  createId?: () => string;
  writeBarrier?: IdempotentCommandOptions["writeBarrier"];
}

export interface ManualExerciseService {
  execute(command: ManualExerciseCommand, idempotencyKey: string): Promise<ManualExerciseSnapshot>;
}

interface DayRecord {
  id: string;
  template_version_id: string;
  day_key: string;
  status: ManualExerciseStatus;
  started_at: string | null;
  paused_at: string | null;
  accumulated_pause_seconds: number;
  ended_at: string | null;
  calculated_duration_minutes: number | null;
  confirmed_duration_minutes: number | null;
  revision: number;
  is_rest: number;
}

interface CycleRecord {
  template_id: string;
  current_day_key: string;
  revision: number;
}

function validation(message = "Invalid manual exercise command."): never {
  throw new ManualExerciseValidationError(message);
}

function conflict(message: string): never {
  throw new ManualExerciseConflictError(message);
}

function text(value: string | null | undefined): string {
  return value ?? "";
}

function boolean(value: boolean | null): number | null {
  return value === null ? null : value ? 1 : 0;
}

function assertStoredLengths(command: ManualExerciseCommand): void {
  const assertLength = (value: string | null | undefined, maximum: number) => {
    if ((value?.length ?? 0) > maximum) validation("Text is too long for storage.");
  };
  if (command.type === "replace-template") {
    assertLength(command.name, 160);
    for (const day of command.days) {
      assertLength(day.name, 160);
      assertLength(day.bodyPart, 160);
      assertLength(day.note, 4_000);
      for (const action of day.actions) {
        assertLength(action.name, 160);
        assertLength(action.plannedRepsText, 500);
        assertLength(action.plannedWeightText, 500);
        assertLength(action.targetText, 1_000);
        assertLength(action.note, 4_000);
      }
    }
  }
  if (command.type === "save-training") {
    assertLength(command.supplementNote, 4_000);
    assertLength(command.note, 4_000);
    assertLength(command.completionText, 4_000);
    for (const action of command.actions) {
      assertLength(action.actualRepsText, 1_000);
      assertLength(action.actualWeightText, 1_000);
      assertLength(action.actualText, 4_000);
      assertLength(action.note, 4_000);
    }
  }
  if (command.type === "select-cycle-day" || command.type === "skip-and-advance") {
    assertLength(command.note, 4_000);
  }
}

function parseCommand(command: ManualExerciseCommand): ManualExerciseCommand {
  const parsed = manualExerciseCommandSchema.safeParse(command);
  if (!parsed.success) validation();
  assertStoredLengths(parsed.data);
  return parsed.data;
}

function getDay(sqlite: Database.Database, businessDate: string): DayRecord | undefined {
  return sqlite.prepare(
    `select id, template_version_id, day_key, status, started_at, paused_at,
            accumulated_pause_seconds, ended_at, calculated_duration_minutes, confirmed_duration_minutes,
            revision, is_rest
     from manual_exercise_days where business_date = ?`,
  ).get(businessDate) as DayRecord | undefined;
}

function getCycle(sqlite: Database.Database, templateId: string): CycleRecord {
  const row = sqlite.prepare(
    `select template_id, current_day_key, revision
     from manual_exercise_cycle_state where template_id = ?`,
  ).get(templateId) as CycleRecord | undefined;
  if (!row) conflict("Cycle state is missing.");
  return row;
}

function materializeDay(
  sqlite: Database.Database,
  businessDate: string,
  expectedRevision: number,
  timestamp: string,
  createId: () => string,
): DayRecord {
  const existing = getDay(sqlite, businessDate);
  if (existing) {
    assertExpectedRevision(expectedRevision, existing.revision);
    return existing;
  }
  assertExpectedRevision(expectedRevision, 0);

  const version = sqlite.prepare(
    `select v.id as version_id, v.template_id
     from manual_exercise_template_versions v
     join manual_exercise_templates t on t.id = v.template_id
     where v.effective_from <= ?
     order by t.updated_at desc, v.effective_from desc, v.revision desc limit 1`,
  ).get(businessDate) as { version_id: string; template_id: string } | undefined;
  if (!version) validation("No effective exercise template exists.");
  const cycle = getCycle(sqlite, version.template_id);
  const selectedDayKey = cycleDayKeyForDate(
    sqlite, version.template_id, version.version_id, businessDate,
    toShanghaiBusinessDate(new Date(timestamp)), cycle.current_day_key,
  );
  const day = sqlite.prepare(
    `select id, day_key, name, body_part, is_rest, ordinal
     from manual_exercise_template_days
     where template_version_id = ? and day_key = ?`,
  ).get(version.version_id, selectedDayKey) as {
    id: string; day_key: string; name: string; body_part: string; is_rest: number; ordinal: number;
  } | undefined;
  if (!day) conflict("The current cycle node is absent from the effective template.");

  const dayId = createId();
  sqlite.prepare(
    `insert into manual_exercise_days
      (id, business_date, template_version_id, day_key, day_name, body_part,
       is_rest, status, revision, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, 'not-started', 1, ?, ?)`,
  ).run(
    dayId, businessDate, version.version_id, day.day_key, day.name,
    day.body_part, day.is_rest, timestamp, timestamp,
  );
  const actions = sqlite.prepare(
    `select action_key, name, planned_sets, planned_reps_text,
            planned_weight_text, target_text, note, ordinal
     from manual_exercise_template_actions
     where template_day_id = ? order by ordinal`,
  ).all(day.id) as Array<{
    action_key: string; name: string; planned_sets: number; planned_reps_text: string;
    planned_weight_text: string; target_text: string; note: string; ordinal: number;
  }>;
  const insert = sqlite.prepare(
    `insert into manual_exercise_day_actions
      (id, day_id, action_key, name, planned_sets, planned_reps_text,
       planned_weight_text, target_text, ordinal)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const action of actions) {
    insert.run(
      createId(), dayId, action.action_key, action.name, action.planned_sets,
      action.planned_reps_text, action.planned_weight_text, action.target_text,
      action.ordinal,
    );
  }
  return getDay(sqlite, businessDate)!;
}

function replaceTemplate(
  sqlite: Database.Database,
  command: Extract<ManualExerciseCommand, { type: "replace-template" }>,
  timestamp: string,
  createId: () => string,
): string {
  const current = sqlite.prepare(
    "select current_revision from manual_exercise_templates where id = ?",
  ).get(command.templateId) as { current_revision: number } | undefined;
  assertExpectedRevision(command.expectedTemplateRevision, current?.current_revision ?? 0);
  const revision = (current?.current_revision ?? 0) + 1;
  const versionId = createId();

  if (current) {
    sqlite.prepare(
      `update manual_exercise_templates
       set name = ?, current_revision = ?, updated_at = ? where id = ?`,
    ).run(command.name, revision, timestamp, command.templateId);
  } else {
    sqlite.prepare(
      `insert into manual_exercise_templates
        (id, name, current_revision, created_at, updated_at)
       values (?, ?, ?, ?, ?)`,
    ).run(command.templateId, command.name, revision, timestamp, timestamp);
  }
  sqlite.prepare(
    `insert into manual_exercise_template_versions
      (id, template_id, revision, effective_from, change_note, created_at)
     values (?, ?, ?, ?, ?, ?)`,
  ).run(
    versionId, command.templateId, revision, command.effectiveFrom,
    command.changeNote, timestamp,
  );

  const insertDay = sqlite.prepare(
    `insert into manual_exercise_template_days
      (id, template_version_id, day_key, name, body_part, is_rest, note, ordinal)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertAction = sqlite.prepare(
    `insert into manual_exercise_template_actions
      (id, template_day_id, action_key, name, planned_sets, planned_reps_text,
       planned_weight_text, target_text, note, ordinal)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const [dayOrdinal, day] of command.days.entries()) {
    const dayId = createId();
    insertDay.run(
      dayId, versionId, day.dayKey, day.name, text(day.bodyPart),
      day.isRest ? 1 : 0, text(day.note), dayOrdinal,
    );
    for (const [actionOrdinal, action] of day.actions.entries()) {
      insertAction.run(
        createId(), dayId, action.actionKey, action.name, action.plannedSets,
        text(action.plannedRepsText), text(action.plannedWeightText),
        text(action.targetText), text(action.note), actionOrdinal,
      );
    }
  }

  const existingCycle = sqlite.prepare(
    `select template_id, current_day_key, revision
     from manual_exercise_cycle_state where template_id = ?`,
  ).get(command.templateId) as CycleRecord | undefined;
  const keys = new Set(command.days.map((day) => day.dayKey));
  if (!existingCycle) {
    const currentDayKey = command.replacementCurrentDayKey ?? command.days[0]!.dayKey;
    sqlite.prepare(
      `insert into manual_exercise_cycle_state
        (template_id, current_day_key, revision, updated_at) values (?, ?, 1, ?)`,
    ).run(command.templateId, currentDayKey, timestamp);
    insertCycleEvent(sqlite, {
      id: createId(), templateId: command.templateId, businessDate: command.effectiveFrom,
      eventType: "started", fromDayKey: null, toDayKey: currentDayKey, dayId: null,
      note: command.changeNote, before: 0, after: 1, timestamp,
    });
  } else if (!keys.has(existingCycle.current_day_key)) {
    if (!command.replacementCurrentDayKey) {
      conflict("A replacement current day is required.");
    }
    const nextRevision = existingCycle.revision + 1;
    sqlite.prepare(
      `update manual_exercise_cycle_state
       set current_day_key = ?, revision = ?, updated_at = ? where template_id = ?`,
    ).run(command.replacementCurrentDayKey, nextRevision, timestamp, command.templateId);
    insertCycleEvent(sqlite, {
      id: createId(), templateId: command.templateId, businessDate: command.effectiveFrom,
      eventType: "reset", fromDayKey: existingCycle.current_day_key,
      toDayKey: command.replacementCurrentDayKey, dayId: null,
      note: command.changeNote, before: existingCycle.revision,
      after: nextRevision, timestamp,
    });
  }
  return command.effectiveFrom;
}

function insertCycleEvent(sqlite: Database.Database, event: {
  id: string;
  templateId: string;
  businessDate: string;
  eventType: "started" | "advanced" | "completed" | "reset" | "corrected";
  fromDayKey: string | null;
  toDayKey: string | null;
  dayId: string | null;
  note: string;
  before: number;
  after: number;
  timestamp: string;
}): void {
  sqlite.prepare(
    `insert into manual_exercise_cycle_events
      (id, template_id, business_date, event_type, from_day_key, to_day_key,
       day_id, note, cycle_revision_before, cycle_revision_after, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    event.id, event.templateId, event.businessDate, event.eventType,
    event.fromDayKey, event.toDayKey, event.dayId, event.note,
    event.before, event.after, event.timestamp,
  );
}

function selectCycleDay(
  sqlite: Database.Database,
  command: Extract<ManualExerciseCommand, { type: "select-cycle-day" }>,
  timestamp: string,
  createId: () => string,
): string {
  if (command.businessDate !== toShanghaiBusinessDate(new Date(timestamp))) {
    validation("Only today's cycle can be changed.");
  }
  const cycle = getCycle(sqlite, command.templateId);
  assertExpectedRevision(command.expectedCycleRevision, cycle.revision);
  const version = sqlite.prepare(
    `select id from manual_exercise_template_versions
     where template_id = ? and effective_from <= ?
     order by effective_from desc, revision desc limit 1`,
  ).pluck().get(command.templateId, command.businessDate) as string | undefined;
  if (!version || !sqlite.prepare(
    `select 1 from manual_exercise_template_days
     where template_version_id = ? and day_key = ?`,
  ).get(version, command.dayKey)) {
    validation("The selected day is not in the effective template.");
  }
  const nextRevision = cycle.revision + 1;
  sqlite.prepare(
    `update manual_exercise_cycle_state
     set current_day_key = ?, revision = ?, updated_at = ? where template_id = ?`,
  ).run(command.dayKey, nextRevision, timestamp, command.templateId);
  insertCycleEvent(sqlite, {
    id: createId(), templateId: command.templateId,
    businessDate: command.businessDate, eventType: "corrected",
    fromDayKey: cycle.current_day_key, toDayKey: command.dayKey, dayId: null,
    note: text(command.note), before: cycle.revision, after: nextRevision, timestamp,
  });
  return command.businessDate;
}

function nextCycleKey(
  sqlite: Database.Database,
  templateVersionId: string,
  currentDayKey: string,
): string {
  const keys = sqlite.prepare(
    `select day_key from manual_exercise_template_days
     where template_version_id = ? order by ordinal`,
  ).pluck().all(templateVersionId) as string[];
  const index = keys.indexOf(currentDayKey);
  if (index < 0 || keys.length === 0) conflict("The cycle node is not in the daily template.");
  return keys[(index + 1) % keys.length]!;
}

function advanceCycle(
  sqlite: Database.Database,
  day: DayRecord,
  businessDate: string,
  expectedCycleRevision: number,
  timestamp: string,
  createId: () => string,
  eventType: "completed" | "advanced",
  note: string,
): void {
  // Reopening or correcting a day must never consume its cycle node twice.
  if (sqlite.prepare(
    "select 1 from manual_exercise_cycle_events where day_id = ? and event_type in ('advanced', 'completed')",
  ).get(day.id)) return;
  const templateId = sqlite.prepare(
    "select template_id from manual_exercise_template_versions where id = ?",
  ).pluck().get(day.template_version_id) as string | undefined;
  if (!templateId) conflict("The daily template is missing.");
  const cycle = getCycle(sqlite, templateId);
  assertExpectedRevision(expectedCycleRevision, cycle.revision);
  if (cycle.current_day_key !== day.day_key) conflict("The daily record is not the current cycle node.");
  const nextKey = nextCycleKey(sqlite, day.template_version_id, day.day_key);
  const nextRevision = cycle.revision + 1;
  sqlite.prepare(
    `update manual_exercise_cycle_state
     set current_day_key = ?, revision = ?, updated_at = ? where template_id = ?`,
  ).run(nextKey, nextRevision, timestamp, templateId);
  insertCycleEvent(sqlite, {
    id: createId(), templateId, businessDate, eventType,
    fromDayKey: day.day_key, toDayKey: nextKey, dayId: day.id, note,
    before: cycle.revision, after: nextRevision, timestamp,
  });
}

function updateTimerStatus(
  sqlite: Database.Database,
  command: Extract<ManualExerciseCommand, {
    type: "start-training" | "pause-training" | "resume-training";
  }>,
  timestamp: string,
  createId: () => string,
): void {
  if (command.businessDate !== toShanghaiBusinessDate(new Date(timestamp))) {
    validation("A live timer can only run for today.");
  }
  const day = materializeDay(
    sqlite, command.businessDate, command.expectedDailyRevision, timestamp, createId,
  );
  if (day.status === "completed" || day.status === "skipped") {
    conflict("A terminal training day cannot change timer state.");
  }
  let startedAt = day.started_at;
  let pausedAt = day.paused_at;
  let accumulated = day.accumulated_pause_seconds;
  if (command.type === "start-training") {
    if (startedAt !== null && day.ended_at === null) conflict("Training already started.");
    if (day.ended_at !== null) {
      const gap = Math.floor((Date.parse(timestamp) - Date.parse(day.ended_at)) / 1_000);
      if (gap < 0) validation("The timer clock moved backwards.");
      accumulated += gap;
    } else {
      startedAt = timestamp;
    }
  } else if (command.type === "pause-training") {
    if (startedAt === null || pausedAt !== null || day.ended_at !== null) {
      conflict("Only a running timer can be paused.");
    }
    pausedAt = timestamp;
  } else {
    if (startedAt === null || pausedAt === null || day.ended_at !== null) {
      conflict("Only a paused timer can be resumed.");
    }
    const seconds = Math.floor((Date.parse(timestamp) - Date.parse(pausedAt)) / 1_000);
    if (seconds < 0) validation("The timer clock moved backwards.");
    accumulated += seconds;
    pausedAt = null;
  }
  sqlite.prepare(
    `update manual_exercise_days
     set status = 'in-progress', started_at = ?, paused_at = ?,
         accumulated_pause_seconds = ?, ended_at = null,
         calculated_duration_minutes = null, confirmed_duration_minutes = null,
         revision = ?, updated_at = ?
     where id = ?`,
  ).run(startedAt, pausedAt, accumulated, day.revision + 1, timestamp, day.id);
}

function saveTraining(
  sqlite: Database.Database,
  command: Extract<ManualExerciseCommand, { type: "save-training" }>,
  timestamp: string,
  createId: () => string,
): void {
  const day = materializeDay(
    sqlite, command.businessDate, command.expectedDailyRevision, timestamp, createId,
  );
  if (day.status === "skipped") conflict("A skipped training day cannot be edited.");
  if (command.confirmedDurationMinutes !== null && day.started_at !== null && day.ended_at === null) {
    validation("Duration can only be confirmed after the timer ends.");
  }
  const validKeys = new Set(sqlite.prepare(
    "select action_key from manual_exercise_day_actions where day_id = ?",
  ).pluck().all(day.id) as string[]);
  const updateAction = sqlite.prepare(
    `update manual_exercise_day_actions
     set actual_sets = ?, actual_reps_text = ?, actual_weight_text = ?,
         actual_text = ?, completion = ?, note = ?
     where day_id = ? and action_key = ?`,
  );
  for (const action of command.actions) {
    if (!validKeys.has(action.actionKey)) validation("An actual action is not in the daily snapshot.");
    updateAction.run(
      action.actualSets, text(action.actualRepsText), text(action.actualWeightText),
      text(action.actualText), action.completion ? "completed" : "", text(action.note),
      day.id, action.actionKey,
    );
  }
  const status = day.status === "completed" ? "completed" : command.status;
  sqlite.prepare(
    `update manual_exercise_days
     set status = ?, confirmed_duration_minutes = ?, manual_duration_minutes = ?, creatine_taken = ?,
         protein_powder_taken = ?, supplement_note = ?, note = ?,
         completion_text = ?, revision = ?, updated_at = ? where id = ?`,
  ).run(
    status, day.ended_at === null ? null : command.confirmedDurationMinutes,
    day.ended_at === null ? command.confirmedDurationMinutes : null,
    boolean(command.creatineTaken), boolean(command.proteinPowderTaken),
    text(command.supplementNote), text(command.note), text(command.completionText),
    day.revision + 1, timestamp, day.id,
  );
}

function finishTraining(
  sqlite: Database.Database,
  command: Extract<ManualExerciseCommand, { type: "finish-and-advance" }>,
  acceptedAt: Date,
  createId: () => string,
): void {
  const timestamp = acceptedAt.toISOString();
  const day = materializeDay(
    sqlite, command.businessDate, command.expectedDailyRevision, timestamp, createId,
  );
  if (day.status === "completed" || day.status === "skipped") conflict("Training is already terminal.");
  const actualSets = sqlite.prepare(
    "select coalesce(sum(actual_sets), 0) from manual_exercise_day_actions where day_id = ?",
  ).pluck().get(day.id) as number;
  if (day.is_rest !== 1 && actualSets === 0) {
    validation("A zero-set training day cannot be completed.");
  }

  let pausedAt = day.paused_at;
  let accumulated = day.accumulated_pause_seconds;
  let endedAt = day.ended_at;
  let calculated: number | null = day.calculated_duration_minutes;
  if (day.started_at !== null && day.ended_at === null) {
    if (pausedAt !== null) {
      const seconds = Math.floor((acceptedAt.getTime() - Date.parse(pausedAt)) / 1_000);
      if (seconds < 0) validation("The timer clock moved backwards.");
      accumulated += seconds;
      pausedAt = null;
    }
    endedAt = timestamp;
    calculated = deriveManualExerciseElapsed(acceptedAt, {
      startedAt: day.started_at,
      pausedAt,
      accumulatedPauseSeconds: accumulated,
      endedAt,
      confirmedDurationMinutes: day.confirmed_duration_minutes,
    }).calculatedDurationMinutes;
  }
  sqlite.prepare(
    `update manual_exercise_days
     set status = 'completed', paused_at = ?, accumulated_pause_seconds = ?,
         ended_at = ?, calculated_duration_minutes = ?, revision = ?, updated_at = ?
     where id = ?`,
  ).run(pausedAt, accumulated, endedAt, calculated, day.revision + 1, timestamp, day.id);

  if (command.businessDate === toShanghaiBusinessDate(acceptedAt)) {
    advanceCycle(
      sqlite, day, command.businessDate, command.expectedCycleRevision,
      timestamp, createId, "completed", "",
    );
  }
}

function skipTraining(
  sqlite: Database.Database,
  command: Extract<ManualExerciseCommand, { type: "skip-and-advance" }>,
  acceptedAt: Date,
  createId: () => string,
): void {
  resolveDay(sqlite, { ...command, type: "resolve-day", outcome: "skipped", advanceCycle: true }, acceptedAt, createId);
}

function hasActualTraining(sqlite: Database.Database, dayId: string): boolean {
  return Boolean(sqlite.prepare(
    `select 1 from manual_exercise_day_actions where day_id = ?
     and (actual_sets > 0 or actual_reps_text <> '' or actual_weight_text <> ''
          or actual_text <> '' or completion <> '') limit 1`,
  ).get(dayId));
}

function resolveDay(
  sqlite: Database.Database,
  command: Extract<ManualExerciseCommand, { type: "resolve-day" }>,
  acceptedAt: Date,
  createId: () => string,
): void {
  if (command.outcome === "rest" && command.advanceCycle) {
    validation("A rest day keeps the current training plan.");
  }
  const timestamp = acceptedAt.toISOString();
  const day = materializeDay(sqlite, command.businessDate, command.expectedDailyRevision, timestamp, createId);
  if (day.status === "completed" || day.status === "skipped") conflict("Reopen the day before changing its outcome.");
  if (command.outcome !== "unrecorded" && hasActualTraining(sqlite, day.id)) {
    conflict("Saved training exists. Correct it or mark it as unrecorded.");
  }

  // Close running/paused timers in the same transaction as the day outcome.
  if (day.started_at !== null && day.ended_at === null) {
    let accumulated = day.accumulated_pause_seconds;
    if (day.paused_at !== null) {
      const pause = Math.floor((acceptedAt.getTime() - Date.parse(day.paused_at)) / 1_000);
      if (pause < 0) validation("The timer clock moved backwards.");
      accumulated += pause;
    }
    const minutes = deriveManualExerciseElapsed(acceptedAt, {
      startedAt: day.started_at, pausedAt: null,
      accumulatedPauseSeconds: accumulated, endedAt: timestamp,
      confirmedDurationMinutes: day.confirmed_duration_minutes,
    }).calculatedDurationMinutes;
    sqlite.prepare(
      `update manual_exercise_days set paused_at = null, accumulated_pause_seconds = ?,
       ended_at = ?, calculated_duration_minutes = ? where id = ?`,
    ).run(accumulated, timestamp, minutes, day.id);
  }

  if (command.advanceCycle && command.businessDate === toShanghaiBusinessDate(acceptedAt)) {
    advanceCycle(sqlite, day, command.businessDate, command.expectedCycleRevision, timestamp, createId, "advanced", text(command.note));
  }
  const cycleAdvanced = Boolean(sqlite.prepare(
    "select 1 from manual_exercise_cycle_events where day_id = ? and event_type in ('advanced', 'completed')",
  ).get(day.id));
  sqlite.prepare(
    `insert into manual_exercise_day_resolutions
     (day_id, outcome, note, cycle_advanced, resolved_at, reopened_at)
     values (?, ?, ?, ?, ?, null)
     on conflict(day_id) do update set outcome = excluded.outcome, note = excluded.note,
     cycle_advanced = excluded.cycle_advanced, resolved_at = excluded.resolved_at, reopened_at = null`,
  ).run(day.id, command.outcome, text(command.note), cycleAdvanced ? 1 : 0, timestamp);
  sqlite.prepare(
    "update manual_exercise_days set status = 'skipped', revision = ?, updated_at = ? where id = ?",
  ).run(day.revision + 1, timestamp, day.id);
}

function reopenDay(
  sqlite: Database.Database,
  command: Extract<ManualExerciseCommand, { type: "reopen-day" }>,
  timestamp: string,
): void {
  const day = getDay(sqlite, command.businessDate);
  if (!day) conflict("There is no day to reopen.");
  assertExpectedRevision(command.expectedDailyRevision, day.revision);
  if (day.status !== "skipped") conflict("Only a resolved day can be reopened.");
  sqlite.prepare(
    "update manual_exercise_day_resolutions set reopened_at = ? where day_id = ?",
  ).run(timestamp, day.id);
  sqlite.prepare(
    "update manual_exercise_days set status = ?, revision = ?, updated_at = ? where id = ?",
  ).run(hasActualTraining(sqlite, day.id) ? "partial" : "not-started", day.revision + 1, timestamp, day.id);
}

function applyCommand(
  sqlite: Database.Database,
  command: ManualExerciseCommand,
  acceptedAt: Date,
  createId: () => string,
): string {
  const timestamp = acceptedAt.toISOString();
  if (command.type !== "replace-template" && command.businessDate > toShanghaiBusinessDate(acceptedAt)) {
    validation("Future dates cannot contain actual training records.");
  }
  switch (command.type) {
    case "replace-template":
      return replaceTemplate(sqlite, command, timestamp, createId);
    case "select-cycle-day":
      return selectCycleDay(sqlite, command, timestamp, createId);
    case "start-training":
    case "pause-training":
    case "resume-training":
      updateTimerStatus(sqlite, command, timestamp, createId);
      return command.businessDate;
    case "save-training":
      saveTraining(sqlite, command, timestamp, createId);
      return command.businessDate;
    case "finish-and-advance":
      finishTraining(sqlite, command, acceptedAt, createId);
      return command.businessDate;
    case "skip-and-advance":
      skipTraining(sqlite, command, acceptedAt, createId);
      return command.businessDate;
    case "resolve-day":
      resolveDay(sqlite, command, acceptedAt, createId);
      return command.businessDate;
    case "reopen-day":
      reopenDay(sqlite, command, timestamp);
      return command.businessDate;
  }
}

function buildService(
  sqlite: Database.Database,
  dependencies: ManualExerciseServiceDependencies,
): ManualExerciseService {
  const now = dependencies.now ?? (() => new Date());
  const createId = dependencies.createId ?? randomUUID;
  return {
    execute(command, idempotencyKey) {
      let transactionNow: Date | undefined;
      const stableNow = () => {
        transactionNow ??= now();
        return transactionNow;
      };
      return runIdempotentCommand(
        sqlite,
        {
          operation: "manual-exercise.command",
          idempotencyKey,
          now: stableNow,
          writeBarrier: dependencies.writeBarrier,
        },
        command,
        () => {
          const parsed = parseCommand(command);
          const acceptedAt = stableNow();
          const businessDate = applyCommand(sqlite, parsed, acceptedAt, createId);
          return getManualExerciseSnapshot(sqlite, { businessDate }, acceptedAt);
        },
      );
    },
  };
}

export function createManualExerciseService(
  sqlite: Database.Database,
  dependencies?: ManualExerciseServiceDependencies,
): ManualExerciseService;
export function createManualExerciseService(
  dependencies: ManualExerciseServiceDependencies & { sqlite: Database.Database },
): ManualExerciseService;
export function createManualExerciseService(
  sqliteOrDependencies: Database.Database | (ManualExerciseServiceDependencies & { sqlite: Database.Database }),
  dependencies: ManualExerciseServiceDependencies = {},
): ManualExerciseService {
  if ("sqlite" in sqliteOrDependencies) {
    const { sqlite, ...options } = sqliteOrDependencies;
    return buildService(sqlite, options);
  }
  return buildService(sqliteOrDependencies, dependencies);
}
