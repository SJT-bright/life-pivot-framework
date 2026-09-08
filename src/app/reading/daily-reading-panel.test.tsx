// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DailyReadingSnapshot } from "@/modules/reading/contracts";

import { DailyReadingPanel } from "./daily-reading-panel";

const initial: DailyReadingSnapshot = {
  businessDate: "2026-08-14",
  books: [{
    bookId: "book-daily-ui-0001",
    title: "界面里的每日阅读",
    author: "作者甲",
    status: "reading",
    totalPages: 200,
    currentPage: 10,
    revision: 1,
  }],
  sessions: [],
  totalPagesRead: 0,
  totalMinutes: 0,
};

function storage(options: {
  entries?: Record<string, string>;
  unavailable?: boolean;
} = {}): Storage {
  const values = new Map(Object.entries(options.entries ?? {}));
  return {
    get length() {
      if (options.unavailable) throw new Error("storage unavailable");
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  } as Storage;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DailyReadingPanel", () => {
  it("records pages and minutes with a frozen submission and refreshes the summary", async () => {
    const user = userEvent.setup();
    const saved: DailyReadingSnapshot = {
      ...initial,
      books: [{ ...initial.books[0]!, currentPage: 30, revision: 2 }],
      sessions: [{
        sessionId: "session-daily-ui-0001",
        bookId: "book-daily-ui-0001",
        bookTitle: "界面里的每日阅读",
        businessDate: "2026-08-14",
        startPage: 10,
        endPage: 30,
        pagesRead: 20,
        durationMinutes: 35,
        note: "今天读得很顺",
        revision: 1,
        createdAt: "2026-08-14T08:00:00.000Z",
        updatedAt: "2026-08-14T08:00:00.000Z",
      }],
      totalPagesRead: 20,
      totalMinutes: 35,
    };
    const request = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({
          result: {
            snapshot: initial,
            applied: {
              operation: "save-reading-session",
              ownerId: "session-daily-ui-0001",
              ownerRevision: 1,
              bookRevision: 2,
              businessDate: "2026-08-14",
            },
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ snapshot: saved }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const ids = ["session-daily-ui-0001", "daily-reading-submit-0001"];

    render(<DailyReadingPanel
      businessDate="2026-08-14"
      createId={() => ids.shift() ?? "daily-reading-submit-replay"}
      initial={initial}
      request={request}
      storage={storage()}
    />);
    await user.clear(screen.getByLabelText("读到第几页"));
    await user.type(screen.getByLabelText("读到第几页"), "30");
    await user.type(screen.getByLabelText("阅读分钟"), "35");
    await user.type(screen.getByLabelText("本次备注"), "今天读得很顺");
    await user.click(screen.getByRole("button", { name: "保存本次阅读" }));

    await waitFor(() => expect(request).toHaveBeenCalledWith(
      "/api/v1/daily-reading",
      expect.objectContaining({ method: "POST" }),
    ));
    expect(await screen.findByText("今日共读 20 页 · 35 分钟")).toBeDefined();
    expect(screen.getByText("今天读得很顺")).toBeDefined();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["locked", storage({
      entries: {
        "life-pivot:accumulation:submission:v1:daily-reading:one": "one",
        "life-pivot:accumulation:submission:v1:daily-reading:two": "two",
      },
    }), "本机阅读提交已在其他页面变化，请刷新后继续"],
    ["storage-unavailable", storage({ unavailable: true }), "本机恢复存储不可用，暂时不能保存阅读记录"],
  ] as const)("locks writes when mount recovery is %s", (_kind, providedStorage, expectedMessage) => {
    render(<DailyReadingPanel
      businessDate="2026-08-14"
      initial={initial}
      request={vi.fn()}
      storage={providedStorage}
    />);

    expect(screen.getByRole("button", { name: "保存本次阅读" })).toBeDisabled();
    expect(screen.getByText(expectedMessage)).toBeInTheDocument();
  });

  it("locks the active submission after a same-purpose storage event", async () => {
    const user = userEvent.setup();
    const request = vi.fn(() => new Promise<Response>(() => {}));
    const ids = ["session-cross-tab-0001", "cross-tab-submit-0001"];

    render(<DailyReadingPanel
      businessDate="2026-08-14"
      createId={() => ids.shift() ?? "cross-tab-submit-replay"}
      initial={initial}
      request={request}
      storage={storage()}
    />);
    await user.clear(screen.getByLabelText("读到第几页"));
    await user.type(screen.getByLabelText("读到第几页"), "30");
    await user.type(screen.getByLabelText("阅读分钟"), "35");
    await user.click(screen.getByRole("button", { name: "保存本次阅读" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "重试原提交" })).toBeInTheDocument());

    act(() => window.dispatchEvent(new StorageEvent("storage", {
      key: "life-pivot:accumulation:submission:v1:daily-reading:other",
      newValue: "changed",
    })));

    expect(screen.getByLabelText("读到第几页")).toBeDisabled();
    expect(screen.getByRole("button", { name: "重试原提交" })).toBeDisabled();
    expect(screen.getByText("本机阅读提交已在其他页面变化，请刷新后继续")).toBeInTheDocument();
  });

  it("locks an idle panel when another tab writes a same-purpose submission and never sends", async () => {
    const user = userEvent.setup();
    const request = vi.fn();

    render(<DailyReadingPanel
      businessDate="2026-08-14"
      initial={initial}
      request={request}
      storage={storage()}
    />);
    await user.clear(screen.getByLabelText("读到第几页"));
    await user.type(screen.getByLabelText("读到第几页"), "30");
    await user.type(screen.getByLabelText("阅读分钟"), "35");
    expect(screen.getByRole("button", { name: "保存本次阅读" })).toBeEnabled();

    act(() => window.dispatchEvent(new StorageEvent("storage", {
      key: "life-pivot:accumulation:submission:v1:daily-reading:other",
      newValue: "written-by-other-tab",
    })));

    const saveButton = screen.getByRole("button", { name: "保存本次阅读" });
    await waitFor(() => expect(saveButton).toBeDisabled());
    expect(screen.getByLabelText("读到第几页")).toBeDisabled();
    expect(screen.getByText("本机阅读提交已在其他页面变化，请刷新后继续")).toBeInTheDocument();

    await user.click(saveButton);
    expect(request).not.toHaveBeenCalled();
  });

  it("shows an honest empty state when there is no book to select", () => {
    render(<DailyReadingPanel
      businessDate="2026-08-14"
      initial={{ ...initial, books: [] }}
      request={vi.fn()}
      storage={storage()}
    />);
    expect(screen.getByText("暂无书籍。")).toBeDefined();
    expect(screen.getByRole("button", { name: "保存本次阅读" })).toBeDisabled();
  });
});
