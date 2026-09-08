import { getApplicationDatabase } from "@/core/db/application-database";
import { getManualExerciseSnapshot } from "@/modules/manual-exercise/queries";
import { handleManualExerciseRequest } from "@/modules/manual-exercise/request-handler";
import { createManualExerciseService } from "@/modules/manual-exercise/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dependencies() {
  const { sqlite } = getApplicationDatabase();
  return {
    getSnapshot: getManualExerciseSnapshot.bind(null, sqlite),
    execute: createManualExerciseService(sqlite).execute,
  };
}

async function handle(request: Request): Promise<Response> {
  try {
    return await handleManualExerciseRequest(request, dependencies());
  } catch {
    return Response.json(
      { message: "Unable to process manual exercise request." },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

function methodNotAllowed(): Response {
  return Response.json(
    { message: "Method not allowed." },
    { status: 405, headers: { "cache-control": "no-store" } },
  );
}

export const GET = (request: Request) => handle(request);
export const POST = (request: Request) => handle(request);
export async function HEAD(request: Request): Promise<Response> {
  const response = await handle(new Request(request, { method: "GET" }));
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
export const OPTIONS = () => new Response(null, {
  status: 204,
  headers: { allow: "GET, HEAD, OPTIONS, POST", "cache-control": "no-store" },
});
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
