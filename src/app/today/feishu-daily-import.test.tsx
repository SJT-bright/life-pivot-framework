// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FEISHU_DAILY_IMPORT_BOT_PROMPT } from "@/modules/daily-import/feishu-daily-import-contract";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

import { FeishuDailyImport } from "./feishu-daily-import";

function validBatch(businessDate = "2026-08-30") {
  return {
    schema: "life-pivot.daily-import",
    version: 1,
    batchId: `batch-${businessDate.replaceAll("-", "")}-001`,
    timezone: "Asia/Shanghai",
    businessDate,
    source: {
      platform: "feishu",
      chatId: "oc_demo_chat",
      generatedAt: `${businessDate}T22:00:00+08:00`,
    },
    items: [
      {
        kind: "meal",
        sourceMessageId: "om_meal_message",
        sourceItemId: "meal-1",
        occurredAt: `${businessDate}T08:15:00+08:00`,
        timePrecision: "exact",
        mealType: "breakfast",
        foods: [{ name: "鸡蛋", quantity: "2 个" }],
        amountFen: 1280,
        currency: "CNY",
        sourceText: "早餐两个鸡蛋，付款12.8元",
      },
      {
        kind: "expense",
        sourceMessageId: "om_expense_message",
        sourceItemId: "expense-1",
        occurredAt: `${businessDate}T12:30:00+08:00`,
        timePrecision: "exact",
        amountFen: 2350,
        currency: "CNY",
        category: "food",
        merchant: "午餐店",
      },
      {
        kind: "activity",
        sourceItemId: "activity-1",
        occurredAt: `${businessDate}T19:00:00+08:00`,
        timePrecision: "estimated",
        title: "健身",
        status: "done",
        durationMinutes: 45,
      },
    ],
  };
}

function previewReceipt() {
  return {
    receipt: {
      batchId: "batch-20260830-001",
      preview: true,
      businessDate: "2026-08-30",
      totalCount: 3,
      importedCount: 0,
      skippedCount: 1,
      items: [
        {
          sourceKey: "feishu:oc_demo_chat:om_meal_message:meal-1",
          kind: "meal",
          status: "ready",
          occurredAt: "2026-08-30T08:15:00+08:00",
          text: "早餐",
        },
        {
          sourceKey: "feishu:oc_demo_chat:om_expense_message:expense-1",
          kind: "expense",
          status: "skipped",
          reason: "duplicate",
          occurredAt: "2026-08-30T12:30:00+08:00",
          text: "午餐消费",
        },
        {
          sourceKey: "feishu:oc_demo_chat:batch-20260830-001:activity-1",
          kind: "activity",
          status: "ready",
          occurredAt: "2026-08-30T19:00:00+08:00",
          text: "健身",
        },
      ],
    },
  };
}

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
  navigation.refresh.mockReset();
  vi.restoreAllMocks();
});

describe("FeishuDailyImport", () => {
  it("keeps the bot prompt inside the workflow and copies it in one action", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    render(<FeishuDailyImport businessDate="2026-08-30" />);

    const trigger = screen.getByRole("button", { name: "导入飞书汇总" });
    await user.click(trigger);

    expect(screen.getByRole("dialog", { name: "导入飞书每日汇总" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭飞书汇总导入" })).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");

    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "取消" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "关闭飞书汇总导入" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "复制给飞书机器人" }));

    expect(writeText).toHaveBeenCalledWith(FEISHU_DAILY_IMPORT_BOT_PROMPT);
    expect(screen.getByRole("textbox", { name: /飞书机器人提示词/ }))
      .toHaveValue(FEISHU_DAILY_IMPORT_BOT_PROMPT);
    expect(screen.getByText(/提示词已复制/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "关闭飞书汇总导入" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });

  it("groups a checked preview, edits timestamps, excludes duplicates and imports the selection", async () => {
    const onImported = vi.fn();
    const request = vi.fn()
      .mockResolvedValueOnce(Response.json(previewReceipt()))
      .mockResolvedValueOnce(Response.json(previewReceipt()))
      .mockResolvedValueOnce(Response.json({
        receipt: {
          batchId: "batch-20260830-001",
          preview: false,
          businessDate: "2026-08-30",
          totalCount: 1,
          importedCount: 1,
          skippedCount: 0,
          items: [{
            sourceKey: "feishu:oc_demo_chat:om_meal_message:meal-1",
            kind: "meal",
            status: "imported",
            captureId: "capture-meal-1",
            occurredAt: "2026-08-30T09:05:00+08:00",
            text: "早餐",
          }],
        },
      }));
    const user = userEvent.setup();
    render(
      <FeishuDailyImport
        businessDate="2026-08-30"
        createId={() => "request:with:colon"}
        onImported={onImported}
        request={request}
      />,
    );

    await user.click(screen.getByRole("button", { name: "导入飞书汇总" }));
    fireEvent.change(screen.getByRole("textbox", { name: "飞书机器人汇总内容" }), {
      target: { value: JSON.stringify(validBatch()) },
    });
    await user.click(screen.getByRole("button", { name: "解析并预览" }));

    expect(await screen.findByRole("region", { name: "饮食记录" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "消费记录" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "事项记录" })).toBeInTheDocument();
    expect(screen.getByText("已存在 · 将跳过")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "导入消费第 1 条" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "导入消费第 1 条" })).not.toBeChecked();
    expect(screen.getByText("今日消费 ¥12.80")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认导入 2 条" })).toBeEnabled();

    const mealTime = screen.getByLabelText("饮食第 1 条时间");
    expect(mealTime).toHaveValue("2026-08-30T08:15");
    fireEvent.change(mealTime, { target: { value: "2026-08-30T09:05" } });
    expect(screen.getByText("时间已修改，请重新检查后再确认导入。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认导入 2 条" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "重新检查" }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "确认导入 2 条" })).toBeEnabled();

    await user.click(screen.getByRole("checkbox", { name: "导入事项第 1 条" }));
    await user.click(screen.getByRole("button", { name: "确认导入 1 条" }));

    expect(await screen.findByText("飞书汇总已完成导入")).toBeInTheDocument();
    expect(screen.getByText(/本次金额 ¥12.80/)).toHaveTextContent("今日时间线已刷新");
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[0]?.[0]).toBe("/api/v1/daily-imports?preview=true");
    expect(request.mock.calls[2]?.[0]).toBe("/api/v1/daily-imports");
    const submitInit = request.mock.calls[2]?.[1];
    expect((submitInit?.headers as Record<string, string>)["idempotency-key"])
      .toBe("feishu-daily-import-request-with-colon");
    const submitted = JSON.parse(String(submitInit?.body));
    expect(submitted.items).toHaveLength(1);
    expect(submitted.items[0]).toMatchObject({
      kind: "meal",
      occurredAt: "2026-08-30T09:05:00+08:00",
      amountFen: 1280,
    });
  });

  it("shows format and date errors without contacting the import service", async () => {
    const request = vi.fn();
    const user = userEvent.setup();
    render(<FeishuDailyImport businessDate="2026-08-30" request={request} />);

    await user.click(screen.getByRole("button", { name: "导入飞书汇总" }));
    const editor = screen.getByRole("textbox", { name: "飞书机器人汇总内容" });
    await user.type(editor, "这不是 JSON");
    await user.click(screen.getByRole("button", { name: "解析并预览" }));
    expect(screen.getByRole("alert")).toHaveTextContent("没有找到可读取的飞书汇总 JSON");

    await user.clear(editor);
    fireEvent.change(editor, { target: { value: JSON.stringify(validBatch("2026-08-29")) } });
    await user.click(screen.getByRole("button", { name: "解析并预览" }));
    expect(screen.getByRole("alert")).toHaveTextContent("汇总日期是 2026-08-29");
    expect(request).not.toHaveBeenCalled();
  });
});
