import { getApplicationDatabase } from "@/core/db/application-database";
import { handleFeishuDailyImportRequest } from "@/modules/daily-import/request-handler";
import { createFeishuDailyImportService } from "@/modules/daily-import/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const database = getApplicationDatabase();
    const service = createFeishuDailyImportService(database.sqlite);
    return await handleFeishuDailyImportRequest(request, service);
  } catch {
    return Response.json(
      { message: "暂时无法导入飞书汇总，请稍后重试" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
