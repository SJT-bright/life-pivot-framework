import type Database from "better-sqlite3";

import { isBusinessDate, toShanghaiBusinessDate } from "@/core/time/business-date";
import { getDailySleepRecord } from "@/modules/daily-sleep/query";

import type {
  ManualSkincareDayItemSnapshot,
  ManualSkincareDaySnapshot,
  ManualSkincareProductSnapshot,
  ManualSkincareRecoveryCycleSnapshot,
  ManualSkincareRecoveryPlanSnapshot,
  ManualSkincareRoutineItemSnapshot,
  ManualSkincareSnapshot,
  ManualSkincarePhotoType,
} from "./contracts";
import { calculateSkincareDayInsight } from "./insights";
import { deriveRecoveryDurationDays } from "./recovery-countdown";

const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 100;

interface ProductRow {
  id: string;
  name: string;
  brand: string;
  current_purpose: string;
  status: ManualSkincareProductSnapshot["status"];
  added_on: string;
  note: string;
  photo_mime: string | null;
  revision: number;
}

interface ProductPhotoRow {
  photo_blob: Buffer;
  photo_mime: ManualSkincarePhotoType;
  revision: number;
}

export interface ManualSkincareProductPhoto {
  readonly bytes: Buffer;
  readonly mediaType: ManualSkincarePhotoType;
  readonly revision: number;
}

interface ActivationRow {
  id: string;
  routine_version_id: string;
  routine_revision: number;
  recovery_cycle_id: string | null;
  recovery_cycle_name: string | null;
  activation_sequence: number;
}

interface RoutineItemRow {
  item_key: string;
  slot: ManualSkincareRoutineItemSnapshot["slot"];
  product_id: string;
  product_name_snapshot: string;
  brand_snapshot: string;
  purpose_snapshot: string;
  ordinal: number;
}

interface DayRow {
  id: string;
  business_date: string;
  routine_version_id: string | null;
  routine_revision: number | null;
  activation_sequence: number | null;
  recovery_cycle_id: string | null;
  recovery_cycle_name_snapshot: string;
  morning_note: string;
  evening_note: string;
  overall_note: string;
  revision: number;
}

interface DayItemRow extends RoutineItemRow {
  used: number;
  used_at: string | null;
}

interface PlanRow {
  id: string;
  name: string;
  note: string;
  revision: number;
}

interface CycleRow {
  id: string;
  plan_id: string;
  ordinal: number;
  name: string;
  goal: string;
  expected_end_on: string | null;
  status: ManualSkincareRecoveryCycleSnapshot["status"];
  actual_started_on: string | null;
  actual_completed_on: string | null;
  note: string;
  revision: number;
  routine_version_id: string;
  routine_revision: number;
  updated_at: string;
}

function shanghaiDateFromTimestamp(timestamp: string): string | null {
  const parsed = new Date(timestamp);
  return Number.isFinite(parsed.getTime()) ? toShanghaiBusinessDate(parsed) : null;
}

function validateInput(input: { businessDate: string; historyLimit?: number }): number {
  if (!isBusinessDate(input.businessDate)) {
    throw new TypeError("Invalid manual skincare business date.");
  }
  const historyLimit = input.historyLimit ?? DEFAULT_HISTORY_LIMIT;
  if (
    !Number.isSafeInteger(historyLimit)
    || historyLimit < 1
    || historyLimit > MAX_HISTORY_LIMIT
  ) {
    throw new TypeError("Invalid manual skincare history limit.");
  }
  return historyLimit;
}

function readProducts(sqlite: Database.Database): ManualSkincareProductSnapshot[] {
  const rows = sqlite.prepare(`
    select id, name, brand, current_purpose, status, added_on, note,
           photo_mime, revision
    from manual_skincare_products
    order by name collate nocase asc, id asc
  `).all() as ProductRow[];
  return rows.map((row) => ({
    productId: row.id,
    name: row.name,
    brand: row.brand,
    currentPurpose: row.current_purpose,
    status: row.status,
    addedOn: row.added_on,
    note: row.note,
    photoUrl: row.photo_mime === null
      ? null
      : `/api/v1/manual-skincare/products/${encodeURIComponent(row.id)}/photo?revision=${row.revision}`,
    revision: row.revision,
  }));
}

/**
 * Routine authority is selected exclusively from explicit activations. Recovery
 * cycle reminder dates deliberately do not participate in this query.
 */
function selectActivation(
  sqlite: Database.Database,
  businessDate: string,
): ActivationRow | undefined {
  return sqlite.prepare(`
    select a.id, a.routine_version_id, v.revision as routine_revision,
           a.recovery_cycle_id, c.name as recovery_cycle_name,
           a.activation_sequence
    from manual_skincare_routine_activations a
    join manual_skincare_routine_versions v on v.id = a.routine_version_id
    left join manual_skincare_recovery_cycles c on c.id = a.recovery_cycle_id
    where a.effective_from <= ?
    order by a.effective_from desc, a.activation_sequence desc
    limit 1
  `).get(businessDate) as ActivationRow | undefined;
}

function readRoutineItems(
  sqlite: Database.Database,
  routineVersionId: string,
): ManualSkincareRoutineItemSnapshot[] {
  const rows = sqlite.prepare(`
    select item_key, slot, product_id, product_name_snapshot,
           brand_snapshot, purpose_snapshot, ordinal
    from manual_skincare_routine_items
    where routine_version_id = ?
    order by case slot when 'morning' then 0 else 1 end, ordinal asc, item_key asc
  `).all(routineVersionId) as RoutineItemRow[];
  return rows.map(mapRoutineItem);
}

function mapRoutineItem(row: RoutineItemRow): ManualSkincareRoutineItemSnapshot {
  return {
    itemKey: row.item_key,
    slot: row.slot,
    productId: row.product_id,
    ordinal: row.ordinal,
    productName: row.product_name_snapshot,
    brand: row.brand_snapshot,
    currentPurpose: row.purpose_snapshot,
  };
}
function readDayRow(
  sqlite: Database.Database,
  businessDate: string,
): DayRow | undefined {
  return sqlite.prepare(`
    select d.id, d.business_date, d.routine_version_id,
           v.revision as routine_revision,
           a.activation_sequence,
           d.recovery_cycle_id, d.recovery_cycle_name_snapshot,
           d.morning_note, d.evening_note, d.overall_note, d.revision
    from manual_skincare_days d
    left join manual_skincare_routine_versions v on v.id = d.routine_version_id
    left join manual_skincare_routine_activations a on a.id = d.routine_activation_id
    where d.business_date = ?
  `).get(businessDate) as DayRow | undefined;
}

function readDayItems(
  sqlite: Database.Database,
  dayId: string,
): ManualSkincareDayItemSnapshot[] {
  const rows = sqlite.prepare(`
    select item_key, slot, product_id, product_name_snapshot,
           brand_snapshot, purpose_snapshot, ordinal, used, used_at
    from manual_skincare_day_items
    where day_id = ?
    order by case slot when 'morning' then 0 else 1 end, ordinal asc, item_key asc
  `).all(dayId) as DayItemRow[];
  return rows.map((row) => ({
    ...mapRoutineItem(row),
    used: row.used === 1,
    usedAt: row.used_at,
  }));
}

function mapMaterializedDay(
  sqlite: Database.Database,
  row: DayRow,
): ManualSkincareDaySnapshot {
  const items = readDayItems(sqlite, row.id);
  return {
    dayId: row.id,
    businessDate: row.business_date,
    materialized: true,
    routineRevision: row.routine_revision ?? 0,
    activationSequence: row.activation_sequence ?? 0,
    recoveryCycle: row.recovery_cycle_id
      ? { cycleId: row.recovery_cycle_id, name: row.recovery_cycle_name_snapshot }
      : null,
    morningNote: row.morning_note,
    eveningNote: row.evening_note,
    overallNote: row.overall_note,
    revision: row.revision,
    morningItems: items.filter((item) => item.slot === "morning"),
    eveningItems: items.filter((item) => item.slot === "evening"),
  };
}

function projectDay(
  sqlite: Database.Database,
  businessDate: string,
): ManualSkincareDaySnapshot {
  const activation = selectActivation(sqlite, businessDate);
  const planned = activation
    ? readRoutineItems(sqlite, activation.routine_version_id).map((item) => ({
        ...item,
        used: false,
        usedAt: null,
      }))
    : [];
  return {
    dayId: null,
    businessDate,
    materialized: false,
    routineRevision: activation?.routine_revision ?? 0,
    activationSequence: activation?.activation_sequence ?? 0,
    recoveryCycle: activation?.recovery_cycle_id
      ? {
          cycleId: activation.recovery_cycle_id,
          name: activation.recovery_cycle_name ?? "",
        }
      : null,
    morningNote: "",
    eveningNote: "",
    overallNote: "",
    revision: 0,
    morningItems: planned.filter((item) => item.slot === "morning"),
    eveningItems: planned.filter((item) => item.slot === "evening"),
  };
}

function readRecoveryPlans(
  sqlite: Database.Database,
): ManualSkincareRecoveryPlanSnapshot[] {
  const plans = sqlite.prepare(`
    select id, name, note, revision
    from manual_skincare_recovery_plans
    order by created_at asc, id asc
  `).all() as PlanRow[];
  const cycleStatement = sqlite.prepare(`
    select c.id, c.plan_id, c.ordinal, c.name, c.goal, c.expected_end_on,
           c.status, c.actual_started_on, c.actual_completed_on, c.note,
           c.revision, c.routine_version_id, v.revision as routine_revision,
           c.updated_at
    from manual_skincare_recovery_cycles c
    join manual_skincare_routine_versions v on v.id = c.routine_version_id
    where c.plan_id = ?
    order by c.ordinal asc, c.id asc
  `);
  return plans.map((plan) => ({
    planId: plan.id,
    name: plan.name,
    note: plan.note,
    revision: plan.revision,
    cycles: (cycleStatement.all(plan.id) as CycleRow[]).map((cycle) => ({
      cycleId: cycle.id,
      planId: cycle.plan_id,
      ordinal: cycle.ordinal,
      name: cycle.name,
      goal: cycle.goal,
      durationDays: deriveRecoveryDurationDays({
        expectedEndOn: cycle.expected_end_on,
        actualStartedOn: cycle.actual_started_on,
        anchorOn: shanghaiDateFromTimestamp(cycle.updated_at),
      }),
      expectedEndOn: cycle.expected_end_on,
      status: cycle.status,
      actualStartedOn: cycle.actual_started_on,
      actualCompletedOn: cycle.actual_completed_on,
      note: cycle.note,
      revision: cycle.revision,
      routineRevision: cycle.routine_revision,
      items: readRoutineItems(sqlite, cycle.routine_version_id),
    })),
  }));
}

function readHistory(
  sqlite: Database.Database,
  businessDate: string,
  historyLimit: number,
): ManualSkincareDaySnapshot[] {
  const rows = sqlite.prepare(`
    select d.id, d.business_date, d.routine_version_id,
           v.revision as routine_revision,
           a.activation_sequence,
           d.recovery_cycle_id, d.recovery_cycle_name_snapshot,
           d.morning_note, d.evening_note, d.overall_note, d.revision
    from manual_skincare_days d
    left join manual_skincare_routine_versions v on v.id = d.routine_version_id
    left join manual_skincare_routine_activations a on a.id = d.routine_activation_id
    where d.business_date <= ?
    order by d.business_date desc, d.id desc
    limit ?
  `).all(businessDate, historyLimit) as DayRow[];
  return rows.map((row) => mapMaterializedDay(sqlite, row));
}

export function getManualSkincareSnapshot(
  sqlite: Database.Database,
  input: { businessDate: string; historyLimit?: number },
): ManualSkincareSnapshot {
  const historyLimit = validateInput(input);
  const materialized = readDayRow(sqlite, input.businessDate);
  const latestRoutineRevision = sqlite.prepare(`
    select coalesce(max(revision), 0) from manual_skincare_routine_versions
  `).pluck().get() as number;
  const activationSequence = sqlite.prepare(`
    select coalesce(max(activation_sequence), 0)
    from manual_skincare_routine_activations
  `).pluck().get() as number;
  const selectedDay = materialized
    ? mapMaterializedDay(sqlite, materialized)
    : projectDay(sqlite, input.businessDate);
  const history = readHistory(sqlite, input.businessDate, historyLimit);
  const insightDays = new Map(
    [selectedDay, ...history].map((day) => [day.businessDate, day]),
  );
  const insights = [...insightDays.values()].map((day) => {
    const sleep = getDailySleepRecord(sqlite, { recordDate: day.businessDate });
    return calculateSkincareDayInsight(day, sleep ? {
      // 手环手动分优先；旧数据没有手动分时回退到本地自动估算分。
      qualityScore: sleep.qualityScore ?? sleep.score.finalScore,
      sleepVariabilityMinutes: sleep.sleepVariabilityMinutes,
      asleepTime: sleep.asleepTime,
    } : null);
  });
  return {
    businessDate: input.businessDate,
    products: readProducts(sqlite),
    latestRoutineRevision,
    activationSequence,
    selectedDay,
    recoveryPlans: readRecoveryPlans(sqlite),
    history,
    insights,
  };
}

export function getManualSkincareProductPhoto(
  sqlite: Database.Database,
  productId: string,
): ManualSkincareProductPhoto | null {
  if (productId !== productId.trim() || productId.length < 8 || productId.length > 128) {
    throw new TypeError("Invalid manual skincare product id.");
  }
  const row = sqlite.prepare(`
    select photo_blob, photo_mime, revision
    from manual_skincare_products
    where id = ? and photo_blob is not null and photo_mime is not null
  `).get(productId) as ProductPhotoRow | undefined;
  return row ? { bytes: row.photo_blob, mediaType: row.photo_mime, revision: row.revision } : null;
}
