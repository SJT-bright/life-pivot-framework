// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredCapture } from "@/modules/today/contracts";
import type { CapturePage } from "@/modules/today/get-captures";
import type { CaptureSource } from "@/modules/today/get-capture-source";

import { CAPTURE_DRAFT_STORAGE_KEY, type CaptureDraft } from "./capture-draft";
import TodayPage from "./page";
import { TodayCapture } from "./today-capture";

const pageDependencies = vi.hoisted(() => ({
  database: { sqlite: {} },
  getDatabase: vi.fn(),
  getSource: vi.fn(),
  getTimeline: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/core/db/application-database", () => ({
  getApplicationDatabase: pageDependencies.getDatabase,
}));

vi.mock("@/modules/today/get-captures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/today/get-captures")>()),
  getCaptureTimeline: pageDependencies.getTimeline,
}));

vi.mock("@/modules/today/get-capture-source", () => ({
  getCaptureSource: pageDependencies.getSource,
}));

const emptyTimeline: CapturePage = {
  items: [],
  nextCursor: null,
  snapshotHighWater: 0,
};

const activeSource: CaptureSource = {
  id: "capture-source",
  businessDate: "2026-08-09",
  occurredAt: "2026-08-09T08:30:00.000Z",
  text: "Exact source text outside the first page",
  createdAt: "2026-08-09T08:30:01.000Z",
  disposition: "active",
};

function savedItem(text: string, id = `saved-${text}`, businessDate = "2026-08-09"): StoredCapture {
  return {
    id,
    draftId: `draft-${id}`,
    businessDate,
    occurredAt: "2026-08-09T08:30:00.000Z",
    text,
    createdAt: "2026-08-09T12:00:00.000Z",
  };
}

type CandidateCommand = {
  id: string;
  sourceCaptureId: string;
  domainKey: string;
  title: string;
  content: string;
  tags: string[];
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function ids() {
  let index = 0;
  return () => `identity-${String(++index).padStart(8, "0")}`;
}

beforeEach(() => {
  localStorage.clear();
  pageDependencies.getDatabase.mockReset().mockReturnValue(pageDependencies.database);
  pageDependencies.getTimeline.mockReset().mockReturnValue(emptyTimeline);
  pageDependencies.getSource.mockReset().mockReturnValue(activeSource);
});
afterEach(() => cleanup());

describe("TodayCapture", () => {
  it("loads and renders an active exact source without loading the unrelated timeline", async () => {
    pageDependencies.getTimeline.mockReturnValue({
      items: [{
        id: "timeline-only",
        businessDate: "2026-08-09",
        occurredAt: "2026-08-09T09:00:00.000Z",
        text: "Timeline only text",
        createdAt: "2026-08-09T09:00:01.000Z",
      }],
      nextCursor: null,
      snapshotHighWater: 61,
    });

    render(await TodayPage({
      searchParams: Promise.resolve({ date: "2026-08-09", source: "capture-source" }),
    }));

    const sourcePanel = screen.getByRole("region", { name: "知识来源原文" });
    expect(within(sourcePanel).getByText("Exact source text outside the first page")).toBeInTheDocument();
    expect(within(sourcePanel).getByText("2026-08-09")).toBeInTheDocument();
    expect(within(sourcePanel).getByText("有效")).toBeInTheDocument();
    expect(within(sourcePanel).queryByRole("button")).not.toBeInTheDocument();
    expect(within(sourcePanel).queryByRole("link")).not.toBeInTheDocument();
    expect(document.querySelector(".capture-timeline")).toBeNull();
    expect(screen.queryByText("Timeline only text")).not.toBeInTheDocument();
    expect(pageDependencies.getTimeline).not.toHaveBeenCalled();
    expect(pageDependencies.getSource).toHaveBeenCalledWith(pageDependencies.database.sqlite, {
      businessDate: "2026-08-09",
      sourceId: "capture-source",
    });
  });

  it("shows a voided source with its original text and current disposition", async () => {
    pageDependencies.getTimeline.mockReturnValue({
      items: [{
        id: "timeline-visible-with-voided-source",
        businessDate: "2026-08-09",
        occurredAt: "2026-08-09T09:00:00.000Z",
        text: "Timeline remains actionable beside voided source",
        createdAt: "2026-08-09T09:00:01.000Z",
      }],
      nextCursor: null,
      snapshotHighWater: 62,
    });
    pageDependencies.getSource.mockReturnValue({
      ...activeSource,
      text: "Original text remains visible",
      disposition: "voided",
    });

    render(await TodayPage({
      searchParams: Promise.resolve({ date: "2026-08-09", source: "capture-source" }),
    }));

    const sourcePanel = screen.getByRole("region", { name: "知识来源原文" });
    expect(within(sourcePanel).getByText("Original text remains visible")).toBeInTheDocument();
    expect(within(sourcePanel).queryByRole("button")).not.toBeInTheDocument();
    expect(document.querySelector(".capture-timeline")).toBeNull();
    expect(pageDependencies.getTimeline).not.toHaveBeenCalled();
    expect(within(sourcePanel).getByText("已作废")).toBeInTheDocument();
  });

  it("preserves every line break in multiline source text", async () => {
    const multilineText = "First source line\nSecond source line\n\nFourth source line";
    pageDependencies.getSource.mockReturnValue({
      ...activeSource,
      text: multilineText,
    });

    render(await TodayPage({
      searchParams: Promise.resolve({ date: "2026-08-09", source: "capture-source" }),
    }));

    const sourcePanel = screen.getByRole("region", { name: "知识来源原文" });
    const sourceText = [...sourcePanel.querySelectorAll("p")]
      .find((paragraph) => paragraph.textContent === multilineText);
    expect(sourceText).toBeDefined();
    expect(sourceText).toHaveStyle({ whiteSpace: "pre-wrap" });
  });

  it("renders source HTML-like content only as inert text", async () => {
    const htmlLikeText = '<img src="x" onerror="alert(1)"><script>capture-secret</script>';
    pageDependencies.getSource.mockReturnValue({ ...activeSource, text: htmlLikeText });

    render(await TodayPage({
      searchParams: Promise.resolve({ date: "2026-08-09", source: "capture-source" }),
    }));

    const sourcePanel = screen.getByRole("region", { name: "知识来源原文" });
    expect(within(sourcePanel).getByText(htmlLikeText)).toBeInTheDocument();
    expect(sourcePanel.querySelector("img")).toBeNull();
    expect(sourcePanel.querySelector("script")).toBeNull();
  });

  it("contains an unavailable source behind generic UI without loading the timeline", async () => {
    pageDependencies.getTimeline.mockReturnValue({
      items: [{
        id: "timeline-still-visible",
        businessDate: "2026-08-09",
        occurredAt: "2026-08-09T09:00:00.000Z",
        text: "Timeline remains available",
        createdAt: "2026-08-09T09:00:01.000Z",
      }],
      nextCursor: null,
      snapshotHighWater: 2,
    });
    pageDependencies.getSource.mockImplementation(() => {
      throw new Error("private database path and capture-secret");
    });

    render(await TodayPage({
      searchParams: Promise.resolve({ date: "2026-08-09", source: "capture-secret" }),
    }));

    expect(screen.getByRole("region", { name: "知识来源原文" })).toHaveTextContent("来源记录不可用");
    expect(screen.queryByText("Timeline remains available")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("记录日期")).not.toBeInTheDocument();
    expect(pageDependencies.getTimeline).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent("private database path");
    expect(document.body).not.toHaveTextContent("capture-secret");
  });

  it("keeps the ordinary date-only page read-only with the timeline available", async () => {
    render(await TodayPage({
      searchParams: Promise.resolve({ date: "2026-08-09" }),
    }));

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(document.querySelector(".date-stepper")).not.toBeNull();
    expect(document.querySelector(".capture-timeline")).not.toBeNull();
    expect(screen.queryByRole("region", { name: "知识来源原文" })).not.toBeInTheDocument();
    expect(pageDependencies.getDatabase).toHaveBeenCalledTimes(1);
    expect(pageDependencies.getTimeline).toHaveBeenCalledWith(pageDependencies.database.sqlite, {
      businessDate: "2026-08-09",
      limit: 50,
    });
    expect(pageDependencies.getSource).not.toHaveBeenCalled();
  });

  it("renders only a read-only fail-closed exit when a focused source query is invalid", async () => {
    for (const searchParams of [
      { source: "capture-source" },
      { date: "2026-02-30", source: "capture-source" },
      { date: ["2026-08-09", "2026-08-10"], source: "capture-source" },
      { date: "2026-08-09", source: ["capture-source", "other"] },
    ]) {
      cleanup();
      pageDependencies.getTimeline.mockClear();
      pageDependencies.getSource.mockClear();

      render(await TodayPage({ searchParams: Promise.resolve(searchParams) }));

      const main = screen.getByRole("main");
      expect(within(main).getByText("来源记录不可用")).toBeInTheDocument();

      expect(within(main).queryByRole("heading", { name: "把今天记下来" })).not.toBeInTheDocument();
      expect(within(main).queryByRole("textbox")).not.toBeInTheDocument();
      expect(within(main).queryByRole("button", { name: "保存到待整理" })).not.toBeInTheDocument();
      expect(document.querySelector("form.date-picker")).toBeNull();
       expect(document.querySelector(".capture-timeline")).toBeNull();
      expect(main).not.toHaveTextContent("capture-source");
      expect(pageDependencies.getTimeline, JSON.stringify(searchParams)).not.toHaveBeenCalled();
      expect(pageDependencies.getSource, JSON.stringify(searchParams)).not.toHaveBeenCalled();
    }
  });

  it("links out of source focus and preserves timeline cursors on an ordinary capture view", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({
      items: [],
      nextCursor: null,
      snapshotHighWater: 42,
    }));
    pageDependencies.getTimeline.mockReturnValue({
      items: [],
      nextCursor: "opaque-cursor",
      snapshotHighWater: 42,
    });

    render(await TodayPage({
      searchParams: Promise.resolve({ date: "2026-08-09", source: "capture-source" }),
    }));

    expect(document.querySelector("form.date-picker")).toBeNull();


    cleanup();
    render(
      <TodayCapture
        businessDate="2026-08-09"
        focusedSource={activeSource}
        initialTimeline={{
          items: [],
          nextCursor: "opaque-cursor",
          snapshotHighWater: 42,
        }}
        request={request}
      />,
    );
    await user.click(screen.getByRole("button", { name: "加载更多" }));

    const requestUrl = String(request.mock.calls[0]?.[0]);
    expect(requestUrl).toContain("cursor=opaque-cursor");
    expect(requestUrl).toContain("snapshot=42");
    expect(requestUrl).not.toContain("source=");
    const timeline = document.querySelector(".capture-timeline");
    expect(timeline?.querySelectorAll("article")).toHaveLength(0);
  });

  it("snapshots a strict request, rotates immediately, and inserts the saved fact", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({
      section: "entry",
      status: "saved",
      item: savedItem("First fact"),
    }));
    render(
      <TodayCapture
        businessDate="2026-08-09"
        createId={ids()}
        initialTimeline={emptyTimeline}
        now={() => new Date("2026-08-09T08:30:00.000Z")}
        request={request}
      />,
    );

    const composer = await screen.findByRole("textbox");
    await user.type(composer, "First fact");
    await user.click(screen.getByRole("button", { name: "保存到待整理" }));

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    const [, init] = request.mock.calls[0] ?? [];
    expect(init?.headers).toMatchObject({
      "idempotency-key": "identity-00000002",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      section: "entry",
      draftId: "identity-00000001",
      businessDate: "2026-08-09",
      occurredAt: "2026-08-09T08:30:00.000Z",
      value: { text: "First fact" },
    });
    await waitFor(() => expect(composer).toHaveValue(""));
    expect(within(screen.getByLabelText("刚刚保存")).getByText("First fact")).toBeInTheDocument();
  });

  it("reports an HTML 404 as a missing local service instead of an unknown network result", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async () => new Response("<!doctype html><title>Not Found</title>", {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    }));
    render(
      <TodayCapture
        businessDate="2026-08-09"
        createId={ids()}
        initialTimeline={emptyTimeline}
        now={() => new Date("2026-08-09T08:30:00.000Z")}
        request={request}
      />,
    );

    await user.type(await screen.findByRole("textbox"), "Keep this safely");
    await user.click(screen.getByRole("button", { name: "保存到待整理" }));

    expect(await screen.findByText(/本地保存服务未找到/)).toBeInTheDocument();
    expect(screen.queryByText(/网络结果未知/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再次确认保存" })).toBeEnabled();
    expect(JSON.parse(localStorage.getItem(CAPTURE_DRAFT_STORAGE_KEY) ?? "null")).toMatchObject({
      pending: [{ draft: { text: "Keep this safely" }, status: "failed" }],
    });
  });

  it("keeps the pending draft when a saved response has an incomplete item", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async () => Response.json({ status: "saved", item: {} }));
    render(
      <TodayCapture
        businessDate="2026-08-09"
        createId={ids()}
        initialTimeline={emptyTimeline}
        now={() => new Date("2026-08-09T08:30:00.000Z")}
        request={request}
      />,
    );

    await user.type(await screen.findByRole("textbox"), "Retain malformed success");
    await user.click(screen.getByRole("button", { name: "保存到待整理" }));

    expect(await screen.findByText(/保存结果格式异常/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再次确认保存" })).toBeEnabled();
    expect(JSON.parse(localStorage.getItem(CAPTURE_DRAFT_STORAGE_KEY) ?? "null")).toMatchObject({
      pending: [{ draft: { text: "Retain malformed success" }, status: "failed" }],
    });
  });

  it("keeps a rejected request as an explicit uncertain result without losing the original key", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => { throw new TypeError("Failed to fetch"); });
    render(
      <TodayCapture
        businessDate="2026-08-09"
        createId={ids()}
        initialTimeline={emptyTimeline}
        now={() => new Date("2026-08-09T08:30:00.000Z")}
        request={request}
      />,
    );

    await user.type(await screen.findByRole("textbox"), "Uncertain but retained");
    await user.click(screen.getByRole("button", { name: "保存到待整理" }));

    expect(await screen.findByText(/没有收到本地保存服务的回应/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再次确认保存" })).toBeEnabled();
    const [, init] = request.mock.calls[0] ?? [];
    expect(init?.headers).toMatchObject({ "idempotency-key": "identity-00000002" });
  });


  it("keeps three overlapping submissions and a newer draft across out-of-order responses", async () => {
    const user = userEvent.setup();
    const requests = [deferred<Response>(), deferred<Response>(), deferred<Response>()];
    const request = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { value: { text: string } };
      return requests[["A", "B", "C"].indexOf(body.value.text)]!.promise;
    });
    render(
      <TodayCapture
        businessDate="2026-08-09"
        createId={ids()}
        initialTimeline={emptyTimeline}
        now={() => new Date("2026-08-09T08:30:00.000Z")}
        request={request}
      />,
    );
    const composer = await screen.findByRole("textbox");

    for (const text of ["A", "B", "C"]) {
      await user.type(composer, text);
      await user.keyboard("{Enter}");
    }
    await user.type(composer, "D remains editable");
    expect(request).toHaveBeenCalledTimes(3);
    expect(composer).toHaveValue("D remains editable");

    await act(async () => requests[1]!.resolve(Response.json({ status: "saved", item: savedItem("B") })));
    await act(async () => requests[0]!.resolve(Response.json({ status: "saved", item: savedItem("A") })));
    await act(async () => requests[2]!.resolve(Response.json({ status: "saved", item: savedItem("C") })));

    await waitFor(() => expect(screen.queryByLabelText("待确认提交")).not.toBeInTheDocument());
    expect(composer).toHaveValue("D remains editable");
    const newItems = screen.getByLabelText("刚刚保存");
    for (const text of ["A", "B", "C"]) expect(within(newItems).getByText(text)).toBeInTheDocument();
  });

  it.each(["already committed", "not committed"])(
    "rehydrates a saving item as an explicit same-key retry: %s",
    async () => {
      const user = userEvent.setup();
      const draft: CaptureDraft = {
        version: 1,
        draftId: "draft-reload-0001",
        draftBusinessDate: "2026-08-09",
        occurredAt: "2026-08-09T08:30:00.000Z",
        idempotencyKey: "request-reload-0001",
        text: "Reload-safe fact",
      };
      localStorage.setItem(CAPTURE_DRAFT_STORAGE_KEY, JSON.stringify({
        version: 1,
        pending: [{ draft, status: "saving" }],
        legacy: [],
      }));
      const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({
        status: "saved",
        item: savedItem("Reload-safe fact", "reload-saved"),
      }));
      render(
        <TodayCapture
          businessDate="2026-08-09"
          initialTimeline={emptyTimeline}
          request={request}
        />,
      );

      const retry = await screen.findByRole("button", { name: "再次确认保存" });
      expect(retry).toBeEnabled();
      expect(request).not.toHaveBeenCalled();
      await user.click(retry);

      await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
      const [, init] = request.mock.calls[0] ?? [];
      expect(init?.headers).toMatchObject({ "idempotency-key": "request-reload-0001" });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        draftId: "draft-reload-0001",
        value: { text: "Reload-safe fact" },
      });
      await waitFor(() => expect(screen.queryByLabelText("待确认提交")).not.toBeInTheDocument());
    },
  );

  it("keeps a cross-date success out of the active timeline and links to its frozen date", async () => {
    const user = userEvent.setup();
    localStorage.setItem(CAPTURE_DRAFT_STORAGE_KEY, JSON.stringify({
      version: 1,
      current: {
        version: 1,
        draftId: "draft-old-date",
        draftBusinessDate: "2026-08-08",
        occurredAt: "2026-08-08T08:00:00.000Z",
        idempotencyKey: "request-old-date",
        text: "Belongs to yesterday",
      },
      pending: [],
      legacy: [],
    }));
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({
      status: "saved",
      item: savedItem("Belongs to yesterday", "old-date-item", "2026-08-08"),
    }));
    render(
      <TodayCapture
        businessDate="2026-08-09"
        initialTimeline={emptyTimeline}
        request={request}
      />,
    );

    expect(await screen.findByText("这份草稿属于 2026-08-08")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "保存到待整理" }));

    const link = await screen.findByRole("link", { name: "查看 2026-08-08" });
    expect(link).toHaveAttribute("href", "/today?date=2026-08-08");
    expect(screen.queryByLabelText("刚刚保存")).not.toBeInTheDocument();
  });

  it("redates only the unsaved draft without changing its identities", async () => {
    const user = userEvent.setup();
    localStorage.setItem(CAPTURE_DRAFT_STORAGE_KEY, JSON.stringify({
      version: 1,
      current: {
        version: 1,
        draftId: "draft-old-date",
        draftBusinessDate: "2026-08-08",
        occurredAt: "2026-08-08T08:00:00.000Z",
        idempotencyKey: "request-old-date",
        text: "Move me",
      },
      pending: [],
      legacy: [],
    }));
    render(
      <TodayCapture
        businessDate="2026-08-09"
        initialTimeline={emptyTimeline}
        now={() => new Date("2026-08-09T09:00:00.000Z")}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "改为当前日期" }));
    const stored = JSON.parse(localStorage.getItem(CAPTURE_DRAFT_STORAGE_KEY) ?? "null");
    await waitFor(() => expect(stored.current?.draftBusinessDate ?? "2026-08-08").toBeTruthy());
    await waitFor(() => {
      const latest = JSON.parse(localStorage.getItem(CAPTURE_DRAFT_STORAGE_KEY) ?? "null");
      expect(latest.current).toMatchObject({
        draftId: "draft-old-date",
        idempotencyKey: "request-old-date",
        draftBusinessDate: "2026-08-09",
        occurredAt: "2026-08-09T09:00:00.000Z",
      });
    });
  });

  it("surfaces legacy drafts without network activity and recovers only by explicit action", async () => {
    const user = userEvent.setup();
    localStorage.setItem("life-pivot:draft:entry:2026-08-08:tab-a", "Legacy A");
    localStorage.setItem("life-pivot:draft:entry:2026-08-09:tab-b", "Legacy B");
    const request = vi.fn();
    render(
      <TodayCapture
        businessDate="2026-08-09"
        createId={ids()}
        initialTimeline={emptyTimeline}
        now={() => new Date("2026-08-10T08:00:00.000Z")}
        request={request}
      />,
    );

    const recovery = await screen.findByLabelText("旧草稿恢复");
    expect(within(recovery).getByText(/Legacy A/)).toBeInTheDocument();
    expect(within(recovery).getByText(/Legacy B/)).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
    await user.click(within(recovery).getAllByRole("button", { name: "继续编辑" })[0]!);

    expect(screen.getByRole("textbox")).toHaveValue("Legacy A");
    expect(localStorage.getItem("life-pivot:draft:entry:2026-08-08:tab-a")).toBe("Legacy A");
    expect(JSON.parse(localStorage.getItem(CAPTURE_DRAFT_STORAGE_KEY) ?? "null")).toMatchObject({
      version: 1,
      current: { text: "Legacy A", draftBusinessDate: "2026-08-08" },
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps an unreadable envelope untouched and never auto-imports or sends legacy text", async () => {
    localStorage.setItem(CAPTURE_DRAFT_STORAGE_KEY, "unreadable-evidence");
    localStorage.setItem("life-pivot:draft:entry:2026-08-08:tab-a", "Do not auto import");
    const request = vi.fn();
    render(
      <TodayCapture
        businessDate="2026-08-09"
        initialTimeline={emptyTimeline}
        request={request}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("已原样保留");
    expect(screen.queryByLabelText("旧草稿恢复")).not.toBeInTheDocument();
    expect(localStorage.getItem(CAPTURE_DRAFT_STORAGE_KEY)).toBe("unreadable-evidence");
    expect(request).not.toHaveBeenCalled();
  });

  it("surfaces local persistence failure without blocking database submission", async () => {
    const user = userEvent.setup();
    const values = new Map<string, string>();
    const failingStorage: Storage = {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem: (key) => { values.delete(key); },
      setItem: () => { throw new Error("quota"); },
    };
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ status: "saved", item: savedItem("Still saved") }));
    render(
      <TodayCapture
        businessDate="2026-08-09"
        createId={ids()}
        initialTimeline={emptyTimeline}
        request={request}
        storage={failingStorage}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("无法持久化草稿");
    await user.type(screen.getByRole("textbox"), "Still saved");
    await user.click(screen.getByRole("button", { name: "保存到待整理" }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  });

  it("uses one-line and multiline keyboard rules without submitting IME Enter", async () => {
    const user = userEvent.setup();
    const request = vi.fn(() => new Promise<Response>(() => undefined));
    render(
      <TodayCapture
        businessDate="2026-08-09"
        createId={ids()}
        initialTimeline={emptyTimeline}
        request={request}
      />,
    );
    const composer = await screen.findByRole("textbox");
    await user.type(composer, "Line one");
    fireEvent.keyDown(composer, { key: "Enter", isComposing: true });
    expect(request).not.toHaveBeenCalled();
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(composer).toHaveValue("Line one\n");
    await user.type(composer, "Line two");
    await user.keyboard("{Enter}");
    expect(request).not.toHaveBeenCalled();
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  });

  it("loads the next page with the original snapshot", async () => {
    const user = userEvent.setup();
    const initialTimeline: CapturePage = {
      items: [{
        id: "first",
        businessDate: "2026-08-09",
        occurredAt: "2026-08-09T09:00:00.000Z",
        text: "First page",
        createdAt: "2026-08-09T09:00:01.000Z",
      }],
      nextCursor: "opaque-cursor",
      snapshotHighWater: 42,
    };
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({
      items: [{
        id: "second",
        businessDate: "2026-08-09",
        occurredAt: "2026-08-09T08:00:00.000Z",
        text: "Second page",
        createdAt: "2026-08-09T08:00:01.000Z",
      }],
      nextCursor: null,
      snapshotHighWater: 42,
    }));
    render(
      <TodayCapture
        businessDate="2026-08-09"
        initialTimeline={initialTimeline}
        request={request}
      />,
    );

    await user.click(screen.getByRole("button", { name: "加载更多" }));

    await screen.findByText("Second page");
    expect(String(request.mock.calls[0]?.[0])).toBe(
      "/api/v1/today/captures?date=2026-08-09&limit=50&cursor=opaque-cursor&snapshot=42",
    );
  });
});


