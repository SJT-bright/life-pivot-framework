import { describe, expect, it, vi } from "vitest";

import { IdempotentCommandConflictError } from "@/core/db/idempotent-command";

import type { HealthChecklistCommand, HealthChecklistDay } from "./contracts";
import { handleHealthChecklistRequest } from "./request-handler";
import {
  HealthChecklistConflictError,
  HealthChecklistValidationError,
} from "./service";

const day: HealthChecklistDay = {
  id: "health-day-0001",
  businessDate: "2026-08-12",
  templateId: "health-default",
  templateVersionId: "health-version-0001",
  templateRevision: 1,
  templateName: "我的健康清单",
  note: "",
  revision: 1,
  persistentItemKeys: [],
  items: [],
};

const command: HealthChecklistCommand = {
  type: "save-health-checklist-note",
  businessDate: "2026-08-12",
  note: "今天状态正常",
  expectedDayRevision: 1,
};

function get(query = "date=2026-08-12") {
  return new Request(`http://127.0.0.1:3000/api/v1/health-checklist?${query}`);
}

function post(overrides: Partial<{
  body: string;
  idempotencyKey: string | null;
  origin: string;
  contentType: string;
}> = {}) {
  const headers = new Headers({
    host: "127.0.0.1:3000",
    origin: overrides.origin ?? "http://127.0.0.1:3000",
    "content-type": overrides.contentType ?? "application/json",
  });
  const key = overrides.idempotencyKey === undefined
    ? "health-request-key-0001"
    : overrides.idempotencyKey;
  if (key) headers.set("idempotency-key", key);
  return new Request("http://127.0.0.1:3000/api/v1/health-checklist", {
    method: "POST",
    headers,
    body: overrides.body ?? JSON.stringify(command),
  });
}

describe("health checklist request handler", () => {
  it("materializes one strict GET date and returns a wrapped no-store day", async () => {
    const materialize = vi.fn(async () => day);
    const response = await handleHealthChecklistRequest(get(), {
      materialize,
      execute: vi.fn(),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ day });
    expect(materialize).toHaveBeenCalledWith("2026-08-12");
  });

  it("rejects missing, repeated, unknown, and impossible GET dates", async () => {
    for (const query of ["", "date=2026-02-30", "date=2026-08-12&date=2026-08-13", "view=history"]) {
      const materialize = vi.fn();
      const response = await handleHealthChecklistRequest(get(query), {
        materialize,
        execute: vi.fn(),
      });
      expect(response.status, query).toBe(400);
      expect(materialize).not.toHaveBeenCalled();
    }
  });

  it("passes one strict local POST command and wraps the result", async () => {
    const execute = vi.fn(async () => day);
    const response = await handleHealthChecklistRequest(post(), {
      materialize: vi.fn(),
      execute,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: day });
    expect(execute).toHaveBeenCalledWith(command, "health-request-key-0001");
  });

  it("blocks unsafe and malformed POSTs before execution", async () => {
    const cases = [
      [post({ origin: "https://evil.example" }), 403],
      [post({ idempotencyKey: null }), 400],
      [post({ body: "{" }), 400],
      [post({ body: JSON.stringify({ ...command, extra: true }) }), 422],
      [post({ contentType: "text/plain" }), 415],
    ] as const;
    for (const [request, status] of cases) {
      const execute = vi.fn();
      const response = await handleHealthChecklistRequest(request, {
        materialize: vi.fn(),
        execute,
      });
      expect(response.status).toBe(status);
      expect(execute).not.toHaveBeenCalled();
    }
  });

  it("maps known conflicts to 409 and contains internal failures", async () => {
    for (const error of [new IdempotentCommandConflictError(), new HealthChecklistConflictError()]) {
      const response = await handleHealthChecklistRequest(post(), {
        materialize: vi.fn(),
        execute: async () => { throw error; },
      });
      expect(response.status).toBe(409);
    }
    const invalid = await handleHealthChecklistRequest(post(), {
      materialize: vi.fn(),
      execute: async () => { throw new HealthChecklistValidationError(); },
    });
    expect(invalid.status).toBe(422);
    const failed = await handleHealthChecklistRequest(get(), {
      materialize: async () => { throw new Error("C:\\private\\health.sqlite"); },
      execute: vi.fn(),
    });
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain("private");
  });
});
