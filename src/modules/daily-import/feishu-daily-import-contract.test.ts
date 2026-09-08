import { describe, expect, it } from "vitest";

import {
  FEISHU_DAILY_IMPORT_BOT_PROMPT,
  FeishuDailyImportParseError,
  getFeishuImportItemSourceKey,
  parseFeishuDailyImport,
} from "./feishu-daily-import-contract";

function validBatch() {
  return {
    schema: "life-pivot.daily-import",
    version: 1,
    batchId: "batch-20260830-001",
    timezone: "Asia/Shanghai",
    businessDate: "2026-08-30",
    source: {
      platform: "feishu",
      chatId: "oc_demo_chat",
      generatedAt: "2026-08-30T22:00:00+08:00",
    },
    items: [
      {
        kind: "meal",
        sourceMessageId: "om_message_1",
        sourceItemId: "meal-1",
        occurredAt: "2026-08-30T08:15:00+08:00",
        timePrecision: "exact",
        mealType: "breakfast",
        foods: [{ name: "鸡蛋", quantity: "2 个" }],
        currency: "CNY",
      },
      {
        kind: "expense",
        sourceMessageId: "om_message_2",
        sourceItemId: "expense-1",
        occurredAt: "2026-08-30T12:30:00+08:00",
        timePrecision: "exact",
        amountFen: 2350,
        currency: "CNY",
        category: "food",
      },
      {
        kind: "activity",
        sourceMessageId: "om_message_3",
        sourceItemId: "activity-1",
        occurredAt: "2026-08-30T19:00:00+08:00",
        timePrecision: "estimated",
        title: "健身",
        status: "done",
        durationMinutes: 45,
      },
    ],
  };
}

describe("Feishu daily import contract", () => {
  it("accepts a human-readable wrapper with one authoritative JSON block", () => {
    const wrapped = `今日汇总如下：\n\n\`\`\`json\n${JSON.stringify(validBatch())}\n\`\`\`\n请确认。`;

    const parsed = parseFeishuDailyImport(wrapped);

    expect(parsed.items).toHaveLength(3);
    expect(parsed.items[1]).toMatchObject({ kind: "expense", amountFen: 2350 });
  });

  it("rejects floating-point yuan in the integer-fen field", () => {
    const batch = validBatch();
    (batch.items[1] as { amountFen: number }).amountFen = 23.5;

    expect(() => parseFeishuDailyImport(batch)).toThrow(FeishuDailyImportParseError);
  });

  it("rejects timestamps that fall outside the Shanghai business date", () => {
    const batch = validBatch();
    batch.items[0] = {
      ...batch.items[0],
      occurredAt: "2026-08-29T23:59:00+08:00",
    };

    expect(() => parseFeishuDailyImport(batch)).toThrow(/Asia\/Shanghai/);
  });

  it("requires a stable sub-item id when one message yields several facts", () => {
    const batch = validBatch();
    batch.items.push({
      ...batch.items[0],
      kind: "meal",
    });

    expect(() => parseFeishuDailyImport(batch)).toThrow(/sourceMessageId \+ sourceItemId/);
  });

  it("derives a deterministic identity from message and sub-item ids", () => {
    expect(getFeishuImportItemSourceKey({
      sourceMessageId: "om_message_1",
      sourceItemId: "expense-2",
    })).toBe("feishu:om_message_1:expense-2");
  });

  it("falls back to the stable batch id when the source message id is unavailable", () => {
    expect(getFeishuImportItemSourceKey({
      sourceItemId: "meal-1",
    }, "batch-20260830-001")).toBe(
      "feishu:batch:batch-20260830-001:meal-1",
    );
  });

  it("ships one directly copyable JSON-only bot output instruction", () => {
    expect(FEISHU_DAILY_IMPORT_BOT_PROMPT.match(/```json/g)).toHaveLength(1);
    expect(FEISHU_DAILY_IMPORT_BOT_PROMPT.match(/```/g)).toHaveLength(2);
    expect(FEISHU_DAILY_IMPORT_BOT_PROMPT).toContain("amountFen");
    expect(FEISHU_DAILY_IMPORT_BOT_PROMPT).toContain("sourceMessageId");
    expect(FEISHU_DAILY_IMPORT_BOT_PROMPT).toContain("Asia/Shanghai");
  });
});
