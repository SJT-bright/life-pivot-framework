import {
  LocalMutationError,
  assertLocalJsonMutation,
} from "@/core/http/local-request";

import type {
  SectionSaveResult,
  TodaySection,
  TodaySectionInput,
} from "./contracts";
import { todaySectionSchema } from "./contracts";
import { CAPTURE_STORAGE_FAILURE_MESSAGE } from "./save-entry";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;

interface RequestHandlerDependencies {
  save: (
    input: TodaySectionInput,
    idempotencyKey: string,
  ) => Promise<SectionSaveResult>;
}

function json(message: unknown, status: number): Response {
  return Response.json(message, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function safeFailure(section: TodaySection): SectionSaveResult {
  return {
    section,
    status: "failed",
    message: CAPTURE_STORAGE_FAILURE_MESSAGE,
  };
}

export async function handleTodaySectionRequest(
  request: Request,
  dependencies: RequestHandlerDependencies,
): Promise<Response> {
  try {
    assertLocalJsonMutation(request);
  } catch (error) {
    if (error instanceof LocalMutationError) {
      return json({ message: error.message }, error.status);
    }
    return json({ message: CAPTURE_STORAGE_FAILURE_MESSAGE }, 500);
  }

  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
    return json({ message: "缺少或无法识别重复请求标识" }, 400);
  }

  let rawInput: unknown;
  try {
    rawInput = await request.json();
  } catch {
    return json({ message: "请求内容不是有效 JSON" }, 400);
  }

  const parsed = todaySectionSchema.safeParse(rawInput);
  if (!parsed.success) {
    return json(
      { message: parsed.error.issues[0]?.message ?? "记录格式不正确" },
      422,
    );
  }

  const input: TodaySectionInput = parsed.data;
  try {
    const result = await dependencies.save(input, idempotencyKey);
    if (result.status === "failed") {
      return json(safeFailure(input.section), 500);
    }
    const status = result.status === "saved"
      ? 200
      : result.status === "conflict"
        ? 409
        : result.status === "invalid"
          ? 422
          : 500;
    return json(result, status);
  } catch {
    return json(safeFailure(input.section), 500);
  }
}
