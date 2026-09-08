import { IdempotentCommandConflictError } from "@/core/db/idempotent-command";
import { LocalMutationError, assertLocalJsonMutation } from "@/core/http/local-request";

import type { WisdomReminder } from "./contracts";
import { wisdomReminderRecordSchema } from "./contracts";
import { WisdomReminderConflictError } from "./service";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/u;
const SAFE_FAILURE_MESSAGE = "暂时无法处理提醒，请稍后重试";

export interface WisdomRemindersRequestDependencies {
  list(): WisdomReminder[];
  execute(command: unknown, idempotencyKey: string): Promise<WisdomReminder>;
}

function json(value: unknown, status: number): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

export async function handleWisdomRemindersRequest(
  request: Request,
  dependencies: WisdomRemindersRequestDependencies,
): Promise<Response> {
  if (request.method === "GET") {
    try {
      return json({ reminders: dependencies.list() }, 200);
    } catch {
      return json({ message: SAFE_FAILURE_MESSAGE }, 500);
    }
  }
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);

  try {
    assertLocalJsonMutation(request);
  } catch (error) {
    return error instanceof LocalMutationError
      ? json({ message: error.message }, error.status)
      : json({ message: SAFE_FAILURE_MESSAGE }, 500);
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
  try {
    const result = await dependencies.execute(value, idempotencyKey);
    const parsed = wisdomReminderRecordSchema.safeParse(result);
    if (!parsed.success) return json({ message: SAFE_FAILURE_MESSAGE }, 500);
    return json({ result }, 200);
  } catch (error) {
    if (error instanceof WisdomReminderConflictError || error instanceof IdempotentCommandConflictError) {
      return json({ message: "提醒已变化，请刷新后重试" }, 409);
    }
    return json({ message: "提醒内容格式不正确" }, 422);
  }
}
