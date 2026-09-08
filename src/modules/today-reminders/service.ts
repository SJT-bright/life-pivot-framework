import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import {
  type IdempotentCommandOptions,
  runIdempotentCommand,
} from "@/core/db/idempotent-command";
import { toShanghaiBusinessDate } from "@/core/time/business-date";

import type {
  TodayReminder,
  TodayReminderCommand,
  TodayReminderCommandResult,
} from "./contracts";
import { getTodayReminder } from "./query";

export class TodayReminderConflictError extends Error {
  constructor(message = "The reminder no longer matches the current state.") {
    super(message);
    this.name = "TodayReminderConflictError";
  }
}

export interface TodayRemindersServiceDependencies {
  now?: () => Date;
  createId?: () => string;
  writeBarrier?: IdempotentCommandOptions["writeBarrier"];
}

export interface TodayRemindersService {
  execute(command: TodayReminderCommand, idempotencyKey: string): Promise<TodayReminderCommandResult>;
}

function conflict(message: string): never {
  throw new TodayReminderConflictError(message);
}

function insertAudit(
  sqlite: Database.Database,
  reminder: TodayReminder,
  eventType: "created" | "completed" | "reopened" | "alerted" | "updated" | "deleted" | "rescheduled",
  createId: () => string,
  occurredAt = reminder.updatedAt,
): void {
  sqlite.prepare(`insert into audit_events
    (id, event_type, resource_type, resource_id, payload_json, occurred_at)
    values (?, ?, 'today_reminder', ?, ?, ?)`)
    .run(createId(), eventType, reminder.id, JSON.stringify(reminder), occurredAt);
}

function toShanghaiClockTime(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).formatToParts(value);
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  if (!hour || !minute) throw new Error("Unable to resolve the Shanghai clock time.");
  return `${hour}:${minute}`;
}

function applyCommand(
  sqlite: Database.Database,
  command: TodayReminderCommand,
  timestamp: string,
  createId: () => string,
): TodayReminderCommandResult {
  if (command.type === "add-today-reminder") {
    if (getTodayReminder(sqlite, command.reminderId)) conflict("The reminder identifier is in use.");
    sqlite.prepare(`insert into today_reminders
      (id, business_date, title, scheduled_time, completed, completed_at,
       revision, created_at, updated_at)
      values (?, ?, ?, ?, 0, null, 1, ?, ?)`)
      .run(
        command.reminderId,
        command.businessDate,
        command.title,
        command.scheduledTime,
        timestamp,
        timestamp,
      );
    const created = getTodayReminder(sqlite, command.reminderId)!;
    insertAudit(sqlite, created, "created", createId);
    return { reminder: created };
  }

  if (
    command.type === "update-today-reminder"
    || command.type === "delete-today-reminder"
    || command.type === "reschedule-today-reminder"
  ) {
    return applyEditingCommand(sqlite, command, timestamp, createId);
  }

  const current = getTodayReminder(sqlite, command.reminderId);
  if (!current) conflict("The reminder does not exist.");
  if (current.revision !== command.expectedRevision) conflict("The reminder revision is stale.");

  if (command.type === "claim-today-reminder-alert") {
    if (
      current.alertedAt !== null
      || current.completed
      || current.scheduledTime === null
      || current.businessDate !== toShanghaiBusinessDate(new Date(timestamp))
      || current.scheduledTime > toShanghaiClockTime(new Date(timestamp))
    ) {
      return { reminder: current, alertClaimed: false };
    }
    insertAudit(sqlite, current, "alerted", createId, timestamp);
    return {
      reminder: getTodayReminder(sqlite, current.id)!,
      alertClaimed: true,
    };
  }

  if (current.completed === command.completed) return { reminder: current };
  if (!Number.isSafeInteger(current.revision) || current.revision >= Number.MAX_SAFE_INTEGER) {
    conflict("The reminder revision cannot be incremented safely.");
  }
  const nextRevision = current.revision + 1;
  const result = sqlite.prepare(`update today_reminders
    set completed = ?, completed_at = ?, revision = ?, updated_at = ?
    where id = ? and revision = ?`)
    .run(
      command.completed ? 1 : 0,
      command.completed ? timestamp : null,
      nextRevision,
      timestamp,
      current.id,
      current.revision,
    );
  if (result.changes !== 1) conflict("The reminder revision is stale.");
  const updated = getTodayReminder(sqlite, current.id)!;
  insertAudit(sqlite, updated, command.completed ? "completed" : "reopened", createId);
  return { reminder: updated };
}

function requireFreshRevision(current: TodayReminder, expectedRevision: number): number {
  if (current.revision !== expectedRevision) conflict("The reminder revision is stale.");
  if (!Number.isSafeInteger(current.revision) || current.revision >= Number.MAX_SAFE_INTEGER) {
    conflict("The reminder revision cannot be incremented safely.");
  }
  return current.revision + 1;
}

function applyEditingCommand(
  sqlite: Database.Database,
  command: TodayReminderCommand,
  timestamp: string,
  createId: () => string,
): TodayReminderCommandResult {
  const current = getTodayReminder(sqlite, command.reminderId);
  if (!current) conflict("The reminder does not exist.");

  if (command.type === "update-today-reminder") {
    const nextRevision = requireFreshRevision(current, command.expectedRevision);
    const result = sqlite.prepare(`update today_reminders
      set title = ?, scheduled_time = ?, revision = ?, updated_at = ?
      where id = ? and revision = ?`)
      .run(
        command.title,
        command.scheduledTime,
        nextRevision,
        timestamp,
        current.id,
        current.revision,
      );
    if (result.changes !== 1) conflict("The reminder revision is stale.");
    const updated = getTodayReminder(sqlite, current.id)!;
    insertAudit(sqlite, updated, "updated", createId, timestamp);
    return { reminder: updated };
  }

  if (command.type === "delete-today-reminder") {
    requireFreshRevision(current, command.expectedRevision);
    const result = sqlite.prepare(`delete from today_reminders
      where id = ? and revision = ?`)
      .run(current.id, current.revision);
    if (result.changes !== 1) conflict("The reminder revision is stale.");
    insertAudit(sqlite, current, "deleted", createId, timestamp);
    return { reminder: current };
  }

  if (command.type === "reschedule-today-reminder") {
    if (command.toBusinessDate === current.businessDate) {
      conflict("The reminder is already on that date.");
    }
    const nextRevision = requireFreshRevision(current, command.expectedRevision);
    const movedId = `${current.id}-moved-${command.toBusinessDate}`;
    if (getTodayReminder(sqlite, movedId)) conflict("The reminder identifier is in use.");
    sqlite.prepare(`insert into today_reminders
      (id, business_date, title, scheduled_time, completed, completed_at,
       revision, created_at, updated_at)
      values (?, ?, ?, ?, 0, null, 1, ?, ?)`)
      .run(
        movedId,
        command.toBusinessDate,
        current.title,
        current.scheduledTime,
        timestamp,
        timestamp,
      );
    const moved = getTodayReminder(sqlite, movedId)!;
    const result = sqlite.prepare(`update today_reminders
      set completed = 1, completed_at = ?, revision = ?, updated_at = ?
      where id = ? and revision = ?`)
      .run(timestamp, nextRevision, timestamp, current.id, current.revision);
    if (result.changes !== 1) conflict("The reminder revision is stale.");
    const updated = getTodayReminder(sqlite, current.id)!;
    insertAudit(sqlite, current, "rescheduled", createId, timestamp);
    return { reminder: updated, createdReminder: moved };
  }

  return { reminder: current };
}

export function createTodayRemindersService(
  sqlite: Database.Database,
  dependencies: TodayRemindersServiceDependencies = {},
): TodayRemindersService {
  const now = dependencies.now ?? (() => new Date());
  const createId = dependencies.createId ?? randomUUID;
  return {
    async execute(command, idempotencyKey) {
      let transactionNow: Date | undefined;
      const stableNow = () => {
        transactionNow ??= now();
        return transactionNow;
      };
      return runIdempotentCommand(
        sqlite,
        {
          operation: "today-reminders.command",
          idempotencyKey,
          now: stableNow,
          writeBarrier: dependencies.writeBarrier,
        },
        command,
        () => applyCommand(sqlite, command, stableNow().toISOString(), createId),
      );
    },
  };
}
