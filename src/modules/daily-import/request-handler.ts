import { IdempotentCommandConflictError } from "@/core/db/idempotent-command";
import { LocalMutationError, assertLocalJsonMutation } from "@/core/http/local-request";

import {
  type FeishuDailyImport,
  type FeishuDailyImportReceipt,
  FeishuDailyImportParseError,
  parseFeishuDailyImport,
} from "./feishu-daily-import-contract";
import { FeishuDailyImportConflictError } from "./service";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/u;
const SAFE_FAILURE_MESSAGE = "暂时无法导入飞书汇总，请稍后重试";

export interface FeishuDailyImportRequestDependencies {
  preview(batch: FeishuDailyImport): FeishuDailyImportReceipt;
  importBatch(batch: FeishuDailyImport, idempotencyKey: string): Promise<FeishuDailyImportReceipt>;
}

function json(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function parsePreviewMode(request: Request): boolean | null {
  const search = new URL(request.url).searchParams;
  const keys = [...search.keys()];
  if (keys.length === 0) return false;
  if (keys.length !== 1 || keys[0] !== "preview") return null;
  const values = search.getAll("preview");
  return values.length === 1 && values[0] === "true" ? true : null;
}

export async function handleFeishuDailyImportRequest(
  request: Request,
  dependencies: FeishuDailyImportRequestDependencies,
): Promise<Response> {
  if (request.method !== "POST") {
    return json({ message: "Method not allowed." }, 405);
  }

  const preview = parsePreviewMode(request);
  if (preview === null) {
    return json({ message: "导入模式参数不正确" }, 400);
  }

  try {
    assertLocalJsonMutation(request);
  } catch (error) {
    return error instanceof LocalMutationError
      ? json({ message: error.message }, error.status)
      : json({ message: SAFE_FAILURE_MESSAGE }, 500);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ message: "请求内容不是有效 JSON" }, 400);
  }

  let batch: FeishuDailyImport;
  try {
    batch = parseFeishuDailyImport(raw);
  } catch (error) {
    return error instanceof FeishuDailyImportParseError
      ? json({ message: error.message }, 422)
      : json({ message: "飞书汇总格式不正确" }, 422);
  }

  if (preview) {
    try {
      return json({ receipt: dependencies.preview(batch) }, 200);
    } catch (error) {
      if (error instanceof FeishuDailyImportConflictError) {
        return json({
          message: error.message,
          sourceKey: error.sourceKey,
        }, 409);
      }
      return json({ message: SAFE_FAILURE_MESSAGE }, 500);
    }
  }

  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
    return json({ message: "缺少或无法识别重复请求标识" }, 400);
  }

  try {
    return json({ receipt: await dependencies.importBatch(batch, idempotencyKey) }, 200);
  } catch (error) {
    if (
      error instanceof FeishuDailyImportConflictError
      || error instanceof IdempotentCommandConflictError
    ) {
      return json({
        message: error instanceof FeishuDailyImportConflictError
          ? error.message
          : "该重复请求标识已用于其他汇总",
        ...(error instanceof FeishuDailyImportConflictError
          ? { sourceKey: error.sourceKey }
          : {}),
      }, 409);
    }
    return json({ message: SAFE_FAILURE_MESSAGE }, 500);
  }
}
