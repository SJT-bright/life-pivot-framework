import {
  IdempotentCommandConflictError,
} from "@/core/db/idempotent-command";
import {
  LocalMutationError,
  assertLocalJsonMutation,
} from "@/core/http/local-request";
import { RevisionConflictError } from "@/core/mutations/revision";
import { isBusinessDate } from "@/core/time/business-date";

import {
  type PlanningCommand,
  type PlanningSnapshot,
  PlanningValidationError,
  planningCommandSchema,
} from "./contracts";
import { PlanningConflictError } from "./service";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
const GET_QUERY_KEYS = new Set(["date"]);

export interface PlanningRequestDependencies {
  getSnapshot: (input: { businessDate: string }) => PlanningSnapshot;
  execute: (command: PlanningCommand, idempotencyKey: string) => Promise<PlanningSnapshot>;
}

function json(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function invalidGetRequest(): Response {
  return json({ message: "Invalid planning snapshot request." }, 400);
}

function parseGetInput(request: Request): { businessDate: string } {
  const url = new URL(request.url);
  for (const key of url.searchParams.keys()) {
    if (!GET_QUERY_KEYS.has(key)) throw new PlanningValidationError();
  }
  const dates = url.searchParams.getAll("date");
  if (dates.length !== 1 || !dates[0] || !isBusinessDate(dates[0])) {
    throw new PlanningValidationError();
  }
  return { businessDate: dates[0] };
}

function handleGet(
  request: Request,
  dependencies: PlanningRequestDependencies,
): Response {
  let input: { businessDate: string };
  try {
    input = parseGetInput(request);
  } catch {
    return invalidGetRequest();
  }

  try {
    return json(dependencies.getSnapshot(input), 200);
  } catch {
    return json({ message: "Unable to load planning snapshot." }, 500);
  }
}

async function handlePost(
  request: Request,
  dependencies: PlanningRequestDependencies,
): Promise<Response> {
  try {
    assertLocalJsonMutation(request);
  } catch (error) {
    if (error instanceof LocalMutationError) {
      return json({ message: error.message }, error.status);
    }
    return json({ message: "Unable to process planning request." }, 500);
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

  const parsed = planningCommandSchema.safeParse(rawCommand);
  if (!parsed.success) {
    return json({ message: "Invalid planning command." }, 422);
  }

  try {
    return json(await dependencies.execute(parsed.data, idempotencyKey), 200);
  } catch (error) {
    if (
      error instanceof IdempotentCommandConflictError ||
      error instanceof PlanningConflictError ||
      error instanceof RevisionConflictError
    ) {
      return json({ message: "Planning command conflicts with current state." }, 409);
    }
    if (error instanceof PlanningValidationError) {
      return json({ message: "Invalid planning command." }, 422);
    }
    return json({ message: "Unable to process planning request." }, 500);
  }
}

export async function handlePlanningRequest(
  request: Request,
  dependencies: PlanningRequestDependencies,
): Promise<Response> {
  if (request.method === "GET") return handleGet(request, dependencies);
  if (request.method === "POST") return handlePost(request, dependencies);
  return json({ message: "Method not allowed." }, 405);
}
