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

describe("personal notes route", () => {
  it("serves no-store GET and POST through the schema v10 database", async () => {
    const sqlite = new Database(":memory:");
    databases.push(sqlite);
    migrateDatabase(sqlite);
    const route = await loadRoute(sqlite);

    const getResponse = await route.GET(new Request(
      "http://127.0.0.1:3000/api/v1/personal-notes?date=2026-08-12",
      { headers: { host: "127.0.0.1:3000" } },
    ));
    expect(getResponse.status).toBe(200);
    expect(getResponse.headers.get("cache-control")).toBe("no-store");
    expect(await getResponse.json()).toEqual({ note: null });

    const postResponse = await route.POST(new Request(
      "http://127.0.0.1:3000/api/v1/personal-notes",
      {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
          "content-type": "application/json",
          "idempotency-key": "personal-note-key-0001",
        },
        body: JSON.stringify({
          type: "save-personal-daily-note",
          noteId: "note-20260812",
          businessDate: "2026-08-12",
          content: "整体备注",
          expectedRevision: 0,
        }),
      },
    ));
    expect(postResponse.status).toBe(200);
    expect(postResponse.headers.get("cache-control")).toBe("no-store");
    expect((await postResponse.json()).result).toMatchObject({ revision: 1, content: "整体备注" });

    const moveResponse = await route.POST(new Request(
      "http://127.0.0.1:3000/api/v1/personal-notes",
      {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
          "content-type": "application/json",
          "idempotency-key": "personal-move-key-0001",
        },
        body: JSON.stringify({
          type: "move-personal-daily-note",
          noteId: "note-20260812",
          fromBusinessDate: "2026-08-12",
          toBusinessDate: "2026-08-11",
          expectedRevision: 1,
        }),
      },
    ));
    expect(moveResponse.status).toBe(200);
    expect(moveResponse.headers.get("cache-control")).toBe("no-store");
    expect((await moveResponse.json()).result).toMatchObject({
      businessDate: "2026-08-11",
      revision: 2,
      content: "整体备注",
    });

    const movedGetResponse = await route.GET(new Request(
      "http://127.0.0.1:3000/api/v1/personal-notes?date=2026-08-11",
      { headers: { host: "127.0.0.1:3000" } },
    ));
    expect((await movedGetResponse.json()).note).toMatchObject({ businessDate: "2026-08-11" });
  });

  it("contains database initialization failures behind an anonymous no-store response", async () => {
    vi.resetModules();
    vi.doMock("@/core/db/application-database", () => ({
      getApplicationDatabase: () => { throw new Error("C:\\private\\notes.sqlite"); },
    }));
    const route = await import("./route");
    const response = await route.GET(new Request(
      "http://127.0.0.1:3000/api/v1/personal-notes?date=2026-08-12",
      { headers: { host: "127.0.0.1:3000" } },
    ));

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(await response.json())).not.toContain("private");
  });
});
