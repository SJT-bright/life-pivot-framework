import { afterEach, describe, expect, it, vi } from "vitest";

async function loadRoute(init: () => unknown) {
  vi.resetModules();
  vi.doMock("@/core/db/application-database", () => ({ getApplicationDatabase: init }));
  return import("@/app/api/v1/health-checklist/route");
}

afterEach(() => {
  vi.doUnmock("@/core/db/application-database");
  vi.resetModules();
});

describe("health checklist route", () => {
  it("contains database init failures and handles HEAD, OPTIONS, and unsupported verbs", async () => {
    const init = vi.fn(() => { throw new Error("C:\\private\\health.sqlite"); });
    const api = await loadRoute(init);
    const get = await api.GET(new Request("http://local/api/v1/health-checklist?date=2026-08-12"));
    const head = await api.HEAD(new Request("http://local/api/v1/health-checklist?date=2026-08-12", { method: "HEAD" }));
    expect(get.status).toBe(500);
    expect(head.status).toBe(500);
    expect(await head.text()).toBe("");
    expect(api.OPTIONS().headers.get("allow")).toBe("GET, HEAD, OPTIONS, POST");
    expect(api.PUT().status).toBe(405);
    expect(init).toHaveBeenCalledTimes(2);
  });
});
