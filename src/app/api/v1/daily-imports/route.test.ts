import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { migrateDatabase } from "@/core/db/migrate";

const databases: Database.Database[] = [];

afterEach(() => {
  vi.doUnmock("@/core/db/application-database");
  vi.resetModules();
  while (databases.length > 0) databases.pop()?.close();
});

function body() {
  return {
    schema: "life-pivot.daily-import",
    version: 1,
    batchId: "batch-20260830-route",
    timezone: "Asia/Shanghai",
    businessDate: "2026-08-30",
    source: {
      platform: "feishu",
      generatedAt: "2026-08-30T22:00:00+08:00",
    },
    items: [{
      kind: "expense",
      sourceItemId: "expense-1",
      occurredAt: "2026-08-30T12:30:00+08:00",
      timePrecision: "exact",
      amountFen: 2350,
      currency: "CNY",
      category: "food",
    }],
  };
}

function request(url: string, key?: string) {
  return new Request(url, {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      "content-type": "application/json",
      ...(key ? { "idempotency-key": key } : {}),
    },
    body: JSON.stringify(body()),
  });
}

async function loadRoute(sqlite: Database.Database) {
  vi.resetModules();
  vi.doMock("@/core/db/application-database", () => ({
    getApplicationDatabase: () => ({ sqlite }),
  }));
  return import("./route");
}

describe("daily imports route", () => {
  it("previews then commits one Feishu batch against the application database", async () => {
    const sqlite = new Database(":memory:");
    databases.push(sqlite);
    migrateDatabase(sqlite);
    const route = await loadRoute(sqlite);

    const preview = await route.POST(request(
      "http://127.0.0.1:3000/api/v1/daily-imports?preview=true",
    ));
    expect(preview.status).toBe(200);
    expect((await preview.json()).receipt).toMatchObject({ preview: true, totalCount: 1 });
    expect(sqlite.prepare("select count(*) from capture_items").pluck().get()).toBe(0);

    const committed = await route.POST(request(
      "http://127.0.0.1:3000/api/v1/daily-imports",
      "feishu-route-key-0001",
    ));
    expect(committed.status).toBe(200);
    expect((await committed.json()).receipt).toMatchObject({
      preview: false,
      importedCount: 1,
      skippedCount: 0,
    });
    expect(sqlite.prepare("select content from capture_items").pluck().get())
      .toBe("【消费 · 餐饮】¥23.50");
  });

  it("contains database initialization failures", async () => {
    vi.resetModules();
    vi.doMock("@/core/db/application-database", () => ({
      getApplicationDatabase: () => { throw new Error("/private/user/data.sqlite"); },
    }));
    const route = await import("./route");

    const response = await route.POST(request(
      "http://127.0.0.1:3000/api/v1/daily-imports?preview=true",
    ));
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(await response.json())).not.toContain("private");
  });
});
