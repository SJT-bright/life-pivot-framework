// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CapturePage } from "@/modules/today/get-captures";
import type { CaptureSource } from "@/modules/today/get-capture-source";

const dependencies = vi.hoisted(() => ({
  database: { sqlite: {} },
  getDatabase: vi.fn(),
  getDailyNote: vi.fn(),
  getHealth: vi.fn(),
  getPersonalKnowledge: vi.fn(),
  getSkincare: vi.fn(),
  getSleep: vi.fn(),
  getSource: vi.fn(),
  getTimeline: vi.fn(),
  getUnorganizedCount: vi.fn(),
  getPlanningSnapshot: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/core/db/application-database", () => ({
  getApplicationDatabase: dependencies.getDatabase,
}));

vi.mock("@/modules/today/get-captures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/today/get-captures")>()),
  getCaptureTimeline: dependencies.getTimeline,
  getUnorganizedCaptureCount: dependencies.getUnorganizedCount,
}));

vi.mock("@/modules/daily-sleep/query", () => ({
  getDailySleepRecord: dependencies.getSleep,
}));

vi.mock("@/modules/health-checklist/service", () => ({
  materializeHealthChecklistDay: dependencies.getHealth,
}));

vi.mock("@/modules/personal-notes/query", () => ({
  getPersonalDailyNote: dependencies.getDailyNote,
}));

vi.mock("@/modules/personal-knowledge/query", () => ({
  getPersonalKnowledgeSnapshot: dependencies.getPersonalKnowledge,
}));

vi.mock("@/modules/manual-skincare/service", () => ({
  materializeManualSkincareDay: dependencies.getSkincare,
}));

vi.mock("@/modules/planning/service", () => ({
  getPlanningSnapshot: dependencies.getPlanningSnapshot,
}));

vi.mock("@/modules/today/get-capture-source", () => ({
  getCaptureSource: dependencies.getSource,
}));

vi.mock("@/modules/sleep/query", () => ({
  getSleepTodaySnapshot: vi.fn(),
}));

import TodayPage from "./page";

const emptyCaptures: CapturePage = {
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

beforeEach(() => {
  localStorage.clear();
  dependencies.getDatabase.mockReset().mockReturnValue(dependencies.database);
  dependencies.getTimeline.mockReset().mockReturnValue(emptyCaptures);
  dependencies.getUnorganizedCount.mockReset().mockReturnValue(3);
  dependencies.getSleep.mockReset().mockReturnValue(null);
  dependencies.getHealth.mockReset().mockReturnValue({
    id: "health-day-2026-08-09",
    businessDate: "2026-08-09",
    templateId: "health-template",
    templateVersionId: "health-version",
    templateRevision: 1,
    note: "",
    revision: 1,
    templateName: "每日健康",
    items: [],
    persistentItemKeys: [],
  });
  dependencies.getSkincare.mockReset().mockResolvedValue({
    businessDate: "2026-08-09",
    products: [],
    latestRoutineRevision: 0,
    activationSequence: 0,
    selectedDay: null,
    recoveryPlans: [],
    history: [],
  });
  dependencies.getPlanningSnapshot.mockReset().mockReturnValue({
    businessDate: "2026-08-09",
    lifeAreas: [],
    goals: [],
    weeklyActions: [],
    todayActions: [],
    overdueActions: [],
    unassignedActions: [],
  });
  dependencies.getDailyNote.mockReset().mockReturnValue(null);
  dependencies.getPersonalKnowledge.mockReset().mockReturnValue({
    businessDate: "2026-08-09",
    modules: [{
      moduleId: "module-directing-0001",
      parentModuleId: null,
      name: "导演思维",
      goal: "",
      currentFocus: "",
      description: "",
      status: "learning",
      ordinal: 0,
      revision: 1,
      createdAt: "2026-08-09T00:00:00.000Z",
      updatedAt: "2026-08-09T00:00:00.000Z",
    }],
    dailyNotes: [],
    items: [],
  });
  dependencies.getSource.mockReset().mockReturnValue(activeSource);
});
afterEach(() => cleanup());

describe("TodayPage", () => {
  it("loads every central Today card for the selected business date", async () => {
    render(await TodayPage({ searchParams: Promise.resolve({ date: "2026-08-09" }) }));

    expect(screen.queryByRole("button", { name: "导入飞书汇总" })).not.toBeInTheDocument();
    expect(dependencies.getTimeline).toHaveBeenCalledWith(dependencies.database.sqlite, {
      businessDate: "2026-08-09",
      limit: 50,
    });
    expect(dependencies.getPlanningSnapshot).toHaveBeenCalledWith(dependencies.database.sqlite, {
      businessDate: "2026-08-09",
    });
    expect(dependencies.getSleep).toHaveBeenCalledWith(dependencies.database.sqlite, {
      recordDate: "2026-08-09",
    });
    expect(dependencies.getHealth).toHaveBeenCalledWith(dependencies.database.sqlite, "2026-08-09");
    expect(dependencies.getDailyNote).toHaveBeenCalledWith(dependencies.database.sqlite, {
      businessDate: "2026-08-09",
    });
    expect(dependencies.getPersonalKnowledge).toHaveBeenCalledWith(dependencies.database.sqlite, {
      businessDate: "2026-08-09",
      noteLimit: 20,
    });
    expect(dependencies.getSkincare).toHaveBeenCalledWith(
      dependencies.database.sqlite,
      "2026-08-09",
    );
  });

  it("renders the dashboard while containing a capture reader failure", async () => {
    dependencies.getTimeline.mockImplementation(() => {
      throw new Error("private capture database path");
    });

    render(await TodayPage({ searchParams: Promise.resolve({ date: "2026-08-09" }) }));

    expect(screen.getByRole("heading", { name: "随手记 · 待整理" }).closest("section"))
      .toHaveTextContent("暂时无法读取");
    expect(screen.getByRole("heading", { name: "今日运动" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "当日新学" })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("private capture database path");
  });

  it("renders every database-backed card unavailable when database initialization fails", async () => {
    dependencies.getDatabase.mockImplementation(() => {
      throw new Error("D:\\private\\today.sqlite");
    });

    render(await TodayPage({ searchParams: Promise.resolve({ date: "2026-08-09" }) }));

    expect(screen.getAllByText("暂时无法读取")).toHaveLength(8);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开目标与行动" })).toHaveAttribute("href", "/goals");
    expect(screen.getAllByRole("link", { name: "打开知识体系" }).length).toBeGreaterThan(0);
    expect(document.body).not.toHaveTextContent("D:\\private\\today.sqlite");
  });

  it("loads only the requested source in source-focus mode", async () => {
    render(await TodayPage({
      searchParams: Promise.resolve({ date: "2026-08-09", source: "capture-source" }),
    }));

    const sourcePanel = screen.getByRole("region", { name: "知识来源原文" });
    expect(within(sourcePanel).getByText("Exact source text outside the first page")).toBeInTheDocument();
    expect(dependencies.getSource).toHaveBeenCalledWith(dependencies.database.sqlite, {
      businessDate: "2026-08-09",
      sourceId: "capture-source",
    });
    expect(dependencies.getTimeline).not.toHaveBeenCalled();
    expect(dependencies.getUnorganizedCount).not.toHaveBeenCalled();
    expect(dependencies.getSleep).not.toHaveBeenCalled();
    expect(dependencies.getHealth).not.toHaveBeenCalled();
    expect(dependencies.getDailyNote).not.toHaveBeenCalled();
    expect(dependencies.getPersonalKnowledge).not.toHaveBeenCalled();
    expect(dependencies.getSkincare).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "快速收集 / 待整理" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("keeps source failures generic and preserves inert multiline text", async () => {
    dependencies.getSource.mockReturnValue({
      ...activeSource,
      text: '<script>inert</script>\nsecond line',
    });
    render(await TodayPage({
      searchParams: Promise.resolve({ date: "2026-08-09", source: "capture-source" }),
    }));

    const sourcePanel = screen.getByRole("region", { name: "知识来源原文" });
    const sourceText = [...sourcePanel.querySelectorAll("p")].find(
      (paragraph) => paragraph.textContent === '<script>inert</script>\nsecond line',
    );
    expect(sourceText).toHaveStyle({ whiteSpace: "pre-wrap" });
    expect(sourcePanel.querySelector("script")).toBeNull();

    cleanup();
    dependencies.getSource.mockImplementation(() => {
      throw new Error("private source path");
    });
    render(await TodayPage({
      searchParams: Promise.resolve({ date: "2026-08-09", source: "capture-source" }),
    }));
    expect(screen.getByRole("region", { name: "知识来源原文" })).toHaveTextContent("来源记录不可用");
    expect(document.body).not.toHaveTextContent("private source path");
  });

  it("fails closed before opening the database for an invalid focused query", async () => {
    render(await TodayPage({
      searchParams: Promise.resolve({ date: "2026-02-30", source: "capture-source" }),
    }));

    expect(screen.getByText("来源记录不可用")).toBeInTheDocument();
    expect(dependencies.getDatabase).not.toHaveBeenCalled();
    expect(dependencies.getTimeline).not.toHaveBeenCalled();
    expect(dependencies.getSource).not.toHaveBeenCalled();
  });
});



