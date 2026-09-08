import { IdempotentCommandConflictError } from "@/core/db/idempotent-command";
import { LocalMutationError, assertLocalJsonMutation } from "@/core/http/local-request";
import { RevisionConflictError } from "@/core/mutations/revision";
import { isBusinessDate } from "@/core/time/business-date";

import { manualExerciseCommandSchema, type ManualExerciseCommand } from "./contracts";
import {
  ManualExerciseConflictError,
  type ManualExerciseSnapshot,
  ManualExerciseValidationError,
} from "./service";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
const GET_QUERY_KEYS = new Set(["date", "historyLimit"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export interface ManualExerciseRequestDependencies {
  getSnapshot: (input: { businessDate: string; historyLimit?: number }) => ManualExerciseSnapshot;
  execute: (command: ManualExerciseCommand, idempotencyKey: string) => Promise<ManualExerciseSnapshot>;
}

function json(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function parseGetInput(request: Request): { businessDate: string; historyLimit?: number } {
  const parameters = new URL(request.url).searchParams;
  for (const key of parameters.keys()) {
    if (!GET_QUERY_KEYS.has(key)) throw new RangeError();
  }
  const dates = parameters.getAll("date");
  if (dates.length !== 1 || !dates[0] || !isBusinessDate(dates[0])) throw new RangeError();
  const limits = parameters.getAll("historyLimit");
  if (limits.length > 1) throw new RangeError();
  if (limits.length === 0) return { businessDate: dates[0] };
  if (!/^\d+$/.test(limits[0]!)) throw new RangeError();
  const historyLimit = Number(limits[0]);
  if (!Number.isSafeInteger(historyLimit) || historyLimit < 1 || historyLimit > 100) {
    throw new RangeError();
  }
  return { businessDate: dates[0], historyLimit };
}

function handleGet(request: Request, dependencies: ManualExerciseRequestDependencies): Response {
  if (!LOOPBACK_HOSTS.has(new URL(request.url).hostname.toLowerCase())) {
    return json({ message: "Local access only." }, 403);
  }
  let input: { businessDate: string; historyLimit?: number };
  try {
    input = parseGetInput(request);
  } catch {
    return json({ message: "Invalid manual exercise snapshot request." }, 400);
  }
  try {
    return json(dependencies.getSnapshot(input), 200);
  } catch {
    return json({ message: "Unable to load manual exercise snapshot." }, 500);
  }
}

async function handlePost(
  request: Request,
  dependencies: ManualExerciseRequestDependencies,
): Promise<Response> {
  try {
    assertLocalJsonMutation(request);
  } catch (error) {
    if (error instanceof LocalMutationError) {
      return json({ message: error.message }, error.status);
    }
    return json({ message: "Unable to process manual exercise request." }, 500);
  }
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
    return json({ message: "A valid idempotency key is required." }, 400);
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ message: "Request content must be valid JSON." }, 400);
  }
  const parsed = manualExerciseCommandSchema.safeParse(raw);
  if (!parsed.success) return json({ message: "Invalid manual exercise command." }, 422);
  try {
    return json(await dependencies.execute(parsed.data, idempotencyKey), 200);
  } catch (error) {
    if (
      error instanceof IdempotentCommandConflictError
      || error instanceof RevisionConflictError
      || error instanceof ManualExerciseConflictError
    ) {
      return json({ message: "Manual exercise command conflicts with current state." }, 409);
    }
    if (error instanceof ManualExerciseValidationError) {
      return json({ message: "Invalid manual exercise command." }, 422);
    }
    return json({ message: "Unable to process manual exercise request." }, 500);
  }
}

export async function handleManualExerciseRequest(
  request: Request,
  dependencies: ManualExerciseRequestDependencies,
): Promise<Response> {
  if (request.method === "GET") return handleGet(request, dependencies);
  if (request.method === "POST") return handlePost(request, dependencies);
  return json({ message: "Method not allowed." }, 405);
}
