// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TodayExerciseCard,
  type TodayExerciseCardState,
} from "./today-exercise-card";

const readyData: Extract<TodayExerciseCardState, { status: "ready" }>["data"] = {
  businessDate: "2026-08-13",
  currentDayName: "训练日 1",
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
};

function readyState(
  overrides: Partial<typeof readyData> = {},
): TodayExerciseCardState {
  return { status: "ready", data: { ...readyData, ...overrides } };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TodayExerciseCard", () => {
  it("keeps an unavailable exercise reader isolated to this card", () => {
    render(<TodayExerciseCard state={{ status: "unavailable" }} />);

    expect(screen.getByRole("region", { name: "今日运动" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("还没有训练计划");
    expect(screen.getByRole("link", { name: "去建立训练日模板" })).toHaveAttribute(
      "href",
      "/exercise/template",
    );
    expect(screen.queryByText(/训练状态|动作进度|肌酸|蛋白粉/)).not.toBeInTheDocument();
  });

  it.each([
    ["not-started", "未开始"],
    ["in-progress", "进行中"],
    ["partial", "部分完成"],
    ["completed", "已完成"],
    ["skipped", "已跳过"],
  ] as const)("shows the %s training status in Chinese", (trainingStatus, label) => {
    render(<TodayExerciseCard state={readyState({ trainingStatus })} />);

    expect(screen.getByText(`训练状态：${label}`)).toBeInTheDocument();
    expect(screen.getByText("当前训练日：训练日 1 · 肩")).toBeInTheDocument();
    expect(screen.getByText("动作进度：2 / 5")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/exercise?date=2026-08-13",
    );
  });

  it("presents a rest node without a misleading action fraction", () => {
    render(<TodayExerciseCard state={readyState({
      currentDayName: "训练日 4",
      bodyPart: "休息",
      isRest: true,
      trainingStatus: "not-started",
      completedActions: 0,
      totalActions: 0,
      timerStatus: "idle",
      calculatedMinutes: 0,
    })} />);

    expect(screen.getByText("当前训练日：训练日 4 · 休息日")).toBeInTheDocument();
    expect(screen.getByText("训练状态：未开始")).toBeInTheDocument();
    expect(screen.getByText("动作进度：休息日，无训练动作")).toBeInTheDocument();
    expect(screen.queryByText("动作进度：0 / 0")).not.toBeInTheDocument();
  });

  it.each([
    ["idle", "计时：尚未开始 · 18 分钟"],
    ["running", "计时：进行中 · 18 分钟"],
    ["paused", "计时：已暂停 · 18 分钟"],
  ] as const)("shows the %s timer state", (timerStatus, copy) => {
    render(<TodayExerciseCard state={readyState({ timerStatus })} />);

    expect(screen.getByText(copy)).toBeInTheDocument();
  });

  it.each([
    [null, 41, "最终时长：41 分钟"],
    [46, 41, "最终时长：46 分钟（已确认）"],
    [0, 41, "最终时长：0 分钟（已确认）"],
  ] as const)(
    "uses confirmed minutes %s as the finished value when recorded",
    (confirmedMinutes, calculatedMinutes, copy) => {
      render(<TodayExerciseCard state={readyState({
        timerStatus: "finished",
        confirmedMinutes,
        calculatedMinutes,
      })} />);

      expect(screen.getByText(copy)).toBeInTheDocument();
    },
  );

  it.each([
    [true, "已摄入"],
    [false, "未摄入"],
    [null, "未记录"],
  ] as const)("keeps supplement value %s distinct", (value, label) => {
    render(<TodayExerciseCard state={readyState({
      creatineTaken: value,
      proteinPowderTaken: value,
    })} />);

    expect(screen.getByText(`肌酸：${label}`)).toBeInTheDocument();
    expect(screen.getByText(`蛋白粉：${label}`)).toBeInTheDocument();
  });

  it("stays a read-only accessible display boundary", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { container } = render(<TodayExerciseCard state={readyState()} />);

    expect(screen.getByRole("region", { name: "今日运动" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "今日运动" })).toBeInTheDocument();
    expect(screen.getByText("补剂记录").closest("details")).not.toHaveAttribute("open");
    expect(container.querySelector("form, button, input, textarea, select")).toBeNull();
    expect(container).not.toHaveTextContent(/RPE|RIR|训练负荷|卡路里|心率/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
