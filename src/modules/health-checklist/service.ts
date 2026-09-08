import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";
import { ZodError } from "zod";

import type { WriteBarrier } from "@/core/backup/write-barrier";
import { runIdempotentCommand } from "@/core/db/idempotent-command";
import { toHealthChecklistBusinessDate } from "@/core/time/business-date";

import {
  type HealthChecklistCommand,
  type HealthChecklistDay,
  type HealthChecklistItemInput,
  parseHealthChecklistCommand,
} from "./contracts";
import { getHealthChecklistDay } from "./query";

type WriteBarrierLike = Pick<WriteBarrier, "runWrite">;

export class HealthChecklistValidationError extends Error {
  constructor() {
    super("Invalid health checklist command.");
    this.name = "HealthChecklistValidationError";
  }
}

export class HealthChecklistConflictError extends Error {
  constructor(message = "The health checklist changed. Reload before editing again.") {
    super(message);
    this.name = "HealthChecklistConflictError";
  }
}

export interface HealthChecklistServiceOptions {
  now?: () => Date;
  createId?: (prefix: string) => string;
  writeBarrier?: WriteBarrierLike;
}

export interface HealthChecklistService {
  execute(command: unknown, idempotencyKey: string): Promise<HealthChecklistDay>;
}

interface TemplateRow {
  id: string;
  name: string;
  current_revision: number;
}

interface VersionRow {
  id: string;
  template_id: string;
  revision: number;
}

interface MutableDayRow {
  id: string;
  business_date: string;
  template_version_id: string;
  revision: number;
}

interface MutableItemRow {
  id: string;
  item_key: string;
  completed: number;
  completed_at: string | null;
}

function idFactory(options: HealthChecklistServiceOptions) {
  return options.createId ?? ((prefix: string) => `${prefix}-${randomUUID()}`);
}

function nowFactory(options: HealthChecklistServiceOptions) {
  return options.now ?? (() => new Date());
}

function readTemplate(sqlite: Database.Database, templateId = "health-default"): TemplateRow | undefined {
  return sqlite.prepare(`
    select id, name, current_revision
    from health_checklist_templates
    where id = ?
  `).get(templateId) as TemplateRow | undefined;
}

function selectVersion(
  sqlite: Database.Database,
  templateId: string,
  businessDate: string,
): VersionRow | undefined {
  return sqlite.prepare(`
    select id, template_id, revision
    from health_checklist_versions
    where template_id = ? and effective_from <= ?
    order by effective_from desc, revision desc
    limit 1
  `).get(templateId, businessDate) as VersionRow | undefined;
}

function readVersionItems(sqlite: Database.Database, versionId: string): HealthChecklistItemInput[] {
  return sqlite.prepare(`
    select item_key as itemKey, group_key as groupKey, group_label as groupLabel,
           name, target_text as targetText, note, ordinal
    from health_checklist_template_items
    where template_version_id = ?
    order by ordinal asc
  `).all(versionId) as HealthChecklistItemInput[];
}

function ensureDefaultTemplate(
  sqlite: Database.Database,
  timestamp: string,
  createId: (prefix: string) => string,
): { template: TemplateRow; version: VersionRow } {
  let template = readTemplate(sqlite);
  if (!template) {
    sqlite.prepare(`
      insert into health_checklist_templates
        (id, name, current_revision, created_at, updated_at)
      values ('health-default', '我的健康清单', 1, ?, ?)
    `).run(timestamp, timestamp);
    const versionId = createId("health-version");
    sqlite.prepare(`
      insert into health_checklist_versions
        (id, template_id, revision, effective_from, change_note, created_at)
      values (?, 'health-default', 1, '1970-01-01', '', ?)
    `).run(versionId, timestamp);
    template = readTemplate(sqlite)!;
  }
  const version = selectVersion(sqlite, template.id, "9999-12-31");
  if (!version) throw new HealthChecklistConflictError("The health checklist template is incomplete.");
  return { template, version };
}

function insertTemplateItems(
  sqlite: Database.Database,
  versionId: string,
  items: readonly HealthChecklistItemInput[],
  createId: (prefix: string) => string,
): void {
  const insert = sqlite.prepare(`
    insert into health_checklist_template_items
      (id, template_version_id, item_key, group_key, group_label, name,
       target_text, note, ordinal)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const item of items) {
    insert.run(
      createId("health-template-item"), versionId, item.itemKey, item.groupKey,
      item.groupLabel, item.name, item.targetText, item.note, item.ordinal,
    );
  }
}

function createDay(
  sqlite: Database.Database,
  businessDate: string,
  version: VersionRow,
  items: readonly HealthChecklistItemInput[],
  timestamp: string,
  createId: (prefix: string) => string,
): string {
  const dayId = createId("health-day");
  sqlite.prepare(`
    insert into health_checklist_days
      (id, business_date, template_version_id, note, revision, created_at, updated_at)
    values (?, ?, ?, '', 1, ?, ?)
  `).run(dayId, businessDate, version.id, timestamp, timestamp);
  insertDayItems(sqlite, dayId, items, new Map(), createId);
  return dayId;
}

function insertDayItems(
  sqlite: Database.Database,
  dayId: string,
  items: readonly HealthChecklistItemInput[],
  previous: ReadonlyMap<string, MutableItemRow>,
  createId: (prefix: string) => string,
): void {
  const insert = sqlite.prepare(`
    insert into health_checklist_day_items
      (id, day_id, item_key, group_key, group_label, name, target_text, note,
       ordinal, completed, completed_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const item of items) {
    const old = previous.get(item.itemKey);
    insert.run(
      old?.id ?? createId("health-day-item"), dayId, item.itemKey, item.groupKey,
      item.groupLabel, item.name, item.targetText, item.note, item.ordinal,
      old?.completed ?? 0, old?.completed_at ?? null,
    );
  }
}

function readMutableDay(sqlite: Database.Database, businessDate: string): MutableDayRow | undefined {
  return sqlite.prepare(`
    select id, business_date, template_version_id, revision
    from health_checklist_days where business_date = ?
  `).get(businessDate) as MutableDayRow | undefined;
}

function readMutableItems(sqlite: Database.Database, dayId: string): MutableItemRow[] {
  return sqlite.prepare(`
    select id, item_key, completed, completed_at
    from health_checklist_day_items where day_id = ?
  `).all(dayId) as MutableItemRow[];
}

function findRemovedCompleted(
  previousItems: readonly MutableItemRow[],
  nextItems: readonly HealthChecklistItemInput[],
): MutableItemRow[] {
  const nextKeys = new Set(nextItems.map((item) => item.itemKey));
  return previousItems.filter(
    (item) => item.completed === 1 && !nextKeys.has(item.item_key),
  );
}

function validateConfirmedRemovals(
  removedCompleted: readonly MutableItemRow[],
  confirmedKeys: readonly string[],
): void {
  const required = new Set(removedCompleted.map((item) => item.item_key));
  const confirmed = new Set(confirmedKeys);
  if (
    required.size !== confirmed.size ||
    [...required].some((key) => !confirmed.has(key))
  ) {
    throw new HealthChecklistConflictError("Completed item removal needs explicit confirmation.");
  }
}

function rebuildDay(
  sqlite: Database.Database,
  day: MutableDayRow,
  versionId: string,
  items: readonly HealthChecklistItemInput[],
  confirmedKeys: readonly string[],
  timestamp: string,
  createId: (prefix: string) => string,
  confirmationsPrevalidated = false,
): void {
  const previousItems = readMutableItems(sqlite, day.id);
  const removedCompleted = findRemovedCompleted(previousItems, items);
  if (!confirmationsPrevalidated) {
    validateConfirmedRemovals(removedCompleted, confirmedKeys);
  }
  for (const removed of removedCompleted) {
    sqlite.prepare(`
      insert into audit_events
        (id, event_type, resource_type, resource_id, payload_json, occurred_at)
      values (?, 'health-checklist.completed-item-removed', 'health-checklist-day', ?, ?, ?)
    `).run(
      createId("health-audit"), day.id,
      JSON.stringify({ businessDate: day.business_date, itemKey: removed.item_key }),
      timestamp,
    );
  }
  const previous = new Map(previousItems.map((item) => [item.item_key, item]));
  sqlite.prepare("delete from health_checklist_day_items where day_id = ?").run(day.id);
  insertDayItems(sqlite, day.id, items, previous, createId);
  sqlite.prepare(`
    update health_checklist_days
    set template_version_id = ?, revision = revision + 1, updated_at = ?
    where id = ?
  `).run(versionId, timestamp, day.id);
}

function requireCurrentDay(
  sqlite: Database.Database,
  businessDate: string,
  expectedRevision: number,
): MutableDayRow {
  const day = readMutableDay(sqlite, businessDate);
  if (!day || day.revision !== expectedRevision) throw new HealthChecklistConflictError();
  return day;
}

function replaceChecklist(
  sqlite: Database.Database,
  command: Extract<HealthChecklistCommand, { type: "replace-health-checklist" }>,
  timestamp: string,
  createId: (prefix: string) => string,
): HealthChecklistDay {
  let state = readTemplate(sqlite, command.templateId);
  if (!state && command.templateId === "health-default" && command.expectedTemplateRevision === 0) {
    state = ensureDefaultTemplate(sqlite, timestamp, createId).template;
  }
  if (!state || state.current_revision !== command.expectedTemplateRevision) {
    throw new HealthChecklistConflictError();
  }
  const existingDay = readMutableDay(sqlite, command.businessDate);
  if (
    (existingDay && existingDay.revision !== command.expectedDayRevision) ||
    (!existingDay && command.expectedDayRevision !== 0)
  ) throw new HealthChecklistConflictError();

  const persistentKeys = new Set(command.templateItemKeys ?? command.items.map((item) => item.itemKey));
  const templateItems = command.items.filter((item) => persistentKeys.has(item.itemKey));

  let version = selectVersion(sqlite, state.id, command.businessDate);
  if (!version) throw new HealthChecklistConflictError("No template applies to this date.");
  if (command.scope === "today-and-future") {
    const nextRevision = state.current_revision + 1;
    const versionId = createId("health-version");
    sqlite.prepare(`
      insert into health_checklist_versions
        (id, template_id, revision, effective_from, change_note, created_at)
      values (?, ?, ?, ?, ?, ?)
    `).run(versionId, state.id, nextRevision, command.businessDate, command.changeNote, timestamp);
    insertTemplateItems(sqlite, versionId, templateItems, createId);
    sqlite.prepare(`
      update health_checklist_templates
      set name = ?, current_revision = ?, updated_at = ? where id = ?
    `).run(command.name, nextRevision, timestamp, state.id);
    version = { id: versionId, template_id: state.id, revision: nextRevision };
  }

  if (command.scope === "today-and-future") {
    const affectedDays = sqlite.prepare(`
      select id, business_date, template_version_id, revision
      from health_checklist_days
      where business_date >= ?
      order by business_date asc
    `).all(command.businessDate) as MutableDayRow[];
    const removedCompleted = affectedDays.flatMap((day) =>
      findRemovedCompleted(
        readMutableItems(sqlite, day.id),
        // 指定日期保留手动添加的今日任务，之后的日期只跟随常驻模板。
        day.business_date === command.businessDate ? command.items : templateItems,
      ));
    validateConfirmedRemovals(removedCompleted, command.confirmedRemovedCompletedItemKeys);
    for (const affectedDay of affectedDays) {
      rebuildDay(
        sqlite, affectedDay, version.id,
        affectedDay.business_date === command.businessDate ? command.items : templateItems,
        command.confirmedRemovedCompletedItemKeys, timestamp, createId, true,
      );
    }
    if (!existingDay) {
      createDay(sqlite, command.businessDate, version, command.items, timestamp, createId);
    }
  } else if (existingDay) {
    rebuildDay(
      sqlite, existingDay, version.id, command.items,
      command.confirmedRemovedCompletedItemKeys, timestamp, createId,
    );
  } else {
    validateConfirmedRemovals([], command.confirmedRemovedCompletedItemKeys);
    createDay(sqlite, command.businessDate, version, command.items, timestamp, createId);
  }
  return getHealthChecklistDay(sqlite, { businessDate: command.businessDate })!;
}

function setItems(
  sqlite: Database.Database,
  command: Extract<HealthChecklistCommand, { type: "set-health-checklist-items" }>,
  timestamp: string,
  today: string,
): HealthChecklistDay {
  if (command.completed && command.itemKeys.length > 1 && command.businessDate > today) {
    throw new HealthChecklistConflictError("Future dates cannot be completed in bulk.");
  }
  const day = requireCurrentDay(sqlite, command.businessDate, command.expectedDayRevision);
  const placeholders = command.itemKeys.map(() => "?").join(", ");
  const count = sqlite.prepare(`
    select count(*) from health_checklist_day_items
    where day_id = ? and item_key in (${placeholders})
  `).pluck().get(day.id, ...command.itemKeys) as number;
  if (count !== command.itemKeys.length) throw new HealthChecklistConflictError();
  sqlite.prepare(`
    update health_checklist_day_items
    set completed = ?, completed_at = ?
    where day_id = ? and item_key in (${placeholders})
  `).run(command.completed ? 1 : 0, command.completed ? timestamp : null, day.id, ...command.itemKeys);
  sqlite.prepare(`
    update health_checklist_days set revision = revision + 1, updated_at = ? where id = ?
  `).run(timestamp, day.id);
  return getHealthChecklistDay(sqlite, { businessDate: command.businessDate })!;
}

function saveNote(
  sqlite: Database.Database,
  command: Extract<HealthChecklistCommand, { type: "save-health-checklist-note" }>,
  timestamp: string,
): HealthChecklistDay {
  const day = requireCurrentDay(sqlite, command.businessDate, command.expectedDayRevision);
  sqlite.prepare(`
    update health_checklist_days
    set note = ?, revision = revision + 1, updated_at = ? where id = ?
  `).run(command.note, timestamp, day.id);
  return getHealthChecklistDay(sqlite, { businessDate: command.businessDate })!;
}

export async function materializeHealthChecklistDay(
  sqlite: Database.Database,
  businessDate: string,
  options: HealthChecklistServiceOptions = {},
): Promise<HealthChecklistDay> {
  const existing = getHealthChecklistDay(sqlite, { businessDate });
  if (existing) return existing;
  const now = nowFactory(options);
  const createId = idFactory(options);
  const template = readTemplate(sqlite);
  const selected = template ? selectVersion(sqlite, template.id, businessDate) : undefined;
  const selectedRevision = selected?.revision ?? 1;
  return runIdempotentCommand(
    sqlite,
    {
      operation: "health-checklist.materialize",
      idempotencyKey: `health-materialize-${businessDate}-r${selectedRevision}`,
      now,
      writeBarrier: options.writeBarrier,
    },
    { type: "materialize-health-checklist-day", businessDate, selectedRevision },
    () => {
      const raced = getHealthChecklistDay(sqlite, { businessDate });
      if (raced) return raced;
      const timestamp = now().toISOString();
      const state = ensureDefaultTemplate(sqlite, timestamp, createId);
      const version = selectVersion(sqlite, state.template.id, businessDate);
      if (!version) throw new HealthChecklistConflictError("No template applies to this date.");
      createDay(
        sqlite, businessDate, version, readVersionItems(sqlite, version.id), timestamp, createId,
      );
      return getHealthChecklistDay(sqlite, { businessDate })!;
    },
  );
}

export function createHealthChecklistService(
  sqlite: Database.Database,
  options: HealthChecklistServiceOptions = {},
): HealthChecklistService {
  const now = nowFactory(options);
  const createId = idFactory(options);
  return {
    async execute(value, idempotencyKey) {
      let command: HealthChecklistCommand;
      try {
        command = parseHealthChecklistCommand(value);
      } catch (error) {
        if (error instanceof ZodError) throw new HealthChecklistValidationError();
        throw error;
      }
      return runIdempotentCommand(
        sqlite,
        {
          operation: "health-checklist.command",
          idempotencyKey,
          now,
          writeBarrier: options.writeBarrier,
        },
        command,
        () => {
          const timestamp = now().toISOString();
          switch (command.type) {
            case "replace-health-checklist":
              return replaceChecklist(sqlite, command, timestamp, createId);
            case "set-health-checklist-items":
              return setItems(sqlite, command, timestamp, toHealthChecklistBusinessDate(now()));
            case "save-health-checklist-note":
              return saveNote(sqlite, command, timestamp);
          }
        },
      );
    },
  };
}
