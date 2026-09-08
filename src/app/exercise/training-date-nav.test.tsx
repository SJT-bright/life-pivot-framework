// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { shiftTrainingDate, TrainingDateNav, trainingWeekDates } from "./training-date-nav";

afterEach(cleanup);

describe("training dates", () => {
  it("moves through month ends, leap days and year boundaries without timezone shifts", () => {
    expect(shiftTrainingDate("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftTrainingDate("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftTrainingDate("2024-03-01", -1)).toBe("2024-02-29");
    expect(trainingWeekDates("2027-01-01")).toEqual([
      "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03",
    ]);
  });

  it("calls the controlled date callback for previous, next, today and calendar selection", async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    render(<TrainingDateNav date="2026-08-31" today="2026-09-07" onDateChange={change} />);
    await user.click(screen.getByRole("button", { name: "上一天" }));
    expect(change).toHaveBeenLastCalledWith("2026-08-30");
    await user.click(screen.getByRole("button", { name: "下一天" }));
    expect(change).toHaveBeenLastCalledWith("2026-09-01");
    await user.click(screen.getByRole("button", { name: "回今天" }));
    expect(change).toHaveBeenLastCalledWith("2026-09-07");
    fireEvent.change(screen.getByLabelText("选择训练日期"), { target: { value: "2026-09-03" } });
    expect(change).toHaveBeenLastCalledWith("2026-09-03");
    expect(screen.getByText("补记")).toBeInTheDocument();
  });

  it("shows recorded outcomes and allows keyboard selection but prevents future recording", async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    render(<TrainingDateNav date="2026-09-04" today="2026-09-04" onDateChange={change} records={[
      { businessDate: "2026-09-01", status: "skipped", resolution: { outcome: "rest" } },
      { businessDate: "2026-09-02", status: "skipped" },
      { businessDate: "2026-09-03", status: "completed" },
    ]} />);
    expect(screen.getByRole("button", { name: "下一天" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "2026-09-05 周六 未到" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "2026-09-01 周二 休息" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "2026-09-02 周三 已跳过" })).toBeEnabled();
    screen.getByRole("button", { name: "2026-09-03 周四 已完成" }).focus();
    await user.keyboard("{Enter}");
    expect(change).toHaveBeenCalledWith("2026-09-03");
    change.mockClear();
    fireEvent.change(screen.getByLabelText("选择训练日期"), { target: { value: "2026-09-05" } });
    expect(change).not.toHaveBeenCalled();
  });
});
