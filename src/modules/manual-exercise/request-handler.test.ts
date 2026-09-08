import { describe, expect, it, vi } from "vitest";

import { IdempotentCommandConflictError } from "@/core/db/idempotent-command";
import { RevisionConflictError } from "@/core/mutations/revision";

import type { ManualExerciseCommand, ManualExerciseSnapshot } from "./service";
import { handleManualExerciseRequest } from "./request-handler";
import { ManualExerciseConflictError, ManualExerciseValidationError } from "./service";

const snapshot = {
  businessDate: "2026-08-13", template: null, cycle: null, selectedDay: null,
  history: [], templateHistory: [],
} satisfies ManualExerciseSnapshot;

const command: ManualExerciseCommand = {
  type: "start-training", businessDate: "2026-08-13", expectedDailyRevision: 0,
};

function dependencies() {
  return {
    getSnapshot: vi.fn(() => snapshot),
    execute: vi.fn(async () => snapshot),
  };
}

function get(query = "date=2026-08-13&historyLimit=20") {
  return new Request(`http://127.0.0.1:3000/api/v1/manual-exercise?${query}`);
}

function post(overrides: { body?: string; origin?: string; contentType?: string; key?: string | null } = {}) {
  const headers = new Headers({
    host: "127.0.0.1:3000",
    origin: overrides.origin ?? "http://127.0.0.1:3000",
    "content-type": overrides.contentType ?? "application/json",
  });
  const key = overrides.key === undefined ? "manual-command-key-0001" : overrides.key;
  if (key) headers.set("idempotency-key", key);
  return new Request("http://127.0.0.1:3000/api/v1/manual-exercise", {
    method: "POST", headers, body: overrides.body ?? JSON.stringify(command),
  });
}

describe("manual exercise request handler", () => {
  it("serves one strict bounded no-store GET query", async () => {
    const deps = dependencies();
    const response = await handleManualExerciseRequest(get(), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(deps.getSnapshot).toHaveBeenCalledWith({ businessDate: "2026-08-13", historyLimit: 20 });
    for (const query of ["", "date=2026-02-30", "date=2026-08-13&date=2026-08-14", "date=2026-08-13&historyLimit=0", "date=2026-08-13&historyLimit=101", "date=2026-08-13&extra=x"]) {
      expect((await handleManualExerciseRequest(get(query), dependencies())).status, query).toBe(400);
    }
    expect((await handleManualExerciseRequest(
      new Request("https://example.com/api/v1/manual-exercise?date=2026-08-13"),
      dependencies(),
    )).status).toBe(403);
  });

  it("enforces local JSON, strict commands, and a strong idempotency key", async () => {
    const deps = dependencies();
    const accepted = await handleManualExerciseRequest(post(), deps);
    expect(accepted.status).toBe(200);
    expect(deps.execute).toHaveBeenCalledWith(command, "manual-command-key-0001");
    for (const [request, status] of [
      [post({ origin: "https://evil.example" }), 403],
      [post({ contentType: "text/plain" }), 415],
      [post({ key: "short" }), 400],
      [post({ body: "{" }), 400],
      [post({ body: JSON.stringify({ ...command, extra: true }) }), 422],
    ] as const) {
      const response = await handleManualExerciseRequest(request, dependencies());
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("maps typed failures anonymously to 409/422 and unexpected failures to 500", async () => {
    for (const error of [
      new IdempotentCommandConflictError(),
      new RevisionConflictError(1, 2),
      new ManualExerciseConflictError("private conflict"),
    ]) {
      const response = await handleManualExerciseRequest(post(), {
        ...dependencies(), execute: async () => { throw error; },
      });
      expect(response.status).toBe(409);
      expect(await response.text()).not.toContain("private");
    }
    const invalid = await handleManualExerciseRequest(post(), {
      ...dependencies(), execute: async () => { throw new ManualExerciseValidationError("private validation"); },
    });
    expect(invalid.status).toBe(422);
    const failed = await handleManualExerciseRequest(post(), {
      ...dependencies(), execute: async () => { throw new Error("C:\\private\\exercise.db"); },
    });
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toContain("private");
  });
});
