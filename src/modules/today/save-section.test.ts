import { describe, expect, it, vi } from "vitest";

import type { EntrySectionInput, StoredCapture } from "./contracts";
import { entrySectionSchema } from "./contracts";
import { saveTodaySection } from "./save-section";

const SAFE_STORAGE_FAILURE_MESSAGE = "保存失败，请稍后重试";
const captureInput: EntrySectionInput = {
  section: "entry",
  draftId: "draft-00000001",
  businessDate: "2026-08-09",
  occurredAt: "2026-08-09T08:30:00.000Z",
  value: { text: "A factual entry." },
};
const stored: StoredCapture = {
  id: "capture-1",
  draftId: "draft-00000001",
  businessDate: "2026-08-09",
  occurredAt: "2026-08-09T08:30:00.000Z",
  text: "A factual entry.",
  createdAt: "2026-08-09T12:00:00.000Z",
};

describe("entry capture contract", () => {
  it("accepts only strict append-only facts and rejects edit fields", () => {
    expect(entrySectionSchema.safeParse(captureInput).success).toBe(true);
    expect(entrySectionSchema.safeParse({ ...captureInput, recordId: "old", revision: 1 }).success)
      .toBe(false);
    expect(entrySectionSchema.safeParse({ ...captureInput, value: { text: "ok", extra: true } }).success)
      .toBe(false);
    expect(entrySectionSchema.safeParse({ ...captureInput, value: { text: "x".repeat(20_001) } }).success)
      .toBe(false);
  });
});

describe("saveTodaySection", () => {
  it("returns the authoritative stored capture for a successful entry save", async () => {
    const result = await saveTodaySection(captureInput, {
      saveEntry: async () => stored,
    });

    expect(result).toEqual({ section: "entry", status: "saved", item: stored });
  });

  it("returns an invalid result without invoking a saver", async () => {
    const saveEntry = vi.fn(async () => stored);

    const result = await saveTodaySection(
      { ...captureInput, value: { text: "   " } },
      { saveEntry },
    );

    expect(result).toMatchObject({ section: "entry", status: "invalid" });
    expect(saveEntry).not.toHaveBeenCalled();
  });

  it("maps only the typed idempotency conflict to a conflict result", async () => {
    const saverModule = await import("./save-entry") as unknown as {
      IdempotencyConflictError?: new () => Error;
    };

    const IdempotencyConflictError = saverModule.IdempotencyConflictError;
    expect(IdempotencyConflictError).toBeTypeOf("function");
    if (!IdempotencyConflictError) return;

    const result = await saveTodaySection(captureInput, {
      saveEntry: async () => {
        throw new IdempotencyConflictError();
      },
    });

    expect(result).toMatchObject({ section: "entry", status: "conflict" });
  });

  it("maps unexpected storage text to one fixed non-sensitive failure", async () => {
    const sentinel = "SQLITE_ERROR C:\\private\\captures\\today.sqlite";
    const result = await saveTodaySection(captureInput, {
      saveEntry: async () => {
        throw new Error(sentinel);
      },
    });

    expect(result).toEqual({
      section: "entry",
      status: "failed",
      message: SAFE_STORAGE_FAILURE_MESSAGE,
    });
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });
});
