import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { migrateDatabase } from "@/core/db/migrate";
import { autoImplementMethods } from "next/dist/server/route-modules/app-route/helpers/auto-implement-methods";

const databases: Database.Database[] = [];
type DispatchedMethod = (request: Request, context: unknown) => Response | Promise<Response>;
type DispatchedMethods = Record<"GET" | "HEAD" | "OPTIONS" | "POST" | "PUT" | "PATCH" | "DELETE", DispatchedMethod>;

async function dispatchedRoute(getApplicationDatabase: () => unknown) {
  vi.resetModules();
  vi.doMock("@/core/db/application-database", () => ({ getApplicationDatabase }));
  const route = await import("./route");
  return autoImplementMethods(route as never) as unknown as DispatchedMethods;
}

function request(method: string, hostname = "127.0.0.1"): Request {
  return new Request(
    `http://${hostname}:3000/api/v1/personal-knowledge?date=2026-08-13`,
    { method },
  );
}

afterEach(() => {
  vi.doUnmock("@/core/db/application-database");
  vi.resetModules();
  while (databases.length > 0) databases.pop()?.close();
});

describe("personal knowledge route through Next method dispatch", () => {
  it("rejects remote GET and HEAD before database initialization", async () => {
    const getApplicationDatabase = vi.fn(() => {
      throw new Error("database must not initialize for remote reads");
    });
    const methods = await dispatchedRoute(getApplicationDatabase);

    for (const method of ["GET", "HEAD"] as const) {
      const response = await methods[method](request(method, "192.168.1.20"), {});
      expect(response.status, method).toBe(403);
      expect(response.headers.get("cache-control"), method).toBe("no-store");
      if (method === "HEAD") {
        expect(await response.text()).toBe("");
      } else {
        expect(await response.json()).toEqual({ message: "Local access only." });
      }
    }
    expect(getApplicationDatabase).not.toHaveBeenCalled();
  });

  it("dispatches HEAD with GET status and headers but no body", async () => {
    const sqlite = new Database(":memory:");
    databases.push(sqlite);
    migrateDatabase(sqlite);
    const methods = await dispatchedRoute(() => ({ sqlite }));

    const getResponse = await methods.GET(request("GET"), {});
    const headResponse = await methods.HEAD(request("HEAD"), {});
    expect(getResponse.status).toBe(200);
    expect(headResponse.status).toBe(200);
    expect(headResponse.headers.get("cache-control")).toBe("no-store");
    expect(headResponse.headers.get("content-type")).toBe(getResponse.headers.get("content-type"));
    expect(await headResponse.text()).toBe("");
  });

  it("serves OPTIONS and unsupported methods without initializing the database", async () => {
    const getApplicationDatabase = vi.fn(() => { throw new Error("must not initialize"); });
    const methods = await dispatchedRoute(getApplicationDatabase);
    const options = await methods.OPTIONS(request("OPTIONS"), {});
    expect(options.status).toBe(204);
    expect(options.headers.get("allow")).toBe("GET, HEAD, OPTIONS, POST");
    expect(options.headers.get("cache-control")).toBe("no-store");
    for (const method of ["PUT", "PATCH", "DELETE"] as const) {
      const response = await methods[method](request(method), {});
      expect(response.status).toBe(405);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ message: "Method not allowed." });
    }
    expect(getApplicationDatabase).not.toHaveBeenCalled();
  });

  it("contains dependency initialization failure for GET, POST, and HEAD", async () => {
    const methods = await dispatchedRoute(() => {
      throw new Error("SQLITE_ERROR C:\\private\\knowledge.sqlite secret");
    });
    for (const method of ["GET", "POST", "HEAD"] as const) {
      const response = await methods[method](request(method), {});
      expect(response.status, method).toBe(500);
      expect(response.headers.get("cache-control"), method).toBe("no-store");
      const body = await response.text();
      if (method === "HEAD") expect(body).toBe("");
      else expect(body).not.toContain("private");
    }
  });
});
