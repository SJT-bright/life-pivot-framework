import { describe, expect, it, vi } from "vitest";

import { runtime } from "@/app/api/v1/today/captures/route";

import type { CapturePage } from "./get-captures";
import { CaptureTimelineInputError } from "./get-captures";
import type { CaptureSource } from "./get-capture-source";
import { CaptureSourceNotFoundError } from "./get-capture-source";
import { handleCaptureTimelineRequest } from "./captures-request-handler";

const page: CapturePage = {
  items: [
    {
      id: "capture-1",
      businessDate: "2026-08-10",
      occurredAt: "2026-08-10T08:00:00.000Z",
      text: "Captured fact",
      createdAt: "2026-08-10T08:00:01.000Z",
    },
  ],
  nextCursor: null,
  snapshotHighWater: 4,
};

const source: CaptureSource = {
  id: "capture-source",
  businessDate: "2026-08-10",
  occurredAt: "2026-08-10T08:00:00.000Z",
  text: "Exact source text",
  createdAt: "2026-08-10T08:00:01.000Z",
  disposition: "active",
};

function request(query = "date=2026-08-10"): Request {
  return new Request(`http://127.0.0.1:3000/api/v1/today/captures?${query}`);
}

function cursor(value: { occurredAt: string; createdAt: string; id: string }): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

describe("handleCaptureTimelineRequest", () => {
  it("returns an exact no-store source without reading or reshaping the timeline", async () => {
    const getTimeline = vi.fn(() => page);
    const getSource = vi.fn(() => source);

    const response = await handleCaptureTimelineRequest(
      request("date=2026-08-10&source=capture-source"),
      { getTimeline, getSource },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ source });
    expect(getSource).toHaveBeenCalledWith({
      businessDate: "2026-08-10",
      sourceId: "capture-source",
    });
    expect(getTimeline).not.toHaveBeenCalled();
  });

  it("decodes an opaque source exactly once before passing it to the source reader", async () => {
    const getTimeline = vi.fn(() => page);
    const getSource = vi.fn(() => source);
    const opaqueId = "capture/path with spaces?part=1&kind=source";

    const response = await handleCaptureTimelineRequest(
      request(`date=2026-08-10&source=${encodeURIComponent(opaqueId)}`),
      { getTimeline, getSource },
    );

    expect(response.status).toBe(200);
    expect(getSource).toHaveBeenCalledWith({
      businessDate: "2026-08-10",
      sourceId: opaqueId,
    });
    expect(getTimeline).not.toHaveBeenCalled();
  });

  it("rejects malformed, repeated, unknown, and mixed source queries before either reader runs", async () => {
    const cases = [
      "source=capture-source",
      "date=2026-02-30&source=capture-source",
      "date=2026-08-10&source=",
      "date=2026-08-10&source=%20%20",
      "date=2026-08-10&source=one&source=two",
      "date=2026-08-10&date=2026-08-11&source=capture-source",
      "date=2026-08-10&source=capture-source&cursor=opaque",
      "date=2026-08-10&source=capture-source&snapshot=4",
      "date=2026-08-10&source=capture-source&limit=50",
      "date=2026-08-10&source=capture-source&unknown=1",
    ];

    for (const query of cases) {
      const getTimeline = vi.fn(() => page);
      const getSource = vi.fn(() => source);

      const response = await handleCaptureTimelineRequest(request(query), {
        getTimeline,
        getSource,
      });

      expect(response.status, query).toBe(400);
      expect(response.headers.get("cache-control"), query).toBe("no-store");
      expect(getTimeline, query).not.toHaveBeenCalled();
      expect(getSource, query).not.toHaveBeenCalled();
    }
  });

  it("maps all exact-source misses to the same anonymous no-store 404", async () => {
    const outcomes = [];
    for (const [query, privateReason] of [
      ["date=2026-08-10&source=missing-secret", "private missing id missing-secret"],
      ["date=2026-08-09&source=capture-secret", "private date mismatch capture-secret"],
    ] as const) {
      const getTimeline = vi.fn(() => page);
      const getSource = vi.fn(() => {
        throw new CaptureSourceNotFoundError(privateReason);
      });
      const response = await handleCaptureTimelineRequest(request(query), { getTimeline, getSource });
      outcomes.push({
        status: response.status,
        cacheControl: response.headers.get("cache-control"),
        body: await response.json(),
      });
      expect(getTimeline).not.toHaveBeenCalled();
    }

    expect(outcomes[0]).toEqual({
      status: 404,
      cacheControl: "no-store",
      body: { message: "Capture source not found" },
    });
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(JSON.stringify(outcomes)).not.toContain("secret");
  });

  it("contains exact-source dependency failures behind an anonymous no-store 500", async () => {
    const getTimeline = vi.fn(() => page);
    const getSource = vi.fn(() => {
      throw new Error("sqlite private path and source-secret");
    });

    const response = await handleCaptureTimelineRequest(
      request("date=2026-08-10&source=capture-source"),
      { getTimeline, getSource },
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({ message: "Unable to load capture source" });
    expect(JSON.stringify(body)).not.toContain("private path");
    expect(JSON.stringify(body)).not.toContain("source-secret");
    expect(getTimeline).not.toHaveBeenCalled();
  });

  it("returns a no-store timeline and caps a valid requested limit at 50", async () => {
    const getTimeline = vi.fn(() => page);
    const getSource = vi.fn(() => {
      throw new Error("source dependency must be isolated from timeline mode");
    });
    const encodedCursor = cursor({
      occurredAt: "2026-08-10T08:00:00.000Z",
      createdAt: "2026-08-10T08:00:01.000Z",
      id: "capture-1",
    });

    const response = await handleCaptureTimelineRequest(
      request(`date=2026-08-10&limit=500&snapshot=4&cursor=${encodedCursor}`),
      { getTimeline, getSource },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(page);
    expect(getTimeline).toHaveBeenCalledWith({
      businessDate: "2026-08-10",
      limit: 50,
      snapshotHighWater: 4,
      cursor: encodedCursor,
    });
    expect(getSource).not.toHaveBeenCalled();
  });

  it("requires a valid date and strict numeric query values before querying", async () => {
    const cases = [
      "",
      "date=2026-02-30",
      "date=2026-08-10&limit=0",
      "date=2026-08-10&limit=1.5",
      "date=2026-08-10&snapshot=-1",
      "date=2026-08-10&snapshot=9007199254740992",
      "date=2026-08-10&snapshot=1e2",
    ];

    for (const query of cases) {
      const getTimeline = vi.fn(() => page);
      const response = await handleCaptureTimelineRequest(request(query), { getTimeline });

      expect(response.status, query).toBe(400);
      expect(response.headers.get("cache-control"), query).toBe("no-store");
      expect(getTimeline, query).not.toHaveBeenCalled();
    }
  });

  it("requires the emitted snapshot for every cursor continuation", async () => {
    const getTimeline = vi.fn(() => page);

    const response = await handleCaptureTimelineRequest(
      request(`date=2026-08-10&cursor=${cursor({
        occurredAt: "2026-08-10T08:00:00.000Z",
        createdAt: "2026-08-10T08:00:01.000Z",
        id: "capture-1",
      })}`),
      { getTimeline },
    );

    expect(response.status).toBe(400);
    expect(getTimeline).not.toHaveBeenCalled();
  });

  it("contains invalid cursor parser failures behind a safe bad-request response", async () => {
    const getTimeline = vi.fn(() => page);

    const response = await handleCaptureTimelineRequest(
      request("date=2026-08-10&snapshot=4&cursor=not-base64url!"),
      { getTimeline },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: "Invalid capture timeline request" });
    expect(getTimeline).not.toHaveBeenCalled();
  });

  it("maps a service-rejected future snapshot to a safe no-store 400", async () => {
    const getTimeline = vi.fn(() => {
      throw new CaptureTimelineInputError("snapshot 100 exceeds private database rowid 2");
    });

    const response = await handleCaptureTimelineRequest(
      request("date=2026-08-10&snapshot=100"),
      { getTimeline },
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ message: "Invalid capture timeline request" });
  });

  it("uses the required Node.js runtime for the database-backed route", () => {
    expect(runtime).toBe("nodejs");
  });
});
