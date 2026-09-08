import { describe, expect, it, vi } from "vitest";

import type { StoredCapture } from "./contracts";
import { handleTodaySectionRequest } from "./request-handler";

const SAFE_STORAGE_FAILURE_MESSAGE = "保存失败，请稍后重试";
const body = {
  section: "entry",
  draftId: "draft-00000001",
  businessDate: "2026-08-09",
  occurredAt: "2026-08-09T08:30:00.000Z",
  value: { text: "API captures an immutable fact." },
};
const item: StoredCapture = {
  id: "capture-1",
  draftId: "draft-00000001",
  businessDate: "2026-08-09",
  occurredAt: "2026-08-09T08:30:00.000Z",
  text: "API captures an immutable fact.",
  createdAt: "2026-08-09T12:00:00.000Z",
};

function request(overrides?: {
  origin?: string;
  idempotencyKey?: string | null;
  body?: string;
}): Request {
  const headers = new Headers({
    host: "127.0.0.1:3000",
    origin: overrides?.origin ?? "http://127.0.0.1:3000",
    "content-type": "application/json",
  });
  const key = overrides?.idempotencyKey === undefined ? "request-key-0001" : overrides.idempotencyKey;
  if (key) headers.set("idempotency-key", key);
  return new Request("http://127.0.0.1:3000/api/v1/today/sections", {
    method: "POST",
    headers,
    body: overrides?.body ?? JSON.stringify(body),
  });
}

describe("handleTodaySectionRequest", () => {
  it("passes one strict capture and key to the saver then returns its authoritative item", async () => {
    const save = vi.fn(async () => ({
      section: "entry" as const,
      status: "saved" as const,
      item,
    }));

    const response = await handleTodaySectionRequest(request(), { save });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ section: "entry", status: "saved", item });
    expect(save).toHaveBeenCalledWith(body, "request-key-0001");
  });

  it("requires an idempotency key", async () => {
    const response = await handleTodaySectionRequest(request({ idempotencyKey: null }), {
      save: vi.fn(),
    });

    expect(response.status).toBe(400);
  });

  it("rejects a foreign origin before calling the saver", async () => {
    const save = vi.fn();

    const response = await handleTodaySectionRequest(
      request({ origin: "https://evil.example" }),
      { save },
    );

    expect(response.status).toBe(403);
    expect(save).not.toHaveBeenCalled();
  });

  it("returns a clear response for malformed JSON", async () => {
    const response = await handleTodaySectionRequest(request({ body: "{" }), {
      save: vi.fn(),
    });

    expect(response.status).toBe(400);
  });

  it("maps strict schema failures, including legacy edit fields, to HTTP 422", async () => {
    const save = vi.fn();
    const response = await handleTodaySectionRequest(
      request({ body: JSON.stringify({ ...body, recordId: "old", revision: 1 }) }),
      { save },
    );

    expect(response.status).toBe(422);
    expect(save).not.toHaveBeenCalled();
  });

  it("maps a typed idempotency conflict result to HTTP 409", async () => {
    const response = await handleTodaySectionRequest(request(), {
      save: async () => ({
        section: "entry",
        status: "conflict",
        message: "该请求标识已用于其他内容",
      }),
    });

    expect(response.status).toBe(409);
  });

  it("maps a safe storage failure result to the fixed HTTP 500 contract", async () => {
    const response = await handleTodaySectionRequest(request(), {
      save: async () => ({
        section: "entry",
        status: "failed",
        message: SAFE_STORAGE_FAILURE_MESSAGE,
      }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      section: "entry",
      status: "failed",
      message: SAFE_STORAGE_FAILURE_MESSAGE,
    });
  });

  it("rebuilds even resolved failed results as the fixed safe HTTP 500 contract", async () => {
    const sentinel = "SQLITE_ERROR C:\\private\\captures\\today.sqlite";
    const response = await handleTodaySectionRequest(request(), {
      save: async () => ({
        section: "entry",
        status: "failed",
        message: sentinel,
      }),
    });

    expect(response.status).toBe(500);
    const result = await response.json();
    expect(result).toEqual({
      section: "entry",
      status: "failed",
      message: SAFE_STORAGE_FAILURE_MESSAGE,
    });
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });

  it("contains unexpected dependency exceptions behind the fixed safe HTTP 500 response", async () => {
    const sentinel = "SQLITE_ERROR C:\\private\\captures\\today.sqlite";
    const response = await handleTodaySectionRequest(request(), {
      save: async () => {
        throw new Error(sentinel);
      },
    });

    expect(response.status).toBe(500);
    const result = await response.json();
    expect(result).toEqual({
      section: "entry",
      status: "failed",
      message: SAFE_STORAGE_FAILURE_MESSAGE,
    });
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });
});
