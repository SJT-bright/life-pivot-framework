// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CapturePage, CaptureTimelineItem } from "@/modules/today/get-captures";
import type { StoredCapture } from "@/modules/today/contracts";

import { CaptureTimeline } from "./capture-timeline";

const businessDate = "2026-08-09";

function capture(id: string, text: string, occurredAt = "2026-08-09T09:00:00.000Z"): CaptureTimelineItem {
  return {
    id,
    businessDate,
    occurredAt,
    text,
    createdAt: "2026-08-09T09:00:01.000Z",
  };
}

function newlySavedCapture(id: string, text: string): StoredCapture {
  return { ...capture(id, text), draftId: `draft-${id}` };
}

function page(items: CaptureTimelineItem[], nextCursor: string | null = null, snapshotHighWater = 73): CapturePage {
  return { items, nextCursor, snapshotHighWater };
}

describe("CaptureTimeline", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => cleanup());

  it("renders initial, newly saved, and loaded captures as plain facts", async () => {
    const request = vi.fn(async () => Response.json(page([
      capture("loaded-capture", "Loaded capture", "2026-08-09T07:00:00.000Z"),
    ])));
    render(
      <CaptureTimeline
        businessDate={businessDate}
        initialTimeline={page([capture("initial-capture", "Initial capture")], "cursor-1")}
        newItems={[newlySavedCapture("new-capture", "Newly saved capture")]}
        onRefreshed={vi.fn()}
        request={request}
      />,
    );

    expect(screen.getByText("Newly saved capture")).toBeInTheDocument();
    expect(screen.getByText("Initial capture")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新时间线" })).toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("appends only unseen captures when loading more and preserves pagination state", async () => {
    const request = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://local");
      if (url.searchParams.get("cursor") === "cursor-1") {
        return Response.json(page([
          capture("loaded-capture", "Loaded capture", "2026-08-09T07:00:00.000Z"),
          capture("initial-capture", "Initial capture"),
        ], null, 91));
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    render(
      <CaptureTimeline
        businessDate={businessDate}
        initialTimeline={page([capture("initial-capture", "Initial capture")], "cursor-1")}
        newItems={[]}
        onRefreshed={vi.fn()}
        request={request}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));

    await waitFor(() => expect(screen.getByText("Loaded capture")).toBeInTheDocument());
    expect(screen.getAllByText("Initial capture")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "加载更多" })).not.toBeInTheDocument();
    expect(request.mock.calls[0]?.[0]).toBe(
      "/api/v1/today/captures?date=2026-08-09&limit=50&cursor=cursor-1&snapshot=73",
    );
  });

  it("adopts a refreshed server snapshot after a batch import", async () => {
    const props = {
      businessDate,
      newItems: [] as StoredCapture[],
      onRefreshed: vi.fn(),
      request: vi.fn(),
    };
    const { rerender } = render(
      <CaptureTimeline
        {...props}
        initialTimeline={page([capture("initial-capture", "Initial capture")], null, 73)}
      />,
    );

    rerender(
      <CaptureTimeline
        {...props}
        initialTimeline={page([
          capture("imported-meal", "【饮食 · 早餐】鸡蛋", "2026-08-09T00:15:00.000Z"),
          capture("initial-capture", "Initial capture"),
        ], null, 74)}
      />,
    );

    await waitFor(() => expect(screen.getByText("【饮食 · 早餐】鸡蛋")).toBeInTheDocument());
    expect(screen.getAllByText("Initial capture")).toHaveLength(1);
  });

  it("ignores an old in-flight page after the server snapshot or date changes", async () => {
    let resolveOldPage!: (response: Response) => void;
    const oldPage = new Promise<Response>((resolve) => {
      resolveOldPage = resolve;
    });
    const request = vi.fn(() => oldPage);
    const shared = {
      newItems: [newlySavedCapture("local-capture", "Locally saved capture")],
      onRefreshed: vi.fn(),
      request,
    };
    const { rerender } = render(
      <CaptureTimeline
        {...shared}
        businessDate="2026-08-09"
        initialTimeline={page([capture("old-first", "Old first page")], "old-cursor", 73)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    expect(request).toHaveBeenCalledWith(
      "/api/v1/today/captures?date=2026-08-09&limit=50&cursor=old-cursor&snapshot=73",
    );

    rerender(
      <CaptureTimeline
        {...shared}
        businessDate="2026-08-10"
        initialTimeline={page([{
          ...capture("new-first", "New server snapshot", "2026-08-10T01:00:00.000Z"),
          businessDate: "2026-08-10",
        }], null, 81)}
      />,
    );

    await act(async () => {
      resolveOldPage(Response.json(page([
        capture("late-old-page", "Late old page"),
      ], "late-old-cursor", 73)));
      await oldPage;
    });

    expect(screen.getByText("New server snapshot")).toBeInTheDocument();
    expect(screen.getByText("Locally saved capture")).toBeInTheDocument();
    expect(screen.queryByText("Old first page")).not.toBeInTheDocument();
    expect(screen.queryByText("Late old page")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "加载更多" })).not.toBeInTheDocument();
  });
});
