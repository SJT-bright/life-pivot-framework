import { performance } from "node:perf_hooks";

import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrateDatabase } from "@/core/db/migrate";

import type { EntrySectionInput } from "./contracts";
import { getCaptureTimeline } from "./get-captures";
import { createEntrySaver } from "./save-entry";

const SAMPLE_COUNT = 30;
const ROW_COUNT = 5_000;
let sqlite: Database.Database;
let sequence = 0;

function nearestRankP95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1] ?? Number.POSITIVE_INFINITY;
}

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.POSITIVE_INFINITY;
}

async function samples(action: () => void | Promise<void>): Promise<number[]> {
  const values: number[] = [];
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const started = performance.now();
    await action();
    values.push(performance.now() - started);
  }
  return values;
}

function report(name: string, values: number[], failures: number): void {
  console.log(JSON.stringify({
    benchmark: name,
    machine: `${process.platform}/${process.arch}`,
    node: process.version,
    rows: ROW_COUNT,
    samples: values.length,
    medianMs: Number(median(values).toFixed(3)),
    p95Ms: Number(nearestRankP95(values).toFixed(3)),
    maxMs: Number(Math.max(...values).toFixed(3)),
    failures,
  }));
}

beforeAll(() => {
  sqlite = new Database(":memory:");
  migrateDatabase(sqlite);
  const insert = sqlite.prepare(`insert into capture_items
    (id, event_type, corrects_item_id, business_date, occurred_at, content, created_at)
    values (?, 'capture', null, '2026-08-10', ?, ?, ?)`);
  const seed = sqlite.transaction(() => {
    for (let index = 0; index < ROW_COUNT; index += 1) {
      const instant = new Date(Date.UTC(2026, 7, 10, 0, 0, index)).toISOString();
      insert.run(`perf-${index}`, instant, `Performance row ${index}`, instant);
    }
  });
  seed();
});

afterAll(() => sqlite.close());

describe("Today local service performance", () => {
  it("keeps first-page p95 at or below 250ms", async () => {
    let failures = 0;
    const values = await samples(() => {
      const page = getCaptureTimeline(sqlite, { businessDate: "2026-08-10", limit: 50 });
      if (page.items.length !== 50) failures += 1;
    });
    report("first-page", values, failures);
    expect(failures).toBe(0);
    expect(nearestRankP95(values)).toBeLessThanOrEqual(250);
  });

  it("keeps next-page p95 at or below 200ms", async () => {
    const first = getCaptureTimeline(sqlite, { businessDate: "2026-08-10", limit: 50 });
    if (!first.nextCursor) throw new Error("Expected a continuation cursor");
    let failures = 0;
    const values = await samples(() => {
      const page = getCaptureTimeline(sqlite, {
        businessDate: "2026-08-10",
        limit: 50,
        cursor: first.nextCursor!,
        snapshotHighWater: first.snapshotHighWater,
      });
      if (page.items.length !== 50) failures += 1;
    });
    report("next-page", values, failures);
    expect(failures).toBe(0);
    expect(nearestRankP95(values)).toBeLessThanOrEqual(200);
  });

  it("keeps append-only save p95 at or below 300ms", async () => {
    let failures = 0;
    const values = await samples(async () => {
      const index = ++sequence;
      const input: EntrySectionInput = {
        section: "entry",
        draftId: `perf-draft-${index}`,
        businessDate: "2026-08-10",
        occurredAt: new Date(Date.UTC(2026, 7, 10, 12, 0, index)).toISOString(),
        value: { text: `Performance save ${index}` },
      };
      const saved = await createEntrySaver(sqlite, {
        idempotencyKey: `perf-request-${index}`,
        createId: () => `perf-generated-${++sequence}`,
        now: () => new Date("2026-08-10T12:30:00.000Z"),
      })(input);
      if (saved.text !== input.value.text) failures += 1;
    });
    report("capture-save", values, failures);
    expect(failures).toBe(0);
    expect(nearestRankP95(values)).toBeLessThanOrEqual(300);
  });
});
