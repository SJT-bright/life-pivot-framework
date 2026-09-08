import { Buffer } from "node:buffer";

import type Database from "better-sqlite3";
import { z } from "zod";

import { isBusinessDate } from "@/core/time/business-date";

const MAX_PAGE_SIZE = 50;

const captureCursorSchema = z
  .object({
    occurredAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
    id: z.string().min(1),
  })
  .strict();

export interface CaptureTimelineItem {
  id: string;
  businessDate: string;
  occurredAt: string;
  text: string;
  createdAt: string;
}

export interface CaptureCursor {
  occurredAt: string;
  createdAt: string;
  id: string;
}

export interface CapturePage {
  items: CaptureTimelineItem[];
  nextCursor: string | null;
  snapshotHighWater: number;
}

export interface CaptureTimelineInput {
  businessDate: string;
  limit?: number;
  cursor?: string;
  snapshotHighWater?: number;
}

export class CaptureTimelineInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptureTimelineInputError";
  }
}

interface CaptureRow {
  id: string;
  business_date: string;
  occurred_at: string;
  content: string;
  created_at: string;
}

function invalidCursor(): never {
  throw new CaptureTimelineInputError("Invalid capture timeline cursor");
}

export function parseCaptureCursor(value: string | undefined): CaptureCursor | undefined {
  if (value === undefined) return undefined;
  if (!/^[A-Za-z0-9_-]+$/.test(value)) invalidCursor();

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    invalidCursor();
  }

  const parsed = captureCursorSchema.safeParse(decoded);
  if (!parsed.success) invalidCursor();
  return parsed.data;
}

function pageSize(value: number | undefined): number {
  if (value === undefined) return MAX_PAGE_SIZE;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new CaptureTimelineInputError("Invalid capture timeline limit");
  }
  return Math.min(value, MAX_PAGE_SIZE);
}

function currentHighWater(sqlite: Database.Database): number {
  const highWater = sqlite
    .prepare("select coalesce(max(rowid), 0) from capture_items")
    .pluck()
    .get();
  if (typeof highWater !== "number" || !Number.isSafeInteger(highWater) || highWater < 0) {
    throw new Error("Capture timeline high-water is outside the safe integer range");
  }
  return highWater;
}

function snapshotHighWater(
  sqlite: Database.Database,
  value: number | undefined,
): number {
  const current = currentHighWater(sqlite);
  if (value === undefined) return current;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CaptureTimelineInputError("Invalid capture timeline snapshot");
  }
  if (value > current) {
    throw new CaptureTimelineInputError("Invalid capture timeline snapshot");
  }
  return value;
}

function encodeCaptureCursor(cursor: CaptureCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function getCaptureTimeline(
  sqlite: Database.Database,
  input: CaptureTimelineInput,
): CapturePage {
  if (!isBusinessDate(input.businessDate)) {
    throw new CaptureTimelineInputError("Invalid capture timeline business date");
  }

  const cursor = parseCaptureCursor(input.cursor);
  if (cursor && input.snapshotHighWater === undefined) {
    throw new CaptureTimelineInputError("A capture timeline cursor requires a snapshot");
  }

  const limit = pageSize(input.limit);
  const highWater = snapshotHighWater(sqlite, input.snapshotHighWater);
  const rows = sqlite
    .prepare(
      `select id, business_date, occurred_at, content, created_at
       from capture_items
       where business_date = ?
         and capture_items.rowid <= ?
         and event_type = 'capture'
         and not exists (
           select 1
           from capture_items newer
           where newer.corrects_item_id = capture_items.id
             and newer.rowid <= ?
             and newer.event_type = 'void'
         )
         and (
           ? = 0
           or unixepoch(occurred_at, 'subsec') < unixepoch(?, 'subsec')
           or (
             unixepoch(occurred_at, 'subsec') = unixepoch(?, 'subsec')
             and unixepoch(created_at, 'subsec') < unixepoch(?, 'subsec')
           )
           or (
             unixepoch(occurred_at, 'subsec') = unixepoch(?, 'subsec')
             and unixepoch(created_at, 'subsec') = unixepoch(?, 'subsec')
             and id < ?
           )
         )
       order by
         unixepoch(occurred_at, 'subsec') desc,
         unixepoch(created_at, 'subsec') desc,
         id desc
       limit ?`,
    )
    .all(
      input.businessDate,
      highWater,
      highWater,
      cursor ? 1 : 0,
      cursor?.occurredAt ?? "",
      cursor?.occurredAt ?? "",
      cursor?.createdAt ?? "",
      cursor?.occurredAt ?? "",
      cursor?.createdAt ?? "",
      cursor?.id ?? "",
      limit + 1,
    ) as CaptureRow[];

  const pageRows = rows.slice(0, limit);
  const items = pageRows.map((row) => ({
    id: row.id,
    businessDate: row.business_date,
    occurredAt: row.occurred_at,
    text: row.content,
    createdAt: row.created_at,
  }));
  const lastItem = items.at(-1);

  return {
    items,
    nextCursor: rows.length > limit && lastItem
      ? encodeCaptureCursor({
        occurredAt: lastItem.occurredAt,
        createdAt: lastItem.createdAt,
        id: lastItem.id,
      })
      : null,
    snapshotHighWater: highWater,
  };
}

