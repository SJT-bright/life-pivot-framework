import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { migrateDatabase } from "@/core/db/migrate";

import { getCaptureTimeline } from "./get-captures";
import { createEntrySaver } from "./save-entry";
import {
  CaptureVoidConflictError,
  createCaptureVoider,
} from "./void-entry";

const databases: Database.Database[] = [];

function setup() {
  const sqlite = new Database(":memory:");
  databases.push(sqlite);
  migrateDatabase(sqlite);
  let id = 0;
  const saver = createEntrySaver(sqlite, {
    idempotencyKey: "void-test-save-key-0001",
    now: () => new Date("2026-08-09T08:30:00.000Z"),
    createId: () => `save-${++id}`,
  });
  const voider = (idempotencyKey: string) =>
    createCaptureVoider(sqlite, {
      idempotencyKey,
      now: () => new Date("2026-08-09T12:00:00.000Z"),
      createId: () => `void-${++id}`,
    });
  const seedOneCapture = () =>
    saver({
      section: "entry",
      draftId: "draft-void-0001",
      businessDate: "2026-08-09",
      occurredAt: "2026-08-09T08:30:00.000Z",
      value: { text: "记错的一条" },
    });
  return { sqlite, voider, seedOneCapture };
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe("createCaptureVoider", () => {
  it("voids a capture and hides it from the timeline while keeping evidence", async () => {
    const { sqlite, voider, seedOneCapture } = setup();
    const stored = await seedOneCapture();

    const result = await voider("void-test-key-00000001")({
      itemId: stored.id,
      businessDate: "2026-08-09",
    });

    expect(result.itemId).toBe(stored.id);
    expect(result.businessDate).toBe("2026-08-09");

    const voidRow = sqlite
      .prepare(
        "select event_type, corrects_item_id, content from capture_items where event_type = 'void'",
      )
      .get() as { event_type: string; corrects_item_id: string; content: string };
    expect(voidRow.corrects_item_id).toBe(stored.id);

    const audit = sqlite
      .prepare("select event_type, resource_type, resource_id from audit_events where event_type = 'voided'")
      .get() as { event_type: string; resource_type: string; resource_id: string };
    expect(audit.resource_id).toBe(stored.id);

    const page = getCaptureTimeline(sqlite, { businessDate: "2026-08-09" });
    expect(page.items).toHaveLength(0);
  });

  it("rejects voiding an unknown item or a mismatched business date", async () => {
    const { voider, seedOneCapture } = setup();
    const stored = await seedOneCapture();

    await expect(
      voider("void-test-key-00000002")({ itemId: "missing-item", businessDate: "2026-08-09" }),
    ).rejects.toThrowError(CaptureVoidConflictError);
    await expect(
      voider("void-test-key-00000003")({ itemId: stored.id, businessDate: "2026-08-10" }),
    ).rejects.toThrowError(CaptureVoidConflictError);
  });

  it("replays the same idempotency key without creating a second void", async () => {
    const { sqlite, voider, seedOneCapture } = setup();
    const stored = await seedOneCapture();

    const first = await voider("void-test-key-00000004")({
      itemId: stored.id,
      businessDate: "2026-08-09",
    });
    const replay = await voider("void-test-key-00000004")({
      itemId: stored.id,
      businessDate: "2026-08-09",
    });

    expect(replay).toEqual(first);
    expect(
      sqlite
        .prepare("select count(*) from capture_items where event_type = 'void'")
        .pluck()
        .get(),
    ).toBe(1);
  });

  it("is a no-op when the item was already voided under a different key", async () => {
    const { sqlite, voider, seedOneCapture } = setup();
    const stored = await seedOneCapture();

    await voider("void-test-key-00000005")({ itemId: stored.id, businessDate: "2026-08-09" });
    const second = await voider("void-test-key-00000006")({
      itemId: stored.id,
      businessDate: "2026-08-09",
    });

    expect(
      sqlite
        .prepare("select count(*) from capture_items where event_type = 'void'")
        .pluck()
        .get(),
    ).toBe(1);
    expect(second.itemId).toBe(stored.id);
  });
});
