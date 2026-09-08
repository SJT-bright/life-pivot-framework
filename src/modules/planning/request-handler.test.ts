import { describe, expect, it, vi } from "vitest";

import {
  IdempotentCommandConflictError,
} from "@/core/db/idempotent-command";
import { RevisionConflictError } from "@/core/mutations/revision";

import type { PlanningCommand, PlanningSnapshot } from "./contracts";
import { PlanningValidationError } from "./contracts";
import { PlanningConflictError } from "./service";
import { handlePlanningRequest } from "./request-handler";

const command: PlanningCommand = {
  type: "create-goal",
  id: "goal-long-0001",
  lifeAreaId: "life-area-general",
  goalType: "long-term",
  title: "Create a reliable goal",
  description: "",
};

const snapshot: PlanningSnapshot = {
  businessDate: "2026-08-10",
  lifeAreas: [{ id: "life-area-general", name: "General" }],
  goals: [],
  weeklyActions: [],
  todayActions: [],
  overdueActions: [],
  unassignedActions: [],
};

function getRequest(query = "date=2026-08-10"): Request {
  return new Request(`http://127.0.0.1:3000/api/v1/planning?${query}`);
}

function postRequest(overrides?: {
  origin?: string;
  idempotencyKey?: string | null;
  body?: string;
  contentType?: string;
}): Request {
  const headers = new Headers({
    host: "127.0.0.1:3000",
    origin: overrides?.origin ?? "http://127.0.0.1:3000",
    "content-type": overrides?.contentType ?? "application/json",
  });
  const key = overrides?.idempotencyKey === undefined
    ? "planning-idempotency-0001"
    : overrides.idempotencyKey;
  if (key) headers.set("idempotency-key", key);
  return new Request("http://127.0.0.1:3000/api/v1/planning", {
    method: "POST",
    headers,
    body: overrides?.body ?? JSON.stringify(command),
  });
}

describe("handlePlanningRequest", () => {
  it("returns a no-store snapshot for one strict GET date", async () => {
    const getSnapshot = vi.fn(() => snapshot);

    const response = await handlePlanningRequest(getRequest(), {
      getSnapshot,
      execute: vi.fn(),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(snapshot);
    expect(getSnapshot).toHaveBeenCalledWith({ businessDate: "2026-08-10" });
  });

  it("rejects malformed, repeated, and unknown GET query values without exposing service details", async () => {
    for (const query of ["", "date=2026-02-30", "date=2026-08-10&date=2026-08-11", "foo=bar"]) {
      const response = await handlePlanningRequest(getRequest(query), {
        getSnapshot: vi.fn(),
        execute: vi.fn(),
      });
      expect(response.status, query).toBe(400);
      expect(response.headers.get("cache-control"), query).toBe("no-store");
    }

    const sentinel = "SQLITE_ERROR C:\\private\\planning.sqlite";
    const response = await handlePlanningRequest(getRequest(), {
      getSnapshot: () => {
        throw new Error(sentinel);
      },
      execute: vi.fn(),
    });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(sentinel);
  });

  it("passes one strict local JSON command and idempotency key to the service", async () => {
    const execute = vi.fn(async () => snapshot);

    const response = await handlePlanningRequest(postRequest(), {
      getSnapshot: vi.fn(),
      execute,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(snapshot);
    expect(execute).toHaveBeenCalledWith(command, "planning-idempotency-0001");
  });

  // JSON parameters are valid, but lookalike media types must not bypass the boundary.
  it("accepts an application/json content type with a charset parameter", async () => {
    const execute = vi.fn(async () => snapshot);

    const response = await handlePlanningRequest(
      postRequest({ contentType: "application/json; charset=utf-8" }),
      { getSnapshot: vi.fn(), execute },
    );

    expect(response.status).toBe(200);
    expect(execute).toHaveBeenCalledWith(command, "planning-idempotency-0001");
  });

  // Every rejected HTTP boundary must have a deterministic status and no command side effect.
  it("rejects unsafe, malformed, missing-key, and non-strict POST inputs before executing", async () => {
    const cases = [
      { request: postRequest({ origin: "https://evil.example" }), status: 403 },
      { request: postRequest({ idempotencyKey: null }), status: 400 },
      { request: postRequest({ body: "{" }), status: 400 },
      { request: postRequest({ body: JSON.stringify({ ...command, unknown: true }) }), status: 422 },
      { request: postRequest({ contentType: "text/plain" }), status: 415 },
      { request: postRequest({ contentType: "application/jsonx" }), status: 415 },
    ];

    for (const { request, status } of cases) {
      const execute = vi.fn();
      const response = await handlePlanningRequest(request, {
        getSnapshot: vi.fn(),
        execute,
      });
      expect(response.status).toBe(status);
      expect(execute).not.toHaveBeenCalled();
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  // Unsupported verbs must not reach either query or command dependencies.
  it("rejects unsupported HTTP methods with a no-store 405 response", async () => {
    const getSnapshot = vi.fn();
    const execute = vi.fn();

    const response = await handlePlanningRequest(
      new Request("http://127.0.0.1:3000/api/v1/planning?date=2026-08-10", { method: "PUT" }),
      { getSnapshot, execute },
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(getSnapshot).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("maps typed conflicts to 409 and validation failures to 422", async () => {
    const conflicts = [
      new IdempotentCommandConflictError(),
      new PlanningConflictError(),
      new RevisionConflictError(1, 2),
    ];
    for (const error of conflicts) {
      const response = await handlePlanningRequest(postRequest(), {
        getSnapshot: vi.fn(),
        execute: async () => {
          throw error;
        },
      });
      expect(response.status).toBe(409);
    }

    const invalid = await handlePlanningRequest(postRequest(), {
      getSnapshot: vi.fn(),
      execute: async () => {
        throw new PlanningValidationError("private validation details");
      },
    });
    expect(invalid.status).toBe(422);
    expect(JSON.stringify(await invalid.json())).not.toContain("private validation details");
  });

  it("contains unexpected POST failures behind a fixed safe 500 response", async () => {
    const sentinel = "SQLITE_ERROR C:\\private\\planning.sqlite";
    const response = await handlePlanningRequest(postRequest(), {
      getSnapshot: vi.fn(),
      execute: async () => {
        throw new Error(sentinel);
      },
    });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain(sentinel);
    expect(body).toEqual({ message: "Unable to process planning request." });
  });

  it("contains route dependency initialization failures behind no-store 500 responses", async () => {
    const sentinel = "SQLITE_ERROR C:\\private\\planning.sqlite";
    vi.resetModules();
    vi.doMock("@/core/db/application-database", () => ({
      getApplicationDatabase: () => {
        throw new Error(sentinel);
      },
    }));

    try {
      const route = await import("@/app/api/v1/planning/route");
      for (const request of [
        getRequest(),
        postRequest(),
      ]) {
        const response = request.method === "GET"
          ? await route.GET(request)
          : await route.POST(request);
        expect(response.status).toBe(500);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(JSON.stringify(await response.json())).not.toContain(sentinel);
      }
    } finally {
      vi.doUnmock("@/core/db/application-database");
      vi.resetModules();
    }
  });
});
