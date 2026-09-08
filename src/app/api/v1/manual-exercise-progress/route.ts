import { getApplicationDatabase } from "@/core/db/application-database";
import {
  handleManualExerciseProgressRequest,
} from "@/modules/manual-exercise/progress-request-handler";
import { getManualExerciseProgressSnapshot } from "@/modules/manual-exercise/progress-query";
import { createManualExerciseProgressService } from "@/modules/manual-exercise/progress-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dependencies() {
  const { sqlite } = getApplicationDatabase();
  const service = createManualExerciseProgressService(sqlite);
  return {
    getSnapshot: (input: { asOfDate: string; templateId?: string }) =>
      getManualExerciseProgressSnapshot(sqlite, input),
    execute: service.execute,
  };
}

async function handle(request: Request): Promise<Response> {
  try {
    return await handleManualExerciseProgressRequest(request, dependencies());
  } catch {
    return Response.json(
      { message: "Unable to process manual exercise progress request." },
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
  headers: {
    allow: "GET, HEAD, OPTIONS, POST",
    "cache-control": "no-store",
  },
});

export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
