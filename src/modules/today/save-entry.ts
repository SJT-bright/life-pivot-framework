import { createHash, randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import {
  type WriteBarrier,
  applicationWriteBarrier,
} from "@/core/backup/write-barrier";

import {
  canonicalizeIsoInstant,
  type EntrySectionInput,
  type StoredCapture,
} from "./contracts";

const OPERATION = "today.entry.save";
export const CAPTURE_STORAGE_FAILURE_MESSAGE = "保存失败，请稍后重试";

export class IdempotencyConflictError extends Error {
  constructor() {
    super("该请求标识已用于其他内容");
    this.name = "IdempotencyConflictError";
  }
}

export class CaptureStorageError extends Error {
  constructor() {
    super(CAPTURE_STORAGE_FAILURE_MESSAGE);
    this.name = "CaptureStorageError";
  }
}

type WriteBarrierLike = Pick<WriteBarrier, "runWrite">;

interface EntrySaverOptions {
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

function requestHash(input: EntrySectionInput): string {
  const canonicalRequest = JSON.stringify({
    section: input.section,
    draftId: input.draftId,
    businessDate: input.businessDate,
    occurredAt: input.occurredAt,
    value: { text: input.value.text },
  });
  return createHash("sha256").update(canonicalRequest, "utf8").digest("hex");
}

export function createEntrySaver(
  sqlite: Database.Database,
  options: EntrySaverOptions,
): (input: EntrySectionInput) => Promise<StoredCapture> {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? randomUUID;
  const writeBarrier = options.writeBarrier ?? applicationWriteBarrier;

  return async (input) => {
    try {
      return await writeBarrier.runWrite(() => {
        const legacyHash = requestHash(input);
        const normalizedInput: EntrySectionInput = {
          ...input,
          occurredAt: canonicalizeIsoInstant(input.occurredAt),
        };
        const hash = requestHash(normalizedInput);
        const save = sqlite.transaction((): StoredCapture => {
          const previous = sqlite
            .prepare(
              `select operation, request_hash, response_json
               from idempotency_keys where key = ?`,
            )
            .get(options.idempotencyKey) as ExistingIdempotencyRecord | undefined;

          if (previous) {
            if (
              previous.operation !== OPERATION
              || (previous.request_hash !== hash && previous.request_hash !== legacyHash)
            ) {
              throw new IdempotencyConflictError();
            }
            return JSON.parse(previous.response_json) as StoredCapture;
          }

          const timestamp = now().toISOString();
          const stored: StoredCapture = {
            id: createId(),
            draftId: normalizedInput.draftId,
            businessDate: normalizedInput.businessDate,
            occurredAt: normalizedInput.occurredAt,
            text: normalizedInput.value.text,
            createdAt: timestamp,
          };

          sqlite
            .prepare(
              `insert into capture_items
                (id, event_type, corrects_item_id, business_date, occurred_at, content, created_at)
               values (?, 'capture', null, ?, ?, ?, ?)`,
            )
            .run(
              stored.id,
              stored.businessDate,
              stored.occurredAt,
              stored.text,
              stored.createdAt,
            );

          sqlite
            .prepare(
              `insert into audit_events
                (id, event_type, resource_type, resource_id, payload_json, occurred_at)
               values (?, 'created', 'capture_item', ?, ?, ?)`,
            )
            .run(createId(), stored.id, JSON.stringify(stored), timestamp);

          sqlite
            .prepare(
              `insert into idempotency_keys
                (key, operation, request_hash, response_json, created_at)
               values (?, ?, ?, ?, ?)`,
            )
            .run(options.idempotencyKey, OPERATION, hash, JSON.stringify(stored), timestamp);

          return stored;
        });

        return save();
      });
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        throw error;
      }
      throw new CaptureStorageError();
    }
  };
}
