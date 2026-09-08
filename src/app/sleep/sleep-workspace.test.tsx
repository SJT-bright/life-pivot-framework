// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { DailySleepRecord } from "@/modules/daily-sleep/contracts";

import { SleepWorkspace } from "./sleep-workspace";

afterEach(cleanup);

const ready = {
  record: { status: "ready" as const, data: null },
  history: { status: "ready" as const, data: { items: [] } },
};

const record: DailySleepRecord = {
  id: "sleep-record-0001",
  recordDate: "2026-08-12",
  asleepTime: "23:30",
  wakeTime: "07:00",
  calculatedDurationMinutes: 450,
  confirmedDurationMinutes: null,
  finalDurationMinutes: 450,
  deepSleepMinutes: 90,
  lightSleepMinutes: 270,
  remSleepMinutes: 90,
  awakeEpisodes: null,
  awakeMinutes: null,
  morningFeeling: 4,
  qualityScore: 91,
  sleepVariabilityMinutes: 18,
  score: {
    finalScore: 91,
    durationScore: 100,
    variabilityScore: 90,
    stageConsistencyScore: 100,
    morningFeelingScore: 75,
    bedVariabilityMinutes: 15,
    wakeVariabilityMinutes: 20,
    averageVariabilityMinutes: 18,
    usedPreviousNaturalDay: true,
    disclaimer: "个人趋势分，非医疗诊断",
  },
  qualityText: "自动质量分 91/100",
  note: "",
  revision: 1,
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z",
};

describe("SleepWorkspace", () => {
  it("shows exactly the lightweight Chinese form and history sections", () => {
    const { container } = render(
      <SleepWorkspace businessDate="2026-08-12" initial={ready} />,
    );

    expect(screen.getByLabelText("日期")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "今日填写" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "手填质量分与睡眠波动" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "历史记录" })).toBeInTheDocument();
    for (const label of ["日期", "入睡时间", "起床时间", "睡眠质量分", "深睡（分钟）", "浅睡（分钟）", "REM（分钟）", "备注"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole("slider", { name: "醒后感受" })).toHaveAttribute("min", "1");
    expect(screen.getByRole("slider", { name: "醒后感受" })).toHaveAttribute("max", "5");
    expect(screen.queryByText("睡眠时长")).not.toBeInTheDocument();
    expect(screen.queryByText("待填写")).not.toBeInTheDocument();
    expect(container.querySelectorAll("section")).toHaveLength(3);
    expect(container.textContent).not.toMatch(/plan|session|awakening|interval|command JSON|Adopt planned times/i);
  });

  it("renders an accessible 60–100 score chart and the adjacent-day variability summary", () => {
    render(<SleepWorkspace businessDate="2026-08-12" initial={{
      record: { status: "ready", data: record },
      history: { status: "ready", data: { items: [record] } },
    }} />);

    expect(screen.getByLabelText("睡眠趋势摘要")).toHaveTextContent("91");
    expect(screen.getByLabelText("睡眠趋势摘要")).toHaveTextContent("18 分钟");
    expect(screen.getByRole("img", { name: /睡眠质量分历史折线图/ })).toBeInTheDocument();
    expect(screen.queryByText(/系统不会自动计算/)).not.toBeInTheDocument();
  });

  it("labels unavailable reads without claiming an empty history", () => {
    render(<SleepWorkspace businessDate="2026-08-12" initial={{
      record: { status: "unavailable" },
      history: { status: "unavailable" },
    }} />);
    expect(screen.getAllByText("暂时无法读取")).toHaveLength(3);
    expect(screen.queryByText(/0 条/)).not.toBeInTheDocument();
  });
});
