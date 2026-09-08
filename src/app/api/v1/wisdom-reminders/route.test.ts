import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { migrateDatabase } from "@/core/db/migrate";

const databases: Database.Database[] = [];

afterEach(() => {
  vi.doUnmock("@/core/db/application-database");
  vi.resetModules();
  while (databases.length > 0) databases.pop()?.close();
});

async function loadRoute(sqlite: Database.Database) {
  vi.resetModules();
  vi.doMock("@/core/db/application-database", () => ({
    getApplicationDatabase: () => ({ sqlite }),
  }));
  return import("./route");
}

function post(body: unknown, key = "wisdom-route-key-0001"): Request {
  return new Request("http://127.0.0.1:3000/api/v1/wisdom-reminders", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify(body),
  });
}

describe("wisdom reminders route", () => {
  it("serves no-store GET and full create/list cycle", async () => {
    const sqlite = new Database(":memory:");
    databases.push(sqlite);
    migrateDatabase(sqlite);
    const route = await loadRoute(sqlite);

    const empty = await route.GET(new Request(
      "http://127.0.0.1:3000/api/v1/wisdom-reminders",
      { headers: { host: "127.0.0.1:3000" } },
    ));
    expect(empty.status).toBe(200);
    expect(empty.headers.get("cache-control")).toBe("no-store");
    expect((await empty.json()).reminders).toEqual([]);

    const created = await route.POST(post({
      type: "create-wisdom-reminder",
      reminderId: "wisdom-reminder-01",
      content: "先处理情绪，再处理事情。",
      context: "",
    }));
    expect(created.status).toBe(200);
    expect((await created.json()).result).toMatchObject({ revision: 1 });

    const listed = await route.GET(new Request(
      "http://127.0.0.1:3000/api/v1/wisdom-reminders",
      { headers: { host: "127.0.0.1:3000" } },
    ));
    expect((await listed.json()).reminders).toHaveLength(1);

    const rejected = await route.POST(post({
      type: "create-wisdom-reminder",
      reminderId: "wisdom-reminder-01",
      content: "重复的 id",
      context: "",
    }, "wisdom-route-key-0002"));
    expect(rejected.status).toBe(409);

    const invalid = await route.POST(post({
      type: "create-wisdom-reminder",
      reminderId: "wisdom-reminder-02",
      content: "   ",
      context: "",
    }, "wisdom-route-key-0003"));
    expect(invalid.status).toBe(422);

    const forbidden = await route.POST(new Request(
      "http://127.0.0.1:3000/api/v1/wisdom-reminders",
      {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin: "https://evil.example",
          "content-type": "application/json",
          "idempotency-key": "wisdom-route-key-0004",
        },
        body: "{}",
      },
    ));
    expect(forbidden.status).toBe(403);
  });

  it("hides database failures behind an anonymous no-store response", async () => {
    vi.resetModules();
    vi.doMock("@/core/db/application-database", () => ({
      getApplicationDatabase: () => { throw new Error("C:\\private\\notes.sqlite"); },
    }));
    const route = await import("./route");
    const response = await route.GET(new Request(
      "http://127.0.0.1:3000/api/v1/wisdom-reminders",
      { headers: { host: "127.0.0.1:3000" } },
    ));
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(await response.json())).not.toContain("private");
  });
});
