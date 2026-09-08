import { getApplicationDatabase } from "@/core/db/application-database";
import { handleHealthChecklistRequest } from "@/modules/health-checklist/request-handler";
import {
  createHealthChecklistService,
  materializeHealthChecklistDay,
} from "@/modules/health-checklist/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dependencies() {
  const { sqlite } = getApplicationDatabase();
  const service = createHealthChecklistService(sqlite);
  return {
    materialize: materializeHealthChecklistDay.bind(null, sqlite),
    execute: service.execute,
  };
}

async function handle(request: Request): Promise<Response> {
  try {
    return await handleHealthChecklistRequest(request, dependencies());
  } catch {
    return Response.json(
      { message: "暂时无法处理健康清单。" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

const methodNotAllowed = () => Response.json(
  { message: "不支持此请求方法。" },
  { status: 405, headers: { "cache-control": "no-store" } },
);

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
