import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import type { WriteBarrier } from "@/core/backup/write-barrier";
import { runIdempotentCommand } from "@/core/db/idempotent-command";
import { isBusinessDate, toShanghaiBusinessDate } from "@/core/time/business-date";

import {
  type ManualSkincareAppliedMutation,
  type ManualSkincareCommand,
  type ManualSkincareMutationResult,
  type ManualSkincareRoutineItemInput,
  parseManualSkincareCommand,
  parseManualSkincarePhotoDataUrl,
} from "./contracts";
import { getManualSkincareSnapshot } from "./query";
import {
  addRecoveryCalendarDays,
  DEFAULT_RECOVERY_DURATION_DAYS,
  deriveRecoveryDurationDays,
} from "./recovery-countdown";

type WriteBarrierLike = Pick<WriteBarrier, "runWrite">;

export class ManualSkincareConflictError extends Error {
  constructor(message = "Manual skincare data changed. Reload before editing again.") {
    super(message);
    this.name = "ManualSkincareConflictError";
  }
}

export interface ManualSkincareServiceOptions {
  now?: () => Date;
  createId?: (prefix: string) => string;
  writeBarrier?: WriteBarrierLike;
}

export interface ManualSkincareService {
  execute(
    command: ManualSkincareCommand,
    idempotencyKey: string,
  ): Promise<ManualSkincareMutationResult>;
}

interface ProductRow {
  id: string;
  revision: number;
  photo_blob: Buffer | null;
  photo_mime: "image/jpeg" | "image/png" | "image/webp" | null;
}

interface ProductSnapshotRow {
  id: string;
  name: string;
  brand: string;
  current_purpose: string;
}

interface VersionRow {
  id: string;
  revision: number;
}

interface ActivationRow {
  id: string;
  routine_version_id: string;
  recovery_cycle_id: string | null;
  recovery_cycle_name: string | null;
  activation_sequence: number;
}

interface DayRow {
  id: string;
  business_date: string;
  routine_activation_id: string | null;
  routine_version_id: string | null;
  recovery_cycle_id: string | null;
  revision: number;
}

interface DayItemRow {
  id: string;
  item_key: string;
  product_id: string;
  slot: ManualSkincareRoutineItemInput["slot"];
  used: number;
  used_at: string | null;
}

interface PlanRow {
  id: string;
  revision: number;
}

interface CycleRow {
  id: string;
  plan_id: string;
  routine_version_id: string;
  name: string;
  expected_end_on: string | null;
  status: "draft" | "active" | "completed";
  actual_started_on: string | null;
  actual_completed_on: string | null;
  revision: number;
  updated_at: string;
}

interface RoutineItemSnapshot {
  itemKey: string;
  slot: ManualSkincareRoutineItemInput["slot"];
  productId: string;
  productName: string;
  brand: string;
  currentPurpose: string;
  ordinal: number;
}

interface DayAuthority {
  activationId: string | null;
  routineVersionId: string | null;
  recoveryCycleId: string | null;
  recoveryCycleName: string;
}

function nowFactory(options: ManualSkincareServiceOptions): () => Date {
  return options.now ?? (() => new Date());
}

function idFactory(options: ManualSkincareServiceOptions): (prefix: string) => string {
  return options.createId ?? ((prefix: string) => `${prefix}-${randomUUID()}`);
}

function readProduct(sqlite: Database.Database, productId: string): ProductRow | undefined {
  return sqlite.prepare(`
    select id, revision, photo_blob, photo_mime from manual_skincare_products where id = ?
  `).get(productId) as ProductRow | undefined;
}

function readProductSnapshot(
  sqlite: Database.Database,
  productId: string,
): ProductSnapshotRow | undefined {
  return sqlite.prepare(`
    select id, name, brand, current_purpose
    from manual_skincare_products where id = ?
  `).get(productId) as ProductSnapshotRow | undefined;
}

function latestRoutineRevision(sqlite: Database.Database): number {
  return sqlite.prepare(`
    select coalesce(max(revision), 0) from manual_skincare_routine_versions
  `).pluck().get() as number;
}

function latestActivationSequence(sqlite: Database.Database): number {
  return sqlite.prepare(`
    select coalesce(max(activation_sequence), 0)
    from manual_skincare_routine_activations
  `).pluck().get() as number;
}

function selectActivation(
  sqlite: Database.Database,
  businessDate: string,
): ActivationRow | undefined {
  return sqlite.prepare(`
    select a.id, a.routine_version_id, a.recovery_cycle_id,
           c.name as recovery_cycle_name, a.activation_sequence
    from manual_skincare_routine_activations a
    left join manual_skincare_recovery_cycles c on c.id = a.recovery_cycle_id
    where a.effective_from <= ?
    order by a.effective_from desc, a.activation_sequence desc
    limit 1
  `).get(businessDate) as ActivationRow | undefined;
}

function readVersionItems(
  sqlite: Database.Database,
  routineVersionId: string,
): RoutineItemSnapshot[] {
  return sqlite.prepare(`
    select item_key as itemKey, slot, product_id as productId,
           product_name_snapshot as productName, brand_snapshot as brand,
           purpose_snapshot as currentPurpose, ordinal
    from manual_skincare_routine_items
    where routine_version_id = ?
    order by case slot when 'morning' then 0 else 1 end, ordinal asc, item_key asc
  `).all(routineVersionId) as RoutineItemSnapshot[];
}

function snapshotInputItems(
  sqlite: Database.Database,
  items: readonly ManualSkincareRoutineItemInput[],
): RoutineItemSnapshot[] {
  return items.map((item) => {
    const product = readProductSnapshot(sqlite, item.productId);
    if (!product) {
      throw new ManualSkincareConflictError("A routine product no longer exists.");
    }
    return {
      ...item,
      productName: product.name,
      brand: product.brand,
      currentPurpose: product.current_purpose,
    };
  });
}

function createRoutineVersion(
  sqlite: Database.Database,
  items: readonly ManualSkincareRoutineItemInput[],
  changeNote: string,
  timestamp: string,
  createId: (prefix: string) => string,
): VersionRow {
  const revision = latestRoutineRevision(sqlite) + 1;
  const id = createId("manual-skincare-routine");
  sqlite.prepare(`
    insert into manual_skincare_routine_versions
      (id, revision, change_note, created_at)
    values (?, ?, ?, ?)
  `).run(id, revision, changeNote, timestamp);
  insertRoutineItems(
    sqlite,
    id,
    snapshotInputItems(sqlite, items),
    timestamp,
    createId,
  );
  return { id, revision };
}

function insertRoutineItems(
  sqlite: Database.Database,
  routineVersionId: string,
  items: readonly RoutineItemSnapshot[],
  timestamp: string,
  createId: (prefix: string) => string,
): void {
  const statement = sqlite.prepare(`
    insert into manual_skincare_routine_items
      (id, routine_version_id, item_key, slot, product_id,
       product_name_snapshot, brand_snapshot, purpose_snapshot, ordinal, created_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const item of items) {
    statement.run(
      createId("manual-skincare-routine-item"),
      routineVersionId,
      item.itemKey,
      item.slot,
      item.productId,
      item.productName,
      item.brand,
      item.currentPurpose,
      item.ordinal,
      timestamp,
    );
  }
}

function authorityFromActivation(activation: ActivationRow | undefined): DayAuthority {
  return {
    activationId: activation?.id ?? null,
    routineVersionId: activation?.routine_version_id ?? null,
    recoveryCycleId: activation?.recovery_cycle_id ?? null,
    recoveryCycleName: activation?.recovery_cycle_name ?? "",
  };
}

function readDay(sqlite: Database.Database, businessDate: string): DayRow | undefined {
  return sqlite.prepare(`
    select id, business_date, routine_activation_id, routine_version_id,
           recovery_cycle_id, revision
    from manual_skincare_days where business_date = ?
  `).get(businessDate) as DayRow | undefined;
}

function readDayItems(sqlite: Database.Database, dayId: string): DayItemRow[] {
  return sqlite.prepare(`
    select id, item_key, product_id, slot, used, used_at
    from manual_skincare_day_items where day_id = ?
  `).all(dayId) as DayItemRow[];
}

function insertDayItems(
  sqlite: Database.Database,
  dayId: string,
  items: readonly RoutineItemSnapshot[],
  previous: ReadonlyMap<string, DayItemRow>,
  createId: (prefix: string) => string,
): void {
  const statement = sqlite.prepare(`
    insert into manual_skincare_day_items
      (id, day_id, item_key, slot, product_id, product_name_snapshot,
       brand_snapshot, purpose_snapshot, ordinal, used, used_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const item of items) {
    const candidate = previous.get(item.itemKey);
    const old = candidate
      && candidate.product_id === item.productId
      && candidate.slot === item.slot
      ? candidate
      : undefined;
    statement.run(
      old?.id ?? createId("manual-skincare-day-item"),
      dayId,
      item.itemKey,
      item.slot,
      item.productId,
      item.productName,
      item.brand,
      item.currentPurpose,
      item.ordinal,
      old?.used ?? 0,
      old?.used_at ?? null,
    );
  }
}

function createDay(
  sqlite: Database.Database,
  businessDate: string,
  authority: DayAuthority,
  items: readonly RoutineItemSnapshot[],
  timestamp: string,
  createId: (prefix: string) => string,
): DayRow {
  const id = createId("manual-skincare-day");
  sqlite.prepare(`
    insert into manual_skincare_days
      (id, business_date, routine_activation_id, routine_version_id,
       recovery_cycle_id, recovery_cycle_name_snapshot,
       morning_note, evening_note, overall_note,
       revision, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, '', '', '', 1, ?, ?)
  `).run(
    id,
    businessDate,
    authority.activationId,
    authority.routineVersionId,
    authority.recoveryCycleId,
    authority.recoveryCycleName,
    timestamp,
    timestamp,
  );
  insertDayItems(sqlite, id, items, new Map(), createId);
  return readDay(sqlite, businessDate)!;
}

function removedUsedItems(
  sqlite: Database.Database,
  day: DayRow,
  nextItems: readonly RoutineItemSnapshot[],
): DayItemRow[] {
  const nextByKey = new Map(nextItems.map((item) => [item.itemKey, item]));
  return readDayItems(sqlite, day.id).filter(
    (item) => {
      if (item.used !== 1) return false;
      const next = nextByKey.get(item.item_key);
      return !next
        || next.productId !== item.product_id
        || next.slot !== item.slot;
    },
  );
}

function validateExactConfirmedRemovals(
  removed: readonly DayItemRow[],
  confirmedKeys: readonly string[],
): void {
  const required = new Set(removed.map((item) => item.item_key));
  const confirmed = new Set(confirmedKeys);
  if (
    required.size !== confirmed.size
    || [...required].some((key) => !confirmed.has(key))
  ) {
    throw new ManualSkincareConflictError(
      "Used item removal requires an exact explicit confirmation set.",
    );
  }
}

function auditRemovedUsedItems(
  sqlite: Database.Database,
  day: DayRow,
  removed: readonly DayItemRow[],
  timestamp: string,
  createId: (prefix: string) => string,
): void {
  const statement = sqlite.prepare(`
    insert into audit_events
      (id, event_type, resource_type, resource_id, payload_json, occurred_at)
    values (?, 'manual-skincare.used-item-removed', 'manual-skincare-day', ?, ?, ?)
  `);
  for (const item of removed) {
    statement.run(
      createId("manual-skincare-audit"),
      day.id,
      JSON.stringify({ businessDate: day.business_date, itemKey: item.item_key }),
      timestamp,
    );
  }
}

function rebuildDay(
  sqlite: Database.Database,
  day: DayRow,
  authority: DayAuthority,
  items: readonly RoutineItemSnapshot[],
  timestamp: string,
  createId: (prefix: string) => string,
): DayRow {
  const previousItems = readDayItems(sqlite, day.id);
  const previous = new Map(previousItems.map((item) => [item.item_key, item]));
  const removed = removedUsedItems(sqlite, day, items);
  auditRemovedUsedItems(sqlite, day, removed, timestamp, createId);
  sqlite.prepare(`delete from manual_skincare_day_items where day_id = ?`).run(day.id);
  insertDayItems(sqlite, day.id, items, previous, createId);
  sqlite.prepare(`
    update manual_skincare_days
    set routine_activation_id = ?, routine_version_id = ?, recovery_cycle_id = ?,
        recovery_cycle_name_snapshot = ?, revision = revision + 1, updated_at = ?
    where id = ?
  `).run(
    authority.activationId,
    authority.routineVersionId,
    authority.recoveryCycleId,
    authority.recoveryCycleName,
    timestamp,
    day.id,
  );
  return readDay(sqlite, day.business_date)!;
}

function requireExpectedDayRevision(
  sqlite: Database.Database,
  businessDate: string,
  expectedRevision: number,
): DayRow | undefined {
  const day = readDay(sqlite, businessDate);
  if ((day?.revision ?? 0) !== expectedRevision) {
    throw new ManualSkincareConflictError();
  }
  return day;
}

function createActivation(
  sqlite: Database.Database,
  routineVersionId: string,
  recoveryCycleId: string | null,
  effectiveFrom: string,
  reason: "manual-routine-update" | "recovery-cycle-start",
  sequence: number,
  timestamp: string,
  createId: (prefix: string) => string,
): ActivationRow {
  const id = createId("manual-skincare-activation");
  sqlite.prepare(`
    insert into manual_skincare_routine_activations
      (id, routine_version_id, recovery_cycle_id, activation_sequence,
       effective_from, reason, created_at)
    values (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    routineVersionId,
    recoveryCycleId,
    sequence,
    effectiveFrom,
    reason,
    timestamp,
  );
  const cycleName = recoveryCycleId
    ? (sqlite.prepare(`
        select name from manual_skincare_recovery_cycles where id = ?
      `).pluck().get(recoveryCycleId) as string)
    : null;
  return {
    id,
    routine_version_id: routineVersionId,
    recovery_cycle_id: recoveryCycleId,
    recovery_cycle_name: cycleName,
    activation_sequence: sequence,
  };
}

function readPlan(sqlite: Database.Database, planId: string): PlanRow | undefined {
  return sqlite.prepare(`
    select id, revision from manual_skincare_recovery_plans where id = ?
  `).get(planId) as PlanRow | undefined;
}

function readCycle(sqlite: Database.Database, cycleId: string): CycleRow | undefined {
  return sqlite.prepare(`
    select id, plan_id, routine_version_id, name, expected_end_on, status,
           actual_started_on, actual_completed_on, revision, updated_at
    from manual_skincare_recovery_cycles where id = ?
  `).get(cycleId) as CycleRow | undefined;
}

function readActiveCycle(sqlite: Database.Database): CycleRow | undefined {
  return sqlite.prepare(`
    select id, plan_id, routine_version_id, name, expected_end_on, status,
           actual_started_on, actual_completed_on, revision, updated_at
    from manual_skincare_recovery_cycles where status = 'active'
  `).get() as CycleRow | undefined;
}

function shanghaiDateFromTimestamp(timestamp: string): string | null {
  const parsed = new Date(timestamp);
  return Number.isFinite(parsed.getTime()) ? toShanghaiBusinessDate(parsed) : null;
}

function storedCycleDurationDays(cycle: CycleRow): number {
  return deriveRecoveryDurationDays({
    expectedEndOn: cycle.expected_end_on,
    actualStartedOn: cycle.actual_started_on,
    anchorOn: shanghaiDateFromTimestamp(cycle.updated_at),
  }) ?? DEFAULT_RECOVERY_DURATION_DAYS;
}

function addOneBusinessDay(businessDate: string): string {
  const [year, month, day] = businessDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function mutationResult(
  sqlite: Database.Database,
  snapshotDate: string,
  applied: ManualSkincareAppliedMutation,
): ManualSkincareMutationResult {
  return {
    snapshot: getManualSkincareSnapshot(sqlite, { businessDate: snapshotDate }),
    applied,
  };
}

function saveProduct(
  sqlite: Database.Database,
  command: Extract<ManualSkincareCommand, { type: "save-product" }>,
  today: string,
  timestamp: string,
): ManualSkincareMutationResult {
  const current = readProduct(sqlite, command.productId);
  if ((current?.revision ?? 0) !== command.expectedProductRevision) {
    throw new ManualSkincareConflictError();
  }
  const revision = (current?.revision ?? 0) + 1;
  let photoBlob = current?.photo_blob ?? null;
  let photoMime = current?.photo_mime ?? null;
  if (Object.hasOwn(command, "photoDataUrl")) {
    const parsedPhoto = command.photoDataUrl === null || command.photoDataUrl === undefined
      ? null
      : parseManualSkincarePhotoDataUrl(command.photoDataUrl);
    if (command.photoDataUrl && !parsedPhoto) throw new TypeError("Invalid skincare product photo.");
    photoBlob = parsedPhoto ? Buffer.from(parsedPhoto.base64, "base64") : null;
    photoMime = parsedPhoto?.mediaType ?? null;
  }
  if (current) {
    sqlite.prepare(`
      update manual_skincare_products
      set name = ?, brand = ?, current_purpose = ?, status = ?, added_on = ?,
          note = ?, photo_blob = ?, photo_mime = ?, revision = ?, updated_at = ?
      where id = ?
    `).run(
      command.name,
      command.brand,
      command.currentPurpose,
      command.status,
      command.addedOn,
      command.note,
      photoBlob,
      photoMime,
      revision,
      timestamp,
      command.productId,
    );
  } else {
    sqlite.prepare(`
      insert into manual_skincare_products
        (id, name, brand, current_purpose, status, added_on, note, photo_blob, photo_mime,
         revision, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      command.productId,
      command.name,
      command.brand,
      command.currentPurpose,
      command.status,
      command.addedOn,
      command.note,
      photoBlob,
      photoMime,
      timestamp,
      timestamp,
    );
  }
  return mutationResult(sqlite, today, {
    operation: command.type,
    ownerId: command.productId,
    ownerRevision: revision,
    businessDate: null,
    activationSequence: null,
  });
}

function replaceRoutine(
  sqlite: Database.Database,
  command: Extract<ManualSkincareCommand, { type: "replace-routine" }>,
  today: string,
  timestamp: string,
  createId: (prefix: string) => string,
): ManualSkincareMutationResult {
  if (
    command.scope === "today-and-future"
    && command.businessDate !== today
  ) {
    throw new ManualSkincareConflictError(
      "Today-and-future changes must begin on the current business date.",
    );
  }
  if (latestRoutineRevision(sqlite) !== command.expectedRoutineRevision) {
    throw new ManualSkincareConflictError();
  }
  let selectedDay = requireExpectedDayRevision(
    sqlite,
    command.businessDate,
    command.expectedDayRevision,
  );
  const items = snapshotInputItems(sqlite, command.items);

  if (command.scope === "today-only") {
    const authority = authorityFromActivation(
      selectActivation(sqlite, command.businessDate),
    );
    if (!selectedDay) {
      validateExactConfirmedRemovals([], command.confirmedRemovedUsedItemKeys);
      selectedDay = createDay(
        sqlite,
        command.businessDate,
        authority,
        items,
        timestamp,
        createId,
      );
    } else {
      const removed = removedUsedItems(sqlite, selectedDay, items);
      validateExactConfirmedRemovals(removed, command.confirmedRemovedUsedItemKeys);
      selectedDay = rebuildDay(
        sqlite,
        selectedDay,
        authority,
        items,
        timestamp,
        createId,
      );
    }
    return mutationResult(sqlite, command.businessDate, {
      operation: command.type,
      ownerId: command.businessDate,
      ownerRevision: selectedDay.revision,
      businessDate: command.businessDate,
      activationSequence: null,
    });
  }

  const version = createRoutineVersion(
    sqlite,
    command.items,
    command.changeNote,
    timestamp,
    createId,
  );
  const sequence = latestActivationSequence(sqlite) + 1;
  const activation = createActivation(
    sqlite,
    version.id,
    null,
    command.businessDate,
    "manual-routine-update",
    sequence,
    timestamp,
    createId,
  );
  const authority = authorityFromActivation(activation);
  const affectedDays = sqlite.prepare(`
    select id, business_date, routine_activation_id, routine_version_id,
           recovery_cycle_id, revision
    from manual_skincare_days
    where business_date >= ?
    order by business_date asc
  `).all(command.businessDate) as DayRow[];
  const removed = affectedDays.flatMap((day) => removedUsedItems(sqlite, day, items));
  validateExactConfirmedRemovals(removed, command.confirmedRemovedUsedItemKeys);
  for (const day of affectedDays) {
    const rebuilt = rebuildDay(sqlite, day, authority, items, timestamp, createId);
    if (day.business_date === command.businessDate) selectedDay = rebuilt;
  }
  if (!selectedDay) {
    selectedDay = createDay(
      sqlite,
      command.businessDate,
      authority,
      items,
      timestamp,
      createId,
    );
  }
  return mutationResult(sqlite, command.businessDate, {
    operation: command.type,
    ownerId: command.businessDate,
    ownerRevision: selectedDay.revision,
    businessDate: command.businessDate,
    activationSequence: sequence,
  });
}

function setDayItemsUsed(
  sqlite: Database.Database,
  command: Extract<ManualSkincareCommand, { type: "set-day-items-used" }>,
  today: string,
  timestamp: string,
): ManualSkincareMutationResult {
  if (command.used && command.businessDate > today) {
    throw new ManualSkincareConflictError("Future products cannot be marked used.");
  }
  const day = requireExpectedDayRevision(
    sqlite,
    command.businessDate,
    command.expectedDayRevision,
  );
  if (!day) throw new ManualSkincareConflictError("The skincare day is not materialized.");
  const placeholders = command.itemKeys.map(() => "?").join(", ");
  const matched = sqlite.prepare(`
    select count(*) from manual_skincare_day_items
    where day_id = ? and item_key in (${placeholders})
  `).pluck().get(day.id, ...command.itemKeys) as number;
  if (matched !== command.itemKeys.length) throw new ManualSkincareConflictError();
  sqlite.prepare(`
    update manual_skincare_day_items
    set used = ?, used_at = ?
    where day_id = ? and item_key in (${placeholders})
  `).run(
    command.used ? 1 : 0,
    command.used ? timestamp : null,
    day.id,
    ...command.itemKeys,
  );
  sqlite.prepare(`
    update manual_skincare_days
    set revision = revision + 1, updated_at = ? where id = ?
  `).run(timestamp, day.id);
  return mutationResult(sqlite, command.businessDate, {
    operation: command.type,
    ownerId: command.businessDate,
    ownerRevision: day.revision + 1,
    businessDate: command.businessDate,
    activationSequence: null,
  });
}

function saveDayNote(
  sqlite: Database.Database,
  command: Extract<ManualSkincareCommand, { type: "save-day-note" }>,
  timestamp: string,
): ManualSkincareMutationResult {
  const day = requireExpectedDayRevision(
    sqlite,
    command.businessDate,
    command.expectedDayRevision,
  );
  if (!day) throw new ManualSkincareConflictError("The skincare day is not materialized.");
  const column = {
    morning: "morning_note",
    evening: "evening_note",
    overall: "overall_note",
  }[command.section];
  sqlite.prepare(`
    update manual_skincare_days
    set ${column} = ?, revision = revision + 1, updated_at = ?
    where id = ?
  `).run(command.note, timestamp, day.id);
  return mutationResult(sqlite, command.businessDate, {
    operation: command.type,
    ownerId: command.businessDate,
    ownerRevision: day.revision + 1,
    businessDate: command.businessDate,
    activationSequence: null,
  });
}

function saveRecoveryPlan(
  sqlite: Database.Database,
  command: Extract<ManualSkincareCommand, { type: "save-recovery-plan" }>,
  today: string,
  timestamp: string,
): ManualSkincareMutationResult {
  const plan = readPlan(sqlite, command.planId);
  if ((plan?.revision ?? 0) !== command.expectedPlanRevision) {
    throw new ManualSkincareConflictError();
  }
  const revision = (plan?.revision ?? 0) + 1;
  if (plan) {
    sqlite.prepare(`
      update manual_skincare_recovery_plans
      set name = ?, note = ?, revision = ?, updated_at = ? where id = ?
    `).run(command.name, command.note, revision, timestamp, command.planId);
  } else {
    sqlite.prepare(`
      insert into manual_skincare_recovery_plans
        (id, name, note, revision, created_at, updated_at)
      values (?, ?, ?, 1, ?, ?)
    `).run(command.planId, command.name, command.note, timestamp, timestamp);
  }
  return mutationResult(sqlite, today, {
    operation: command.type,
    ownerId: command.planId,
    ownerRevision: revision,
    businessDate: null,
    activationSequence: null,
  });
}

function saveRecoveryCycle(
  sqlite: Database.Database,
  command: Extract<ManualSkincareCommand, { type: "save-recovery-cycle" }>,
  today: string,
  timestamp: string,
  createId: (prefix: string) => string,
): ManualSkincareMutationResult {
  const plan = readPlan(sqlite, command.planId);
  if (!plan || plan.revision !== command.expectedPlanRevision) {
    throw new ManualSkincareConflictError();
  }
  const cycle = readCycle(sqlite, command.cycleId);
  if (
    (cycle?.revision ?? 0) !== command.expectedCycleRevision
    || (cycle && cycle.plan_id !== command.planId)
    || (cycle && cycle.status !== "draft")
  ) {
    throw new ManualSkincareConflictError();
  }
  if (latestRoutineRevision(sqlite) !== command.expectedRoutineRevision) {
    throw new ManualSkincareConflictError();
  }
  const routine = createRoutineVersion(
    sqlite,
    command.items,
    `recovery-cycle:${command.cycleId}`,
    timestamp,
    createId,
  );
  const expectedEndOn = command.durationDays === undefined
    ? command.expectedEndOn
    : addRecoveryCalendarDays(today, command.durationDays - 1);
  const revision = (cycle?.revision ?? 0) + 1;
  if (cycle) {
    sqlite.prepare(`
      update manual_skincare_recovery_cycles
      set ordinal = ?, name = ?, goal = ?, expected_end_on = ?,
          routine_version_id = ?, note = ?, revision = ?, updated_at = ?
      where id = ?
    `).run(
      command.ordinal,
      command.name,
      command.goal,
      expectedEndOn,
      routine.id,
      command.note,
      revision,
      timestamp,
      command.cycleId,
    );
  } else {
    sqlite.prepare(`
      insert into manual_skincare_recovery_cycles
        (id, plan_id, ordinal, name, goal, expected_end_on, routine_version_id,
         status, actual_started_on, actual_completed_on, note,
         revision, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, 'draft', null, null, ?, 1, ?, ?)
    `).run(
      command.cycleId,
      command.planId,
      command.ordinal,
      command.name,
      command.goal,
      expectedEndOn,
      routine.id,
      command.note,
      timestamp,
      timestamp,
    );
  }
  sqlite.prepare(`
    update manual_skincare_recovery_plans
    set revision = revision + 1, updated_at = ? where id = ?
  `).run(timestamp, command.planId);
  return mutationResult(sqlite, today, {
    operation: command.type,
    ownerId: command.cycleId,
    ownerRevision: revision,
    businessDate: null,
    activationSequence: null,
  });
}

function startRecoveryCycle(
  sqlite: Database.Database,
  command: Extract<ManualSkincareCommand, { type: "start-recovery-cycle" }>,
  today: string,
  timestamp: string,
  createId: (prefix: string) => string,
): ManualSkincareMutationResult {
  if (command.effectiveFrom !== today && command.effectiveFrom !== addOneBusinessDay(today)) {
    throw new ManualSkincareConflictError(
      "A recovery cycle can start only today or tomorrow.",
    );
  }
  const plan = readPlan(sqlite, command.planId);
  const cycle = readCycle(sqlite, command.cycleId);
  if (
    !plan
    || plan.revision !== command.expectedPlanRevision
    || !cycle
    || cycle.plan_id !== command.planId
    || cycle.revision !== command.expectedCycleRevision
    || cycle.status !== "draft"
  ) {
    throw new ManualSkincareConflictError();
  }
  if (sqlite.prepare(`
    select count(*) from manual_skincare_routine_activations
    where recovery_cycle_id = ?
  `).pluck().get(cycle.id) !== 0) {
    throw new ManualSkincareConflictError("This recovery cycle was already started.");
  }
  const active = readActiveCycle(sqlite);
  if (
    (active?.id ?? null) !== command.expectedCurrentCycleId
    || (active?.revision ?? 0) !== command.expectedCurrentCycleRevision
  ) {
    throw new ManualSkincareConflictError();
  }
  const currentSequence = latestActivationSequence(sqlite);
  if (currentSequence !== command.expectedActivationSequence) {
    throw new ManualSkincareConflictError();
  }
  let effectiveDay = requireExpectedDayRevision(
    sqlite,
    command.effectiveFrom,
    command.expectedDayRevision,
  );
  const items = readVersionItems(sqlite, cycle.routine_version_id);
  const affectedDays = sqlite.prepare(`
    select id, business_date, routine_activation_id, routine_version_id,
           recovery_cycle_id, revision
    from manual_skincare_days
    where business_date >= ?
    order by business_date asc
  `).all(command.effectiveFrom) as DayRow[];
  const removed = affectedDays.flatMap((day) => removedUsedItems(sqlite, day, items));
  validateExactConfirmedRemovals(removed, command.confirmedRemovedUsedItemKeys);

  if (active) {
    if (!active.actual_started_on || command.effectiveFrom < active.actual_started_on) {
      throw new ManualSkincareConflictError("The active cycle cannot close before it started.");
    }
    sqlite.prepare(`
      update manual_skincare_recovery_cycles
      set status = 'completed', actual_completed_on = ?, revision = revision + 1,
          updated_at = ? where id = ?
    `).run(command.effectiveFrom, timestamp, active.id);
  }
  const cycleRevision = cycle.revision + 1;
  const expectedEndOn = addRecoveryCalendarDays(
    command.effectiveFrom,
    storedCycleDurationDays(cycle) - 1,
  );
  sqlite.prepare(`
    update manual_skincare_recovery_cycles
    set status = 'active', actual_started_on = ?, actual_completed_on = null,
        expected_end_on = ?, revision = ?, updated_at = ? where id = ?
  `).run(command.effectiveFrom, expectedEndOn, cycleRevision, timestamp, cycle.id);
  const sequence = currentSequence + 1;
  const activation = createActivation(
    sqlite,
    cycle.routine_version_id,
    cycle.id,
    command.effectiveFrom,
    "recovery-cycle-start",
    sequence,
    timestamp,
    createId,
  );
  const authority = authorityFromActivation(activation);
  for (const day of affectedDays) {
    const rebuilt = rebuildDay(sqlite, day, authority, items, timestamp, createId);
    if (day.business_date === command.effectiveFrom) effectiveDay = rebuilt;
  }
  if (!effectiveDay) {
    effectiveDay = createDay(
      sqlite,
      command.effectiveFrom,
      authority,
      items,
      timestamp,
      createId,
    );
  }
  return mutationResult(sqlite, command.effectiveFrom, {
    operation: command.type,
    ownerId: command.cycleId,
    ownerRevision: cycleRevision,
    businessDate: command.effectiveFrom,
    activationSequence: sequence,
  });
}

function completeRecoveryCycle(
  sqlite: Database.Database,
  command: Extract<ManualSkincareCommand, { type: "complete-recovery-cycle" }>,
  timestamp: string,
): ManualSkincareMutationResult {
  const cycle = readCycle(sqlite, command.cycleId);
  if (
    !cycle
    || cycle.revision !== command.expectedCycleRevision
    || cycle.status !== "active"
    || !cycle.actual_started_on
    || command.completedOn < cycle.actual_started_on
  ) {
    throw new ManualSkincareConflictError();
  }
  const revision = cycle.revision + 1;
  sqlite.prepare(`
    update manual_skincare_recovery_cycles
    set status = 'completed', actual_completed_on = ?, revision = ?, updated_at = ?
    where id = ?
  `).run(command.completedOn, revision, timestamp, cycle.id);
  return mutationResult(sqlite, command.completedOn, {
    operation: command.type,
    ownerId: command.cycleId,
    ownerRevision: revision,
    businessDate: command.completedOn,
    activationSequence: null,
  });
}

function executeCommand(
  sqlite: Database.Database,
  command: ManualSkincareCommand,
  now: Date,
  createId: (prefix: string) => string,
): ManualSkincareMutationResult {
  if (!Number.isFinite(now.getTime())) throw new TypeError("Invalid current time.");
  const timestamp = now.toISOString();
  const today = toShanghaiBusinessDate(now);
  switch (command.type) {
    case "save-product":
      return saveProduct(sqlite, command, today, timestamp);
    case "replace-routine":
      return replaceRoutine(sqlite, command, today, timestamp, createId);
    case "set-day-items-used":
      return setDayItemsUsed(sqlite, command, today, timestamp);
    case "save-day-note":
      return saveDayNote(sqlite, command, timestamp);
    case "save-recovery-plan":
      return saveRecoveryPlan(sqlite, command, today, timestamp);
    case "save-recovery-cycle":
      return saveRecoveryCycle(sqlite, command, today, timestamp, createId);
    case "start-recovery-cycle":
      return startRecoveryCycle(sqlite, command, today, timestamp, createId);
    case "complete-recovery-cycle":
      return completeRecoveryCycle(sqlite, command, timestamp);
  }
}

export async function materializeManualSkincareDay(
  sqlite: Database.Database,
  businessDate: string,
  options: ManualSkincareServiceOptions = {},
): Promise<ReturnType<typeof getManualSkincareSnapshot>> {
  if (!isBusinessDate(businessDate)) {
    throw new TypeError("Invalid manual skincare business date.");
  }
  if (readDay(sqlite, businessDate)) {
    return getManualSkincareSnapshot(sqlite, { businessDate });
  }
  const now = nowFactory(options);
  const createId = idFactory(options);
  const selected = selectActivation(sqlite, businessDate);
  const selectedSequence = selected?.activation_sequence ?? 0;
  return runIdempotentCommand(
    sqlite,
    {
      operation: "manual-skincare.materialize",
      idempotencyKey: `manual-skincare-materialize-${businessDate}-a${selectedSequence}`,
      now,
      writeBarrier: options.writeBarrier,
    },
    { type: "materialize-manual-skincare-day", businessDate, selectedSequence },
    () => {
      if (!readDay(sqlite, businessDate)) {
        const racedSelection = selectActivation(sqlite, businessDate);
        if ((racedSelection?.activation_sequence ?? 0) !== selectedSequence) {
          throw new ManualSkincareConflictError();
        }
        const timestamp = now().toISOString();
        const items = racedSelection
          ? readVersionItems(sqlite, racedSelection.routine_version_id)
          : [];
        createDay(
          sqlite,
          businessDate,
          authorityFromActivation(racedSelection),
          items,
          timestamp,
          createId,
        );
      }
      return getManualSkincareSnapshot(sqlite, { businessDate });
    },
  );
}

export function createManualSkincareService(
  dependencies: ManualSkincareServiceOptions & { sqlite: Database.Database },
): ManualSkincareService {
  const { sqlite } = dependencies;
  const now = nowFactory(dependencies);
  const createId = idFactory(dependencies);
  return {
    execute(command, idempotencyKey) {
      return runIdempotentCommand(
        sqlite,
        {
          operation: "manual-skincare.command",
          idempotencyKey,
          now,
          writeBarrier: dependencies.writeBarrier,
        },
        command,
        () => executeCommand(
          sqlite,
          parseManualSkincareCommand(command),
          now(),
          createId,
        ),
      );
    },
  };
}

export { ManualSkincareValidationError } from "./contracts";
