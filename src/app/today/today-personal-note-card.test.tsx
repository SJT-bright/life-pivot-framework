// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PersonalDailyNote } from "@/modules/personal-notes/contracts";

import { TodayPersonalNoteCard } from "./today-personal-note-card";

const note: PersonalDailyNote = {
  id: "note-20260812",
  businessDate: "2026-08-12",
  content: "原备注",
  revision: 1,
  createdAt: "2026-08-12T01:00:00.000Z",
  updatedAt: "2026-08-12T01:00:00.000Z",
};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("crypto", { randomUUID: vi.fn()
    .mockReturnValueOnce("personal-note-key-0001")
    .mockReturnValueOnce("personal-note-key-0002") });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TodayPersonalNoteCard", () => {
  it("edits the one daily note and stores exact frozen bytes before POST", async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      () => new Promise<Response>((resolve) => { resolveFetch = resolve; }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    render(<TodayPersonalNoteCard businessDate="2026-08-12" initialNote={note} />);

    fireEvent.change(screen.getByRole("textbox", { name: "每日复盘" }), {
      target: { value: "更新后的备注" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存复盘" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [, init] = fetchSpy.mock.calls[0]!;
    const body = String((init as RequestInit).body);
    expect(JSON.parse(body)).toEqual({
      type: "save-personal-daily-note",
      noteId: "note-20260812",
      businessDate: "2026-08-12",
      content: "更新后的备注",
      expectedRevision: 1,
    });
    expect([...Array(localStorage.length)].map((_, index) => localStorage.key(index)))
      .toContain("life-pivot:accumulation:submission:v1:personal-note:personal-note-key-0001");

    await act(async () => resolveFetch(Response.json({
      result: { ...note, content: "更新后的备注", revision: 2 },
    })));
    await screen.findByText("已保存");
    expect(localStorage.length).toBe(0);
  });

  it("recovers an uncertain exact submission without auto-sending and offers exact retry", async () => {
    const body = JSON.stringify({
      type: "save-personal-daily-note",
      noteId: "note-20260812",
      businessDate: "2026-08-12",
      content: "等待确认的备注",
      expectedRevision: 1,
    });
    localStorage.setItem(
      "life-pivot:accumulation:submission:v1:personal-note:personal-note-key-recover-0001",
      JSON.stringify({
        version: 1,
        purpose: "personal-note",
        endpoint: "/api/v1/personal-notes",
        operation: "save-personal-daily-note",
        ownerId: "note-20260812",
        localRevision: 2,
        idempotencyKey: "personal-note-key-recover-0001",
        body,
        expected: { noteId: "note-20260812", businessDate: "2026-08-12", revision: 2 },
        status: "uncertain",
        createdAt: "2026-08-12T02:00:00.000Z",
      }),
    );
    const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => Response.json({ result: { ...note, revision: 2 } }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    render(<TodayPersonalNoteCard businessDate="2026-08-12" initialNote={note} />);

    expect(await screen.findByText(/有一份结果待确认/)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "每日复盘" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "重试原提交" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ body });
  });
});

