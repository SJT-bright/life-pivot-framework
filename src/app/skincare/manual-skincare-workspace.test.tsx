// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MANUAL_SKINCARE_PHOTO_ACCEPT,
  MANUAL_SKINCARE_PHOTO_MAX_BYTES,
  type ManualSkincareMutationResult,
  type ManualSkincareSnapshot,
} from "@/modules/manual-skincare/contracts";

import { ManualSkincareWorkspace } from "./manual-skincare-workspace";

const initial: ManualSkincareSnapshot = {
  businessDate: "2026-08-13",
  products: [
    { productId: "cleanser", name: "温和洁面", brand: "日常", currentPurpose: "清洁", status: "active", addedOn: "2026-08-01", note: "晚间少量", revision: 2 },
    { productId: "cream", name: "修护霜", brand: "安心", currentPurpose: "保湿修护", status: "active", addedOn: "2026-08-02", note: "薄涂", revision: 1 },
  ],
  latestRoutineRevision: 5,
  activationSequence: 3,
  selectedDay: {
    dayId: "day-13",
    businessDate: "2026-08-13",
    materialized: true,
    routineRevision: 5,
    activationSequence: 3,
    recoveryCycle: { cycleId: "cycle-1", name: "第一周期" },
    morningNote: "晨间稳定",
    eveningNote: "晚间偏干",
    overallNote: "整体舒适",
    revision: 7,
    morningItems: [
      { itemKey: "am-cleanser", slot: "morning", productId: "cleanser", ordinal: 0, productName: "温和洁面", brand: "日常", currentPurpose: "清洁", used: false, usedAt: null },
      { itemKey: "am-cream", slot: "morning", productId: "cream", ordinal: 1, productName: "修护霜", brand: "安心", currentPurpose: "保湿修护", used: true, usedAt: "2026-08-13T00:10:00.000Z" },
    ],
    eveningItems: [
      { itemKey: "pm-cream", slot: "evening", productId: "cream", ordinal: 0, productName: "修护霜", brand: "安心", currentPurpose: "保湿修护", used: false, usedAt: null },
    ],
  },
  recoveryPlans: [{
    planId: "plan-1",
    name: "屏障恢复",
    note: "循序渐进",
    revision: 4,
    cycles: [
      { cycleId: "cycle-1", planId: "plan-1", ordinal: 0, name: "第一周期", goal: "稳定基础", durationDays: 10, expectedEndOn: "2026-08-10", status: "active", actualStartedOn: "2026-08-01", actualCompletedOn: null, note: "", revision: 3, routineRevision: 4, items: [{ itemKey: "cycle1-am", slot: "morning", productId: "cream", ordinal: 0, productName: "修护霜", brand: "安心", currentPurpose: "保湿修护" }] },
      { cycleId: "cycle-2", planId: "plan-1", ordinal: 1, name: "第二周期", goal: "逐步恢复", durationDays: 17, expectedEndOn: "2026-08-20", status: "draft", actualStartedOn: null, actualCompletedOn: null, note: "", revision: 2, routineRevision: 6, items: [{ itemKey: "cycle2-pm", slot: "evening", productId: "cleanser", ordinal: 0, productName: "温和洁面", brand: "日常", currentPurpose: "清洁" }] },
    ],
  }],
  history: [{
    dayId: "day-12", businessDate: "2026-08-12", materialized: true, routineRevision: 4, activationSequence: 2,
    recoveryCycle: { cycleId: "cycle-1", name: "第一周期" }, morningNote: "", eveningNote: "", overallNote: "旧日快照",
    revision: 2,
    morningItems: [{ itemKey: "old-am", slot: "morning", productId: "cream", ordinal: 0, productName: "旧名修护霜", brand: "旧品牌", currentPurpose: "历史用途", used: true, usedAt: "2026-08-12T00:10:00.000Z" }],
    eveningItems: [],
  }],
  insights: [{
    businessDate: "2026-08-12",
    completedItems: 1,
    totalItems: 1,
    completionPercent: 100,
    sleepQualityScore: 82,
    sleepVariabilityMinutes: 35,
    sleepPenalty: 0,
    stabilityScore: 100,
  }],
};

function exact(command: Record<string, unknown>, snapshot: ManualSkincareSnapshot): ManualSkincareMutationResult {
  const type = command.type as ManualSkincareMutationResult["applied"]["operation"];
  const ownerId = type === "save-product" ? String(command.productId)
    : type === "save-recovery-plan" ? String(command.planId)
      : type.includes("recovery-cycle") ? String(command.cycleId)
        : String(command.businessDate);
  const expectedRevision = Number(
    command.expectedProductRevision ?? command.expectedDayRevision ?? command.expectedPlanRevision ?? command.expectedCycleRevision,
  );
  return { snapshot, applied: { operation: type, ownerId, ownerRevision: expectedRevision + 1, businessDate: typeof command.businessDate === "string" ? command.businessDate : null, activationSequence: null } };
}

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("ManualSkincareWorkspace", () => {
  it("renders exactly four accessible views with ordered AM/PM facts, three notes, and immutable history snapshots", async () => {
    const user = userEvent.setup();
    const { container } = render(<ManualSkincareWorkspace initial={initial} today="2026-08-13" storage={localStorage} />);

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "今日护肤", "护肤品库", "恢复计划", "历史记录",
    ]);
    const today = screen.getByRole("tabpanel");
    expect(screen.getByLabelText("记录日期")).toHaveValue("2026-08-13");
    expect(within(today).getByRole("heading", { name: "AM" })).toBeInTheDocument();
    expect(within(today).getByRole("heading", { name: "PM" })).toBeInTheDocument();
    expect(within(today).getAllByRole("checkbox").map((item) => item.getAttribute("aria-label"))).toEqual([
      "AM 温和洁面已使用", "AM 修护霜已使用", "PM 修护霜已使用",
    ]);
    expect(screen.getByLabelText("晨间备注")).toHaveValue("晨间稳定");
    expect(screen.getByLabelText("晚间备注")).toHaveValue("晚间偏干");
    expect(screen.getByLabelText("整体备注")).toHaveValue("整体舒适");

    await user.click(screen.getByRole("tab", { name: "历史记录" }));
    expect(screen.getByRole("img", { name: "护肤执行稳定度与同日睡眠趋势折线图" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText(/旧名修护霜/)).toBeInTheDocument();
    expect(screen.getByText(/历史用途/)).toBeInTheDocument();
    expect(screen.queryByText("保湿修护")).not.toBeInTheDocument();

    for (const width of [320, 375, 768, 1024]) {
      container.style.width = `${width}px`;
      expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth || width);
      expect(screen.getByTestId("manual-skincare-workspace")).toHaveStyle({ maxWidth: "100%" });
    }
  });

  it("checks only the selected day and applies the returned snapshot after exact confirmation", async () => {
    const user = userEvent.setup();
    const changed: ManualSkincareSnapshot = {
      ...initial,
      selectedDay: {
        ...initial.selectedDay!,
        revision: 8,
        morningItems: initial.selectedDay!.morningItems.map((item) => item.itemKey === "am-cleanser" ? { ...item, used: true, usedAt: "2026-08-13T01:00:00.000Z" } : item),
      },
    };
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ result: exact(body, changed) });
    });
    render(<ManualSkincareWorkspace createId={() => "manual-skincare-check-0001"} initial={initial} request={request} storage={localStorage} today="2026-08-13" />);

    await user.click(screen.getByLabelText("AM 温和洁面已使用"));

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(request.mock.calls[0]![0]).toBe("/api/v1/manual-skincare");
    expect(JSON.parse(String(request.mock.calls[0]![1]?.body))).toEqual({
      type: "set-day-items-used",
      businessDate: "2026-08-13",
      itemKeys: ["am-cleanser"],
      used: true,
      expectedDayRevision: 7,
    });
    expect(screen.getByLabelText("AM 温和洁面已使用")).toBeChecked();
  });

  it("requires an explicit routine scope and summarizes used items before removing them", async () => {
    const user = userEvent.setup();
    render(<ManualSkincareWorkspace initial={initial} today="2026-08-13" storage={localStorage} />);
    await user.click(screen.getByRole("button", { name: "编辑今日清单" }));

    expect(screen.getByLabelText("仅今天")).toBeChecked();
    expect(screen.getByLabelText("今天及以后")).not.toBeChecked();
    await user.click(screen.getByLabelText("AM 修护霜保留在清单"));
    expect(screen.getByText(/将移除 1 个已使用项/)).toBeInTheDocument();
    expect(screen.getByText(/AM 修护霜/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认移除并保存清单" })).toBeInTheDocument();
  });

  it("highlights file drags, supports file-picker replacement, previews, saves, and removes a product photo", async () => {
    const user = userEvent.setup();
    const changed: ManualSkincareSnapshot = {
      ...initial,
      products: initial.products.map((candidate) => candidate.productId === "cleanser"
        ? {
            ...candidate,
            photoUrl: "/api/v1/manual-skincare/products/cleanser/photo?revision=3",
            revision: 3,
          }
        : candidate),
    };
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ result: exact(body, changed) });
    });
    render(<ManualSkincareWorkspace initial={initial} request={request} storage={localStorage} today="2026-08-13" />);
    await user.click(screen.getByRole("tab", { name: "护肤品库" }));

    const dropzone = screen.getByRole("group", { name: "产品照片" });
    const png = new File([
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ], "产品.png", { type: "image/png" });
    const dragData = { files: [png], types: ["Files"], dropEffect: "none" };
    fireEvent.dragEnter(dropzone, { dataTransfer: dragData });
    expect(dropzone).toHaveAttribute("data-drag-active", "true");
    expect(screen.getByText("松开鼠标即可载入照片")).toBeInTheDocument();
    fireEvent.drop(dropzone, { dataTransfer: dragData });
    await waitFor(() => expect(screen.getByRole("img", { name: "温和洁面照片预览" }))
      .toHaveAttribute("src", "data:image/png;base64,iVBORw0KGgo="));
    expect(dropzone).toHaveAttribute("data-drag-active", "false");

    const input = screen.getByLabelText("选择本地照片替换当前照片");
    expect(input).toHaveAttribute("accept", MANUAL_SKINCARE_PHOTO_ACCEPT);
    const webp = new File([
      new TextEncoder().encode("RIFF\0\0\0\0WEBP"),
    ], "替换.webp", { type: "image/webp" });
    await user.upload(input, webp);
    await waitFor(() => expect(screen.getByRole("img", { name: "温和洁面照片预览" }))
      .toHaveAttribute("src", "data:image/webp;base64,UklGRgAAAABXRUJQ"));

    await user.click(screen.getByRole("button", { name: "保存护肤品" }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(request.mock.calls[0]![1]?.body)) as Record<string, unknown>;
    expect(body.photoDataUrl).toBe("data:image/webp;base64,UklGRgAAAABXRUJQ");
    await waitFor(() => expect(screen.getByRole("img", { name: "温和洁面照片预览" }))
      .toHaveAttribute("src", "/api/v1/manual-skincare/products/cleanser/photo?revision=3"));

    await user.click(screen.getByRole("button", { name: "移除照片" }));
    expect(screen.queryByRole("img", { name: "温和洁面照片预览" })).not.toBeInTheDocument();
    expect(within(dropzone).getByRole("status"))
      .toHaveTextContent("保存护肤品后会从本地数据库删除");
  });

  it("rejects non-image and oversized dropped files without creating a preview", async () => {
    const user = userEvent.setup();
    render(<ManualSkincareWorkspace initial={initial} storage={localStorage} today="2026-08-13" />);
    await user.click(screen.getByRole("tab", { name: "护肤品库" }));
    const dropzone = screen.getByRole("group", { name: "产品照片" });

    const textFile = new File(["not an image"], "说明.txt", { type: "text/plain" });
    fireEvent.drop(dropzone, {
      dataTransfer: { files: [textFile], types: ["Files"], dropEffect: "none" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("只能使用 JPEG、PNG 或 WebP 图片");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();

    const oversized = new File([
      new Uint8Array(MANUAL_SKINCARE_PHOTO_MAX_BYTES + 1),
    ], "太大.jpg", { type: "image/jpeg" });
    fireEvent.drop(dropzone, {
      dataTransfer: { files: [oversized], types: ["Files"], dropEffect: "none" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("小于或等于 2 MB");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows natural-day countdown facts and starts a custom-duration cycle only after confirmation", async () => {
    const user = userEvent.setup();
    render(<ManualSkincareWorkspace initial={initial} now={() => new Date("2026-08-30T00:00:00.000Z")} storage={localStorage} today="2026-08-13" />);
    await user.click(screen.getByRole("tab", { name: "恢复计划" }));

    expect(screen.getByText("第一周期", { selector: "h3" })).toBeInTheDocument();
    const firstCountdown = screen.getByRole("region", { name: "第一周期倒计时" });
    expect(firstCountdown).toHaveTextContent("总周期10 天");
    expect(firstCountdown).toHaveTextContent("已进行10 天");
    expect(firstCountdown).toHaveTextContent("剩余0 天");
    expect(firstCountdown).toHaveTextContent("预计完成日：2026-08-10");
    expect(firstCountdown).toHaveTextContent("历史数据仍完整保留");
    expect(screen.getByText(/当前使用：修护霜/)).toBeInTheDocument();
    expect(screen.queryByText(/当前使用：温和洁面/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "开始下一周期" }));
    expect(screen.getByRole("heading", { name: "确认开始第二周期" })).toBeInTheDocument();
    expect(screen.getByLabelText("今天（2026-08-13）")).toBeInTheDocument();
    expect(screen.getByLabelText("明天（2026-08-14）")).toBeInTheDocument();
    expect(screen.getByText(/本周期产品：PM 温和洁面/)).toBeInTheDocument();
    expect(screen.getByText("计划周期：17 天。请选择明确生效日。")).toBeInTheDocument();
    await user.click(screen.getByLabelText("今天（2026-08-13）"));
    expect(screen.getByText(/预计完成日为 2026-08-29/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认开始所选周期" })).toBeInTheDocument();
  });

  it("creates a 14-day cycle for a saved plan and sends duration rather than a fragile date", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ result: exact(body, initial) });
    });
    render(<ManualSkincareWorkspace createId={(prefix) => `${prefix}-created-0001`} initial={initial} request={request} storage={localStorage} today="2026-08-13" />);
    await user.click(screen.getByRole("tab", { name: "恢复计划" }));
    await user.click(screen.getByText("添加计划周期"));
    const duration = screen.getByLabelText("计划周期（天）", { selector: "#new-cycle-duration" });
    await user.clear(duration);
    await user.type(duration, "14");
    await user.click(screen.getByRole("button", { name: "保存新周期" }));

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(request.mock.calls[0]![1]?.body))).toMatchObject({
      type: "save-recovery-cycle",
      durationDays: 14,
      expectedEndOn: null,
      expectedPlanRevision: 4,
      expectedCycleRevision: 0,
      expectedRoutineRevision: 5,
    });
  });
});
