import { getApplicationDatabase } from "@/core/db/application-database";
import { getManualSkincareSnapshot } from "@/modules/manual-skincare/query";
import { handleManualSkincareRequest } from "@/modules/manual-skincare/request-handler";
import { createManualSkincareService } from "@/modules/manual-skincare/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dependencies(method: string) {
  const { sqlite } = getApplicationDatabase();
  const execute = method === "POST"
    ? createManualSkincareService({ sqlite }).execute
    : async () => {
        throw new Error("Manual skincare mutations require POST.");
      };
  return {
    getSnapshot: getManualSkincareSnapshot.bind(null, sqlite),
    execute,
  };
}

async function handle(request: Request): Promise<Response> {
  try {
    return await handleManualSkincareRequest(request, dependencies(request.method));
  } catch {
    return Response.json(
      { message: "Unable to process manual skincare request." },
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
