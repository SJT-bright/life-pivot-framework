import { getApplicationDatabase } from "@/core/db/application-database";
import { listWisdomReminders } from "@/modules/wisdom-reminders/query";
import { handleWisdomRemindersRequest } from "@/modules/wisdom-reminders/request-handler";
import { createWisdomReminderService } from "@/modules/wisdom-reminders/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  try {
    const database = getApplicationDatabase();
    const service = createWisdomReminderService(database.sqlite);
    return await handleWisdomRemindersRequest(request, {
      list: () => listWisdomReminders(database.sqlite),
      execute: service.execute,
    });
  } catch {
    return Response.json(
      { message: "暂时无法处理提醒，请稍后重试" },
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
