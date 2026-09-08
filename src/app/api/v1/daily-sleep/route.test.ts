import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApplicationDatabase: vi.fn(),
  getDailySleepRecord: vi.fn(),
  getDailySleepHistory: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@/core/db/application-database", () => ({
  getApplicationDatabase: mocks.getApplicationDatabase,
}));
vi.mock("@/modules/daily-sleep/query", () => ({
  getDailySleepRecord: mocks.getDailySleepRecord,
  getDailySleepHistory: mocks.getDailySleepHistory,
}));
vi.mock("@/modules/daily-sleep/service", () => ({
  createDailySleepService: () => ({ execute: mocks.execute }),
  DailySleepConflictError: class DailySleepConflictError extends Error {},
}));

import { DELETE, GET, HEAD, OPTIONS, POST } from "./route";

beforeEach(() => {
  mocks.getApplicationDatabase.mockReturnValue({ sqlite: {} });
  mocks.getDailySleepRecord.mockReturnValue(null);
  mocks.getDailySleepHistory.mockReturnValue({ items: [] });
});

describe("daily sleep route", () => {
  it("provides GET/POST, cache-safe HEAD/OPTIONS, and 405 methods", async () => {
    const get = await GET(new Request("http://localhost/api/v1/daily-sleep?date=2026-08-12"));
    expect(get.status).toBe(200);
    expect(get.headers.get("cache-control")).toBe("no-store");

    const head = await HEAD(new Request("http://localhost/api/v1/daily-sleep?date=2026-08-12"));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");

    const options = await OPTIONS();
    expect(options.status).toBe(204);
    expect(options.headers.get("allow")).toBe("GET, HEAD, OPTIONS, POST");
    expect((await DELETE()).status).toBe(405);

    const post = await POST(new Request("http://localhost/api/v1/daily-sleep", {
      method: "POST",
      headers: { host: "localhost", "content-type": "application/json" },
      body: "{}",
    }));
    expect(post.headers.get("cache-control")).toBe("no-store");
  });

  it("fails anonymously when database initialization fails", async () => {
    mocks.getApplicationDatabase.mockImplementationOnce(() => {
      throw new Error("D:/private/data.sqlite");
    });
    const response = await GET(new Request("http://localhost/api/v1/daily-sleep?date=2026-08-12"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: "暂时无法处理睡眠记录请求" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
