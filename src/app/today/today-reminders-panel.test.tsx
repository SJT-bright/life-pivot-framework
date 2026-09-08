// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TodayReminder } from "@/modules/today-reminders/contracts";

import { TodayRemindersPanel } from "./today-reminders-panel";

function pastReminder(id: string, businessDate: string, title: string): TodayReminder {
  return {
    id,
    businessDate,
    title,
    scheduledTime: null,
    completed: false,
    completedAt: null,
    alertedAt: null,
    revision: 1,
    createdAt: `${businessDate}T08:00:00.000Z`,
    updatedAt: `${businessDate}T08:00:00.000Z`,
  };
}

describe("TodayRemindersPanel companion stability", () => {
  const setCompanionExpanded = vi.fn();
  const moveCompanion = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    setCompanionExpanded.mockReset();
    moveCompanion.mockReset();
    window.lifePivotDesktop = {
      moveCompanion,
      notifyReminder: vi.fn(),
      openMainWindow: vi.fn(),
      rememberMainLocation: vi.fn(),
      setCompanionExpanded,
    };
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    delete window.lifePivotDesktop;
  });

  it("deduplicates hover and click expansion and cancels a pending collapse", () => {
    render(
      <TodayRemindersPanel
        businessDate="2026-08-29"
        desktopCompanion
        initialReminders={[]}
        request={vi.fn()}
      />,
    );
    const companion = screen.getByLabelText("今日还有 0 件事");
    const expandButton = screen.getByRole("button", { name: "展开今日提醒，还有 0 件事" });

    fireEvent.pointerEnter(companion);
    fireEvent.click(expandButton);
    fireEvent.pointerEnter(companion);
    expect(setCompanionExpanded).toHaveBeenCalledTimes(1);
    expect(setCompanionExpanded).toHaveBeenLastCalledWith(true);

    fireEvent.pointerLeave(companion);
    fireEvent.pointerEnter(companion);
    act(() => vi.advanceTimersByTime(500));
    expect(setCompanionExpanded).toHaveBeenCalledTimes(1);

    fireEvent.pointerLeave(companion);
    act(() => vi.advanceTimersByTime(420));
    expect(setCompanionExpanded).toHaveBeenCalledTimes(2);
    expect(setCompanionExpanded).toHaveBeenLastCalledWith(false);
  });

  it("coalesces pointer movement, blocks collapse during drag, and supports keyboard nudging", () => {
    render(
      <TodayRemindersPanel
        businessDate="2026-08-29"
        desktopCompanion
        initialReminders={[]}
        request={vi.fn()}
      />,
    );
    const companion = screen.getByLabelText("今日还有 0 件事");
    const handle = screen.getByRole("button", { name: "上下拖动今日悬浮窗" });
    const expandButton = screen.getByRole("button", { name: "展开今日提醒，还有 0 件事" });

    expect(expandButton.compareDocumentPosition(handle) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();

    fireEvent.pointerEnter(handle);
    expect(setCompanionExpanded).toHaveBeenCalledOnce();
    expect(setCompanionExpanded).toHaveBeenLastCalledWith(true);
    fireEvent.pointerDown(handle, { button: 0, pointerId: 7, screenY: 200 });
    fireEvent.pointerMove(handle, { pointerId: 7, screenY: 230 });
    fireEvent.pointerMove(handle, { pointerId: 7, screenY: 260 });
    expect(moveCompanion).toHaveBeenCalledTimes(1);
    expect(moveCompanion).toHaveBeenLastCalledWith({ phase: "start", screenY: 200 });

    fireEvent.pointerLeave(companion);
    act(() => vi.advanceTimersByTime(500));
    expect(setCompanionExpanded).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(20));
    expect(moveCompanion).toHaveBeenLastCalledWith({ phase: "move", screenY: 260 });
    fireEvent.pointerUp(handle, { button: 0, pointerId: 7, screenY: 260 });
    expect(moveCompanion).toHaveBeenLastCalledWith({ phase: "end" });

    act(() => vi.advanceTimersByTime(420));
    expect(setCompanionExpanded).toHaveBeenLastCalledWith(false);

    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(moveCompanion).toHaveBeenLastCalledWith({ phase: "nudge", deltaY: 24 });
    fireEvent.keyDown(handle, { key: "ArrowUp", shiftKey: true });
    expect(moveCompanion).toHaveBeenLastCalledWith({ phase: "nudge", deltaY: -80 });
  });

  it("keeps reminder inputs and buttons outside the drag gesture", () => {
    render(
      <TodayRemindersPanel
        businessDate="2026-08-29"
        desktopCompanion
        initialReminders={[]}
        request={vi.fn()}
      />,
    );
    const companion = screen.getByLabelText("今日还有 0 件事");
    fireEvent.pointerEnter(companion);

    const title = screen.getByPlaceholderText("例如：五点开会");
    fireEvent.pointerDown(title, { button: 0, pointerId: 9, screenY: 300 });
    fireEvent.change(title, { target: { value: "五点开会" } });
    fireEvent.click(screen.getByRole("button", { name: "打开今日" }));

    expect(title).toHaveValue("五点开会");
    expect(moveCompanion).not.toHaveBeenCalled();
    expect(window.lifePivotDesktop?.openMainWindow).toHaveBeenCalledWith("/today");
  });

  it("keeps unfinished past tasks collapsed and groups them by date", () => {
    const { container } = render(
      <TodayRemindersPanel
        businessDate="2026-09-01"
        desktopCompanion
        initialPastReminders={[
          pastReminder("older", "2026-08-30", "整理上周的账单"),
          pastReminder("newer-a", "2026-08-31", "回复邮件"),
          pastReminder("newer-b", "2026-08-31", "整理会议纪要"),
        ]}
        initialReminders={[]}
        request={vi.fn()}
      />,
    );

    const details = container.querySelector("details.reminder-past");
    expect(details).not.toHaveAttribute("open");
    expect(screen.getByText("往期任务")).toBeInTheDocument();
    expect(screen.getByLabelText("往期未完成 3 项")).toBeInTheDocument();

    fireEvent.pointerEnter(screen.getByLabelText("今日还有 0 件事"));
    fireEvent.click(screen.getByText("往期任务"));
    expect(details).toHaveAttribute("open");
    const dateHeadings = screen.getAllByRole("heading", { level: 2 });
    expect(dateHeadings.map((heading) => heading.textContent))
      .toEqual(["2026年8月31日", "2026年8月30日"]);
    expect(screen.getByText("回复邮件")).toBeInTheDocument();
    expect(screen.getByText("整理会议纪要")).toBeInTheDocument();
    expect(screen.getByText("整理上周的账单")).toBeInTheDocument();
  });
});
