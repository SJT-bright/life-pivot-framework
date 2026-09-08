import { getApplicationDatabase } from "@/core/db/application-database";
import { getPersonalKnowledgeSnapshot } from "@/modules/personal-knowledge/query";
import {
  handlePersonalKnowledgeRequest,
  isPersonalKnowledgeLoopbackRequest,
} from "@/modules/personal-knowledge/request-handler";
import { createPersonalKnowledgeService } from "@/modules/personal-knowledge/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dependencies() {
  const database = getApplicationDatabase();
  const service = createPersonalKnowledgeService({ sqlite: database.sqlite });
  return {
    getSnapshot: (input: Parameters<typeof getPersonalKnowledgeSnapshot>[1]) =>
      getPersonalKnowledgeSnapshot(database.sqlite, input),
    execute: service.execute,
  };
}

async function handleRouteRequest(request: Request): Promise<Response> {
  if (!isPersonalKnowledgeLoopbackRequest(request)) {
    return Response.json(
      { message: "Local access only." },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    return await handlePersonalKnowledgeRequest(request, dependencies());
  } catch {
    return Response.json(
      { message: "Unable to process personal knowledge request." },
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

export function GET(request: Request): Promise<Response> {
  return handleRouteRequest(request);
}

export function POST(request: Request): Promise<Response> {
  return handleRouteRequest(request);
}

export async function HEAD(request: Request): Promise<Response> {
  const response = await handleRouteRequest(new Request(request, { method: "GET" }));
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      allow: "GET, HEAD, OPTIONS, POST",
      "cache-control": "no-store",
    },
  });
}

export function PUT(): Response {
  return methodNotAllowed();
}

export function PATCH(): Response {
  return methodNotAllowed();
}

export function DELETE(): Response {
  return methodNotAllowed();
}
