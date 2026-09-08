import { createHash } from "node:crypto";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { migrateDatabase } from "@/core/db/migrate";

import type { EntrySectionInput } from "./contracts";
import { createEntrySaver } from "./save-entry";

const databases: Database.Database[] = [];
const SAFE_STORAGE_FAILURE_MESSAGE = "保存失败，请稍后重试";

const captureInput: EntrySectionInput = {
  section: "entry",
  draftId: "draft-00000001",
  businessDate: "2026-08-09",
  occurredAt: "2026-08-09T08:30:00.000Z",
  value: { text: "Capture facts stay immutable." },
};

function setup() {
  const sqlite = new Database(":memory:");
  databases.push(sqlite);
  migrateDatabase(sqlite);
  let id = 0;

  return {
    sqlite,
    saver: (idempotencyKey: string, options?: { writeBarrier?: { runWrite<T>(action: () => Promise<T> | T): Promise<T> } }) =>
      createEntrySaver(sqlite, {
        idempotencyKey,
        now: () => new Date("2026-08-09T12:00:00.000Z"),
        createId: () => `generated-${++id}`,
        ...options,
      }),
  };
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe("createEntrySaver", () => {
  it("inserts one immutable capture, audit event, and full idempotency response", async () => {
    const { sqlite, saver } = setup();

    const stored = await saver("request-key-0001")(captureInput);

    expect(stored).toEqual({
      id: "generated-1",
      draftId: "draft-00000001",
      businessDate: "2026-08-09",
      occurredAt: "2026-08-09T08:30:00.000Z",
      text: "Capture facts stay immutable.",
      createdAt: "2026-08-09T12:00:00.000Z",
    });
    expect(
      sqlite.prepare(
        "select id, event_type, business_date, occurred_at, content, created_at from capture_items",
      ).get(),
    ).toEqual({
      id: "generated-1",
      event_type: "capture",
      business_date: "2026-08-09",
      occurred_at: "2026-08-09T08:30:00.000Z",
      content: "Capture facts stay immutable.",
      created_at: "2026-08-09T12:00:00.000Z",
    });
    expect(sqlite.prepare("select resource_type, resource_id from audit_events").get()).toEqual({
      resource_type: "capture_item",
      resource_id: "generated-1",
    });
    expect(sqlite.prepare("select response_json from idempotency_keys").pluck().get()).toBe(
      JSON.stringify(stored),
    );
  });

  it("replays an identical request and rejects every changed fact under the same key", async () => {
    const { sqlite, saver } = setup();

    const first = await saver("request-key-0001")(captureInput);
    await expect(saver("request-key-0001")(captureInput)).resolves.toEqual(first);

    const variants: EntrySectionInput[] = [
      { ...captureInput, draftId: "draft-00000002" },
      { ...captureInput, businessDate: "2026-08-10" },
      { ...captureInput, occurredAt: "2026-08-09T08:31:00.000Z" },
      { ...captureInput, value: { text: "Different fact." } },
    ];

    for (const variant of variants) {
      await expect(saver("request-key-0001")(variant)).rejects.toMatchObject({
        name: "IdempotencyConflictError",
      });
    }
    expect(sqlite.prepare("select count(*) as count from capture_items").get()).toEqual({ count: 1 });
  });

  it("canonicalizes equivalent ISO instants before hashing and storing", async () => {
    const { sqlite, saver } = setup();
    const wholeSecond = { ...captureInput, occurredAt: "2026-08-09T08:30:00Z" };
    const millisecond = { ...captureInput, occurredAt: "2026-08-09T08:30:00.000Z" };

    const first = await saver("request-key-0001")(wholeSecond);

    expect(first.occurredAt).toBe("2026-08-09T08:30:00.000Z");
    await expect(saver("request-key-0001")(millisecond)).resolves.toEqual(first);
    expect(sqlite.prepare("select occurred_at from capture_items").pluck().get()).toBe(
      "2026-08-09T08:30:00.000Z",
    );
  });

  it("replays an exact pre-normalization idempotency record after upgrade", async () => {
    const { sqlite, saver } = setup();
    const legacyInput = { ...captureInput, occurredAt: "2026-08-09T08:30:00Z" };
    const legacyResponse = {
      id: "legacy-capture",
      draftId: legacyInput.draftId,
      businessDate: legacyInput.businessDate,
      occurredAt: legacyInput.occurredAt,
      text: legacyInput.value.text,
      createdAt: "2026-08-09T12:00:00.000Z",
    };
    const legacyHash = createHash("sha256").update(JSON.stringify({
      section: legacyInput.section,
      draftId: legacyInput.draftId,
      businessDate: legacyInput.businessDate,
      occurredAt: legacyInput.occurredAt,
      value: { text: legacyInput.value.text },
    }), "utf8").digest("hex");
    sqlite.prepare(`insert into idempotency_keys
      (key, operation, request_hash, response_json, created_at)
      values (?, 'today.entry.save', ?, ?, '2026-08-09T12:00:00.000Z')`)
      .run("request-key-legacy", legacyHash, JSON.stringify(legacyResponse));

    await expect(saver("request-key-legacy")(legacyInput)).resolves.toEqual(legacyResponse);
  });

  it("wraps write-barrier storage failures without exposing their private details", async () => {
    const { saver } = setup();
    const sentinel = "SQLITE_BUSY at C:\\private\\captures\\today.sqlite";
    const writeBarrier = {
      runWrite: async <T>(): Promise<T> => {
        throw new Error(sentinel);
      },
    };

    await expect(saver("request-key-0001", { writeBarrier })(captureInput)).rejects.toMatchObject({
      name: "CaptureStorageError",
      message: SAFE_STORAGE_FAILURE_MESSAGE,
    });
  });

  it("rolls back the capture when a later audit write fails", async () => {
    const { sqlite, saver } = setup();
    sqlite.exec(`
      create trigger reject_capture_audit
      before insert on audit_events
      begin
        select raise(abort, 'SQLITE_ERROR C:\\private\\captures\\audit.sqlite');
      end
    `);

    await expect(saver("request-key-0001")(captureInput)).rejects.toMatchObject({
      name: "CaptureStorageError",
      message: SAFE_STORAGE_FAILURE_MESSAGE,
    });
    expect(sqlite.prepare("select count(*) as count from capture_items").get()).toEqual({ count: 0 });
    expect(sqlite.prepare("select count(*) as count from audit_events").get()).toEqual({ count: 0 });
    expect(sqlite.prepare("select count(*) as count from idempotency_keys").get()).toEqual({ count: 0 });
  });
});
