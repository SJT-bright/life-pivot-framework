import { describe, expect, it, vi } from "vitest";

import type {
  FeishuDailyImport,
  FeishuDailyImportReceipt,
} from "./feishu-daily-import-contract";
import { handleFeishuDailyImportRequest } from "./request-handler";
import { FeishuDailyImportConflictError } from "./service";

function body() {
  return {
    schema: "life-pivot.daily-import",
    version: 1,
    batchId: "batch-20260830-handler",
    timezone: "Asia/Shanghai",
    businessDate: "2026-08-30",
    source: {
      platform: "feishu",
      generatedAt: "2026-08-30T21:30:00+08:00",
    },
    items: [{
      kind: "activity",
      sourceItemId: "note-1",
      occurredAt: "2026-08-30T17:00:00+08:00",
      timePrecision: "exact",
      title: "整理今日记录",
      status: "done",
    }],
  };
}

const receipt: FeishuDailyImportReceipt = {
  batchId: "batch-20260830-handler",
  preview: true,
  businessDate: "2026-08-30",
  totalCount: 1,
  importedCount: 0,
  skippedCount: 0,
  items: [{
    sourceKey: "feishu:batch:batch-20260830-handler:note-1",
    kind: "activity",
    status: "ready",
    occurredAt: "2026-08-30T09:00:00.000Z",
    text: "【今日事项 · 已完成】整理今日记录",
  }],
};

function request(url: string, options: { body?: unknown; key?: string; origin?: string } = {}) {
  return new Request(url, {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      origin: options.origin ?? "http://127.0.0.1:3000",
      "content-type": "application/json",
      ...(options.key ? { "idempotency-key": options.key } : {}),
    },
    body: JSON.stringify(options.body ?? body()),
  });
}

describe("Feishu daily import request handler", () => {
  it("offers a no-write preview without requiring an idempotency header", async () => {
    const preview = vi.fn((_batch: FeishuDailyImport) => receipt);
    const importBatch = vi.fn();

    const response = await handleFeishuDailyImportRequest(
      request("http://127.0.0.1:3000/api/v1/daily-imports?preview=true"),
      { preview, importBatch },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).receipt).toMatchObject({ preview: true, totalCount: 1 });
    expect(preview).toHaveBeenCalledOnce();
    expect(importBatch).not.toHaveBeenCalled();
  });

  it("imports a validated batch with its caller idempotency key", async () => {
    const imported = { ...receipt, preview: false, importedCount: 1, items: [
      { ...receipt.items[0]!, status: "imported" as const, captureId: "capture-0001" },
    ] };
    const importBatch = vi.fn(async (_batch: FeishuDailyImport, _key: string) => imported);

    const response = await handleFeishuDailyImportRequest(
      request("http://127.0.0.1:3000/api/v1/daily-imports", {
        key: "feishu-handler-key-0001",
      }),
      { preview: vi.fn(), importBatch },
    );

    expect(response.status).toBe(200);
    expect(importBatch).toHaveBeenCalledWith(
      expect.objectContaining({ batchId: "batch-20260830-handler" }),
      "feishu-handler-key-0001",
    );
  });

  it("rejects malformed templates, unsafe origins, and missing commit keys", async () => {
    const dependencies = { preview: vi.fn(), importBatch: vi.fn() };

    const malformed = await handleFeishuDailyImportRequest(
      request("http://127.0.0.1:3000/api/v1/daily-imports?preview=true", {
        body: { ...body(), timezone: "UTC" },
      }),
      dependencies,
    );
    expect(malformed.status).toBe(422);
    expect((await malformed.json()).message).toContain("timezone");

    const unsafe = await handleFeishuDailyImportRequest(
      request("http://127.0.0.1:3000/api/v1/daily-imports?preview=true", {
        origin: "https://example.com",
      }),
      dependencies,
    );
    expect(unsafe.status).toBe(403);

    const missingKey = await handleFeishuDailyImportRequest(
      request("http://127.0.0.1:3000/api/v1/daily-imports"),
      dependencies,
    );
    expect(missingKey.status).toBe(400);
    expect(dependencies.importBatch).not.toHaveBeenCalled();
  });

  it("returns a source-specific conflict without exposing internals", async () => {
    const sourceKey = "feishu:om_source:activity-1";
    const response = await handleFeishuDailyImportRequest(
      request("http://127.0.0.1:3000/api/v1/daily-imports", {
        key: "feishu-handler-key-0002",
      }),
      {
        preview: vi.fn(),
        importBatch: vi.fn(async () => { throw new FeishuDailyImportConflictError(sourceKey); }),
      },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      message: "同一条飞书来源已经导入过不同内容",
      sourceKey,
    });
  });
});
