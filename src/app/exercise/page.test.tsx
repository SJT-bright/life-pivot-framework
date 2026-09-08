// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ManualExerciseSnapshot } from "@/modules/manual-exercise/service";

const emptySnapshot: ManualExerciseSnapshot = {
  businessDate: "2026-08-13",
  template: null,
  cycle: null,
  selectedDay: null,
  history: [],
  templateHistory: [],
};

async function loadPage(database: () => unknown, snapshot = emptySnapshot) {
  vi.resetModules();
  vi.doMock("@/core/db/application-database", () => ({ getApplicationDatabase: database }));
  vi.doMock("@/modules/manual-exercise/queries", () => ({
    getManualExerciseSnapshot: vi.fn(() => snapshot),
    countManualExerciseHistory: vi.fn(() => snapshot.history.length),
  }));
  vi.doMock("./manual-exercise-workspace", () => ({
    ManualExerciseWorkspace: ({ initial, businessDate, today }: { initial: ManualExerciseSnapshot | null; businessDate: string; today: string }) => initial
      ? <div data-testid="exercise-workspace" data-date={businessDate} data-today={today}>{initial.businessDate}</div>
      : <div role="status">运动记录暂时无法读取，请稍后刷新重试。</div>,
  }));
  return import("./page");
}

afterEach(() => {
  cleanup();
  vi.doUnmock("@/core/db/application-database");
  vi.doUnmock("@/modules/manual-exercise/queries");
  vi.doUnmock("./manual-exercise-workspace");
  vi.resetModules();
});

describe("ExercisePage", () => {
  it("loads the requested business date into the lightweight manual workspace", async () => {
    const page = await loadPage(() => ({ sqlite: {} }));
    render(await page.default({ searchParams: Promise.resolve({ date: "2026-08-13" }) }));
    expect(screen.getByTestId("exercise-workspace")).toHaveTextContent("2026-08-13");
    expect(screen.getByTestId("exercise-workspace")).toHaveAttribute("data-date", "2026-08-13");
    expect(screen.getByTestId("exercise-workspace").getAttribute("data-today")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(screen.queryByRole("button", { name: "切换日期" })).not.toBeInTheDocument();
  });

  it("contains an independent database read failure as a recoverable unavailable page", async () => {
    const page = await loadPage(() => { throw new Error("C:\\private\\exercise.db"); });
    render(await page.default({ searchParams: Promise.resolve({ date: "2026-08-13" }) }));
    expect(screen.getByRole("status")).toHaveTextContent("运动记录暂时无法读取");
    expect(screen.queryByText(/private|exercise\.db/)).not.toBeInTheDocument();
  });
});
