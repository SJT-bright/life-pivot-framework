import { IdempotentCommandConflictError } from "@/core/db/idempotent-command";
import {
  LocalMutationError,
  assertLocalJsonMutation,
} from "@/core/http/local-request";

import type { VoidCaptureInput, VoidedCapture } from "./void-entry";
import {
  CAPTURE_VOID_CONFLICT_MESSAGE,
  CAPTURE_VOID_STORAGE_MESSAGE,
  CaptureVoidConflictError,
  voidCaptureSchema,
} from "./void-entry";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;

export interface CaptureVoidRequestDependencies {
  voidCapture: (input: VoidCaptureInput, idempotencyKey: string) => Promise<VoidedCapture>;
}

function json(value: unknown, status: number): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

export async function handleCaptureVoidRequest(
  request: Request,
  dependencies: CaptureVoidRequestDependencies,
): Promise<Response> {
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);

  try {
    assertLocalJsonMutation(request);
  } catch (error) {
    return error instanceof LocalMutationError
      ? json({ message: error.message }, error.status)
      : json({ message: CAPTURE_VOID_STORAGE_MESSAGE }, 500);
  }

  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
    return json({ message: "缺少或无法识别重复请求标识" }, 400);
  }

  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return json({ message: "请求内容不是有效 JSON" }, 400);
  }

  const parsed = voidCaptureSchema.safeParse(value);
  if (!parsed.success) {
    return json({ message: parsed.error.issues[0]?.message ?? "作废请求格式不正确" }, 422);
  }

  try {
    const result = await dependencies.voidCapture(parsed.data, idempotencyKey);
    return json({ status: "voided", ...result }, 200);
  } catch (error) {
    if (
      error instanceof CaptureVoidConflictError
      || error instanceof IdempotentCommandConflictError
    ) {
      return json({ message: CAPTURE_VOID_CONFLICT_MESSAGE }, 409);
    }
    return json({ message: CAPTURE_VOID_STORAGE_MESSAGE }, 500);
  }
}
