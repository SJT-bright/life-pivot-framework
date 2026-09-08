import { describe, expect, it, vi } from "vitest";

import { IdempotentCommandConflictError } from "@/core/db/idempotent-command";

import type {
  PersonalKnowledgeCommand,
  PersonalKnowledgeResult,
  PersonalKnowledgeSnapshot,
} from "./contracts";
import { handlePersonalKnowledgeRequest } from "./request-handler";
import { PersonalKnowledgeConflictError } from "./service";

const snapshot: PersonalKnowledgeSnapshot = {
  businessDate: "2026-08-13",
  modules: [],
  dailyNotes: [],
};

const command: PersonalKnowledgeCommand = {
  type: "save-module",
  moduleId: "module-http-0001",
  parentModuleId: null,
  name: "HTTP module",
  goal: "",
  currentFocus: "",
  description: "",
  status: "learning",
  ordinal: 0,
  expectedModuleRevision: 0,
  expectedParentRevision: 0,
};

const result: PersonalKnowledgeResult = {
  snapshot,
  applied: {
    operation: "save-module",
    ownerId: "module-http-0001",
    ownerRevision: 1,
    businessDate: null,
  },
};

function getRequest(
  query = "date=2026-08-13",
  origin = "http://127.0.0.1:3000",
): Request {
  return new Request(`${origin}/api/v1/personal-knowledge?${query}`);
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
    headers.set("idempotency-key", overrides.idempotencyKey ?? "personal-knowledge-http-key");
  }
  return new Request("http://127.0.0.1:3000/api/v1/personal-knowledge", {
    method: "POST",
    headers,
    body: overrides.body ?? JSON.stringify(command),
  });
}

describe("personal knowledge request handler", () => {
  it("rejects remote GET requests before reading a snapshot", async () => {
    const getSnapshot = vi.fn(() => snapshot);
    const response = await handlePersonalKnowledgeRequest(
      getRequest("date=2026-08-13", "http://192.168.1.20:3000"),
      { getSnapshot, execute: vi.fn() },
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ message: "Local access only." });
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it("parses the exact bounded GET query and returns a no-store snapshot wrapper", async () => {
    const getSnapshot = vi.fn(() => snapshot);
    const response = await handlePersonalKnowledgeRequest(
      getRequest("date=2026-08-13&noteLimit=5&itemLimit=7"),
      { getSnapshot, execute: vi.fn() },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ snapshot });
    expect(getSnapshot).toHaveBeenCalledWith({
      businessDate: "2026-08-13",
      noteLimit: 5,
      itemLimit: 7,
    });
  });

  it("rejects unknown, duplicate, invalid date, and invalid limit GET queries before reading", async () => {
    for (const query of [
      "date=2026-08-13&unknown=x",
      "date=2026-08-13&date=2026-08-13",
      "date=2026-02-30",
      "date=2026-08-13&noteLimit=0",
      "date=2026-08-13&noteLimit=101",
      "date=2026-08-13&itemLimit=1.5",
      "date=2026-08-13&itemLimit=1e2",
    ]) {
      const getSnapshot = vi.fn();
      const response = await handlePersonalKnowledgeRequest(getRequest(query), {
        getSnapshot,
        execute: vi.fn(),
      });
      expect(response.status, query).toBe(400);
      expect(response.headers.get("cache-control"), query).toBe("no-store");
      expect(getSnapshot).not.toHaveBeenCalled();
    }
  });

  it("passes one strict local JSON command and idempotency key and returns the result wrapper", async () => {
    const execute = vi.fn(async () => result);
    const response = await handlePersonalKnowledgeRequest(postRequest(), {
      getSnapshot: vi.fn(),
      execute,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ result });
    expect(execute).toHaveBeenCalledWith(command, "personal-knowledge-http-key");
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
      const response = await handlePersonalKnowledgeRequest(request, { getSnapshot: vi.fn(), execute });
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(execute).not.toHaveBeenCalled();
    }

    for (const error of [new PersonalKnowledgeConflictError(), new IdempotentCommandConflictError()]) {
      const response = await handlePersonalKnowledgeRequest(postRequest(), {
        getSnapshot: vi.fn(),
        execute: async () => { throw error; },
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        message: "Personal knowledge command conflicts with current state.",
      });
    }

    const failed = await handlePersonalKnowledgeRequest(postRequest(), {
      getSnapshot: vi.fn(),
      execute: async () => { throw new Error("SQLITE_ERROR C:\\private\\knowledge.sqlite secret"); },
    });
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain("private");
  });

  it("contains GET failures and rejects unsupported methods without invoking dependencies", async () => {
    const failed = await handlePersonalKnowledgeRequest(getRequest(), {
      getSnapshot: () => { throw new Error("SQLITE_ERROR C:\\private\\knowledge.sqlite"); },
      execute: vi.fn(),
    });
    expect(failed.status).toBe(500);
    expect(failed.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(await failed.json())).not.toContain("private");

    const getSnapshot = vi.fn();
    const execute = vi.fn();
    const method = await handlePersonalKnowledgeRequest(new Request(
      "http://127.0.0.1:3000/api/v1/personal-knowledge",
      { method: "PUT" },
    ), { getSnapshot, execute });
    expect(method.status).toBe(405);
    expect(method.headers.get("cache-control")).toBe("no-store");
    expect(getSnapshot).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
