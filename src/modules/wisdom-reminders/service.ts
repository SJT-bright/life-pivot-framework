import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import {
  type IdempotentCommandOptions,
  runIdempotentCommand,
} from "@/core/db/idempotent-command";

import type {
  ArchiveWisdomReminderCommand,
  CreateWisdomReminderCommand,
  UpdateWisdomReminderCommand,
  WisdomReminder,
  WisdomReminderCommand,
} from "./contracts";
import { parseWisdomReminderCommand } from "./contracts";
import { getWisdomReminder } from "./query";

export class WisdomReminderConflictError extends Error {
  constructor(message = "The wisdom reminder conflicts with current state.") {
    super(message);
    this.name = "WisdomReminderConflictError";
  }
}

export interface WisdomReminderServiceOptions {
  now?: () => Date;
  createId?: () => string;
  writeBarrier?: IdempotentCommandOptions["writeBarrier"];
}

export interface WisdomReminderService {
  execute(command: unknown, idempotencyKey: string): Promise<WisdomReminder>;
}

function conflict(message: string): never {
  throw new WisdomReminderConflictError(message);
}

function insertAudit(
  sqlite: Database.Database,
  reminder: WisdomReminder,
  eventType: "created" | "updated" | "archived",
  createId: () => string,
  timestamp: string,
): void {
  sqlite.prepare(`insert into audit_events
    (id, event_type, resource_type, resource_id, payload_json, occurred_at)
    values (?, ?, 'wisdom_reminder', ?, ?, ?)`)
    .run(createId(), eventType, reminder.id, JSON.stringify(reminder), timestamp);
}

function applyCommand(
  sqlite: Database.Database,
  command: WisdomReminderCommand,
  timestamp: string,
  createId: () => string,
): WisdomReminder {
  if (command.type === "create-wisdom-reminder") {
    const create = command as CreateWisdomReminderCommand;
    if (sqlite.prepare("select 1 from wisdom_reminders where id = ?").get(create.reminderId)) {
      conflict("The wisdom reminder identifier is already in use.");
    }
    sqlite.prepare(`insert into wisdom_reminders
      (id, content, context, archived_at, revision, created_at, updated_at)
      values (?, ?, ?, null, 1, ?, ?)`)
      .run(create.reminderId, create.content, create.context, timestamp, timestamp);
    const created = getWisdomReminder(sqlite, create.reminderId)!;
    insertAudit(sqlite, created, "created", createId, timestamp);
    return created;
  }

  const current = getWisdomReminder(sqlite, command.reminderId);
  if (!current || current.archivedAt !== null) {
    conflict("The wisdom reminder does not exist.");
  }

  if (command.type === "archive-wisdom-reminder") {
    const archive = command as ArchiveWisdomReminderCommand;
    if (current.revision !== archive.expectedRevision) conflict("The wisdom reminder revision is stale.");
    const nextRevision = current.revision + 1;
    const result = sqlite.prepare(`update wisdom_reminders
      set archived_at = ?, revision = ?, updated_at = ?
      where id = ? and revision = ?`)
      .run(timestamp, nextRevision, timestamp, current.id, current.revision);
    if (result.changes !== 1) conflict("The wisdom reminder revision is stale.");
  } else {
    const update = command as UpdateWisdomReminderCommand;
    if (current.revision !== update.expectedRevision) conflict("The wisdom reminder revision is stale.");
    const nextRevision = current.revision + 1;
    const result = sqlite.prepare(`update wisdom_reminders
      set content = ?, context = ?, revision = ?, updated_at = ?
      where id = ? and revision = ?`)
      .run(update.content, update.context, nextRevision, timestamp, current.id, current.revision);
    if (result.changes !== 1) conflict("The wisdom reminder revision is stale.");
  }
  const updated = getWisdomReminder(sqlite, command.reminderId)!;
  insertAudit(sqlite, updated, command.type === "archive-wisdom-reminder" ? "archived" : "updated", createId, timestamp);
  return updated;
}

export function createWisdomReminderService(
  sqlite: Database.Database,
  options: WisdomReminderServiceOptions = {},
): WisdomReminderService {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? randomUUID;
  return {
    async execute(rawCommand, idempotencyKey) {
      let transactionNow: Date | undefined;
      const stableNow = () => {
        transactionNow ??= now();
        return transactionNow;
      };
      return runIdempotentCommand(
        sqlite,
        {
          operation: "wisdom-reminders.command",
          idempotencyKey,
          now: stableNow,
          writeBarrier: options.writeBarrier,
        },
        rawCommand,
        () => {
          const command = parseWisdomReminderCommand(rawCommand);
          return applyCommand(sqlite, command, stableNow().toISOString(), createId);
        },
      );
    },
  };
}
