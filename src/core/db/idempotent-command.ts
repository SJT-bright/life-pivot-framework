import { createHash } from "node:crypto";
import { isAsyncFunction } from "node:util/types";

import type Database from "better-sqlite3";

import {
  type WriteBarrier,
  applicationWriteBarrier,
} from "@/core/backup/write-barrier";

export class IdempotentCommandConflictError extends Error {
  constructor() {
    super("The idempotency key is already bound to another command.");
    this.name = "IdempotentCommandConflictError";
  }
}

export class IdempotentCommandIntegrityError extends Error {
  constructor() {
    super("The stored idempotency response is invalid.");
    this.name = "IdempotentCommandIntegrityError";
  }
}

export class IdempotentCommandSerializationError extends Error {
  constructor(message = "Idempotent commands require JSON-serializable values.") {
    super(message);
    this.name = "IdempotentCommandSerializationError";
  }
}

export class IdempotentCommandTransactionError extends Error {
  constructor(message = "Idempotent commands require one synchronous outer transaction.") {
    super(message);
    this.name = "IdempotentCommandTransactionError";
  }
}

type WriteBarrierLike = Pick<WriteBarrier, "runWrite">;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | (object & { readonly then?: never });

export interface IdempotentCommandOptions {
  operation: string;
  idempotencyKey: string;
  now?: () => Date;
  writeBarrier?: WriteBarrierLike;
}

interface ExistingIdempotencyRecord {
  operation: string;
  request_hash: string;
  response_json: string;
}

function rejectJsonValue(reason: string): never {
  throw new IdempotentCommandSerializationError(reason);
}

function canonicalJson(value: unknown, ancestors = new Set<object>()): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) {
        return rejectJsonValue("NaN and infinite numbers are not JSON values.");
      }
      return JSON.stringify(value);
    case "undefined":
      return rejectJsonValue("Undefined is not a JSON value.");
    case "bigint":
      return rejectJsonValue("BigInt is not a JSON value.");
    case "symbol":
      return rejectJsonValue("Symbols are not JSON values.");
    case "function":
      return rejectJsonValue("Functions are not JSON values.");
    case "object":
      break;
  }

  if (
    value instanceof Date ||
    value instanceof Map ||
    value instanceof Set ||
    value instanceof Promise
  ) {
    return rejectJsonValue("Only plain JSON objects and arrays are supported.");
  }

  const object = value as object;
  if (ancestors.has(object)) {
    return rejectJsonValue("Circular values are not JSON values.");
  }

  ancestors.add(object);
  try {
    if (Array.isArray(value)) {
      if (Object.getOwnPropertySymbols(value).length > 0) {
        return rejectJsonValue("Symbols are not JSON values.");
      }
      const ownNames = Object.getOwnPropertyNames(value);
      for (const name of ownNames) {
        if (name === "length") continue;
        const index = Number(name);
        if (
          !Number.isSafeInteger(index) ||
          index < 0 ||
          index >= value.length ||
          String(index) !== name
        ) {
          return rejectJsonValue("Arrays cannot contain extra properties.");
        }
      }

      const entries: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          return rejectJsonValue("Sparse arrays are not JSON values.");
        }
        entries.push(canonicalJson(value[index], ancestors));
      }
      return `[${entries.join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return rejectJsonValue("Only plain JSON objects and arrays are supported.");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      return rejectJsonValue("Symbols are not JSON values.");
    }

    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key], ancestors)}`);
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(object);
  }
}

function parseStoredSnapshot<T>(responseJson: string): T {
  try {
    const parsed: unknown = JSON.parse(responseJson);
    if (canonicalJson(parsed) !== responseJson) {
      throw new IdempotentCommandIntegrityError();
    }
    return parsed as T;
  } catch (error) {
    if (error instanceof IdempotentCommandIntegrityError) throw error;
    throw new IdempotentCommandIntegrityError();
  }
}

function requestHash(canonicalInput: string): string {
  return createHash("sha256").update(canonicalInput, "utf8").digest("hex");
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  ) && "then" in value && typeof (value as { then?: unknown }).then === "function";
}

function isDeclaredAsyncFunction(execute: () => unknown): boolean {
  return isAsyncFunction(execute);
}

function runWithinImmediateTransaction<T>(
  sqlite: Database.Database,
  options: IdempotentCommandOptions,
  canonicalInput: string,
  execute: () => T,
): T {
  if (sqlite.inTransaction) {
    throw new IdempotentCommandTransactionError("Nested idempotent commands are not allowed.");
  }

  sqlite.exec("BEGIN IMMEDIATE");
  try {
    const hash = requestHash(canonicalInput);
    const previous = sqlite
      .prepare(
        `select operation, request_hash, response_json
         from idempotency_keys
         where key = ?`,
      )
      .get(options.idempotencyKey) as ExistingIdempotencyRecord | undefined;

    if (previous) {
      if (previous.operation !== options.operation || previous.request_hash !== hash) {
        throw new IdempotentCommandConflictError();
      }

      const replay = parseStoredSnapshot<T>(previous.response_json);
      sqlite.exec("COMMIT");
      return replay;
    }

    if (isDeclaredAsyncFunction(execute)) {
      throw new IdempotentCommandTransactionError("Idempotent command execution must be synchronous.");
    }
    const result = execute();
    if (isThenable(result)) {
      Promise.resolve(result).catch(() => undefined);
      throw new IdempotentCommandTransactionError("Idempotent command execution must be synchronous.");
    }

    const responseJson = canonicalJson(result);
    const snapshot = parseStoredSnapshot<T>(responseJson);
    const timestamp = (options.now ?? (() => new Date()))().toISOString();
    sqlite
      .prepare(
        `insert into idempotency_keys
          (key, operation, request_hash, response_json, created_at)
         values (?, ?, ?, ?, ?)`,
      )
      .run(options.idempotencyKey, options.operation, hash, responseJson, timestamp);

    sqlite.exec("COMMIT");
    return snapshot;
  } catch (error) {
    if (sqlite.inTransaction) sqlite.exec("ROLLBACK");
    throw error;
  }
}

/**
 * Runs an idempotent database command for trusted application code.
 *
 * `execute` must complete every side effect synchronously before returning a
 * JSON value. The type and runtime checks catch common mistakes, but this is
 * not a sandbox or a safety boundary for arbitrary extension callbacks.
 *
 * @internal
 */
export async function runIdempotentCommand<T extends JsonValue>(
  sqlite: Database.Database,
  options: IdempotentCommandOptions,
  input: unknown,
  execute: () => T,
): Promise<T> {
  const canonicalInput = canonicalJson(input);
  const writeBarrier = options.writeBarrier ?? applicationWriteBarrier;
  return writeBarrier.runWrite(() =>
    runWithinImmediateTransaction(sqlite, options, canonicalInput, execute),
  );
}
