// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PersonalKnowledgeSnapshot } from "@/modules/personal-knowledge/contracts";

import { PersonalKnowledgeWorkspace } from "./personal-knowledge-workspace";

const initial: PersonalKnowledgeSnapshot = {
  businessDate: "2026-08-13",
  modules: [
    { moduleId: "module-root-0001", parentModuleId: null, name: "创作", goal: "", currentFocus: "", description: "", status: "learning", ordinal: 0, revision: 2, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" },
    { moduleId: "module-child-001", parentModuleId: "module-root-0001", name: "镜头语言", goal: "", currentFocus: "", description: "", status: "paused", ordinal: 1, revision: 1, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" },
  ],
  dailyNotes: [
    { noteId: "daily-note-0001", businessDate: "2026-08-13", title: "构图练习", moduleId: "module-root-0001", content: "观察画面重心", source: "一本书", personalUnderstanding: "先看关系", openQuestions: "如何形成节奏？", application: "下一次拍摄", status: "active", revision: 1, createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z" },
  ],
};

function successRequest() {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      const ownerId = String(body.moduleId ?? body.noteId);
      const expected = Number(body.expectedModuleRevision ?? body.expectedNoteRevision ?? 0);
      return Response.json({ result: { snapshot: initial, applied: { operation: body.type, ownerId, ownerRevision: expected + 1, businessDate: body.type === "save-daily-learning-note" ? body.businessDate : null } } });
    }
    return Response.json({ snapshot: initial });
  });
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PersonalKnowledgeWorkspace", () => {
  it("exposes exactly the two views and saves a formal note with folded details", async () => {
    const request = successRequest();
    const user = userEvent.setup();
    render(<PersonalKnowledgeWorkspace initial={initial} today="2026-08-13" request={request} storage={localStorage} createId={() => "daily-note-new-001"} />);

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["每日学习", "知识模块"]);
    expect(screen.getByText("构图练习")).toBeInTheDocument();
    const existingDetails = screen.getByText("来源与思考").closest("details");
    expect(existingDetails).not.toHaveAttribute("open");

    await user.type(screen.getByLabelText("学习标题"), "导演思维复盘");
    await user.type(screen.getByLabelText("学习内容"), "把叙事目的放在镜头选择之前");
    await user.click(screen.getByText("补充来源与个人思考"));
    await user.type(screen.getByLabelText("个人理解"), "先决定观众应该感受到什么");
    await user.click(screen.getByRole("button", { name: "保存学习记录" }));

    await waitFor(() => expect(request.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    const post = request.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(String(post[1]?.body))).toMatchObject({
      type: "save-daily-learning-note",
      title: "导演思维复盘",
      personalUnderstanding: "先决定观众应该感受到什么",
    });
  });

  it("creates a user-entered nested module and keeps move/archive conflicts local", async () => {
    const request = successRequest();
    const user = userEvent.setup();
    render(<PersonalKnowledgeWorkspace initial={initial} today="2026-08-13" request={request} storage={localStorage} createId={() => "module-new-00001"} />);
    await user.click(screen.getByRole("tab", { name: "知识模块" }));

    const moduleDirectory = screen.getByRole("navigation", { name: "知识模块目录" });
    const rootToggle = within(moduleDirectory).getByRole("button", { name: "展开文件夹：创作" });
    expect(rootToggle).toHaveAttribute("aria-expanded", "false");
    expect(within(moduleDirectory).queryByRole("button", { name: "打开模块：镜头语言" }))
      .not.toBeInTheDocument();
    await user.click(rootToggle);
    expect(within(moduleDirectory).getByRole("button", { name: "打开模块：镜头语言" }))
      .toBeInTheDocument();
    await user.click(within(moduleDirectory).getByRole("button", { name: "打开模块：镜头语言" }));
    expect(screen.getByRole("heading", { name: "镜头语言" })).toBeInTheDocument();

    const createDetails = screen.getByText("新建知识模块").closest("details")!;
    expect(createDetails).not.toHaveAttribute("open");
    await user.click(within(createDetails).getByText("新建知识模块"));
    const createForm = createDetails.querySelector("form")!;
    await user.type(within(createForm).getByLabelText("模块名称"), "导演思维");
    await user.selectOptions(within(createForm).getByLabelText("上级模块"), "module-root-0001");
    await user.clear(within(createForm).getByLabelText("手动顺序"));
    await user.type(within(createForm).getByLabelText("手动顺序"), "2");
    await user.click(within(createForm).getByRole("button", { name: "创建模块" }));

    const post = await waitFor(() => request.mock.calls.find(([, init]) => init?.method === "POST"));
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
      type: "save-module",
      name: "导演思维",
      parentModuleId: "module-root-0001",
      ordinal: 2,
      expectedParentRevision: 2,
    });

    request.mockImplementationOnce(async () => Response.json({ error: "conflict" }, { status: 409 }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "归档模块：镜头语言" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("数据已变化，请重新加载"));
    expect(request.mock.calls.filter(([, init]) => init?.method === "GET")).toHaveLength(1);
  });

  it("uses compact module actions, confirms archive, and keeps archived modules discoverable", async () => {
    const request = successRequest();
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const withArchive: PersonalKnowledgeSnapshot = {
      ...initial,
      modules: [
        ...initial.modules,
        { moduleId: "module-archived-1", parentModuleId: null, name: "旧的学习主题", goal: "", currentFocus: "", description: "", status: "archived", ordinal: 9, revision: 3, createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-08-10T00:00:00.000Z" },
      ],
    };
    render(<PersonalKnowledgeWorkspace initial={withArchive} today="2026-08-13" request={request} storage={localStorage} />);
    await user.click(screen.getByRole("tab", { name: "知识模块" }));

    await user.click(screen.getByRole("button", { name: "展开文件夹：创作" }));
    await user.click(screen.getByRole("button", { name: "打开模块：镜头语言" }));

    const move = screen.getByRole("button", { name: "移动模块：镜头语言" });
    const archive = screen.getByRole("button", { name: "归档模块：镜头语言" });
    expect(move).toHaveClass("personal-knowledge-action-button");
    expect(archive).toHaveClass("personal-knowledge-action-button", "personal-knowledge-archive-button");

    await user.click(archive);
    expect(confirm).toHaveBeenCalledWith("确认归档“镜头语言”？归档后可在“已归档模块”中查看。");
    expect(request.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);

    const archived = screen.getByText("已归档模块（1）").closest("details");
    expect(archived).not.toBeNull();
    await user.click(within(archived!).getByText("已归档模块（1）"));
    expect(within(archived!).getByRole("heading", { name: "旧的学习主题" })).toBeInTheDocument();
    expect(within(archived!).getByText("2026-08-10")).toBeInTheDocument();
  });

});
