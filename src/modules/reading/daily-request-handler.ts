import { IdempotentCommandConflictError } from "@/core/db/idempotent-command";
import { LocalMutationError, assertLocalJsonMutation } from "@/core/http/local-request";
import { isBusinessDate } from "@/core/time/business-date";

import {
  type DailyReadingCommand,
  type DailyReadingResult,
  type DailyReadingSnapshot,
  ReadingValidationError,
  dailyReadingCommandSchema,
} from "./contracts";
import { isReadingLoopbackRequest } from "./request-handler";
import { ReadingConflictError } from "./service";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/u;

export interface DailyReadingRequestDependencies {
  getSnapshot: (businessDate: string) => DailyReadingSnapshot;
  execute: (
    command: DailyReadingCommand,
    idempotencyKey: string,
  ) => Promise<DailyReadingResult>;
}

function json(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function handleGet(
  request: Request,
  dependencies: DailyReadingRequestDependencies,
): Response {
  if (!isReadingLoopbackRequest(request)) {
    return json({ message: "Local access only." }, 403);
  }
  const url = new URL(request.url);
  if (
    [...url.searchParams.keys()].some((key) => key !== "date") ||
    url.searchParams.getAll("date").length !== 1
  ) {
    return json({ message: "Invalid daily reading request." }, 400);
  }
  const businessDate = url.searchParams.get("date");
  if (!businessDate || !isBusinessDate(businessDate)) {
    return json({ message: "Invalid daily reading request." }, 400);
  }
  try {
    return json({ snapshot: dependencies.getSnapshot(businessDate) }, 200);
  } catch {
    return json({ message: "Unable to load daily reading snapshot." }, 500);
  }
}

async function handlePost(
  request: Request,
  dependencies: DailyReadingRequestDependencies,
): Promise<Response> {
  try {
    assertLocalJsonMutation(request);
  } catch (error) {
    if (error instanceof LocalMutationError) {
      return json({ message: error.message }, error.status);
    }
    return json({ message: "Unable to process daily reading request." }, 500);
  }

  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
    return json({ message: "A valid idempotency key is required." }, 400);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ message: "Request content must be valid JSON." }, 400);
  }
  const parsed = dailyReadingCommandSchema.safeParse(body);
  if (!parsed.success) {
    return json({ message: "Invalid daily reading command." }, 422);
  }

  try {
    return json({ result: await dependencies.execute(parsed.data, idempotencyKey) }, 200);
  } catch (error) {
    if (
      error instanceof ReadingConflictError ||
      error instanceof IdempotentCommandConflictError
    ) {
      return json({ message: "Daily reading command conflicts with current state." }, 409);
    }
    if (error instanceof ReadingValidationError) {
      return json({ message: "Invalid daily reading command." }, 422);
    }
    return json({ message: "Unable to process daily reading request." }, 500);
  }
}

export async function handleDailyReadingRequest(
  request: Request,
  dependencies: DailyReadingRequestDependencies,
): Promise<Response> {
  if (request.method === "GET") return handleGet(request, dependencies);
  if (request.method === "POST") return handlePost(request, dependencies);
  return json({ message: "Method not allowed." }, 405);
}
