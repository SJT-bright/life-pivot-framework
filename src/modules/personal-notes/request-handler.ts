import { IdempotentCommandConflictError } from "@/core/db/idempotent-command";
import { LocalMutationError, assertLocalJsonMutation } from "@/core/http/local-request";
import { isBusinessDate } from "@/core/time/business-date";

import type {
  MovePersonalDailyNoteCommand,
  PersonalDailyNote,
  SavePersonalDailyNoteCommand,
} from "./contracts";
import { movePersonalDailyNoteSchema, savePersonalDailyNoteSchema } from "./contracts";
import {
  PersonalNoteConflictError,
  PersonalNoteDateOccupiedError,
  PersonalNoteMoveBlockedError,
} from "./service";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/u;
const SAFE_FAILURE_MESSAGE = "暂时无法处理整体备注，请稍后重试";

export interface PersonalNotesRequestDependencies {
  getNote(input: { businessDate: string }): PersonalDailyNote | null;
  save(command: SavePersonalDailyNoteCommand, idempotencyKey: string): Promise<PersonalDailyNote>;
  move(command: MovePersonalDailyNoteCommand, idempotencyKey: string): Promise<PersonalDailyNote>;
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

export async function handlePersonalNotesRequest(
  request: Request,
  dependencies: PersonalNotesRequestDependencies,
): Promise<Response> {
  if (request.method === "GET") {
    const businessDate = readBusinessDate(request);
    if (!businessDate) return json({ message: "日期参数不正确" }, 400);
    try {
      return json({ note: dependencies.getNote({ businessDate }) }, 200);
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
  const commandType = typeof value === "object" && value !== null && "type" in value
    ? (value as { type?: unknown }).type
    : undefined;
  if (commandType === "move-personal-daily-note") {
    const parsed = movePersonalDailyNoteSchema.safeParse(value);
    if (!parsed.success) {
      return json({ message: parsed.error.issues[0]?.message ?? "移动复盘请求格式不正确" }, 422);
    }
    try {
      return json({ result: await dependencies.move(parsed.data, idempotencyKey) }, 200);
    } catch (error) {
      if (error instanceof PersonalNoteDateOccupiedError) {
        return json({ message: "目标日期已经有一份复盘，请换一个日期" }, 409);
      }
      if (error instanceof PersonalNoteMoveBlockedError) {
        return json({ message: error.message }, 422);
      }
      if (error instanceof PersonalNoteConflictError || error instanceof IdempotentCommandConflictError) {
        return json({ message: "复盘已变化，请刷新后重试" }, 409);
      }
      return json({ message: SAFE_FAILURE_MESSAGE }, 500);
    }
  }
  const parsed = savePersonalDailyNoteSchema.safeParse(value);
  if (!parsed.success) {
    return json({ message: parsed.error.issues[0]?.message ?? "整体备注格式不正确" }, 422);
  }
  try {
    return json({ result: await dependencies.save(parsed.data, idempotencyKey) }, 200);
  } catch (error) {
    if (error instanceof PersonalNoteConflictError || error instanceof IdempotentCommandConflictError) {
      return json({ message: "整体备注已变化，请刷新后重试" }, 409);
    }
    return json({ message: SAFE_FAILURE_MESSAGE }, 500);
  }
}
