import { getApplicationDatabase } from "@/core/db/application-database";
import {
  getDailySleepHistory,
  getDailySleepRecord,
} from "@/modules/daily-sleep/query";
import { handleDailySleepRequest } from "@/modules/daily-sleep/request-handler";
import { createDailySleepService } from "@/modules/daily-sleep/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dependencies() {
  const { sqlite } = getApplicationDatabase();
  const service = createDailySleepService(sqlite);
  return {
    getRecord: getDailySleepRecord.bind(null, sqlite),
    getHistory: getDailySleepHistory.bind(null, sqlite),
    execute: service.execute,
  };
}

async function handle(request: Request): Promise<Response> {
  try {
    return await handleDailySleepRequest(request, dependencies());
  } catch {
    return Response.json(
      { message: "暂时无法处理睡眠记录请求" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

function methodNotAllowed(): Response {
  return Response.json(
    { message: "不支持此请求方法" },
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
