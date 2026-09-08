// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PersonalDailyNote } from "@/modules/personal-notes/contracts";

import { DailyReviewTemplateCard } from "./daily-review-template-card";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace }),
}));

const note: PersonalDailyNote = {
  id: "daily-note-20260812",
  businessDate: "2026-08-12",
  content: JSON.stringify({
    schemaVersion: "daily-review-template-v1",
    completed: "旧记录",
    effective: "旧有效",
    tomorrow: "旧计划",
  }),
  revision: 3,
  createdAt: "2026-08-12T01:00:00.000Z",
  updatedAt: "2026-08-12T01:00:00.000Z",
};

beforeEach(() => {
  localStorage.clear();
  navigation.replace.mockClear();
  vi.stubGlobal("crypto", { randomUUID: vi.fn()
    .mockReturnValueOnce("daily-review-key-0001")
    .mockReturnValueOnce("daily-review-key-0002") });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DailyReviewTemplateCard", () => {
  it("saves template fields as serialized JSON in personal daily note content", async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() => {
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<DailyReviewTemplateCard businessDate="2026-08-12" initialNote={note} />);

    fireEvent.change(screen.getByRole("textbox", { name: "今天做了什么" }), {
      target: { value: "今天完成了内容梳理" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "什么是有效的" }), {
      target: { value: "复盘更清晰" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "明天做什么更好" }), {
      target: { value: "明天做两次复盘" },
    });

    fireEvent.click(screen.getByRole("button", { name: "保存复盘" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const body = String((fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined)?.body);
    const requestBody = JSON.parse(body);
    const content = JSON.parse(requestBody.content as string);
    expect(requestBody).toEqual({
      type: "save-personal-daily-note",
      noteId: "daily-note-20260812",
      businessDate: "2026-08-12",
      expectedRevision: 3,
      content: expect.any(String),
    });
    expect(content).toEqual({
      schemaVersion: "daily-review-template-v1",
      completed: "今天完成了内容梳理",
      effective: "复盘更清晰",
      tomorrow: "明天做两次复盘",
    });

    await act(async () => resolveFetch(Response.json({
      result: {
        ...note,
        content: JSON.stringify(content),
        revision: 4,
      },
    })));
    await screen.findByText("已保存");
    expect(localStorage.length).toBe(0);
  });

  it("offers date correction only for saved reviews", () => {
    const renderCard = (initialNote: PersonalDailyNote | null) => render(
      <DailyReviewTemplateCard businessDate="2026-08-12" initialNote={initialNote} today="2026-08-12" />,
    );

    const unsaved = renderCard(null);
    expect(unsaved.queryByRole("button", { name: "修改日期" })).not.toBeInTheDocument();
    unsaved.unmount();

    const saved = renderCard(note);
    fireEvent.click(screen.getByRole("button", { name: "修改日期" }));
    expect(screen.getByLabelText("移动复盘到")).toHaveAttribute("max", "2026-08-12");
    expect(screen.getByRole("button", { name: "确认移动" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "取消修改日期" }));
    expect(screen.queryByLabelText("移动复盘到")).not.toBeInTheDocument();
    saved.unmount();
  });

  it("moves a saved review to another date and navigates to it", async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() => {
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<DailyReviewTemplateCard businessDate="2026-08-12" initialNote={note} today="2026-08-12" />);

    fireEvent.click(screen.getByRole("button", { name: "修改日期" }));
    const confirm = screen.getByRole("button", { name: "确认移动" });
    fireEvent.change(screen.getByLabelText("移动复盘到"), { target: { value: "2026-08-12" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("移动复盘到"), { target: { value: "2026-08-11" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [endpoint, init] = fetchSpy.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(String(endpoint)).toBe("/api/v1/personal-notes");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      type: "move-personal-daily-note",
      noteId: "daily-note-20260812",
      fromBusinessDate: "2026-08-12",
      toBusinessDate: "2026-08-11",
      expectedRevision: 3,
    });

    await act(async () => resolveFetch(Response.json({
      result: { ...note, businessDate: "2026-08-11", revision: 4 },
    })));
    await screen.findByText("复盘已移动到 2026-08-11。");
    expect(navigation.replace).toHaveBeenCalledWith("/daily-review?date=2026-08-11");
    expect(screen.queryByLabelText("移动复盘到")).not.toBeInTheDocument();
  });

  it("shows the friendly message when the target date already has a review", async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() => {
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<DailyReviewTemplateCard businessDate="2026-08-12" initialNote={note} today="2026-08-12" />);

    fireEvent.click(screen.getByRole("button", { name: "修改日期" }));
    fireEvent.change(screen.getByLabelText("移动复盘到"), { target: { value: "2026-08-11" } });
    fireEvent.click(screen.getByRole("button", { name: "确认移动" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    await act(async () => resolveFetch(Response.json(
      { message: "目标日期已经有一份复盘，请换一个日期" },
      { status: 409 },
    )));
    await screen.findByText("目标日期已经有一份复盘，请换一个日期");
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});

