// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ManualSkincareMutationResult,
  ManualSkincareSnapshot,
} from "@/modules/manual-skincare/contracts";

import { TodaySkincareCard } from "./today-skincare-card";

const initial: ManualSkincareSnapshot = {
  businessDate: "2026-08-13",
  products: [],
  latestRoutineRevision: 3,
  activationSequence: 4,
  selectedDay: {
    dayId: "skincare-day-0001",
    businessDate: "2026-08-13",
    materialized: true,
    routineRevision: 3,
    activationSequence: 4,
    recoveryCycle: { cycleId: "recovery-cycle-0001", name: "第一周期" },
    morningNote: "晨间稳定",
    eveningNote: "晚间偏干",
    overallNote: "整体舒适",
    revision: 7,
    morningItems: [
      {
        itemKey: "am-cleanser",
        slot: "morning",
        productId: "product-cleanser",
        ordinal: 0,
        productName: "温和洁面",
        brand: "示例品牌",
        currentPurpose: "清洁",
        used: false,
        usedAt: null,
      },
      {
        itemKey: "am-cream",
        slot: "morning",
        productId: "product-cream",
        ordinal: 1,
        productName: "修护霜",
        brand: "示例品牌",
        currentPurpose: "保湿修护",
        used: true,
        usedAt: "2026-08-13T00:30:00.000Z",
      },
    ],
    eveningItems: [
      {
        itemKey: "pm-cream",
        slot: "evening",
        productId: "product-cream",
        ordinal: 0,
        productName: "修护霜",
        brand: "示例品牌",
        currentPurpose: "保湿修护",
        used: false,
        usedAt: null,
      },
    ],
  },
  recoveryPlans: [{
    planId: "recovery-plan-0001",
    name: "屏障恢复",
    note: "",
    revision: 2,
    cycles: [{
      cycleId: "recovery-cycle-0001",
      planId: "recovery-plan-0001",
      ordinal: 0,
      name: "第一周期",
      goal: "稳定屏障",
      expectedEndOn: "2026-08-10",
      status: "active",
      actualStartedOn: "2026-08-01",
      actualCompletedOn: null,
      note: "",
      revision: 2,
      routineRevision: 3,
      items: [],
    }],
  }],
  history: [],
};

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe("TodaySkincareCard", () => {
  it("shows the cycle reminder, separate AM/PM progress, folded notes, and exact-date link", () => {
    render(<TodaySkincareCard state={{ status: "ready", data: initial }} storage={localStorage} today="2026-08-13" />);

    expect(screen.getByText("当前周期：第一周期")).toBeInTheDocument();
    expect(screen.getByText("预计结束：2026-08-10（仅提醒，不会自动切换）")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AM" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "PM" })).toBeInTheDocument();
    expect(screen.getByText("AM 1 / 2")).toBeInTheDocument();
    expect(screen.getByText("PM 0 / 1")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "AM 温和洁面已使用" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "AM 修护霜已使用" })).toBeChecked();
    const notes = screen.getByText("查看三项备注").closest("details");
    expect(notes).not.toHaveAttribute("open");
    expect(notes).toHaveTextContent("晨间备注：晨间稳定");
    expect(notes).toHaveTextContent("晚间备注：晚间偏干");
    expect(notes).toHaveTextContent("整体备注：整体舒适");
    expect(screen.getByRole("link", { name: "打开完整护肤记录" })).toHaveAttribute(
      "href",
      "/skincare?date=2026-08-13",
    );
  });

  it("checks one selected-day item through the shared manual endpoint and applies only the confirmed snapshot", async () => {
    const user = userEvent.setup();
    const changed: ManualSkincareSnapshot = {
      ...initial,
      selectedDay: {
        ...initial.selectedDay!,
        revision: 8,
        morningItems: initial.selectedDay!.morningItems.map((item) => item.itemKey === "am-cleanser"
          ? { ...item, used: true, usedAt: "2026-08-13T01:00:00.000Z" }
          : item),
      },
    };
    const result: ManualSkincareMutationResult = {
      snapshot: changed,
      applied: {
        operation: "set-day-items-used",
        ownerId: "2026-08-13",
        ownerRevision: 8,
        businessDate: "2026-08-13",
        activationSequence: null,
      },
    };
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      Response.json({ result })
    ));
    render(
      <TodaySkincareCard
        createId={() => "today-skincare-check-0001"}
        now={() => new Date("2026-08-13T01:00:00.000Z")}
        request={request}
        state={{ status: "ready", data: initial }}
        storage={localStorage}
        today="2026-08-13"
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "AM 温和洁面已使用" }));

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(request.mock.calls[0]![0]).toBe("/api/v1/manual-skincare");
    expect(JSON.parse(String(request.mock.calls[0]![1]?.body))).toEqual({
      type: "set-day-items-used",
      businessDate: "2026-08-13",
      itemKeys: ["am-cleanser"],
      used: true,
      expectedDayRevision: 7,
    });
    expect(request.mock.calls[0]![0]).not.toMatch(/\/api\/v1\/skincare\/(catalog|plans|today)/u);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "AM 温和洁面已使用" })).toBeChecked());
    expect(screen.getByText("AM 2 / 2")).toBeInTheDocument();
  });

  it("keeps the visible snapshot and frozen evidence when confirmation is uncertain", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      Response.json({ unexpected: true })
    ));
    render(
      <TodaySkincareCard
        createId={() => "today-skincare-uncertain-0001"}
        now={() => new Date("2026-08-13T01:00:00.000Z")}
        request={request}
        state={{ status: "ready", data: initial }}
        storage={localStorage}
        today="2026-08-13"
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "AM 温和洁面已使用" }));

    await waitFor(() => expect(screen.getByText("结果未确认，已保留原提交。")).toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: "AM 温和洁面已使用" })).not.toBeChecked();
    expect(localStorage.length).toBe(1);
  });
});
