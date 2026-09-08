import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import {
  type IdempotentCommandOptions,
  runIdempotentCommand,
} from "@/core/db/idempotent-command";
import { toShanghaiBusinessDate } from "@/core/time/business-date";

import type {
  MovePersonalDailyNoteCommand,
  PersonalDailyNote,
  SavePersonalDailyNoteCommand,
} from "./contracts";
import { getPersonalDailyNote } from "./query";

export class PersonalNoteConflictError extends Error {
  constructor(message = "The personal note no longer matches the current state.") {
    super(message);
    this.name = "PersonalNoteConflictError";
  }
}

export class PersonalNoteDateOccupiedError extends Error {
  constructor(message = "The target business date already has a personal note.") {
    super(message);
    this.name = "PersonalNoteDateOccupiedError";
  }
}

export class PersonalNoteMoveBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersonalNoteMoveBlockedError";
  }
}

export interface PersonalNotesServiceDependencies {
  now?: () => Date;
  createId?: () => string;
  writeBarrier?: IdempotentCommandOptions["writeBarrier"];
}

export interface PersonalNotesService {
  save(command: SavePersonalDailyNoteCommand, idempotencyKey: string): Promise<PersonalDailyNote>;
  move(command: MovePersonalDailyNoteCommand, idempotencyKey: string): Promise<PersonalDailyNote>;
}

function conflict(message: string): never {
  throw new PersonalNoteConflictError(message);
}

function insertAudit(
  sqlite: Database.Database,
  note: PersonalDailyNote,
  eventType: "created" | "updated" | "moved",
  createId: () => string,
  movedFrom?: string,
): void {
  const payload = movedFrom === undefined
    ? JSON.stringify(note)
    : JSON.stringify({ movedFrom, note });
  sqlite.prepare(`insert into audit_events
    (id, event_type, resource_type, resource_id, payload_json, occurred_at)
    values (?, ?, 'personal_daily_note', ?, ?, ?)`)
    .run(createId(), eventType, note.id, payload, note.updatedAt);
}

function applySave(
  sqlite: Database.Database,
  command: SavePersonalDailyNoteCommand,
  timestamp: string,
  createId: () => string,
): PersonalDailyNote {
  const current = getPersonalDailyNote(sqlite, { businessDate: command.businessDate });
  if (!current) {
    if (command.expectedRevision !== 0) conflict("A new personal note requires revision zero.");
    if (sqlite.prepare("select 1 from personal_daily_notes where id = ?").get(command.noteId)) {
      conflict("The personal note identifier is already in use.");
    }
    sqlite.prepare(`insert into personal_daily_notes
      (id, business_date, content, revision, created_at, updated_at)
      values (?, ?, ?, 1, ?, ?)`)
      .run(command.noteId, command.businessDate, command.content, timestamp, timestamp);
    const created = getPersonalDailyNote(sqlite, { businessDate: command.businessDate })!;
    insertAudit(sqlite, created, "created", createId);
    return created;
  }

  if (current.id !== command.noteId || current.revision !== command.expectedRevision) {
    conflict("The personal note revision is stale.");
  }
  if (!Number.isSafeInteger(current.revision) || current.revision >= Number.MAX_SAFE_INTEGER) {
    conflict("The personal note revision cannot be incremented safely.");
  }
  const nextRevision = current.revision + 1;
  const result = sqlite.prepare(`update personal_daily_notes
    set content = ?, revision = ?, updated_at = ?
    where id = ? and business_date = ? and revision = ?`)
    .run(command.content, nextRevision, timestamp, current.id, current.businessDate, current.revision);
  if (result.changes !== 1) conflict("The personal note revision is stale.");
  const updated = getPersonalDailyNote(sqlite, { businessDate: command.businessDate })!;
  insertAudit(sqlite, updated, "updated", createId);
  return updated;
}

function applyMove(
  sqlite: Database.Database,
  command: MovePersonalDailyNoteCommand,
  timestamp: string,
  today: string,
  createId: () => string,
): PersonalDailyNote {
  const current = getPersonalDailyNote(sqlite, { businessDate: command.fromBusinessDate });
  if (!current || current.id !== command.noteId) {
    conflict("The personal note does not exist on the given business date.");
  }
  if (current.revision !== command.expectedRevision) {
    conflict("The personal note revision is stale.");
  }
  if (command.toBusinessDate === command.fromBusinessDate) {
    throw new PersonalNoteMoveBlockedError("新日期与当前日期相同，无需移动。");
  }
  if (command.toBusinessDate > today) {
    throw new PersonalNoteMoveBlockedError("不能把复盘移动到未来的日期。");
  }
  const occupied = sqlite
    .prepare("select id from personal_daily_notes where business_date = ?")
    .get(command.toBusinessDate) as { id: string } | undefined;
  if (occupied) {
    throw new PersonalNoteDateOccupiedError();
  }
  if (!Number.isSafeInteger(current.revision) || current.revision >= Number.MAX_SAFE_INTEGER) {
    conflict("The personal note revision cannot be incremented safely.");
  }
  const nextRevision = current.revision + 1;
  const result = sqlite.prepare(`update personal_daily_notes
    set business_date = ?, revision = ?, updated_at = ?
    where id = ? and business_date = ? and revision = ?`)
    .run(command.toBusinessDate, nextRevision, timestamp, current.id, command.fromBusinessDate, current.revision);
  if (result.changes !== 1) conflict("The personal note revision is stale.");
  const moved = getPersonalDailyNote(sqlite, { businessDate: command.toBusinessDate })!;
  insertAudit(sqlite, moved, "moved", createId, command.fromBusinessDate);
  return moved;
}

export function createPersonalNotesService(
  sqlite: Database.Database,
  dependencies: PersonalNotesServiceDependencies = {},
): PersonalNotesService {
  const now = dependencies.now ?? (() => new Date());
  const createId = dependencies.createId ?? randomUUID;
  return {
    async save(command, idempotencyKey) {
      let transactionNow: Date | undefined;
      const stableNow = () => {
        transactionNow ??= now();
        return transactionNow;
      };
      return runIdempotentCommand(
        sqlite,
        {
          operation: "personal-notes.command",
          idempotencyKey,
          now: stableNow,
          writeBarrier: dependencies.writeBarrier,
        },
        command,
        () => applySave(sqlite, command, stableNow().toISOString(), createId),
      );
    },
    async move(command, idempotencyKey) {
      let transactionNow: Date | undefined;
      const stableNow = () => {
        transactionNow ??= now();
        return transactionNow;
      };
      return runIdempotentCommand(
        sqlite,
        {
          operation: "personal-notes.move",
          idempotencyKey,
          now: stableNow,
          writeBarrier: dependencies.writeBarrier,
        },
        command,
        () => applyMove(sqlite, command, stableNow().toISOString(), toShanghaiBusinessDate(stableNow()), createId),
      );
    },
  };
}
