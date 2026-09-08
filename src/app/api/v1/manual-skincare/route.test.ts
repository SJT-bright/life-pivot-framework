import { afterEach, describe, expect, it, vi } from "vitest";

const snapshot = {
  businessDate: "2026-08-13",
  products: [],
  latestRoutineRevision: 0,
  activationSequence: 0,
  selectedDay: null,
  recoveryPlans: [],
  history: [],
};

const result = {
  snapshot,
  applied: {
    operation: "save-product",
    ownerId: "product-http-0001",
    ownerRevision: 1,
    businessDate: null,
    activationSequence: null,
  },
};

async function loadRoute(initializer: () => unknown) {
  vi.resetModules();
  vi.doMock("@/core/db/application-database", () => ({
    getApplicationDatabase: initializer,
  }));
  vi.doMock("@/modules/manual-skincare/query", () => ({
    getManualSkincareSnapshot: vi.fn(() => snapshot),
  }));
  vi.doMock("@/modules/manual-skincare/service", () => ({
    ManualSkincareConflictError: class ManualSkincareConflictError extends Error {},
    createManualSkincareService: vi.fn(() => ({
      execute: vi.fn(async () => result),
    })),
  }));
  return import("./route");
}

afterEach(() => {
  vi.doUnmock("@/core/db/application-database");
  vi.doUnmock("@/modules/manual-skincare/query");
  vi.doUnmock("@/modules/manual-skincare/service");
  vi.resetModules();
});
describe("manual skincare Next route", () => {
  it("dispatches GET/POST, mirrors HEAD, exposes OPTIONS, and contains failures", async () => {
    const initializer = vi.fn(() => ({ sqlite: {} }));
    const route = await loadRoute(initializer);
    expect(route.runtime).toBe("nodejs");
    expect(route.dynamic).toBe("force-dynamic");

    const get = await route.GET(new Request(
      "http://127.0.0.1/api/v1/manual-skincare?date=2026-08-13",
    ));
    const post = await route.POST(new Request(
      "http://127.0.0.1:3000/api/v1/manual-skincare",
      {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
          "content-type": "application/json",
          "idempotency-key": "manual-skincare-http-0001",
        },
        body: JSON.stringify({
          type: "save-product",
          productId: "product-http-0001",
          name: "温和洁面",
          brand: "示例品牌",
          currentPurpose: "清洁",
          status: "active",
          addedOn: "2026-08-01",
          note: "",
          expectedProductRevision: 0,
        }),
      },
    ));
    const head = await route.HEAD(new Request(
      "http://127.0.0.1/api/v1/manual-skincare?date=2026-08-13",
      { method: "HEAD" },
    ));
    expect([get.status, post.status, head.status]).toEqual([200, 200, 200]);
    expect(await get.json()).toEqual({ snapshot });
    expect(await post.json()).toEqual({ result });
    expect(await head.text()).toBe("");
    expect(get.headers.get("cache-control")).toBe("no-store");
    expect(route.OPTIONS().headers.get("allow")).toBe("GET, HEAD, OPTIONS, POST");
    expect(route.PUT().status).toBe(405);
    expect(initializer).toHaveBeenCalledTimes(3);

    const failed = await loadRoute(() => {
      throw new Error("C:\\private\\manual-skincare.sqlite");
    });
    const response = await failed.GET(new Request(
      "http://127.0.0.1/api/v1/manual-skincare?date=2026-08-13",
    ));
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain("private");
  });
});
