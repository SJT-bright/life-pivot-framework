import { describe, expect, it } from "vitest";

import { assertLocalJsonMutation } from "./local-request";

function request(headers: Record<string, string>): Request {
  return new Request("http://127.0.0.1:3000/api/v1/today/sections", {
    method: "POST",
    headers,
    body: "{}",
  });
}

describe("assertLocalJsonMutation", () => {
  it("accepts a same-origin JSON request on loopback", () => {
    expect(() =>
      assertLocalJsonMutation(
        request({
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
          "content-type": "application/json",
        }),
      ),
    ).not.toThrow();
  });

  it("accepts JSON parameters but rejects lookalike media types", () => {
    expect(() =>
      assertLocalJsonMutation(
        request({
          host: "127.0.0.1:3000",
          "content-type": "application/json; charset=utf-8",
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertLocalJsonMutation(
        request({
          host: "127.0.0.1:3000",
          "content-type": "application/jsonx",
        }),
      ),
    ).toThrow();
  });

  it("rejects an origin whose scheme differs from the request URL", () => {
    const crossScheme = new Request(
      "https://127.0.0.1:3000/api/v1/today/sections",
      {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
          "content-type": "application/json",
        },
        body: "{}",
      },
    );

    expect(() => assertLocalJsonMutation(crossScheme)).toThrow();
  });

  it.each(["127.0.0.1", "[::1]"])(
    "accepts an HTTPS same-origin request with an explicit default port on %s",
    (hostname) => {
      const sameOrigin = new Request(
        `https://${hostname}:443/api/v1/today/sections`,
        {
          method: "POST",
          headers: {
            host: `${hostname}:443`,
            origin: `https://${hostname}:443`,
            "content-type": "application/json",
          },
          body: "{}",
        },
      );

      expect(() => assertLocalJsonMutation(sameOrigin)).not.toThrow();
    },
  );

  it.each([
    [{ host: "192.168.1.10:3000", "content-type": "application/json" }, "仅允许本机访问"],
    [
      {
        host: "127.0.0.1:3000",
        origin: "https://evil.example",
        "content-type": "application/json",
      },
      "请求来源不匹配",
    ],
    [{ host: "127.0.0.1:3000", "content-type": "text/plain" }, "只接受 JSON 请求"],
  ])("rejects unsafe mutation headers", (headers, message) => {
    expect(() => assertLocalJsonMutation(request(headers))).toThrow(message);
  });
});
