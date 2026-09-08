import { getApplicationDatabase } from "@/core/db/application-database";
import {
  listIncompletePastReminders,
  listTodayReminders,
} from "@/modules/today-reminders/query";
import { handleTodayRemindersRequest } from "@/modules/today-reminders/request-handler";
import { createTodayRemindersService } from "@/modules/today-reminders/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  try {
    const database = getApplicationDatabase();
    const service = createTodayRemindersService(database.sqlite);
    return await handleTodayRemindersRequest(request, {
      list: (input) => listTodayReminders(database.sqlite, input),
      listPast: (input) => listIncompletePastReminders(database.sqlite, input),
      execute: service.execute,
    });
  } catch {
    return Response.json(
      { message: "暂时无法处理今日提醒，请稍后重试" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export function GET(request: Request): Promise<Response> {
  return handle(request);
}

export function POST(request: Request): Promise<Response> {
  return handle(request);
}
