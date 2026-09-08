import { getApplicationDatabase } from "@/core/db/application-database";
import { createCaptureVoider } from "@/modules/today/void-entry";
import { handleCaptureVoidRequest } from "@/modules/today/void-request-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let sqlite;
  try {
    sqlite = getApplicationDatabase().sqlite;
  } catch {
    return Response.json(
      { message: "作废失败，请稍后重试" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
  return handleCaptureVoidRequest(request, {
    voidCapture: (input, idempotencyKey) =>
      createCaptureVoider(sqlite, { idempotencyKey })(input),
  });
}
