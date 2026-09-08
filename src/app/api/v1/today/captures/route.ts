import { getApplicationDatabase } from "@/core/db/application-database";
import { getCaptureTimeline } from "@/modules/today/get-captures";
import { getCaptureSource } from "@/modules/today/get-capture-source";
import { handleCaptureTimelineRequest } from "@/modules/today/captures-request-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  return handleCaptureTimelineRequest(request, {
    getSource: (input) => {
      const database = getApplicationDatabase();
      return getCaptureSource(database.sqlite, input);
    },
    getTimeline: (input) => {
      const database = getApplicationDatabase();
      return getCaptureTimeline(database.sqlite, input);
    },
  });
}
