import { afterEach, describe, expect, it, vi } from "vitest";

async function loadRoute(init: () => unknown) {
  vi.resetModules();
  vi.doMock("@/core/db/application-database", () => ({ getApplicationDatabase: init }));
  return import("./route");
}
afterEach(() => { vi.doUnmock("@/core/db/application-database"); vi.resetModules(); });

describe("weekly review route", () => {
  it("contains initialization failures and exposes HTTP method contract", async () => {
    const api = await loadRoute(() => { throw new Error("C:\\private\\weekly.sqlite"); });
    expect((await api.GET(new Request("http://127.0.0.1/api/v1/weekly-review?start=2026-08-03&end=2026-08-10"))).status).toBe(500);
    expect((await api.HEAD(new Request("http://127.0.0.1/api/v1/weekly-review?start=2026-08-03&end=2026-08-10", { method: "HEAD" }))).status).toBe(500);
    expect(api.OPTIONS().headers.get("allow")).toBe("GET, HEAD, OPTIONS, POST");
    expect(api.DELETE().status).toBe(405);
  });
});
