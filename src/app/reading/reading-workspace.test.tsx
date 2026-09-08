// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReadingSnapshot } from "@/modules/reading/contracts";

import { ReadingWorkspace } from "./reading-workspace";

const emptySnapshot: ReadingSnapshot = { books: [], notes: [] };

function snapshotWithBook(): ReadingSnapshot {
  return {
    books: [{
      bookId: "book-ui-0001",
      title: "界面测试书",
      author: "作者乙",
      status: "wishlist",
      totalPages: 200,
      currentPage: 0,
      rating: 4,
      pdf: null,
      revision: 1,
      createdAt: "2026-08-14T08:00:00.000Z",
      updatedAt: "2026-08-14T08:00:00.000Z",
    }],
    notes: [],
  };
}

function snapshotWithPdf(): ReadingSnapshot {
  const snapshot = snapshotWithBook();
  return {
    ...snapshot,
    books: snapshot.books.map((book) => ({
      ...book,
      pdf: {
        storageKey: "reading/book-ui-0001/test.pdf",
        originalName: "界面测试书.pdf",
        sizeBytes: 4_194_304,
        addedAt: "2026-08-14T09:00:00.000Z",
      },
    })),
  };
}

function mockStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  } as Storage;
}

function mockResponse(snapshot: ReadingSnapshot, status = 200): Response {
  return new Response(JSON.stringify({ result: { snapshot, applied: { operation: "save-book", ownerId: "book-ui-0001", ownerRevision: 1, businessDate: null } } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installFullscreenMock(viewer: HTMLElement) {
  let fullscreenElement: Element | null = null;
  const viewerRequestDescriptor = Object.getOwnPropertyDescriptor(viewer, "requestFullscreen");
  const documentElementDescriptor = Object.getOwnPropertyDescriptor(document, "fullscreenElement");
  const documentExitDescriptor = Object.getOwnPropertyDescriptor(document, "exitFullscreen");
  const emitChange = () => document.dispatchEvent(new Event("fullscreenchange"));
  const requestFullscreen = vi.fn(async () => {
    fullscreenElement = viewer;
    emitChange();
  });
  const exitFullscreen = vi.fn(async () => {
    fullscreenElement = null;
    emitChange();
  });

  Object.defineProperty(viewer, "requestFullscreen", {
    configurable: true,
    value: requestFullscreen,
  });
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreenElement,
  });
  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    value: exitFullscreen,
  });

  const restoreDescriptor = (
    target: object,
    property: string,
    descriptor: PropertyDescriptor | undefined,
  ) => {
    if (descriptor) Object.defineProperty(target, property, descriptor);
    else Reflect.deleteProperty(target, property);
  };

  return {
    exitFullscreen,
    leaveFullscreen() {
      fullscreenElement = null;
      emitChange();
    },
    requestFullscreen,
    restore() {
      restoreDescriptor(viewer, "requestFullscreen", viewerRequestDescriptor);
      restoreDescriptor(document, "fullscreenElement", documentElementDescriptor);
      restoreDescriptor(document, "exitFullscreen", documentExitDescriptor);
    },
  };
}

let fullscreenMock: ReturnType<typeof installFullscreenMock> | null = null;

afterEach(() => {
  fullscreenMock?.restore();
  fullscreenMock = null;
  cleanup();
  vi.restoreAllMocks();
});

describe("ReadingWorkspace", () => {
  it("renders the empty state and add form", () => {
    render(
      <ReadingWorkspace
        initial={emptySnapshot}
        storage={mockStorage()}
        request={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "读书" })).toBeDefined();
    expect(screen.getByLabelText("书名")).toBeDefined();
    expect(screen.queryByLabelText("作者")).toBeNull();
    expect(screen.queryByText(/评分/)).toBeNull();
    expect(screen.getByRole("button", { name: "添加书籍" })).toBeDefined();
    expect(screen.getByText("这个分类还没有书籍。")).toBeDefined();
  });

  it("keeps every book compact until its details are expanded", async () => {
    const user = userEvent.setup();
    render(
      <ReadingWorkspace
        initial={snapshotWithBook()}
        storage={mockStorage()}
        request={vi.fn()}
      />,
    );
    const card = screen.getByRole("article", { name: "书籍：界面测试书" });
    expect(within(card).getByText("界面测试书")).toBeDefined();
    expect(within(card).getByText("待看")).toBeDefined();
    expect(within(card).queryByText(/作者乙|佚名/)).toBeNull();
    expect(within(card).getByText("待看")).toHaveTextContent("★★★★");
    expect(within(card).getByRole("button", { name: "开始阅读" })).toBeDefined();
    expect(within(card).getByRole("button", { name: "编辑" })).toBeDefined();
    expect(card).toHaveTextContent("0 / 200 页（0%）");
    expect(within(card).queryByRole("progressbar")).toBeNull();
    expect(within(card).queryByText(/读后感/)).toBeNull();

    const expand = within(card).getByRole("button", { name: "展开书籍：界面测试书" });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    await user.click(expand);
    expect(within(card).getByRole("progressbar")).toBeVisible();
    expect(within(card).getByRole("button", { name: "收起书籍：界面测试书" })).toHaveAttribute("aria-expanded", "true");
  });

  it("filters by status tabs", async () => {
    const user = userEvent.setup();
    render(
      <ReadingWorkspace
        initial={snapshotWithBook()}
        storage={mockStorage()}
        request={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("tab", { name: "在读" }));
    expect(screen.getByText("这个分类还没有书籍。")).toBeDefined();
    await user.click(screen.getByRole("tab", { name: "待看" }));
    expect(screen.getByText("界面测试书")).toBeDefined();
  });

  it("opens an attached PDF directly inside the book card", async () => {
    const user = userEvent.setup();
    render(
      <ReadingWorkspace
        initial={snapshotWithPdf()}
        storage={mockStorage()}
        request={vi.fn()}
      />,
    );

    expect(screen.queryByTitle("PDF 阅读器：界面测试书")).toBeNull();
    await user.click(screen.getByRole("button", { name: "展开书籍：界面测试书" }));
    await user.click(screen.getByRole("button", { name: "查看 PDF：界面测试书" }));

    const readerWithoutThumbnails = screen.getByTitle("PDF 阅读器：界面测试书");
    expect(readerWithoutThumbnails).toHaveAttribute(
      "src",
      "/api/v1/reading/books/book-ui-0001/pdf#view=FitH&navpanes=0",
    );
    expect(screen.getByRole("button", { name: "收起 PDF：界面测试书" })).toHaveAttribute("aria-expanded", "true");

    const showThumbnails = screen.getByRole("button", { name: "显示缩略图：界面测试书" });
    expect(showThumbnails).toHaveAttribute("aria-pressed", "false");
    await user.click(showThumbnails);

    const readerWithThumbnails = screen.getByTitle("PDF 阅读器：界面测试书");
    expect(readerWithThumbnails).not.toBe(readerWithoutThumbnails);
    expect(readerWithThumbnails).toHaveAttribute(
      "src",
      "/api/v1/reading/books/book-ui-0001/pdf#view=FitH&navpanes=1",
    );
    expect(screen.getByRole("button", { name: "收起缩略图：界面测试书" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "收起缩略图：界面测试书" }));
    const readerCollapsedAgain = screen.getByTitle("PDF 阅读器：界面测试书");
    expect(readerCollapsedAgain).not.toBe(readerWithThumbnails);
    expect(readerCollapsedAgain).toHaveAttribute(
      "src",
      "/api/v1/reading/books/book-ui-0001/pdf#view=FitH&navpanes=0",
    );

    const viewer = screen.getByLabelText("PDF 阅读器：界面测试书");
    await user.click(screen.getByRole("button", { name: "铺满软件：界面测试书" }));
    expect(viewer).toHaveClass("is-window-filled");
    expect(screen.getByRole("button", { name: "退出铺满软件：界面测试书" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "退出铺满软件：界面测试书" }));
    expect(viewer).not.toHaveClass("is-window-filled");

    fullscreenMock = installFullscreenMock(viewer);
    await user.click(screen.getByRole("button", { name: "电脑全屏：界面测试书" }));
    expect(fullscreenMock.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(viewer).toHaveClass("is-fullscreen");
    expect(screen.getByRole("button", { name: "退出电脑全屏：界面测试书" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "退出电脑全屏：界面测试书" }));
    expect(fullscreenMock.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(viewer).not.toHaveClass("is-fullscreen");
    expect(screen.getByRole("button", { name: "电脑全屏：界面测试书" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "电脑全屏：界面测试书" }));
    act(() => fullscreenMock?.leaveFullscreen());
    expect(viewer).not.toHaveClass("is-fullscreen");
    expect(screen.getByRole("button", { name: "电脑全屏：界面测试书" })).toBeVisible();
  });

  it("submits a new book through the submission hook", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      mockResponse(snapshotWithBook()),
    );
    const ids = ["book-ui-0001", "reading-submit-key-0001"];
    render(
      <ReadingWorkspace
        initial={emptySnapshot}
        storage={mockStorage()}
        request={request}
        createId={() => ids.shift() ?? "reading-submit-key-replay"}
      />,
    );

    await user.type(screen.getByLabelText("书名"), "界面测试书");
    await user.type(screen.getByLabelText("总页数"), "200");
    await user.click(screen.getByRole("button", { name: "添加书籍" }));

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        "/api/v1/reading",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const call = request.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(String(call.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "save-book",
      bookId: "book-ui-0001",
      title: "界面测试书",
      author: "",
      status: "wishlist",
      totalPages: 200,
      currentPage: 0,
      rating: null,
    });
  });

  it("keeps legacy author and rating values while editing the supported fields", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const command = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({
        result: {
          snapshot: snapshotWithBook(),
          applied: {
            operation: "save-book",
            ownerId: command.bookId,
            ownerRevision: 2,
            businessDate: null,
          },
        },
      });
    });
    render(
      <ReadingWorkspace
        initial={snapshotWithBook()}
        storage={mockStorage()}
        request={request}
        createId={() => "reading-edit-key-0001"}
      />,
    );

    await user.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.queryByLabelText("编辑作者：界面测试书")).toBeNull();
    expect(screen.getByLabelText("编辑评分：界面测试书")).toHaveValue("4");
    await user.clear(screen.getByLabelText("编辑当前页：界面测试书"));
    await user.type(screen.getByLabelText("编辑当前页：界面测试书"), "35");
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(request.mock.calls[0]![1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "save-book",
      bookId: "book-ui-0001",
      title: "界面测试书",
      author: "作者乙",
      status: "wishlist",
      totalPages: 200,
      currentPage: 35,
      rating: 4,
      expectedRevision: 1,
    });
  });

  it("keeps legacy author and rating values when changing status", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const command = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({
        result: {
          snapshot: snapshotWithBook(),
          applied: {
            operation: "save-book",
            ownerId: command.bookId,
            ownerRevision: 2,
            businessDate: null,
          },
        },
      });
    });
    render(
      <ReadingWorkspace
        initial={snapshotWithBook()}
        storage={mockStorage()}
        request={request}
        createId={() => "reading-status-key-0001"}
      />,
    );

    await user.click(screen.getByRole("button", { name: "开始阅读" }));

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(request.mock.calls[0]![1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "save-book",
      author: "作者乙",
      status: "reading",
      rating: 4,
      expectedRevision: 1,
    });
  });
});
