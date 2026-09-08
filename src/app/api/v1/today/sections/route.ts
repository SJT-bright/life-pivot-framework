import { getApplicationDatabase } from "@/core/db/application-database";
import { createEntrySaver } from "@/modules/today/save-entry";
import { handleTodaySectionRequest } from "@/modules/today/request-handler";
import { saveTodaySection } from "@/modules/today/save-section";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const database = getApplicationDatabase();
  return handleTodaySectionRequest(request, {
    save: (input, idempotencyKey) =>
      saveTodaySection(input, {
        saveEntry: createEntrySaver(database.sqlite, { idempotencyKey }),
      }),
  });
}
