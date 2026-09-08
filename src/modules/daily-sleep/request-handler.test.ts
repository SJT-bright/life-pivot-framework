import { describe, expect, it, vi } from "vitest";

import type { DailySleepRecord } from "./contracts";
import { handleDailySleepRequest } from "./request-handler";
import { DailySleepConflictError } from "./service";

const record: DailySleepRecord = {
  id: "sleep-record-0001",
  recordDate: "2026-08-12",
  asleepTime: "23:30",
  wakeTime: "07:00",
  calculatedDurationMinutes: 450,
  confirmedDurationMinutes: null,
  finalDurationMinutes: 450,
  deepSleepMinutes: 90,
  lightSleepMinutes: 270,
  remSleepMinutes: 90,
  awakeEpisodes: null,
  awakeMinutes: null,
  morningFeeling: 4,
  qualityScore: 91,
  sleepVariabilityMinutes: 0,
  score: {
    finalScore: 91,
    durationScore: 100,
    variabilityScore: 100,
    stageConsistencyScore: 100,
    morningFeelingScore: 75,
    bedVariabilityMinutes: 0,
    wakeVariabilityMinutes: 0,
    averageVariabilityMinutes: 0,
    usedPreviousNaturalDay: true,
    disclaimer: "个人趋势分，非医疗诊断",
  },
  qualityText: "睡眠尚可",
  note: "",
  revision: 1,
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z",
};

const command = {
  type: "save-daily-sleep",
  recordId: record.id,
  recordDate: record.recordDate,
  asleepTime: record.asleepTime,
  wakeTime: record.wakeTime,
  confirmedDurationMinutes: null,
  qualityText: record.qualityText,
  note: "",
  expectedRevision: 0,
};

function dependencies() {
  return {
    getRecord: vi.fn(() => record),
    getHistory: vi.fn(() => ({ items: [record] })),
    execute: vi.fn(async () => record),
  };
}

function request(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost${path}`, init);
}

describe("handleDailySleepRequest", () => {
  it("serves exactly the date and bounded history GET views with no-store", async () => {
    const deps = dependencies();
    const byDate = await handleDailySleepRequest(
      request("/api/v1/daily-sleep?date=2026-08-12"),
      deps,
    );
    expect(byDate.status).toBe(200);
    expect(byDate.headers.get("cache-control")).toBe("no-store");
    expect(await byDate.json()).toEqual({ record });

    const history = await handleDailySleepRequest(
      request("/api/v1/daily-sleep?view=history&limit=20"),
      deps,
    );
    expect(history.status).toBe(200);
    expect(await history.json()).toEqual({ history: { items: [record] } });
    expect(deps.getHistory).toHaveBeenCalledWith({ limit: 20 });
  });

  it.each([
    "?",
    "?date=2026-02-30",
    "?date=2026-08-12&date=2026-08-11",
    "?date=2026-08-12&extra=1",
    "?view=history",
    "?view=history&limit=0",
    "?view=history&limit=101",
    "?view=history&limit=2&limit=3",
  ])("rejects an invalid GET query: %s", async (query) => {
    const response = await handleDailySleepRequest(
      request(`/api/v1/daily-sleep${query}`),
      dependencies(),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("requires a local JSON mutation and valid idempotency key", async () => {
    const invalidOrigin = await handleDailySleepRequest(request("/api/v1/daily-sleep", {
      method: "POST",
      headers: {
        host: "localhost",
        origin: "https://example.com",
        "content-type": "application/json",
        "idempotency-key": "daily-sleep-key-0001",
      },
      body: JSON.stringify(command),
    }), dependencies());
    expect(invalidOrigin.status).toBe(403);

    const wrongType = await handleDailySleepRequest(request("/api/v1/daily-sleep", {
      method: "POST",
      headers: { host: "localhost", "content-type": "text/plain" },
      body: JSON.stringify(command),
    }), dependencies());
    expect(wrongType.status).toBe(415);

    const invalidKey = await handleDailySleepRequest(request("/api/v1/daily-sleep", {
      method: "POST",
      headers: { host: "localhost", "content-type": "application/json", "idempotency-key": "short" },
      body: JSON.stringify(command),
    }), dependencies());
    expect(invalidKey.status).toBe(400);
  });

  it("executes valid POST commands and maps validation, conflict, and anonymous failures", async () => {
    const deps = dependencies();
    const response = await handleDailySleepRequest(request("/api/v1/daily-sleep", {
      method: "POST",
      headers: {
        host: "localhost",
        "content-type": "application/json",
        "idempotency-key": "daily-sleep-key-0001",
      },
      body: JSON.stringify(command),
    }), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: record });

    const invalid = await handleDailySleepRequest(request("/api/v1/daily-sleep", {
      method: "POST",
      headers: {
        host: "localhost",
        "content-type": "application/json",
        "idempotency-key": "daily-sleep-key-0002",
      },
      body: JSON.stringify({ ...command, unexpected: true }),
    }), dependencies());
    expect(invalid.status).toBe(422);

    for (const error of [new DailySleepConflictError(), new Error("secret db path")]) {
      const failing = dependencies();
      failing.execute.mockRejectedValueOnce(error);
      const failed = await handleDailySleepRequest(request("/api/v1/daily-sleep", {
        method: "POST",
        headers: {
          host: "localhost",
          "content-type": "application/json",
          "idempotency-key": "daily-sleep-key-0003",
        },
        body: JSON.stringify(command),
      }), failing);
      expect(failed.status).toBe(error instanceof DailySleepConflictError ? 409 : 500);
      expect(JSON.stringify(await failed.json())).not.toContain("secret db path");
    }
  });
});
