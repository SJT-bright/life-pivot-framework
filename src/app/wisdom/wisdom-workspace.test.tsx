// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WisdomReminder } from "@/modules/wisdom-reminders/contracts";

import { WisdomWorkspace } from "./wisdom-workspace";

const reminder: WisdomReminder = {
  id: "wisdom-reminder-01",
  content: "先处理情绪，再处理事情。",
  context: "某次访谈里听到的。",
  archivedAt: null,
  revision: 1,
  createdAt: "2026-09-05T10:00:00.000Z",
  updatedAt: "2026-09-05T10:00:00.000Z",
};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("wisdom-ui-0001") });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WisdomWorkspace", () => {
  it("keeps the add form collapsed and lists existing reminders", () => {
    render(<WisdomWorkspace initial={[reminder]} />);
    expect(screen.getByText("先处理情绪，再处理事情。")).toBeDefined();
    expect(screen.getByText("某次访谈里听到的。")).toBeDefined();
    expect(screen.getByRole("button", { name: "编辑" })).toBeDefined();
    const details = document.querySelector("details.wisdom-add") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    fireEvent.click(screen.getByText("＋ 添加提醒"));
    expect(details.open).toBe(true);
    expect(screen.getByLabelText("提醒内容")).toBeDefined();
  });

  it("creates a reminder from the collapsible form and clears the draft", async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() => {
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<WisdomWorkspace initial={[]} createId={() => "wisdom-ui-0001"} />);
    fireEvent.click(screen.getByText("＋ 添加提醒"));
    fireEvent.change(screen.getByLabelText("提醒内容"), {
      target: { value: "能用钱解决的都别拖。" },
    });
    fireEvent.change(screen.getByLabelText("来源或为什么有用"), {
      target: { value: "播客里听到的" },
    });
    fireEvent.click(screen.getByRole("button", { name: "记下这条提醒" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [endpoint, init] = fetchSpy.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(String(endpoint)).toBe("/api/v1/wisdom-reminders");
    expect(JSON.parse(String(init.body))).toEqual({
      type: "create-wisdom-reminder",
      reminderId: "wisdom-ui-0001",
      content: "能用钱解决的都别拖。",
      context: "播客里听到的",
    });

    await act(async () => resolveFetch(Response.json({
      result: { ...reminder, id: "wisdom-wisdom-ui-0001", content: "能用钱解决的都别拖。", context: "播客里听到的" },
    })));
    await screen.findByText("已记下这条提醒。");
    expect(screen.getByText("能用钱解决的都别拖。")).toBeDefined();
    await waitFor(() => expect(localStorage.getItem("page-draft:wisdom-add-draft")).toBeNull());
  });

  it("keeps the newest reminder at the top before and after adding", async () => {
    const newer = {
      ...reminder,
      id: "wisdom-reminder-02",
      content: "刚记下的新提醒",
      createdAt: "2026-09-05T11:00:00.000Z",
      updatedAt: "2026-09-05T11:00:00.000Z",
    };
    const fetchSpy = vi.fn().mockResolvedValue(Response.json({
      result: {
        ...reminder,
        id: "wisdom-reminder-03",
        content: "最后添加的提醒",
        context: "",
        createdAt: "2026-09-05T12:00:00.000Z",
        updatedAt: "2026-09-05T12:00:00.000Z",
      },
    }));

    render(
      <WisdomWorkspace
        createId={() => "wisdom-reminder-03"}
        initial={[reminder, newer]}
        request={fetchSpy}
      />,
    );

    let cards = screen.getAllByRole("listitem");
    expect(cards[0]).toHaveTextContent("刚记下的新提醒");
    expect(cards[1]).toHaveTextContent("先处理情绪，再处理事情。");

    fireEvent.click(screen.getByText("＋ 添加提醒"));
    fireEvent.change(screen.getByLabelText("提醒内容"), {
      target: { value: "最后添加的提醒" },
    });
    fireEvent.click(screen.getByRole("button", { name: "记下这条提醒" }));

    await screen.findByText("已记下这条提醒。");
    cards = screen.getAllByRole("listitem");
    expect(cards[0]).toHaveTextContent("最后添加的提醒");
    expect(cards[1]).toHaveTextContent("刚记下的新提醒");
  });

  it("edits a reminder inline and deletes with confirmation", async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() => {
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<WisdomWorkspace initial={[reminder]} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const textarea = screen.getByLabelText("编辑提醒：先处理情绪，再处理事情。") as HTMLTextAreaElement;
    expect(textarea.value).toBe("先处理情绪，再处理事情。");
    fireEvent.change(textarea, { target: { value: "先处理情绪，再处理事情（改）。" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const updateInit = (fetchSpy.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(JSON.parse(String(updateInit.body))).toMatchObject({
      type: "update-wisdom-reminder",
      reminderId: "wisdom-reminder-01",
      expectedRevision: 1,
    });
    await act(async () => resolveFetch(Response.json({
      result: { ...reminder, content: "先处理情绪，再处理事情（改）。", revision: 2 },
    })));
    await screen.findByText("先处理情绪，再处理事情（改）。");

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    const archiveInit = (fetchSpy.mock.calls[1] as unknown[])[1] as RequestInit;
    expect(JSON.parse(String(archiveInit.body))).toMatchObject({
      type: "archive-wisdom-reminder",
      expectedRevision: 2,
    });
    await act(async () => resolveFetch(Response.json({
      result: { ...reminder, archivedAt: "2026-09-05T11:00:00.000Z", revision: 3 },
    })));
    await screen.findByText("已删除这条提醒。");
    expect(screen.queryByText("先处理情绪，再处理事情（改）。")).not.toBeInTheDocument();
  });
});
