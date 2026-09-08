import { describe, expect, it, vi } from "vitest";

import { toShanghaiBusinessDate } from "@/core/time/business-date";

import {
  CAPTURE_DRAFT_STORAGE_KEY,
  loadCaptureDraftEnvelope,
  persistCaptureDraftEnvelope,
  recoverLegacyDraft,
  startDraft,
  updateDraft,
} from "./capture-draft";

function draftDependencies(iso: string) {
  let sequence = 0;
  return {
    now: () => new Date(iso),
    createId: () => `draft-${String(++sequence).padStart(8, "0")}`,
    toBusinessDate: toShanghaiBusinessDate,
  };
}

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(seed));
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe("capture draft state", () => {
  it("freezes the business date and identities on first non-empty input", () => {
    expect(
      startDraft(undefined, "文字", draftDependencies("2026-08-09T23:59:00+08:00")),
    ).toEqual({
      version: 1,
      draftId: "draft-00000001",
      draftBusinessDate: "2026-08-09",
      occurredAt: "2026-08-09T15:59:00.000Z",
      idempotencyKey: "draft-00000002",
      text: "文字",
    });
  });

  it("creates a new-day draft only after the old draft becomes truly empty", () => {
    const old = startDraft(
      undefined,
      "A",
      draftDependencies("2026-08-09T23:59:00+08:00"),
    );
    expect(old).toBeDefined();
    expect(updateDraft(old!, "")).toBeUndefined();
    expect(
      startDraft(undefined, "B", draftDependencies("2026-08-10T00:01:00+08:00")),
    ).toMatchObject({ draftBusinessDate: "2026-08-10", text: "B" });
  });

  it("hydrates interrupted saves as uncertain without changing frozen identities", () => {
    const storage = memoryStorage({
      [CAPTURE_DRAFT_STORAGE_KEY]: JSON.stringify({
        version: 1,
        pending: [{
          status: "saving",
          draft: startDraft(undefined, "A", draftDependencies("2026-08-09T08:00:00Z")),
        }],
        legacy: [],
      }),
    });

    const loaded = loadCaptureDraftEnvelope(storage);

    expect(loaded.writable).toBe(true);
    expect(loaded.envelope.pending[0]).toMatchObject({
      status: "uncertain",
      draft: {
        draftId: "draft-00000001",
        idempotencyKey: "draft-00000002",
      },
    });
  });

  it("imports only strict legacy keys as read-only recovery evidence", () => {
    const storage = memoryStorage({
      "life-pivot:draft:entry:2026-08-09:tab-a": "  first  ",
      "life-pivot:draft:entry:2026-08-10:tab-b": "second",
      "life-pivot:draft:entry:2026-02-30:bad": "invalid date",
      "life-pivot:draft:entry:2026-08-09": "missing suffix",
      "other:key": "unrelated",
    });

    const loaded = loadCaptureDraftEnvelope(storage);

    expect(loaded.envelope.legacy).toEqual([
      {
        sourceKey: "life-pivot:draft:entry:2026-08-09:tab-a",
        businessDate: "2026-08-09",
        text: "  first  ",
      },
      {
        sourceKey: "life-pivot:draft:entry:2026-08-10:tab-b",
        businessDate: "2026-08-10",
        text: "second",
      },
    ]);
    expect(storage.getItem("life-pivot:draft:entry:2026-08-09:tab-a")).toBe("  first  ");
  });

  it("preserves invalid or newer envelopes as unreadable evidence", () => {
    for (const raw of ["not-json", JSON.stringify({ version: 2, pending: [], legacy: [] })]) {
      const storage = memoryStorage({ [CAPTURE_DRAFT_STORAGE_KEY]: raw });
      const loaded = loadCaptureDraftEnvelope(storage);

      expect(loaded.writable).toBe(false);
      expect(loaded.recoveryMessage).toBeTruthy();
      expect(storage.getItem(CAPTURE_DRAFT_STORAGE_KEY)).toBe(raw);
      expect(loaded.envelope).toEqual({ version: 1, pending: [], legacy: [] });
    }
  });

  it("reports persistence failure without deleting recovery evidence", () => {
    const storage = memoryStorage({ "life-pivot:draft:entry:2026-08-09:tab": "evidence" });
    storage.setItem = vi.fn(() => { throw new Error("quota"); });
    const loaded = loadCaptureDraftEnvelope(storage);

    expect(persistCaptureDraftEnvelope(storage, loaded.envelope)).toBe(false);
    expect(storage.getItem("life-pivot:draft:entry:2026-08-09:tab")).toBe("evidence");
  });

  it("explicitly recovers one legacy item without deleting its source key", () => {
    const storage = memoryStorage({ "life-pivot:draft:entry:2026-08-09:tab": "old text" });
    const loaded = loadCaptureDraftEnvelope(storage);

    const recovered = recoverLegacyDraft(
      loaded.envelope,
      "life-pivot:draft:entry:2026-08-09:tab",
      draftDependencies("2026-08-10T08:00:00Z"),
    );

    expect(recovered.current).toMatchObject({
      draftBusinessDate: "2026-08-09",
      text: "old text",
    });
    expect(recovered.legacy).toEqual([]);
    expect(storage.getItem("life-pivot:draft:entry:2026-08-09:tab")).toBe("old text");
  });
});
