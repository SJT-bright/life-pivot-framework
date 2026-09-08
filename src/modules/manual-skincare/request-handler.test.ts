import { describe, expect, it, vi } from "vitest";

import { IdempotentCommandConflictError } from "@/core/db/idempotent-command";
import { RevisionConflictError } from "@/core/mutations/revision";

import type {
  ManualSkincareCommand,
  ManualSkincareMutationResult,
  ManualSkincareSnapshot,
} from "./contracts";
import { ManualSkincareValidationError } from "./contracts";
import { handleManualSkincareRequest } from "./request-handler";
import { ManualSkincareConflictError } from "./service";

const snapshot = {
  businessDate: "2026-08-13",
  products: [],
  latestRoutineRevision: 0,
  activationSequence: 0,
  selectedDay: null,
  recoveryPlans: [],
  history: [],
} satisfies ManualSkincareSnapshot;

const command = {
  type: "save-product",
  productId: "product-http-0001",
  name: "温和洁面",
  brand: "示例品牌",
  currentPurpose: "清洁",
  status: "active",
  addedOn: "2026-08-01",
  note: "",
  expectedProductRevision: 0,
} satisfies ManualSkincareCommand;

const result = {
  snapshot,
  applied: {
    operation: "save-product",
    ownerId: command.productId,
    ownerRevision: 1,
    businessDate: null,
    activationSequence: null,
  },
} satisfies ManualSkincareMutationResult;

function dependencies() {
  return {
    getSnapshot: vi.fn(() => snapshot),
    execute: vi.fn(async () => result),
  };
}

function get(query = "date=2026-08-13&historyLimit=20"): Request {
  return new Request(`http://127.0.0.1:3000/api/v1/manual-skincare?${query}`);
}

function post(
  overrides: {
    body?: string;
    origin?: string;
    contentType?: string;
    key?: string | null;
  } = {},
): Request {
  const headers = new Headers({
    host: "127.0.0.1:3000",
    origin: overrides.origin ?? "http://127.0.0.1:3000",
    "content-type": overrides.contentType ?? "application/json",
  });
  const key = overrides.key === undefined ? "manual-skincare-http-0001" : overrides.key;
  if (key) headers.set("idempotency-key", key);
  return new Request("http://127.0.0.1:3000/api/v1/manual-skincare", {
    method: "POST",
    headers,
    body: overrides.body ?? JSON.stringify(command),
  });
}

describe("manual skincare request handler", () => {
  it("serves one strict bounded loopback-only no-store GET wrapper", async () => {
    const deps = dependencies();
    const response = await handleManualSkincareRequest(get(), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ snapshot });
    expect(deps.getSnapshot).toHaveBeenCalledWith({
      businessDate: "2026-08-13",
      historyLimit: 20,
    });

    for (const query of [
      "",
      "date=2026-02-30",
      "date=2026-08-13&date=2026-08-14",
      "date=2026-08-13&historyLimit=0",
      "date=2026-08-13&historyLimit=101",
      "date=2026-08-13&historyLimit=1&historyLimit=2",
      "date=2026-08-13&unknown=x",
    ]) {
      expect(
        (await handleManualSkincareRequest(get(query), dependencies())).status,
        query,
      ).toBe(400);
    }
    const remote = await handleManualSkincareRequest(
      new Request("https://example.com/api/v1/manual-skincare?date=2026-08-13"),
      dependencies(),
    );
    expect(remote.status).toBe(403);
  });

  it("enforces local strict JSON commands and wraps exact mutation results", async () => {
    const deps = dependencies();
    const accepted = await handleManualSkincareRequest(post(), deps);
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get("cache-control")).toBe("no-store");
    expect(await accepted.json()).toEqual({ result });
    expect(deps.execute).toHaveBeenCalledWith(command, "manual-skincare-http-0001");

    for (const [request, status] of [
      [post({ origin: "https://evil.example" }), 403],
      [post({ contentType: "text/plain" }), 415],
      [post({ key: "short" }), 400],
      [post({ body: "{" }), 400],
      [post({ body: JSON.stringify({ ...command, extra: true }) }), 422],
    ] as const) {
      const response = await handleManualSkincareRequest(request, dependencies());
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("maps conflicts, validation, and unexpected failures anonymously", async () => {
    for (const error of [
      new IdempotentCommandConflictError(),
      new RevisionConflictError(1, 2),
      new ManualSkincareConflictError("private notes and SQL"),
    ]) {
      const response = await handleManualSkincareRequest(post(), {
        ...dependencies(),
        execute: async () => { throw error; },
      });
      expect(response.status).toBe(409);
      expect(await response.text()).not.toContain("private");
    }
    const invalid = await handleManualSkincareRequest(post(), {
      ...dependencies(),
      execute: async () => { throw new ManualSkincareValidationError("private body"); },
    });
    expect(invalid.status).toBe(422);
    expect(await invalid.text()).not.toContain("private");

    const failed = await handleManualSkincareRequest(post(), {
      ...dependencies(),
      execute: async () => { throw new Error("C:\\private\\manual-skincare.sqlite"); },
    });
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toContain("private");
  });
});
