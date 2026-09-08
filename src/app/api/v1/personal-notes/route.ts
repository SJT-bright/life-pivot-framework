import { getApplicationDatabase } from "@/core/db/application-database";
import { getPersonalDailyNote } from "@/modules/personal-notes/query";
import { handlePersonalNotesRequest } from "@/modules/personal-notes/request-handler";
import { createPersonalNotesService } from "@/modules/personal-notes/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  try {
    const database = getApplicationDatabase();
    const service = createPersonalNotesService(database.sqlite);
    return await handlePersonalNotesRequest(request, {
      getNote: (input) => getPersonalDailyNote(database.sqlite, input),
      save: service.save,
      move: service.move,
    });
  } catch {
    return Response.json(
      { message: "暂时无法处理整体备注，请稍后重试" },
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
