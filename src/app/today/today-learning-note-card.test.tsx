// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PersonalKnowledgeSnapshot } from "@/modules/personal-knowledge/contracts";

import { TodayLearningNoteCard } from "./today-learning-note-card";

const initial: PersonalKnowledgeSnapshot = {
  businessDate: "2026-08-13",
  modules: [{
    moduleId: "module-directing-0001",
    parentModuleId: null,
    name: "导演思维",
    goal: "",
    currentFocus: "镜头语言",
    description: "",
    status: "learning",
    ordinal: 0,
    revision: 1,
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
  }],
  dailyNotes: [],
};

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe("TodayLearningNoteCard", () => {
  it("saves a formal learning note separately from the quick-capture inbox", async () => {
    const saved: PersonalKnowledgeSnapshot = {
      ...initial,
      dailyNotes: [{
        noteId: "daily-note-today-0001",
        businessDate: "2026-08-13",
        title: "景别如何改变叙事距离",
        moduleId: "module-directing-0001",
        content: "远景先交代人物和环境的关系。",
        source: "",
        personalUnderstanding: "",
        openQuestions: "",
        application: "",
        status: "active",
        revision: 1,
        createdAt: "2026-08-13T01:00:00.000Z",
        updatedAt: "2026-08-13T01:00:00.000Z",
      }],
    };
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        const command = JSON.parse(String(init.body));
        return new Response(JSON.stringify({
          result: {
            snapshot: saved,
            applied: {
              operation: "save-daily-learning-note",
              ownerId: command.noteId,
              ownerRevision: 1,
              businessDate: "2026-08-13",
            },
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ snapshot: saved }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const ids = ["daily-note-today-0001", "submission-today-0001"];

    render(<TodayLearningNoteCard
      businessDate="2026-08-13"
      createId={() => ids.shift()!}
      initial={initial}
      request={request}
      storage={localStorage}
    />);

    fireEvent.change(screen.getByRole("combobox", { name: "所属知识模块" }), {
      target: { value: "module-directing-0001" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "学习标题" }), {
      target: { value: "景别如何改变叙事距离" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "学习内容" }), {
      target: { value: "远景先交代人物和环境的关系。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存正式学习记录" }));

    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    const [, postInit] = request.mock.calls[0]!;
    expect(JSON.parse(String(postInit?.body))).toMatchObject({
      type: "save-daily-learning-note",
      noteId: "daily-note-today-0001",
      businessDate: "2026-08-13",
      moduleId: "module-directing-0001",
      expectedNoteRevision: 0,
    });
    expect(String(request.mock.calls[1]![0])).toBe(
      "/api/v1/personal-knowledge?date=2026-08-13",
    );
    expect(screen.getByText("已保存到每日学习")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开知识体系" })).toHaveAttribute(
      "href",
      "/knowledge?date=2026-08-13",
    );
  });
});
