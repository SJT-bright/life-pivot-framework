// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WeeklyReviewWorkspace } from "./weekly-review-workspace";

const snapshot = {
  periodStart: "2026-08-10", periodEndExclusive: "2026-08-17", recordedDays: ["2026-08-10"],
  trainingDays: [], sleepRecords: [], skincareUses: [], activeRecoveryCycle: null,
  healthCompletions: [], knowledgeAdditions: [], summary: null,
  recentEdits: [{ targetType: "exercise-template" as const, targetId: "template-1", title: "复盘素材", modifiedAt: "2026-08-10T10:00:00.000Z", pinned: false }],
};

const extras = {
  previous: { recordedDays: 2, trainingCompleted: 1, sleepAvgMinutes: 400 },
  goals: [],
};

describe("WeeklyReviewWorkspace", () => {
  it("renders factual weekly sections and a prose-only summary without score or advice", () => {
    render(<WeeklyReviewWorkspace initial={snapshot} extras={extras} today="2026-08-16" />);
    for (const heading of ["本周记录", "训练", "睡眠", "护肤", "健康", "知识新增", "最近修改", "我的周总结"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
    expect(screen.getByRole("textbox", { name: "我的周总结" })).toBeInTheDocument();
    expect(screen.getAllByRole("link").some((link) =>
      link.getAttribute("href") === "/review?start=2026-08-03")).toBe(true);
    expect(screen.getByRole("link", { name: "下一周" })).toHaveAttribute("href", "/review?start=2026-08-17");
    expect(screen.getByRole("button", { name: "置顶：复盘素材" })).toBeInTheDocument();
    expect(screen.queryByText(/评分|诊断|排名|推荐|图表/)).not.toBeInTheDocument();
  });

  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("binds pin commands to the visible week and preserves the summary draft", async () => {
    const request = vi.fn().mockResolvedValue(Response.json({
      result: {
        ...snapshot,
        recentEdits: snapshot.recentEdits.map((item) => ({ ...item, pinned: true })),
      },
    }));
    vi.stubGlobal("fetch", request);
    render(<WeeklyReviewWorkspace initial={snapshot} extras={extras} today="2026-08-16" />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "这一周的手写总结" } });
    const pinButton = screen.getAllByRole("button").find((button) =>
      button.textContent?.includes(snapshot.recentEdits[0]!.title));
    fireEvent.click(pinButton!);

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(JSON.parse(request.mock.calls[0]![1].body as string)).toMatchObject({
      type: "pin-review-target",
      periodStart: "2026-08-10",
      periodEndExclusive: "2026-08-17",
    });
    expect(screen.getByRole("textbox")).toHaveValue("这一周的手写总结");
    expect(screen.getByRole("link", { name: "上一周" })).toHaveAttribute("href", "/review?start=2026-08-03");
  });
});
