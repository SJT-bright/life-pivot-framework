import { IdempotentCommandConflictError } from "@/core/db/idempotent-command";
import { LocalMutationError, assertLocalJsonMutation } from "@/core/http/local-request";

import {
  type ReadingCommand,
  type ReadingResult,
  type ReadingSnapshot,
  ReadingValidationError,
  readingCommandSchema,
} from "./contracts";
import { ReadingConflictError } from "./service";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/u;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export interface ReadingRequestDependencies {
  getSnapshot: () => ReadingSnapshot;
  execute: (
    command: ReadingCommand,
    idempotencyKey: string,
  ) => Promise<ReadingResult>;
}

function json(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export function isReadingLoopbackRequest(request: Request): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(request.url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function handleGet(
  request: Request,
  dependencies: ReadingRequestDependencies,
): Response {
  if (!isReadingLoopbackRequest(request)) {
    return json({ message: "Local access only." }, 403);
  }
  const url = new URL(request.url);
  for (const key of url.searchParams.keys()) {
    if (key !== "view") {
      return json({ message: "Invalid reading request." }, 400);
    }
  }
  try {
    return json({ snapshot: dependencies.getSnapshot() }, 200);
  } catch {
    return json({ message: "Unable to load reading snapshot." }, 500);
  }
}

async function handlePost(
  request: Request,
  dependencies: ReadingRequestDependencies,
): Promise<Response> {
  try {
    assertLocalJsonMutation(request);
  } catch (error) {
    if (error instanceof LocalMutationError) return json({ message: error.message }, error.status);
    return json({ message: "Unable to process reading request." }, 500);
  }
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
    return json({ message: "A valid idempotency key is required." }, 400);
  }
  let rawCommand: unknown;
  try {
    rawCommand = await request.json();
  } catch {
    return json({ message: "Request content must be valid JSON." }, 400);
  }
  const parsed = readingCommandSchema.safeParse(rawCommand);
  if (!parsed.success) return json({ message: "Invalid reading command." }, 422);

  try {
    return json({ result: await dependencies.execute(parsed.data, idempotencyKey) }, 200);
  } catch (error) {
    if (
      error instanceof ReadingConflictError ||
      error instanceof IdempotentCommandConflictError
    ) {
      return json({ message: "Reading command conflicts with current state." }, 409);
    }
    if (error instanceof ReadingValidationError) {
      return json({ message: "Invalid reading command." }, 422);
    }
    return json({ message: "Unable to process reading request." }, 500);
  }
}

export async function handleReadingRequest(
  request: Request,
  dependencies: ReadingRequestDependencies,
): Promise<Response> {
  if (request.method === "GET") return handleGet(request, dependencies);
  if (request.method === "POST") return handlePost(request, dependencies);
  return json({ message: "Method not allowed." }, 405);
}
