import { createHash, randomUUID } from "node:crypto";

import type Database from "better-sqlite3";
import { z } from "zod";

import { applicationWriteBarrier, type WriteBarrier } from "@/core/backup/write-barrier";
import { isBusinessDate } from "@/core/time/business-date";

const OPERATION = "today.capture.void";

export const CAPTURE_VOID_CONFLICT_MESSAGE = "这条记录不存在，或已不是可作废的状态";
export const CAPTURE_VOID_STORAGE_MESSAGE = "作废失败，请稍后重试";

export class CaptureVoidConflictError extends Error {
  constructor(message = CAPTURE_VOID_CONFLICT_MESSAGE) {
    super(message);
    this.name = "CaptureVoidConflictError";
  }
}

export class CaptureVoidStorageError extends Error {
  constructor() {
    super(CAPTURE_VOID_STORAGE_MESSAGE);
    this.name = "CaptureVoidStorageError";
  }
}

export const voidCaptureSchema = z.object({
  itemId: z.string().trim().min(1, "记录标识不正确").max(128, "记录标识不正确"),
  businessDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "记录日期格式不正确")
    .refine(isBusinessDate, "记录日期不存在"),
}).strict();

export type VoidCaptureInput = z.output<typeof voidCaptureSchema>;

export interface VoidedCapture {
  itemId: string;
  voidId: string;
  businessDate: string;
  voidedAt: string;
}

type WriteBarrierLike = Pick<WriteBarrier, "runWrite">;

interface CaptureVoiderOptions {
  idempotencyKey: string;
  now?: () => Date;
  createId?: () => string;
  writeBarrier?: WriteBarrierLike;
}

interface ExistingIdempotencyRecord {
  operation: string;
  request_hash: string;
  response_json: string;
}

interface CaptureItemRow {
  id: string;
  business_date: string;
  occurred_at: string;
  content: string;
  created_at: string;
}

function requestHash(input: VoidCaptureInput): string {
  const canonicalRequest = JSON.stringify({
    businessDate: input.businessDate,
    itemId: input.itemId,
  });
  return createHash("sha256").update(canonicalRequest, "utf8").digest("hex");
}

export function createCaptureVoider(
  sqlite: Database.Database,
  options: CaptureVoiderOptions,
): (input: VoidCaptureInput) => Promise<VoidedCapture> {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? randomUUID;
  const writeBarrier = options.writeBarrier ?? applicationWriteBarrier;

  return async (input) => {
    try {
      return await writeBarrier.runWrite(() => {
        const hash = requestHash(input);
        const voided = sqlite.transaction((): VoidedCapture => {
          const previous = sqlite
            .prepare(
              `select operation, request_hash, response_json
               from idempotency_keys where key = ?`,
            )
            .get(options.idempotencyKey) as ExistingIdempotencyRecord | undefined;

          if (previous) {
            if (previous.operation !== OPERATION || previous.request_hash !== hash) {
              throw new CaptureVoidConflictError("该请求标识已用于其他内容");
            }
            return JSON.parse(previous.response_json) as VoidedCapture;
          }

          const item = sqlite
            .prepare(
              `select id, business_date, occurred_at, content, created_at
               from capture_items where id = ?`,
            )
            .get(input.itemId) as CaptureItemRow | undefined;

          if (!item || item.business_date !== input.businessDate) {
            throw new CaptureVoidConflictError();
          }

          const timestamp = now().toISOString();
          const existingVoid = sqlite
            .prepare(
              `select id from capture_items
               where event_type = 'void' and corrects_item_id = ?
               order by created_at desc limit 1`,
            )
            .get(item.id) as { id: string } | undefined;

          let voidId: string;
          if (existingVoid) {
            voidId = existingVoid.id;
          } else {
            voidId = createId();
            sqlite
              .prepare(
                `insert into capture_items
                  (id, event_type, corrects_item_id, business_date, occurred_at, content, created_at)
                 values (?, 'void', ?, ?, ?, ?, ?)`,
              )
              .run(voidId, item.id, item.business_date, item.occurred_at, "已作废", timestamp);
            sqlite
              .prepare(
                `insert into audit_events
                  (id, event_type, resource_type, resource_id, payload_json, occurred_at)
                 values (?, 'voided', 'capture_item', ?, ?, ?)`,
              )
              .run(
                createId(),
                item.id,
                JSON.stringify({ itemId: item.id, voidId, businessDate: item.business_date }),
                timestamp,
              );
          }

          const result: VoidedCapture = {
            itemId: item.id,
            voidId,
            businessDate: item.business_date,
            voidedAt: timestamp,
          };
          sqlite
            .prepare(
              `insert into idempotency_keys
                (key, operation, request_hash, response_json, created_at)
               values (?, ?, ?, ?, ?)`,
            )
            .run(options.idempotencyKey, OPERATION, hash, JSON.stringify(result), timestamp);

          return result;
        });

        return voided();
      });
    } catch (error) {
      if (error instanceof CaptureVoidConflictError) {
        throw error;
      }
      throw new CaptureVoidStorageError();
    }
  };
}
