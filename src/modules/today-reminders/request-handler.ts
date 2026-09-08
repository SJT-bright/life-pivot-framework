import { IdempotentCommandConflictError } from "@/core/db/idempotent-command";
import { LocalMutationError, assertLocalJsonMutation } from "@/core/http/local-request";
import { isBusinessDate } from "@/core/time/business-date";

import type {
  TodayReminder,
  TodayReminderCommand,
  TodayReminderCommandResult,
} from "./contracts";
import { todayReminderCommandSchema } from "./contracts";
import { TodayReminderConflictError } from "./service";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/u;
const SAFE_FAILURE_MESSAGE = "暂时无法处理今日提醒，请稍后重试";

export interface TodayRemindersRequestDependencies {
  list(input: { businessDate: string }): TodayReminder[];
  listPast(input: { beforeBusinessDate: string; limit: number }): TodayReminder[];
  execute(command: TodayReminderCommand, idempotencyKey: string): Promise<TodayReminderCommandResult>;
}

function json(value: unknown, status: number): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

function readBusinessDate(request: Request): string | null {
  const search = new URL(request.url).searchParams;
  const keys = [...search.keys()];
  const values = search.getAll("date");
  if (keys.length !== 1 || keys[0] !== "date" || values.length !== 1 || !isBusinessDate(values[0]!)) {
    return null;
  }
  return values[0]!;
}

export async function handleTodayRemindersRequest(
  request: Request,
  dependencies: TodayRemindersRequestDependencies,
): Promise<Response> {
  if (request.method === "GET") {
    const businessDate = readBusinessDate(request);
    if (!businessDate) return json({ message: "日期参数不正确" }, 400);
    try {
      return json({
        reminders: dependencies.list({ businessDate }),
        pastReminders: dependencies.listPast({ beforeBusinessDate: businessDate, limit: 100 }),
      }, 200);
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
  const parsed = todayReminderCommandSchema.safeParse(value);
  if (!parsed.success) {
    return json({ message: parsed.error.issues[0]?.message ?? "提醒格式不正确" }, 422);
  }
  try {
    const result = await dependencies.execute(parsed.data, idempotencyKey);
    return json({
      reminder: result.reminder,
      ...(result.alertClaimed === undefined ? {} : { alertClaimed: result.alertClaimed }),
    }, 200);
  } catch (error) {
    if (error instanceof TodayReminderConflictError || error instanceof IdempotentCommandConflictError) {
      return json({ message: "提醒已变化，请刷新后重试" }, 409);
    }
    return json({ message: SAFE_FAILURE_MESSAGE }, 500);
  }
}
