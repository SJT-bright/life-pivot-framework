import { describe, expect, it, vi } from "vitest";

import { IdempotentCommandConflictError } from "@/core/db/idempotent-command";

import type {
  ReadingCommand,
  ReadingResult,
  ReadingSnapshot,
} from "./contracts";
import { handleReadingRequest } from "./request-handler";
import { ReadingConflictError } from "./service";

const snapshot: ReadingSnapshot = {
  books: [],
  notes: [],
};

const command: ReadingCommand = {
  type: "save-book",
  bookId: "book-http-0001",
  title: "HTTP 测试书",
  author: "",
  status: "wishlist",
  totalPages: null,
  currentPage: 0,
  rating: null,
  expectedRevision: 0,
};

const result: ReadingResult = {
  snapshot,
  applied: {
    operation: "save-book",
    ownerId: "book-http-0001",
    ownerRevision: 1,
    businessDate: null,
  },
};

function getRequest(
  origin = "http://127.0.0.1:3000",
  url = "/api/v1/reading",
): Request {
  return new Request(`${origin}${url}`);
}

function postRequest(overrides: {
  body?: string;
  contentType?: string;
  host?: string;
  origin?: string | null;
  idempotencyKey?: string | null;
} = {}): Request {
  const headers = new Headers();
  headers.set("host", overrides.host ?? "127.0.0.1:3000");
  headers.set("content-type", overrides.contentType ?? "application/json; charset=utf-8");
  if (overrides.origin !== null) headers.set("origin", overrides.origin ?? "http://127.0.0.1:3000");
  if (overrides.idempotencyKey !== null) {
    headers.set("idempotency-key", overrides.idempotencyKey ?? "reading-http-key-0001");
  }
  return new Request("http://127.0.0.1:3000/api/v1/reading", {
    method: "POST",
    headers,
    body: overrides.body ?? JSON.stringify(command),
  });
}

describe("reading request handler", () => {
  it("rejects remote GET requests before reading a snapshot", async () => {
    const getSnapshot = vi.fn(() => snapshot);
    const response = await handleReadingRequest(
      getRequest("http://192.168.1.20:3000"),
      { getSnapshot, execute: vi.fn() },
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ message: "Local access only." });
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it("returns a no-store snapshot wrapper and rejects unknown query keys", async () => {
    const getSnapshot = vi.fn(() => snapshot);
    const ok = await handleReadingRequest(getRequest(), { getSnapshot, execute: vi.fn() });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(await ok.json()).toEqual({ snapshot });

    const bad = await handleReadingRequest(
      getRequest("http://127.0.0.1:3000", "/api/v1/reading?unknown=x"),
      { getSnapshot: vi.fn(), execute: vi.fn() },
    );
    expect(bad.status).toBe(400);
    expect(getSnapshot).toHaveBeenCalledTimes(1);
  });

  it("passes one strict local JSON command and idempotency key and returns the result wrapper", async () => {
    const execute = vi.fn(async () => result);
    const response = await handleReadingRequest(postRequest(), {
      getSnapshot: vi.fn(),
      execute,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ result });
    expect(execute).toHaveBeenCalledWith(command, "reading-http-key-0001");
  });

  it("maps unsafe boundaries, malformed JSON, strict validation, conflicts, and failures anonymously", async () => {
    const boundaryCases = [
      { request: postRequest({ origin: "https://evil.example" }), status: 403 },
      { request: postRequest({ contentType: "text/plain" }), status: 415 },
      { request: postRequest({ idempotencyKey: null }), status: 400 },
      { request: postRequest({ idempotencyKey: "short" }), status: 400 },
      { request: postRequest({ body: "{" }), status: 400 },
      { request: postRequest({ body: JSON.stringify({ ...command, unknown: true }) }), status: 422 },
    ];
    for (const { request, status } of boundaryCases) {
      const execute = vi.fn();
      const response = await handleReadingRequest(request, { getSnapshot: vi.fn(), execute });
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(execute).not.toHaveBeenCalled();
    }

    for (const error of [new ReadingConflictError(), new IdempotentCommandConflictError()]) {
      const response = await handleReadingRequest(postRequest(), {
        getSnapshot: vi.fn(),
        execute: async () => { throw error; },
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        message: "Reading command conflicts with current state.",
      });
    }

    const failed = await handleReadingRequest(postRequest(), {
      getSnapshot: vi.fn(),
      execute: async () => { throw new Error("SQLITE_ERROR C:\\private\\reading.sqlite secret"); },
    });
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain("private");
  });

  it("contains GET failures and rejects unsupported methods without invoking dependencies", async () => {
    const failed = await handleReadingRequest(getRequest(), {
      getSnapshot: () => { throw new Error("SQLITE_ERROR C:\\private\\reading.sqlite"); },
      execute: vi.fn(),
    });
    expect(failed.status).toBe(500);
    expect(failed.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(await failed.json())).not.toContain("private");

    const getSnapshot = vi.fn();
    const execute = vi.fn();
    const method = await handleReadingRequest(new Request(
      "http://127.0.0.1:3000/api/v1/reading",
      { method: "PUT" },
    ), { getSnapshot, execute });
    expect(method.status).toBe(405);
    expect(method.headers.get("cache-control")).toBe("no-store");
    expect(getSnapshot).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
