import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import type { WriteBarrier } from "@/core/backup/write-barrier";
import { IdempotentCommandConflictError, runIdempotentCommand } from "@/core/db/idempotent-command";
import type { WeeklyReviewSnapshot } from "./contracts";
import { isWeeklyReviewPeriod } from "./contracts";
import { getWeeklyReviewSnapshot } from "./query";

export const PIN_TARGET_TYPES = ["knowledge-module", "exercise-template", "skincare-plan", "health-template"] as const;
export type PinTargetType = (typeof PIN_TARGET_TYPES)[number];
export type WeeklyReviewCommand =
  | { type: "save-weekly-summary"; periodStart: string; periodEndExclusive: string; content: string; expectedRevision: number | null }
  | { type: "pin-review-target"; targetType: PinTargetType; targetId: string; periodStart: string; periodEndExclusive: string }
  | { type: "unpin-review-target"; targetType: PinTargetType; targetId: string; periodStart: string; periodEndExclusive: string };

export class WeeklyReviewValidationError extends Error {
  constructor() { super("Invalid weekly review command."); this.name = "WeeklyReviewValidationError"; }
}
export class WeeklyReviewConflictError extends Error {
  constructor() { super("The weekly review changed. Reload before saving."); this.name = "WeeklyReviewConflictError"; }
}

export interface WeeklyReviewServiceOptions {
  now?: () => Date;
  createId?: (prefix: string) => string;
  writeBarrier?: Pick<WriteBarrier, "runWrite">;
}
export interface WeeklyReviewService {
  execute(command: unknown, idempotencyKey: string): Promise<WeeklyReviewSnapshot>;
}

interface ReviewRow { id: string; content: string; revision: number; }
const legacySummaryFields = ["highlights", "blockers", "lessons", "adjustments", "nextFocus"] as const;

function commandOf(input: unknown): WeeklyReviewCommand {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new WeeklyReviewValidationError();
  const value = input as Record<string, unknown>;
  if (value.type === "save-weekly-summary") {
    if (Object.keys(value).length !== 5 || typeof value.periodStart !== "string" || typeof value.periodEndExclusive !== "string" ||
      typeof value.content !== "string" || value.content.length > 10_000 ||
      !(value.expectedRevision === null || (Number.isSafeInteger(value.expectedRevision) && (value.expectedRevision as number) >= 1)) ||
      !isWeeklyReviewPeriod(value.periodStart, value.periodEndExclusive)) throw new WeeklyReviewValidationError();
    return { type: value.type, periodStart: value.periodStart, periodEndExclusive: value.periodEndExclusive, content: value.content, expectedRevision: value.expectedRevision as number | null };
  }
  if (value.type === "pin-review-target" || value.type === "unpin-review-target") {
    if (Object.keys(value).length !== 5 || !PIN_TARGET_TYPES.includes(value.targetType as PinTargetType) || typeof value.targetId !== "string" ||
      value.targetId.trim().length < 1 || value.targetId.length > 128 || typeof value.periodStart !== "string" ||
      typeof value.periodEndExclusive !== "string" || !isWeeklyReviewPeriod(value.periodStart, value.periodEndExclusive)) throw new WeeklyReviewValidationError();
    return { type: value.type, targetType: value.targetType as PinTargetType, targetId: value.targetId,
      periodStart: value.periodStart, periodEndExclusive: value.periodEndExclusive };
  }
  throw new WeeklyReviewValidationError();
}

function isLegacyFiveFieldSummary(content: string): boolean {
  try {
    const parsed: unknown = JSON.parse(content);
    return !!parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
      Object.keys(parsed as object).length === legacySummaryFields.length &&
      legacySummaryFields.every((key) => typeof (parsed as Record<string, unknown>)[key] === "string");
  } catch { return false; }
}

function targetExists(sqlite: Database.Database, type: PinTargetType, id: string): boolean {
  const query = {
    "knowledge-module": "select 1 from knowledge_modules where module_id = ? and status <> 'archived'",
    "exercise-template": "select 1 from manual_exercise_templates where id = ?",
    "skincare-plan": "select 1 from manual_skincare_recovery_plans where id = ?",
    "health-template": "select 1 from health_checklist_templates where id = ?",
  }[type];
  return sqlite.prepare(query).get(id) !== undefined;
}

function canonicalReviewSnapshot(row: { id: string; periodStart: string; periodEndExclusive: string; content: string; revision: number }) {
  return { id: row.id, reviewType: "weekly", periodStart: row.periodStart, periodEndExclusive: row.periodEndExclusive, content: row.content, revision: row.revision };
}

function snapshotFor(sqlite: Database.Database, periodStart: string, periodEndExclusive: string): WeeklyReviewSnapshot {
  return getWeeklyReviewSnapshot(sqlite, { periodStart, periodEndExclusive, recentLimit: 20 });
}

export function createWeeklyReviewService(sqlite: Database.Database, options: WeeklyReviewServiceOptions = {}): WeeklyReviewService {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? ((prefix: string) => `${prefix}-${randomUUID()}`);
  return {
    async execute(raw, idempotencyKey) {
      const command = commandOf(raw);
      return runIdempotentCommand(sqlite, { operation: "weekly-review.command", idempotencyKey, now, writeBarrier: options.writeBarrier }, command, () => {
        const timestamp = now().toISOString();
        if (command.type === "save-weekly-summary") {
          const existing = sqlite.prepare(`select id, content, revision from reviews where review_type = 'weekly' and period_start = ? and period_end_exclusive = ? and archived_at is null`).get(command.periodStart, command.periodEndExclusive) as ReviewRow | undefined;
          if (!existing) {
            if (command.expectedRevision !== null) throw new WeeklyReviewConflictError();
            const id = createId("weekly-review");
            sqlite.prepare("insert into reviews (id, review_type, period_start, period_end_exclusive, content, revision, created_at, updated_at, archived_at) values (?, 'weekly', ?, ?, ?, 1, ?, ?, null)")
              .run(id, command.periodStart, command.periodEndExclusive, command.content, timestamp, timestamp);
            sqlite.prepare("insert into review_revisions (id, review_id, revision, snapshot_json, created_at) values (?, ?, 1, ?, ?)")
              .run(createId("weekly-review-revision"), id, JSON.stringify(canonicalReviewSnapshot({ id, periodStart: command.periodStart, periodEndExclusive: command.periodEndExclusive, content: command.content, revision: 1 })), timestamp);
          } else {
            if (command.expectedRevision !== existing.revision || isLegacyFiveFieldSummary(existing.content)) throw new WeeklyReviewConflictError();
            const revision = existing.revision + 1;
            sqlite.prepare("update reviews set content = ?, revision = ?, updated_at = ? where id = ? and revision = ?")
              .run(command.content, revision, timestamp, existing.id, existing.revision);
            sqlite.prepare("insert into review_revisions (id, review_id, revision, snapshot_json, created_at) values (?, ?, ?, ?, ?)")
              .run(createId("weekly-review-revision"), existing.id, revision, JSON.stringify(canonicalReviewSnapshot({ id: existing.id, periodStart: command.periodStart, periodEndExclusive: command.periodEndExclusive, content: command.content, revision })), timestamp);
          }
          sqlite.prepare("insert into audit_events (id, event_type, resource_type, resource_id, payload_json, occurred_at) values (?, ?, 'weekly_review', ?, ?, ?)")
            .run(createId("audit"), "weekly-summary-saved", command.periodStart, JSON.stringify({ periodStart: command.periodStart, periodEndExclusive: command.periodEndExclusive }), timestamp);
          return snapshotFor(sqlite, command.periodStart, command.periodEndExclusive);
        }
        if (command.type === "pin-review-target") {
          if (!targetExists(sqlite, command.targetType, command.targetId)) throw new WeeklyReviewValidationError();
          sqlite.prepare("insert or ignore into user_pins (target_type, target_id, pinned_at) values (?, ?, ?)").run(command.targetType, command.targetId, timestamp);
        } else {
          sqlite.prepare("delete from user_pins where target_type = ? and target_id = ?").run(command.targetType, command.targetId);
        }
        return snapshotFor(sqlite, command.periodStart, command.periodEndExclusive);
      }).catch((error: unknown) => {
        if (error instanceof IdempotentCommandConflictError) throw error;
        throw error;
      });
    },
  };
}

export { commandOf as parseWeeklyReviewCommand };
