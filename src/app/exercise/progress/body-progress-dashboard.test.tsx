// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { buildMuscleProgress } from "@/modules/manual-exercise/training-metrics";

import { BodyProgressDashboard } from "./body-progress-dashboard";

afterEach(cleanup);

describe("BodyProgressDashboard", () => {
  it("selects a muscle and calculates BMI while keeping the two progress dimensions separate", async () => {
    const user = userEvent.setup();
    const storageValues = new Map<string, string>();
    const storage = {
      getItem: (key: string) => storageValues.get(key) ?? null,
      setItem: (key: string, value: string) => { storageValues.set(key, value); },
    };
    const muscles = buildMuscleProgress([
      { businessDate: "2026-08-18", dayLabel: "胸", actionName: "卧推", sets: 4, repsText: "8", weightText: "60 kg" },
    ], "2026-08-20");
    render(<BodyProgressDashboard muscles={muscles} storage={storage} />);

    expect(screen.getByRole("heading", { name: "全身训练进步" })).toBeVisible();
    await user.click(screen.getAllByRole("button", { name: /背部，综合训练指数/ })[0]);
    expect(screen.getByRole("article", { name: "背部进步详情" })).toBeVisible();

    await user.type(screen.getByLabelText("身高（cm）"), "180");
    await user.type(screen.getByLabelText("体重（kg）"), "75");
    expect(screen.getByText("23.1")).toBeVisible();
    expect(screen.getByText("常规范围")).toBeVisible();
    expect(storageValues.size).toBe(1);
  });
});
