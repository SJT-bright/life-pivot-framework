// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { DailySleepRecord } from "@/modules/daily-sleep/contracts";

import { SleepHistoryChart } from "./sleep-history-chart";

afterEach(cleanup);

function record(id: string, recordDate: string, qualityScore: number): DailySleepRecord {
  return {
    id,
    recordDate,
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
    qualityScore,
    sleepVariabilityMinutes: null,
    score: {
      finalScore: qualityScore,
      durationScore: 100,
      variabilityScore: 50,
      stageConsistencyScore: 50,
      morningFeelingScore: 50,
      bedVariabilityMinutes: null,
      wakeVariabilityMinutes: null,
      averageVariabilityMinutes: null,
      usedPreviousNaturalDay: false,
      disclaimer: "个人趋势分，非医疗诊断",
    },
    qualityText: `自动质量分 ${qualityScore}/100`,
    note: "",
    revision: 1,
    createdAt: `${recordDate}T00:00:00.000Z`,
    updatedAt: `${recordDate}T00:00:00.000Z`,
  };
}

describe("SleepHistoryChart", () => {
  it("sorts dates ascending and breaks the line across a missing calendar date", () => {
    const { container } = render(<SleepHistoryChart items={[
      record("three", "2026-08-13", 92),
      record("one", "2026-08-10", 78),
      record("two", "2026-08-11", 84),
    ]} />);

    expect(screen.getByRole("img", { name: /睡眠质量分历史折线图/ })).toBeInTheDocument();
    expect(container.querySelectorAll("polyline")).toHaveLength(1);
    expect([...container.querySelectorAll("circle")].map((point) => point.getAttribute("aria-label")))
      .toEqual([
        expect.stringContaining("2026-08-10"),
        expect.stringContaining("2026-08-11"),
        expect.stringContaining("2026-08-13"),
      ]);
  });

  it("renders a useful empty state", () => {
    render(<SleepHistoryChart items={[]} />);
    expect(screen.getByText("暂无质量分记录。")).toBeInTheDocument();
  });
});
