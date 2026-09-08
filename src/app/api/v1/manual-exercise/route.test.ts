import { afterEach, describe, expect, it, vi } from "vitest";

const snapshot = {
  businessDate: "2026-08-13", template: null, cycle: null, selectedDay: null,
  history: [], templateHistory: [],
};

async function loadRoute(initializer: () => unknown) {
  vi.resetModules();
  vi.doMock("@/core/db/application-database", () => ({ getApplicationDatabase: initializer }));
  vi.doMock("@/modules/manual-exercise/queries", () => ({ getManualExerciseSnapshot: vi.fn(() => snapshot) }));
  vi.doMock("@/modules/manual-exercise/service", () => ({ createManualExerciseService: vi.fn(() => ({ execute: vi.fn(async () => snapshot) })) }));
  return import("./route");
}

afterEach(() => {
  vi.doUnmock("@/core/db/application-database");
  vi.doUnmock("@/modules/manual-exercise/queries");
  vi.doUnmock("@/modules/manual-exercise/service");
  vi.resetModules();
});

describe("manual exercise route", () => {
  it("dispatches GET/POST, mirrors HEAD, exposes OPTIONS, and contains initialization failures", async () => {
    const api = await loadRoute(() => ({ sqlite: {} }));
    const get = await api.GET(new Request("http://127.0.0.1/api/v1/manual-exercise?date=2026-08-13"));
    const post = await api.POST(new Request("http://127.0.0.1:3000/api/v1/manual-exercise", {
      method: "POST",
      headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "content-type": "application/json", "idempotency-key": "manual-command-key-0001" },
      body: JSON.stringify({ type: "start-training", businessDate: "2026-08-13", expectedDailyRevision: 0 }),
    }));
    const head = await api.HEAD(new Request("http://127.0.0.1/api/v1/manual-exercise?date=2026-08-13", { method: "HEAD" }));
    expect([get.status, post.status, head.status]).toEqual([200, 200, 200]);
    expect(await head.text()).toBe("");
    expect(get.headers.get("cache-control")).toBe("no-store");
    expect(api.OPTIONS().headers.get("allow")).toBe("GET, HEAD, OPTIONS, POST");
    expect(api.PUT().status).toBe(405);

    const failed = await loadRoute(() => { throw new Error("C:\\private\\exercise.db"); });
    const response = await failed.GET(new Request("http://127.0.0.1/api/v1/manual-exercise?date=2026-08-13"));
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain("private");
  });
});
