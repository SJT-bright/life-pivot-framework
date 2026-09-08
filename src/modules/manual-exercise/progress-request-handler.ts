import { IdempotentCommandConflictError } from "@/core/db/idempotent-command";
import { LocalMutationError, assertLocalJsonMutation } from "@/core/http/local-request";
import { RevisionConflictError } from "@/core/mutations/revision";
import { isBusinessDate } from "@/core/time/business-date";

import {
  manualExerciseProgressDecisionSchema,
  type ManualExerciseProgressDecisionCommand,
  type ManualExerciseProgressSnapshot,
} from "./progress-contracts";
import {
  ManualExerciseProgressConflictError,
  ManualExerciseProgressValidationError,
} from "./progress-service";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/u;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export interface ManualExerciseProgressRequestDependencies {
  getSnapshot(input: { asOfDate: string; templateId?: string }): ManualExerciseProgressSnapshot;
  execute(
    command: ManualExerciseProgressDecisionCommand,
    idempotencyKey: string,
  ): Promise<ManualExerciseProgressSnapshot>;
}

function json(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function parseGetInput(request: Request): { asOfDate: string; templateId?: string } {
  const searchParams = new URL(request.url).searchParams;
  for (const key of searchParams.keys()) {
    if (key !== "asOfDate" && key !== "templateId") throw new RangeError();
  }
  const dates = searchParams.getAll("asOfDate");
  if (dates.length !== 1 || !isBusinessDate(dates[0]!)) throw new RangeError();
  const values = searchParams.getAll("templateId");
  if (values.length > 1 || values[0] === "") throw new RangeError();
  if (values.length === 0) return { asOfDate: dates[0]! };
  const templateId = values[0]!.trim();
  if (!templateId || templateId.length > 128) throw new RangeError();
  return { asOfDate: dates[0]!, templateId };
}

function handleGet(
  request: Request,
  dependencies: ManualExerciseProgressRequestDependencies,
): Response {
  if (!LOOPBACK_HOSTS.has(new URL(request.url).hostname.toLowerCase())) {
    return json({ message: "Local access only." }, 403);
  }
  let input: { asOfDate: string; templateId?: string };
  try {
    input = parseGetInput(request);
  } catch {
    return json({ message: "Invalid manual exercise progress request." }, 400);
  }
  return json(dependencies.getSnapshot(input), 200);
}

async function handlePost(
  request: Request,
  dependencies: ManualExerciseProgressRequestDependencies,
): Promise<Response> {
  try {
    assertLocalJsonMutation(request);
  } catch (error) {
    if (error instanceof LocalMutationError) {
      return json({ message: error.message }, error.status);
    }
    return json({ message: "Unable to process manual exercise progress request." }, 500);
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
  const parsed = manualExerciseProgressDecisionSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ message: "Invalid manual exercise progress decision." }, 422);
  }
  try {
    return json(await dependencies.execute(parsed.data, idempotencyKey), 200);
  } catch (error) {
    if (
      error instanceof IdempotentCommandConflictError
      || error instanceof RevisionConflictError
      || error instanceof ManualExerciseProgressConflictError
    ) {
      return json({ message: "Manual exercise progress state conflicts with current state." }, 409);
    }
    if (error instanceof ManualExerciseProgressValidationError) {
      return json({ message: "Invalid manual exercise progress decision." }, 422);
    }
    return json({ message: "Unable to process manual exercise progress request." }, 500);
  }
}

export async function handleManualExerciseProgressRequest(
  request: Request,
  dependencies: ManualExerciseProgressRequestDependencies,
): Promise<Response> {
  if (request.method === "GET") return handleGet(request, dependencies);
  if (request.method === "POST") return handlePost(request, dependencies);
  return json({ message: "Method not allowed." }, 405);
}
