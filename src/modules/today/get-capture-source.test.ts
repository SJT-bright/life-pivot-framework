import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { migrateDatabase } from "@/core/db/migrate";

import { getCaptureTimeline } from "./get-captures";
import {
  CaptureSourceInputError,
  CaptureSourceNotFoundError,
  getCaptureSource,
} from "./get-capture-source";

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

function insertEvent(
  sqlite: Database.Database,
  input: {
    id: string;
    eventType: "capture" | "correction" | "void";
    correctsItemId?: string;
    businessDate?: string;
    occurredAt: string;
    text: string;
    createdAt?: string;
  },
): void {
  sqlite.prepare(`insert into capture_items
    (id, event_type, corrects_item_id, business_date, occurred_at, content, created_at)
    values (?, ?, ?, ?, ?, ?, ?)`)
    .run(
      input.id,
      input.eventType,
      input.correctsItemId ?? null,
      input.businessDate ?? "2026-08-10",
      input.occurredAt,
      input.text,
      input.createdAt ?? input.occurredAt,
    );
}

function seedCaptures(sqlite: Database.Database, total: number): void {
  for (let index = 0; index < total; index += 1) {
    const timestamp = new Date(Date.UTC(2026, 7, 10, 8, 0, index)).toISOString();
    insertEvent(sqlite, {
      id: `capture-${String(index).padStart(4, "0")}`,
      eventType: "capture",
      occurredAt: timestamp,
      text: `Original capture ${index}`,
    });
  }
}

describe("getCaptureSource", () => {
  it("reads exact captures beyond the first timeline page, including rows 51 and 500", () => {
    const sqlite = createDatabase();
    seedCaptures(sqlite, 500);
    const firstPage = getCaptureTimeline(sqlite, {
      businessDate: "2026-08-10",
      limit: 50,
    });

    const row51 = getCaptureSource(sqlite, {
      businessDate: "2026-08-10",
      sourceId: "capture-0449",
    });
    const row500 = getCaptureSource(sqlite, {
      businessDate: "2026-08-10",
      sourceId: "capture-0000",
    });

    expect(firstPage.items.map((item) => item.id)).not.toContain(row51.id);
    expect(firstPage.items.map((item) => item.id)).not.toContain(row500.id);
    expect(row51).toMatchObject({
      id: "capture-0449",
      businessDate: "2026-08-10",
      text: "Original capture 449",
      disposition: "active",
    });
    expect(row500).toMatchObject({
      id: "capture-0000",
      text: "Original capture 0",
      disposition: "active",
    });
  });

  it("always returns original capture text while corrections are ignored and void sets disposition", () => {
    const sqlite = createDatabase();
    insertEvent(sqlite, {
      id: "corrected-source",
      eventType: "capture",
      occurredAt: "2026-08-10T08:00:00.000Z",
      text: "Original corrected text",
    });
    insertEvent(sqlite, {
      id: "correction-event",
      eventType: "correction",
      correctsItemId: "corrected-source",
      occurredAt: "2026-08-10T08:01:00.000Z",
      text: "Replacement text that must not leak",
    });
    insertEvent(sqlite, {
      id: "voided-source",
      eventType: "capture",
      occurredAt: "2026-08-10T08:02:00.000Z",
      text: "Original voided text",
    });
    insertEvent(sqlite, {
      id: "voided-correction",
      eventType: "correction",
      correctsItemId: "voided-source",
      occurredAt: "2026-08-10T08:03:00.000Z",
      text: "Corrected voided text that must not leak",
    });
    insertEvent(sqlite, {
      id: "void-event",
      eventType: "void",
      correctsItemId: "voided-source",
      occurredAt: "2026-08-10T08:04:00.000Z",
      text: "Void metadata that must not replace the source",
    });

    expect(getCaptureSource(sqlite, {
      businessDate: "2026-08-10",
      sourceId: "corrected-source",
    })).toMatchObject({ text: "Original corrected text", disposition: "active" });
    expect(getCaptureSource(sqlite, {
      businessDate: "2026-08-10",
      sourceId: "voided-source",
    })).toMatchObject({ text: "Original voided text", disposition: "voided" });
  });

  it("derives current disposition from multiple linked events in one database statement", () => {
    const sqlite = createDatabase();
    insertEvent(sqlite, {
      id: "multiply-linked-source",
      eventType: "capture",
      occurredAt: "2026-08-10T08:00:00.000Z",
      text: "Immutable original",
    });
    for (const [id, eventType, occurredAt, text] of [
      ["correction-one", "correction", "2026-08-10T08:01:00.000Z", "First replacement"],
      ["void-one", "void", "2026-08-10T08:02:00.000Z", "First void"],
      ["correction-two", "correction", "2026-08-10T08:03:00.000Z", "Latest replacement"],
      ["void-two", "void", "2026-08-10T08:04:00.000Z", "Latest void"],
    ] as const) {
      insertEvent(sqlite, {
        id,
        eventType,
        correctsItemId: "multiply-linked-source",
        occurredAt,
        text,
      });
    }
    const prepare = vi.spyOn(sqlite, "prepare");

    expect(getCaptureSource(sqlite, {
      businessDate: "2026-08-10",
      sourceId: "multiply-linked-source",
    })).toEqual({
      id: "multiply-linked-source",
      businessDate: "2026-08-10",
      occurredAt: "2026-08-10T08:00:00.000Z",
      text: "Immutable original",
      createdAt: "2026-08-10T08:00:00.000Z",
      disposition: "voided",
    });
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("maps missing, date-mismatched, correction, and void identifiers to the same typed not-found error", () => {
    const sqlite = createDatabase();
    insertEvent(sqlite, {
      id: "source-capture",
      eventType: "capture",
      occurredAt: "2026-08-10T08:00:00.000Z",
      text: "Original",
    });
    insertEvent(sqlite, {
      id: "correction-event",
      eventType: "correction",
      correctsItemId: "source-capture",
      occurredAt: "2026-08-10T08:01:00.000Z",
      text: "Correction",
    });
    insertEvent(sqlite, {
      id: "void-event",
      eventType: "void",
      correctsItemId: "source-capture",
      occurredAt: "2026-08-10T08:02:00.000Z",
      text: "Void",
    });

    for (const input of [
      { businessDate: "2026-08-09", sourceId: "source-capture" },
      { businessDate: "2026-08-10", sourceId: "missing" },
      { businessDate: "2026-08-10", sourceId: "correction-event" },
      { businessDate: "2026-08-10", sourceId: "void-event" },
    ]) {
      expect(() => getCaptureSource(sqlite, input)).toThrow(CaptureSourceNotFoundError);
    }
  });

  it("does not mutate timeline membership, cursor, or snapshot and returns clone-safe data", () => {
    const sqlite = createDatabase();
    seedCaptures(sqlite, 60);
    const before = getCaptureTimeline(sqlite, {
      businessDate: "2026-08-10",
      limit: 50,
    });

    const source = getCaptureSource(sqlite, {
      businessDate: "2026-08-10",
      sourceId: "capture-0000",
    });
    const after = getCaptureTimeline(sqlite, {
      businessDate: "2026-08-10",
      limit: 50,
    });

    expect(after).toEqual(before);
    expect(before.items.map((item) => item.id)).not.toContain(source.id);
    expect(structuredClone(source)).toEqual(source);
    expect(JSON.parse(JSON.stringify(source))).toEqual(source);
  });

  it("rejects invalid domain input before querying", () => {
    const sqlite = createDatabase();

    expect(() => getCaptureSource(sqlite, {
      businessDate: "2026-02-30",
      sourceId: "source-capture",
    })).toThrow(CaptureSourceInputError);
    expect(() => getCaptureSource(sqlite, {
      businessDate: "2026-08-10",
      sourceId: "",
    })).toThrow(CaptureSourceInputError);
  });
});
