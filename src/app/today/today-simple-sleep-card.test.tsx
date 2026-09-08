// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DailySleepRecord } from "@/modules/daily-sleep/contracts";

import { TodaySimpleSleepCard } from "./today-simple-sleep-card";

const record: DailySleepRecord = {
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
  qualityText: "自动质量分 80/100",
  note: "",
  revision: 1,
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TodaySimpleSleepCard", () => {
  it("shows a lightweight summary and the shared simple sleep controls", () => {
    render(<TodaySimpleSleepCard businessDate="2026-08-12" initialRecord={record} />);

    expect(screen.getByText("23:30 → 07:00 · 7小时30分钟")).toBeInTheDocument();
    expect(screen.getByLabelText("入睡时间")).toHaveValue("23:30");
    expect(screen.getByRole("button", { name: "保存睡眠记录" })).toBeInTheDocument();
    expect(screen.queryByText(/计划|夜醒/)).not.toBeInTheDocument();
  });

  it("updates the summary from the refreshed record immediately after saving", async () => {
    const refreshedRecord: DailySleepRecord = {
      ...record,
      asleepTime: "00:15",
      wakeTime: "08:15",
      calculatedDurationMinutes: 480,
      finalDurationMinutes: 480,
      revision: 2,
      updatedAt: "2026-08-13T00:00:00.000Z",
    };
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") {
        return Response.json({ result: refreshedRecord });
      }
      if (url.includes("view=history")) {
        return Response.json({ history: { items: [refreshedRecord] } });
      }
      return Response.json({ record: refreshedRecord });
    });
    vi.stubGlobal("fetch", request);
    render(<TodaySimpleSleepCard businessDate="2026-08-12" initialRecord={record} />);

    fireEvent.change(screen.getByLabelText("入睡时间"), { target: { value: "00:15" } });
    fireEvent.change(screen.getByLabelText("起床时间"), { target: { value: "08:15" } });
    fireEvent.click(screen.getByRole("button", { name: "保存睡眠记录" }));

    await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    expect(await screen.findByText("00:15 → 08:15 · 8小时")).toBeInTheDocument();
  });
});
