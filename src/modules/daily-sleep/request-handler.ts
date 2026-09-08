import { IdempotentCommandConflictError } from "@/core/db/idempotent-command";
import {
  LocalMutationError,
  assertLocalJsonMutation,
} from "@/core/http/local-request";
import { isBusinessDate } from "@/core/time/business-date";

import {
  type DailySleepCommand,
  type DailySleepRecord,
  DailySleepValidationError,
  parseDailySleepCommand,
} from "./contracts";
import type { DailySleepHistory } from "./query";
import { DailySleepConflictError } from "./service";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/u;
const HISTORY_LIMIT = /^(?:[1-9]\d?|100)$/u;

export interface DailySleepRequestDependencies {
  getRecord: (input: { recordDate: string }) => DailySleepRecord | null;
  getHistory: (input: { limit: number }) => DailySleepHistory;
  execute: (
    command: DailySleepCommand,
    idempotencyKey: string,
  ) => Promise<DailySleepRecord>;
}

function json(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function handleGet(
  request: Request,
  dependencies: DailySleepRequestDependencies,
): Response {
  const search = new URL(request.url).searchParams;
  const keys = [...search.keys()];

  try {
    if (keys.length === 1 && keys[0] === "date") {
      const dates = search.getAll("date");
      if (dates.length !== 1 || !isBusinessDate(dates[0]!)) {
        throw new DailySleepValidationError();
      }
      return json({ record: dependencies.getRecord({ recordDate: dates[0]! }) }, 200);
    }

    if (
      keys.length === 2 &&
      keys.includes("view") &&
      keys.includes("limit") &&
      search.getAll("view").length === 1 &&
      search.get("view") === "history" &&
      search.getAll("limit").length === 1 &&
      HISTORY_LIMIT.test(search.get("limit") ?? "")
    ) {
      return json({
        history: dependencies.getHistory({ limit: Number(search.get("limit")) }),
      }, 200);
    }
  } catch (error) {
    if (!(error instanceof DailySleepValidationError)) {
      return json({ message: "暂时无法读取睡眠记录" }, 500);
    }
  }

  return json({ message: "睡眠记录查询参数无效" }, 400);
}

async function handlePost(
  request: Request,
  dependencies: DailySleepRequestDependencies,
): Promise<Response> {
  try {
    assertLocalJsonMutation(request);
  } catch (error) {
    if (error instanceof LocalMutationError) return json({ message: error.message }, error.status);
    return json({ message: "暂时无法处理睡眠记录请求" }, 500);
  }

  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
    return json({ message: "缺少有效的幂等键" }, 400);
  }

  let command: DailySleepCommand;
  try {
    command = parseDailySleepCommand(await request.json());
  } catch (error) {
    return json({
      message: error instanceof DailySleepValidationError
        ? "睡眠记录内容无效"
        : "请求内容必须是有效 JSON",
    }, error instanceof DailySleepValidationError ? 422 : 400);
  }

  try {
    return json({ result: await dependencies.execute(command, idempotencyKey) }, 200);
  } catch (error) {
    if (
      error instanceof DailySleepConflictError ||
      error instanceof IdempotentCommandConflictError
    ) {
      return json({ message: "睡眠记录已变化，请刷新后重试" }, 409);
    }
    if (error instanceof DailySleepValidationError) {
      return json({ message: "睡眠记录内容无效" }, 422);
    }
    return json({ message: "暂时无法保存睡眠记录" }, 500);
  }
}

export async function handleDailySleepRequest(
  request: Request,
  dependencies: DailySleepRequestDependencies,
): Promise<Response> {
  if (request.method === "GET") return handleGet(request, dependencies);
  if (request.method === "POST") return handlePost(request, dependencies);
  return json({ message: "不支持此请求方法" }, 405);
}
