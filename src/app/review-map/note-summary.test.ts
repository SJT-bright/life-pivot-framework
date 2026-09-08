import { describe, expect, it } from "vitest";

import type { PersonalDailyNote } from "@/modules/personal-notes/contracts";

import {
  buildHeatmap,
  computeReviewStats,
  reviewExcerpt,
  summarizeDailyReview,
} from "./note-summary";

function note(businessDate: string, content: string): PersonalDailyNote {
  return {
    id: `note-${businessDate}`,
    businessDate,
    content,
    revision: 1,
    createdAt: "2026-08-12T01:00:00.000Z",
    updatedAt: "2026-08-12T02:00:00.000Z",
  };
}

describe("summarizeDailyReview", () => {
  it("parses the v1 template payload and counts content characters", () => {
    const summary = summarizeDailyReview(note("2026-08-12", JSON.stringify({
      schemaVersion: "daily-review-template-v1",
      completed: "完成了复盘地图",
      effective: "可视化很有成就感",
      tomorrow: "继续补充星图",
    })));
    expect(summary.completed).toBe("完成了复盘地图");
    expect(summary.chars).toBe("完成了复盘地图".length + "可视化很有成就感".length + "继续补充星图".length);
  });

  it("falls back to legacy plain text as the completed field", () => {
    const summary = summarizeDailyReview(note("2026-08-11", "旧版纯文本复盘"));
    expect(summary.completed).toBe("旧版纯文本复盘");
    expect(summary.effective).toBe("");
    expect(summary.chars).toBe("旧版纯文本复盘".length);
  });
});

describe("reviewExcerpt", () => {
  it("flattens whitespace and truncates with an ellipsis", () => {
    const summary = summarizeDailyReview(note("2026-08-12", JSON.stringify({
      schemaVersion: "daily-review-template-v1",
      completed: `${"很".repeat(120)}\n\n第二段`,
      effective: "",
      tomorrow: "",
    })));
    const excerpt = reviewExcerpt(summary, 20);
    expect(excerpt.startsWith("很")).toBe(true);
    expect(excerpt).toHaveLength(21);
    expect(excerpt.endsWith("…")).toBe(true);
  });
});

describe("computeReviewStats", () => {
  it("counts streaks across consecutive days and monthly coverage", () => {
    const summaries = ["2026-08-08", "2026-08-10", "2026-08-11", "2026-08-12", "2026-07-31"]
      .map((date) => summarizeDailyReview(note(date, `复盘${date}`)));
    const stats = computeReviewStats(summaries, "2026-08-12");
    expect(stats.totalDays).toBe(5);
    expect(stats.currentStreak).toBe(3);
    expect(stats.monthDays).toBe(4);
    expect(stats.monthLabel).toBe("2026 年 08 月");
  });

  it("keeps a streak alive when today is not yet reviewed", () => {
    const summaries = ["2026-08-10", "2026-08-11"].map((date) =>
      summarizeDailyReview(note(date, `复盘${date}`)));
    expect(computeReviewStats(summaries, "2026-08-12").currentStreak).toBe(2);
    expect(computeReviewStats([], "2026-08-12").currentStreak).toBe(0);
  });
});

describe("buildHeatmap", () => {
  it("aligns columns to Monday..Sunday and ends at today", () => {
    const summaries = ["2026-08-10", "2026-08-12"].map((date) =>
      summarizeDailyReview(note(date, `复盘${date}`)));
    const columns = buildHeatmap(summaries, "2026-08-12", 4);
    const flat = columns.flat();
    expect(columns).toHaveLength(4);
    expect(columns[0]).toHaveLength(7);
    expect(flat.at(-1)?.date).toBe("2026-08-12");
    const monday = new Date(`${flat[0].date}T12:00:00Z`);
    expect(monday.getUTCDay()).toBe(1);
    const reviewed = flat.find((cell) => cell.date === "2026-08-10");
    expect(reviewed?.level).toBeGreaterThan(0);
    expect(reviewed?.reviewed).toBe(true);
    expect(flat.find((cell) => cell.date === "2026-08-11")?.level).toBe(0);
  });

  it("keeps every row on the correct weekday across month boundaries", () => {
    const columns = buildHeatmap([], "2026-09-04", 2);

    expect(columns.map((column) => column.map((cell) => cell.date))).toEqual([
      [
        "2026-08-24",
        "2026-08-25",
        "2026-08-26",
        "2026-08-27",
        "2026-08-28",
        "2026-08-29",
        "2026-08-30",
      ],
      ["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"],
    ]);
  });

  it("lights a saved business date even when its review text is empty", () => {
    const summary = summarizeDailyReview(note("2026-09-01", ""));
    const cell = buildHeatmap([summary], "2026-09-04", 1)
      .flat()
      .find((candidate) => candidate.date === "2026-09-01");

    expect(cell).toMatchObject({ reviewed: true, chars: 0, level: 1 });
  });

  it("handles leap-day transitions without depending on the host timezone", () => {
    const columns = buildHeatmap([], "2024-03-01", 1);
    expect(columns.flat().map((cell) => cell.date)).toEqual([
      "2024-02-26",
      "2024-02-27",
      "2024-02-28",
      "2024-02-29",
      "2024-03-01",
    ]);
  });
});
