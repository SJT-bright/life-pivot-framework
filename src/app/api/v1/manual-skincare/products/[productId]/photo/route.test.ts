import { afterEach, describe, expect, it, vi } from "vitest";

const getPhoto = vi.fn();

async function loadRoute(initializer: () => unknown = () => ({ sqlite: {} })) {
  vi.resetModules();
  vi.doMock("@/core/db/application-database", () => ({
    getApplicationDatabase: initializer,
  }));
  vi.doMock("@/modules/manual-skincare/query", () => ({
    getManualSkincareProductPhoto: getPhoto,
  }));
  return import("./route");
}

function context(productId = "product-photo-0001") {
  return { params: Promise.resolve({ productId }) };
}

afterEach(() => {
  getPhoto.mockReset();
  vi.doUnmock("@/core/db/application-database");
  vi.doUnmock("@/modules/manual-skincare/query");
  vi.resetModules();
});

describe("manual skincare product photo route", () => {
  it("serves exact revision bytes with a safe immutable response and mirrors HEAD", async () => {
    getPhoto.mockReturnValue({
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      mediaType: "image/png",
      revision: 4,
    });
    const route = await loadRoute();
    const request = new Request(
      "http://127.0.0.1/api/v1/manual-skincare/products/product-photo-0001/photo?revision=4",
    );
    const response = await route.GET(request, context());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-length")).toBe("4");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0x89, 0x50, 0x4e, 0x47]);

    const head = await route.HEAD(request, context());
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("4");
    expect(await head.text()).toBe("");
    expect(route.OPTIONS().headers.get("allow")).toBe("GET, HEAD, OPTIONS");
  });

  it("rejects missing, malformed, stale, and failed requests without leaking local details", async () => {
    getPhoto.mockReturnValue({ bytes: Buffer.from([1]), mediaType: "image/webp", revision: 5 });
    const route = await loadRoute();
    expect((await route.GET(new Request(
      "http://127.0.0.1/api/v1/manual-skincare/products/product-photo-0001/photo",
    ), context())).status).toBe(400);
    expect((await route.GET(new Request(
      "http://127.0.0.1/api/v1/manual-skincare/products/product-photo-0001/photo?revision=old",
    ), context())).status).toBe(400);
    const stale = await route.GET(new Request(
      "http://127.0.0.1/api/v1/manual-skincare/products/product-photo-0001/photo?revision=4",
    ), context());
    expect(stale.status).toBe(404);
    expect(stale.headers.get("cache-control")).toBe("no-store");

    const failed = await loadRoute(() => { throw new Error("/private/user/database.sqlite"); });
    getPhoto.mockReturnValue({ bytes: Buffer.from([1]), mediaType: "image/jpeg", revision: 1 });
    const response = await failed.GET(new Request(
      "http://127.0.0.1/api/v1/manual-skincare/products/product-photo-0001/photo?revision=1",
    ), context());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private");
  });
});
