import { createHash, randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import {
  type IdempotentCommandOptions,
  runIdempotentCommand,
} from "@/core/db/idempotent-command";

import {
  type FeishuDailyImport,
  type FeishuDailyImportItem,
  type FeishuDailyImportReceipt,
  type FeishuDailyImportReceiptItem,
  getFeishuImportItemSourceKey,
} from "./feishu-daily-import-contract";

const BATCH_OPERATION = "daily-import.feishu.batch.v1";
const ITEM_OPERATION = "daily-import.feishu.item.v1";

const MEAL_LABELS: Record<Extract<FeishuDailyImportItem, { kind: "meal" }>["mealType"], string> = {
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐",
  snack: "加餐",
  other: "饮食",
};

const EXPENSE_LABELS: Record<Extract<FeishuDailyImportItem, { kind: "expense" }>["category"], string> = {
  food: "餐饮",
  transport: "交通",
  shopping: "购物",
  housing: "居住",
  health: "健康",
  learning: "学习",
  entertainment: "娱乐",
  other: "其他",
};

const ACTIVITY_LABELS: Record<Extract<FeishuDailyImportItem, { kind: "activity" }>["status"], string> = {
  done: "已完成",
  planned: "待办",
  cancelled: "已取消",
};

interface ExistingItemRecord {
  operation: string;
  request_hash: string;
  response_json: string;
}

export class FeishuDailyImportConflictError extends Error {
  readonly sourceKey: string;

  constructor(sourceKey: string) {
    super("同一条飞书来源已经导入过不同内容");
    this.name = "FeishuDailyImportConflictError";
    this.sourceKey = sourceKey;
  }
}

export interface FeishuDailyImportServiceDependencies {
  now?: () => Date;
  createId?: () => string;
  writeBarrier?: IdempotentCommandOptions["writeBarrier"];
}

export interface FeishuDailyImportService {
  preview(batch: FeishuDailyImport): FeishuDailyImportReceipt;
  importBatch(batch: FeishuDailyImport, idempotencyKey: string): Promise<FeishuDailyImportReceipt>;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function amountText(amountFen: number): string {
  const yuan = Math.floor(amountFen / 100);
  const fen = amountFen % 100;
  return `¥${yuan}.${String(fen).padStart(2, "0")}`;
}

function suffix(parts: Array<string | undefined>): string {
  const visible = parts.filter((part): part is string => Boolean(part));
  return visible.length === 0 ? "" : ` · ${visible.join("｜")}`;
}

export function renderFeishuImportItemText(item: FeishuDailyImportItem): string {
  if (item.kind === "meal") {
    const foods = item.foods
      .map((food) => food.quantity ? `${food.name} ${food.quantity}` : food.name)
      .join("、");
    return `【饮食 · ${MEAL_LABELS[item.mealType]}】${foods}${suffix([
      item.amountFen ? amountText(item.amountFen) : undefined,
      item.note,
    ])}`;
  }

  if (item.kind === "expense") {
    const subject = item.merchant ? `${item.merchant} ` : "";
    return `【消费 · ${EXPENSE_LABELS[item.category]}】${subject}${amountText(item.amountFen)}${suffix([
      item.note,
    ])}`;
  }

  return `【今日事项 · ${ACTIVITY_LABELS[item.status]}】${item.title}${suffix([
    item.durationMinutes ? `${item.durationMinutes} 分钟` : undefined,
    item.note,
  ])}`;
}

function fullSourceKey(batch: FeishuDailyImport, item: FeishuDailyImportItem): string {
  const itemKey = getFeishuImportItemSourceKey(item, batch.batchId);
  return batch.source.chatId ? `feishu:${batch.source.chatId}:${itemKey.slice("feishu:".length)}` : itemKey;
}

function itemStorageKey(sourceKey: string): string {
  return `daily-import-item-${sha256(sourceKey)}`;
}

function itemRequestHash(
  batch: FeishuDailyImport,
  item: FeishuDailyImportItem,
): string {
  return sha256(canonicalJson({
    schema: batch.schema,
    version: batch.version,
    timezone: batch.timezone,
    businessDate: batch.businessDate,
    chatId: batch.source.chatId ?? null,
    item,
  }));
}

function canonicalOccurredAt(item: FeishuDailyImportItem): string {
  return new Date(item.occurredAt).toISOString();
}

function newReceiptItem(
  batch: FeishuDailyImport,
  item: FeishuDailyImportItem,
  status: "ready" | "imported",
  captureId?: string,
): FeishuDailyImportReceiptItem {
  return {
    sourceKey: fullSourceKey(batch, item),
    kind: item.kind,
    status,
    ...(captureId ? { captureId } : {}),
    occurredAt: canonicalOccurredAt(item),
    text: renderFeishuImportItemText(item),
  };
}

function duplicateReceiptItem(
  item: FeishuDailyImportReceiptItem,
): FeishuDailyImportReceiptItem {
  return { ...item, status: "skipped", reason: "duplicate" };
}

function parseStoredReceiptItem(responseJson: string, sourceKey: string): FeishuDailyImportReceiptItem {
  try {
    const value = JSON.parse(responseJson) as FeishuDailyImportReceiptItem;
    if (
      !value
      || value.status !== "imported"
      || value.sourceKey !== sourceKey
      || typeof value.captureId !== "string"
      || typeof value.occurredAt !== "string"
      || typeof value.text !== "string"
    ) {
      throw new Error("invalid item snapshot");
    }
    return value;
  } catch {
    throw new Error("飞书导入的去重记录已损坏");
  }
}

function existingItem(
  sqlite: Database.Database,
  batch: FeishuDailyImport,
  item: FeishuDailyImportItem,
): FeishuDailyImportReceiptItem | null {
  const sourceKey = fullSourceKey(batch, item);
  const expectedHash = itemRequestHash(batch, item);
  const row = sqlite.prepare(`select operation, request_hash, response_json
    from idempotency_keys where key = ?`)
    .get(itemStorageKey(sourceKey)) as ExistingItemRecord | undefined;
  if (!row) return null;
  if (row.operation !== ITEM_OPERATION || row.request_hash !== expectedHash) {
    throw new FeishuDailyImportConflictError(sourceKey);
  }
  return parseStoredReceiptItem(row.response_json, sourceKey);
}

function makeReceipt(
  batch: FeishuDailyImport,
  preview: boolean,
  items: FeishuDailyImportReceiptItem[],
): FeishuDailyImportReceipt {
  return {
    batchId: batch.batchId,
    preview,
    businessDate: batch.businessDate,
    totalCount: items.length,
    importedCount: items.filter((item) => item.status === "imported").length,
    skippedCount: items.filter((item) => item.status === "skipped").length,
    items,
  };
}

function previewBatch(
  sqlite: Database.Database,
  batch: FeishuDailyImport,
): FeishuDailyImportReceipt {
  const items = batch.items.map((item) => {
    const existing = existingItem(sqlite, batch, item);
    return existing ? duplicateReceiptItem(existing) : newReceiptItem(batch, item, "ready");
  });
  return makeReceipt(batch, true, items);
}

function importOne(
  sqlite: Database.Database,
  batch: FeishuDailyImport,
  item: FeishuDailyImportItem,
  timestamp: string,
  createId: () => string,
): FeishuDailyImportReceiptItem {
  const duplicate = existingItem(sqlite, batch, item);
  if (duplicate) return duplicateReceiptItem(duplicate);

  const captureId = createId();
  const receiptItem = newReceiptItem(batch, item, "imported", captureId);
  sqlite.prepare(`insert into capture_items
    (id, event_type, corrects_item_id, business_date, occurred_at, content, created_at)
    values (?, 'capture', null, ?, ?, ?, ?)`)
    .run(captureId, batch.businessDate, receiptItem.occurredAt, receiptItem.text, timestamp);

  sqlite.prepare(`insert into audit_events
    (id, event_type, resource_type, resource_id, payload_json, occurred_at)
    values (?, 'imported', 'capture_item', ?, ?, ?)`)
    .run(createId(), captureId, JSON.stringify({
      importer: "feishu-daily-import-v1",
      batchId: batch.batchId,
      source: batch.source,
      sourceKey: receiptItem.sourceKey,
      item,
    }), timestamp);

  sqlite.prepare(`insert into idempotency_keys
    (key, operation, request_hash, response_json, created_at)
    values (?, ?, ?, ?, ?)`)
    .run(
      itemStorageKey(receiptItem.sourceKey),
      ITEM_OPERATION,
      itemRequestHash(batch, item),
      JSON.stringify(receiptItem),
      timestamp,
    );
  return receiptItem;
}

export function createFeishuDailyImportService(
  sqlite: Database.Database,
  dependencies: FeishuDailyImportServiceDependencies = {},
): FeishuDailyImportService {
  const now = dependencies.now ?? (() => new Date());
  const createId = dependencies.createId ?? randomUUID;

  return {
    preview(batch) {
      return previewBatch(sqlite, batch);
    },

    async importBatch(batch, idempotencyKey) {
      let transactionNow: Date | undefined;
      const stableNow = () => {
        transactionNow ??= now();
        return transactionNow;
      };

      return runIdempotentCommand(
        sqlite,
        {
          operation: BATCH_OPERATION,
          idempotencyKey,
          now: stableNow,
          writeBarrier: dependencies.writeBarrier,
        },
        batch,
        () => {
          const timestamp = stableNow().toISOString();
          return makeReceipt(
            batch,
            false,
            batch.items.map((item) => importOne(sqlite, batch, item, timestamp, createId)),
          );
        },
      );
    },
  };
}
