import { getApplicationDatabase } from "@/core/db/application-database";
import {
  createPlanningService,
  getPlanningSnapshot,
} from "@/modules/planning/service";
import { handlePlanningRequest } from "@/modules/planning/request-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dependencies() {
  const database = getApplicationDatabase();
  const service = createPlanningService(database.sqlite);
  return {
    getSnapshot: getPlanningSnapshot.bind(null, database.sqlite),
    execute: service.execute,
  };
}

async function handleRouteRequest(request: Request): Promise<Response> {
  try {
    return await handlePlanningRequest(request, dependencies());
  } catch {
    return Response.json(
      { message: "Unable to process planning request." },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export function GET(request: Request): Promise<Response> {
  return handleRouteRequest(request);
}

export function POST(request: Request): Promise<Response> {
  return handleRouteRequest(request);
}
