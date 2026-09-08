// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DailySleepRecord } from "@/modules/daily-sleep/contracts";
import type { HealthChecklistDay } from "@/modules/health-checklist/contracts";
import type { PersonalDailyNote } from "@/modules/personal-notes/contracts";
import type { PersonalKnowledgeSnapshot } from "@/modules/personal-knowledge/contracts";
import type { PlanningSnapshot } from "@/modules/planning/contracts";
import type { DailyReadingSnapshot } from "@/modules/reading/contracts";
import type { ManualSkincareSnapshot } from "@/modules/manual-skincare/contracts";
import type { CapturePage } from "@/modules/today/get-captures";

import { TodayDashboard, type TodayDashboardData } from "./today-dashboard";
import type { TodayExerciseCardState } from "./today-exercise-card";

const emptyCaptures: CapturePage = {
  items: [],
  nextCursor: null,
  snapshotHighWater: 0,
};

const sleepRecord: DailySleepRecord = {
  id: "sleep-record-0001",
  recordDate: "2026-08-12",
  asleepTime: "23:30",
  wakeTime: "07:00",
  calculatedDurationMinutes: 450,
  confirmedDurationMinutes: null,
  finalDurationMinutes: 450,
  deepSleepMinutes: null,
  lightSleepMinutes: null,
  remSleepMinutes: null,
  awakeEpisodes: null,
  awakeMinutes: null,
  morningFeeling: null,
  qualityScore: 80,
  sleepVariabilityMinutes: null,
  score: {
    finalScore: 80, durationScore: 100, variabilityScore: 50,
    stageConsistencyScore: 50, morningFeelingScore: 50,
    bedVariabilityMinutes: null, wakeVariabilityMinutes: null,
    averageVariabilityMinutes: null, usedPreviousNaturalDay: false,
    disclaimer: "个人趋势分，非医疗诊断",
  },
  qualityText: "手动手环质量分",
  note: "",
  revision: 1,
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z",
};

const healthDay: HealthChecklistDay = {
  id: "health-day-0001",
  businessDate: "2026-08-12",
  templateId: "health-template-0001",
  templateVersionId: "health-version-0001",
  templateRevision: 1,
  templateName: "每日健康",
  note: "",
  revision: 1,
  persistentItemKeys: [],
  items: [
    {
      id: "health-item-0001",
      itemKey: "breakfast-item",
      groupKey: "breakfast",
      groupLabel: "早餐",
      name: "吃早餐",
      targetText: "",
      note: "",
      ordinal: 0,
      completed: true,
      completedAt: "2026-08-12T01:00:00.000Z",
    },
    {
      id: "health-item-0002",
      itemKey: "vitamin-item",
      groupKey: "vitamin",
      groupLabel: "全天维生素",
      name: "补充维生素",
      targetText: "",
      note: "",
      ordinal: 1,
      completed: false,
      completedAt: null,
    },
  ],
};

const dailyNote: PersonalDailyNote = {
  id: "personal-note-0001",
  businessDate: "2026-08-12",
  content: "今天的整体备注",
  revision: 1,
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z",
};

const exercise: TodayExerciseCardState = {
  status: "ready",
  data: {
    businessDate: "2026-08-12",
    currentDayName: "肩部训练",
    bodyPart: "肩",
    isRest: false,
    trainingStatus: "in-progress",
    completedActions: 2,
    totalActions: 5,
    timerStatus: "running",
    calculatedMinutes: 18,
    confirmedMinutes: null,
    creatineTaken: true,
    proteinPowderTaken: null,
  },
};

const personalKnowledge: PersonalKnowledgeSnapshot = {
  businessDate: "2026-08-12",
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
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
  }],
  dailyNotes: [{
    noteId: "note-0001",
    businessDate: "2026-08-12",
    moduleId: "module-directing-0001",
    title: "轴线原则",
    content: "对话镜头要守轴线",
    source: "",
    personalUnderstanding: "",
    openQuestions: "",
    application: "",
    status: "active",
    revision: 1,
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
  }],
};

const planning: PlanningSnapshot = {
  businessDate: "2026-08-12",
  lifeAreas: [{ id: "area-creation-0001", name: "创作" }],
  goals: [{
    id: "goal-0001",
    lifeAreaId: "area-creation-0001",
    parentGoalId: null,
    goalType: "long-term",
    title: "做成一部短片",
    description: "",
    status: "active",
    progressPercent: 30,
    revision: 1,
  }],
  weeklyActions: [],
  todayActions: [
    {
      id: "action-today-0001",
      goalId: "goal-0001",
      parentActionId: null,
      actionType: "today",
      businessDate: "2026-08-12",
      title: "写分镜初稿",
      status: "pending",
      priority: "high",
      estimatedMinutes: 60,
      notes: "",
      revision: 1,
    },
    {
      id: "action-today-0002",
      goalId: null,
      parentActionId: null,
      actionType: "today",
      businessDate: "2026-08-12",
      title: "整理参考图",
      status: "completed",
      priority: "normal",
      estimatedMinutes: null,
      notes: "",
      revision: 2,
    },
  ],
  overdueActions: [],
  unassignedActions: [],
};

const reading: DailyReadingSnapshot = {
  businessDate: "2026-08-12",
  books: [{
    bookId: "reading-book-0001",
    title: "理解媒介",
    author: "",
    status: "reading",
    totalPages: 300,
    currentPage: 80,
    revision: 1,
  }],
  sessions: [],
  totalPagesRead: 0,
  totalMinutes: 0,
};

const skincare: ManualSkincareSnapshot = {
  businessDate: "2026-08-12",
  products: [],
  latestRoutineRevision: 1,
  activationSequence: 1,
  selectedDay: {
    dayId: "skincare-day-0001",
    businessDate: "2026-08-12",
    materialized: true,
    routineRevision: 1,
    activationSequence: 1,
    recoveryCycle: null,
    morningNote: "",
    eveningNote: "",
    overallNote: "",
    revision: 1,
    morningItems: [],
    eveningItems: [],
  },
  recoveryPlans: [],
  history: [],
};

function readyData(overrides: Partial<TodayDashboardData> = {}): TodayDashboardData {
  return {
    captures: { status: "ready", data: emptyCaptures },
    sleep: { status: "ready", data: sleepRecord },
    health: { status: "ready", data: healthDay },
    dailyNote: { status: "ready", data: dailyNote },
    personalKnowledge: { status: "ready", data: personalKnowledge },
    reading: { status: "ready", data: reading },
    exercise,
    skincare: { status: "ready", data: skincare },
    reminders: { status: "ready", data: [] },
    planning: { status: "ready", data: planning },
    ...overrides,
  };
}

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe("TodayDashboard (read-only overview)", () => {
  it("shows goals, today facts, and learning without any input controls", () => {
    render(
      <TodayDashboard
        businessDate="2026-08-12"
        data={readyData()}
        today="2026-08-12"
      />,
    );

    for (const title of ["今日概览", "目的与今日目标", "今日提醒", "当日新学", "随手记 · 待整理"]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
    expect(document.querySelector("#capture-timeline-heading")).not.toBeNull();

    expect(screen.getByText("7 小时 30 分钟 · 手环质量分 80")).toBeInTheDocument();
    expect(screen.getByText("1 / 2 项完成")).toBeInTheDocument();
    expect(screen.getByText("肩部训练 · 2 / 5 个动作 · 18 分钟")).toBeInTheDocument();

    expect(screen.getByText("所有目的")).toBeInTheDocument();
    expect(screen.getByText("做成一部短片")).toBeInTheDocument();
    expect(screen.getByText("30%")).toBeInTheDocument();
    expect(screen.getByText("今日行动（2）")).toBeInTheDocument();
    expect(screen.getByText("写分镜初稿")).toBeInTheDocument();
    expect(screen.getByText("整理参考图")).toBeInTheDocument();

    expect(screen.getByText("轴线原则")).toBeInTheDocument();
    expect(screen.getByText("对话镜头要守轴线")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "查看今日复盘 →" })).toHaveAttribute(
      "href",
      "/daily-review?date=2026-08-12",
    );
    expect(screen.getByRole("link", { name: "打开目标与行动" })).toHaveAttribute("href", "/goals");

    expect(screen.queryByRole("textbox", { name: "今天发生了什么？" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存到待整理" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("入睡时间")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("keeps per-domain failure isolated inside the overview rows", () => {
    render(
      <TodayDashboard
        businessDate="2026-08-12"
        data={readyData({
          sleep: { status: "unavailable" },
          planning: { status: "unavailable" },
        })}
        today="2026-08-12"
      />,
    );

    expect(screen.getAllByText("暂时无法读取").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("1 / 2 项完成")).toBeInTheDocument();
    expect(screen.queryByText("做成一部短片")).not.toBeInTheDocument();
  });

  it("keeps the review link honest when no note exists", () => {
    render(
      <TodayDashboard
        businessDate="2026-08-12"
        data={readyData({
          dailyNote: { status: "ready", data: null },
        })}
        today="2026-08-12"
      />,
    );

    expect(screen.getByRole("link", { name: "今天还没写复盘 →" })).toHaveAttribute(
      "href",
      "/daily-review?date=2026-08-12",
    );
  });
});
