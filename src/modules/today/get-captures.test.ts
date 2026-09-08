import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { migrateDatabase } from "@/core/db/migrate";

import { getCaptureTimeline } from "./get-captures";

const databases: Database.Database[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

function createDatabase(): Database.Database {
  const sqlite = new Database(":memory:");
  databases.push(sqlite);
  migrateDatabase(sqlite);
  return sqlite;
}

function seedCaptures(
  sqlite: Database.Database,
  input: { total: number; duplicateOccurredAt: number },
): string[] {
  const insert = sqlite.prepare(`insert into capture_items
    (id, event_type, corrects_item_id, business_date, occurred_at, content, created_at)
    values (?, 'capture', null, '2026-08-10', ?, ?, ?)`);
  const ids: string[] = [];
  for (let index = 0; index < input.total; index += 1) {
    const id = `capture-${String(index).padStart(4, "0")}`;
    const occurredAt = index < input.duplicateOccurredAt
      ? "2026-08-10T08:00:00.000Z"
      : new Date(Date.UTC(2026, 7, 10, 8, 0, index)).toISOString();
    insert.run(id, occurredAt, `记录 ${index}`, occurredAt);
    ids.push(id);
  }
  return ids;
}

function readAllPages(
  sqlite: Database.Database,
  input: { limit?: number; cursor?: string; snapshotHighWater?: number } = {},
) {
  const items: string[] = [];
  let cursor = input.cursor;
  let snapshotHighWater = input.snapshotHighWater;

  do {
    const page = getCaptureTimeline(sqlite, {
      businessDate: "2026-08-10",
      limit: input.limit,
      cursor,
      snapshotHighWater,
    });
    items.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor ?? undefined;
    snapshotHighWater ??= page.snapshotHighWater;
  } while (cursor);

  return { items, snapshotHighWater };
}

describe("getCaptureTimeline", () => {
  it("returns an empty, serializable first page with a zero high-water mark", () => {
    const sqlite = createDatabase();

    const initialTimeline = getCaptureTimeline(sqlite, {
      businessDate: "2026-08-10",
      limit: 50,
    });

    expect(initialTimeline).toEqual({
      items: [],
      nextCursor: null,
      snapshotHighWater: 0,
    });
    expect(structuredClone(initialTimeline)).toEqual(initialTimeline);
  });

  it("paginates 500 rows with duplicate timestamps without gaps or duplicates", () => {
    const sqlite = createDatabase();
    const ids = seedCaptures(sqlite, { total: 500, duplicateOccurredAt: 80 });

    const traversal = readAllPages(sqlite, { limit: 50 });

    expect(new Set(traversal.items).size).toBe(500);
    expect(traversal.items).toHaveLength(500);
    expect(new Set(traversal.items)).toEqual(new Set(ids));
    expect(traversal.snapshotHighWater).toBe(500);
  });

  it("orders every cursor boundary by occurred_at, created_at, and id descending", () => {
    const sqlite = createDatabase();
    const insert = sqlite.prepare(`insert into capture_items
      (id, event_type, corrects_item_id, business_date, occurred_at, content, created_at)
      values (?, 'capture', null, '2026-08-10', ?, ?, ?)`);
    insert.run("older-created", "2026-08-10T09:00:00.000Z", "A", "2026-08-10T10:00:00.000Z");
    insert.run("id-c", "2026-08-10T09:00:00.000Z", "B", "2026-08-10T10:01:00.000Z");
    insert.run("id-z", "2026-08-10T09:00:00.000Z", "C", "2026-08-10T10:01:00.000Z");
    insert.run("newer-occurred", "2026-08-10T09:01:00.000Z", "D", "2026-08-10T09:01:00.000Z");

    const first = getCaptureTimeline(sqlite, { businessDate: "2026-08-10", limit: 2 });
    const second = getCaptureTimeline(sqlite, {
      businessDate: "2026-08-10",
      limit: 2,
      cursor: first.nextCursor ?? undefined,
      snapshotHighWater: first.snapshotHighWater,
    });

    expect(first.items.map((item) => item.id)).toEqual(["newer-occurred", "id-z"]);
    expect(second.items.map((item) => item.id)).toEqual(["id-c", "older-created"]);
    expect(second.nextCursor).toBeNull();
  });

  it("keeps the original exact ID set when a void is appended after page one", () => {
    const sqlite = createDatabase();
    const ids = seedCaptures(sqlite, { total: 4, duplicateOccurredAt: 0 });
    const first = getCaptureTimeline(sqlite, { businessDate: "2026-08-10", limit: 2 });
    const voidedId = "capture-0000";

    sqlite
      .prepare(`insert into capture_items
        (id, event_type, corrects_item_id, business_date, occurred_at, content, created_at)
        values ('later-void', 'void', ?, '2026-08-10', '2026-08-10T10:00:00.000Z', 'Voided later', '2026-08-10T10:00:00.000Z')`)
      .run(voidedId);

    const rest = readAllPages(sqlite, {
      limit: 2,
      cursor: first.nextCursor ?? undefined,
      snapshotHighWater: first.snapshotHighWater,
    });

    const seen = [...first.items.map((item) => item.id), ...rest.items];
    expect(new Set(seen)).toEqual(new Set(ids));
    expect(seen).toHaveLength(ids.length);
    expect(readAllPages(sqlite, { limit: 50 }).items).not.toContain(voidedId);
  });

  it("keeps an exact 500-row snapshot while later capture and void events arrive", () => {
    const sqlite = createDatabase();
    const snapshotIds = seedCaptures(sqlite, { total: 500, duplicateOccurredAt: 100 });
    const first = getCaptureTimeline(sqlite, { businessDate: "2026-08-10", limit: 50 });
    const voidedAfterSnapshot = "capture-0000";
    const newlyInsertedId = "capture-after-snapshot";
    sqlite.prepare(`insert into capture_items
      (id, event_type, corrects_item_id, business_date, occurred_at, content, created_at)
      values (?, 'capture', null, '2026-08-10', ?, 'Later capture', ?)`)
      .run(newlyInsertedId, "2026-08-10T07:00:00.000Z", "2026-08-10T10:00:00.000Z");
    sqlite.prepare(`insert into capture_items
      (id, event_type, corrects_item_id, business_date, occurred_at, content, created_at)
      values ('void-after-snapshot', 'void', ?, '2026-08-10', ?, 'Later void', ?)`)
      .run(voidedAfterSnapshot, "2026-08-10T10:01:00.000Z", "2026-08-10T10:01:00.000Z");

    const rest = readAllPages(sqlite, {
      limit: 50,
      cursor: first.nextCursor ?? undefined,
      snapshotHighWater: first.snapshotHighWater,
    });
    const seenIds = [...first.items.map((item) => item.id), ...rest.items];

    expect(new Set(seenIds)).toEqual(new Set(snapshotIds));
    expect(seenIds).toHaveLength(snapshotIds.length);
    expect(seenIds).not.toContain(newlyInsertedId);
    const fresh = readAllPages(sqlite, { limit: 50 }).items;
    expect(fresh).toContain(newlyInsertedId);
    expect(fresh).not.toContain(voidedAfterSnapshot);
  });

  it("keeps a capture visible after a correction but hides it after an in-snapshot void", () => {
    const sqlite = createDatabase();
    const insert = sqlite.prepare(`insert into capture_items
      (id, event_type, corrects_item_id, business_date, occurred_at, content, created_at)
      values (?, ?, ?, '2026-08-10', ?, ?, ?)`);
    insert.run("corrected", "capture", null, "2026-08-10T08:00:00.000Z", "Original", "2026-08-10T08:00:00.000Z");
    insert.run("correction", "correction", "corrected", "2026-08-10T08:01:00.000Z", "Correction", "2026-08-10T08:01:00.000Z");
    insert.run("voided", "capture", null, "2026-08-10T08:02:00.000Z", "Void me", "2026-08-10T08:02:00.000Z");
    insert.run("void", "void", "voided", "2026-08-10T08:03:00.000Z", "Void", "2026-08-10T08:03:00.000Z");

    const page = getCaptureTimeline(sqlite, { businessDate: "2026-08-10" });

    expect(page.items.map((item) => item.id)).toEqual(["corrected"]);
  });

  it("rejects a caller-supplied snapshot above the current global high-water", () => {
    const sqlite = createDatabase();
    seedCaptures(sqlite, { total: 2, duplicateOccurredAt: 0 });

    expect(() =>
      getCaptureTimeline(sqlite, {
        businessDate: "2026-08-10",
        limit: 1,
        snapshotHighWater: 100,
      }),
    ).toThrow("Invalid capture timeline snapshot");
  });

  it("orders legacy ISO variants by their actual instants across cursor pages", () => {
    const sqlite = createDatabase();
    const insert = sqlite.prepare(`insert into capture_items
      (id, event_type, corrects_item_id, business_date, occurred_at, content, created_at)
      values (?, 'capture', null, '2026-08-10', ?, ?, ?)`);
    insert.run("occurred-whole", "2026-08-10T08:00:00Z", "A", "2026-08-10T10:00:00.000Z");
    insert.run("occurred-fraction", "2026-08-10T08:00:00.100Z", "B", "2026-08-10T09:00:00.000Z");
    insert.run("created-whole", "2026-08-10T09:00:00Z", "C", "2026-08-10T10:00:00Z");
    insert.run("created-fraction", "2026-08-10T09:00:00.000Z", "D", "2026-08-10T10:00:00.100Z");

    const traversal = readAllPages(sqlite, { limit: 1 });

    expect(traversal.items).toEqual([
      "created-fraction",
      "created-whole",
      "occurred-fraction",
      "occurred-whole",
    ]);
  });

  it("rejects an invalid opaque cursor rather than silently using it", () => {
    const sqlite = createDatabase();

    expect(() =>
      getCaptureTimeline(sqlite, {
        businessDate: "2026-08-10",
        cursor: "not-a-valid-cursor",
        snapshotHighWater: 0,
      }),
    ).toThrow("Invalid capture timeline cursor");
  });
});

