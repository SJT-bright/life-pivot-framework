import { afterEach, describe, expect, it, vi } from "vitest";

const snapshot = {
  asOfDate: "2026-08-22",
  templateId: "template-1",
  pending: [],
  tracked: [],
  excluded: [],
  actualFacts: [],
};

async function loadRoute(initializer: () => unknown, getSnapshot: () => unknown = () => snapshot) {
  vi.resetModules();
  vi.doMock("@/core/db/application-database", () => ({
    getApplicationDatabase: initializer,
  }));
  vi.doMock("@/modules/manual-exercise/progress-query", () => ({
    getManualExerciseProgressSnapshot: vi.fn(getSnapshot),
  }));
  vi.doMock("@/modules/manual-exercise/progress-service", () => ({
    createManualExerciseProgressService: vi.fn(() => ({
      execute: vi.fn(async () => snapshot),
    })),
    ManualExerciseProgressConflictError: class extends Error {},
    ManualExerciseProgressValidationError: class extends Error {},
  }));
  return import("./route");
}

afterEach(() => {
  vi.doUnmock("@/core/db/application-database");
  vi.doUnmock("@/modules/manual-exercise/progress-query");
  vi.doUnmock("@/modules/manual-exercise/progress-service");
  vi.resetModules();
});

describe("manual exercise progress route", () => {
  it("dispatches snapshot GET/POST, mirrors HEAD, and keeps initialization errors anonymous", async () => {
    const api = await loadRoute(() => ({ sqlite: {} }));
    const get = await api.GET(new Request(
      "http://127.0.0.1/api/v1/manual-exercise-progress?asOfDate=2026-08-22&templateId=template-1",
    ));
    const post = await api.POST(new Request(
      "http://127.0.0.1:3000/api/v1/manual-exercise-progress",
      {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
          "content-type": "application/json",
          "idempotency-key": "progress-decision-key-0001",
        },
        body: JSON.stringify({
          type: "record-progress-decision",
          templateId: "template-1",
          templateVersionId: "version-2",
          asOfDate: "2026-08-22",
          decision: "tracked",
          expectedDecisionRevision: 0,
        }),
      },
    ));
    const head = await api.HEAD(new Request(
      "http://127.0.0.1/api/v1/manual-exercise-progress?asOfDate=2026-08-22&templateId=template-1",
      { method: "HEAD" },
    ));
    expect([get.status, post.status, head.status]).toEqual([200, 200, 200]);
    expect(await get.json()).toEqual(snapshot);
    expect(await post.json()).toEqual(snapshot);
    expect(await head.text()).toBe("");
    expect(get.headers.get("cache-control")).toBe("no-store");
    expect(api.OPTIONS().headers.get("allow")).toBe("GET, HEAD, OPTIONS, POST");
    expect(api.PUT().status).toBe(405);

    const failed = await loadRoute(() => {
      throw new Error("C:\\private\\exercise.db");
    });
    const response = await failed.GET(new Request(
      "http://127.0.0.1/api/v1/manual-exercise-progress?asOfDate=2026-08-22",
    ));
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain("private");
  });

  it("keeps parse errors at 400 and anonymizes snapshot failures as 500", async () => {
    const api = await loadRoute(
      () => ({ sqlite: {} }),
      () => {
        throw new Error("C:\\private\\progress-query.sql");
      },
    );
    const failure = await api.GET(new Request(
      "http://127.0.0.1/api/v1/manual-exercise-progress?asOfDate=2026-08-22&templateId=template-1",
    ));
    expect(failure.status).toBe(500);
    expect(failure.headers.get("cache-control")).toBe("no-store");
    expect(await failure.json()).toEqual({
      message: "Unable to process manual exercise progress request.",
    });

    for (const url of [
      "http://127.0.0.1/api/v1/manual-exercise-progress",
      "http://127.0.0.1/api/v1/manual-exercise-progress?asOfDate=2026-02-30",
      "http://127.0.0.1/api/v1/manual-exercise-progress?asOfDate=2026-08-22&asOfDate=2026-08-23",
      "http://127.0.0.1/api/v1/manual-exercise-progress?asOfDate=2026-08-22&unknown=1",
    ]) {
      const response = await api.GET(new Request(url));
      expect(response.status, url).toBe(400);
      expect(await response.json(), url).toEqual({
        message: "Invalid manual exercise progress request.",
      });
    }
  });
});
