import { IdempotentCommandConflictError } from "@/core/db/idempotent-command";
import { LocalMutationError, assertLocalJsonMutation } from "@/core/http/local-request";
import { RevisionConflictError } from "@/core/mutations/revision";
import { isBusinessDate } from "@/core/time/business-date";

import {
  type ManualSkincareCommand,
  type ManualSkincareMutationResult,
  type ManualSkincareSnapshot,
  ManualSkincareValidationError,
  manualSkincareCommandSchema,
} from "./contracts";
import { ManualSkincareConflictError } from "./service";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/u;
const GET_QUERY_KEYS = new Set(["date", "historyLimit"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export interface ManualSkincareRequestDependencies {
  getSnapshot(input: {
    businessDate: string;
    historyLimit?: number;
  }): ManualSkincareSnapshot;
  execute(
    command: ManualSkincareCommand,
    idempotencyKey: string,
  ): Promise<ManualSkincareMutationResult>;
}

function noStoreJson(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function parseGetInput(request: Request): {
  businessDate: string;
  historyLimit?: number;
} {
  const searchParams = new URL(request.url).searchParams;
  for (const key of searchParams.keys()) {
    if (!GET_QUERY_KEYS.has(key)) throw new RangeError();
  }
  const dates = searchParams.getAll("date");
  if (dates.length !== 1 || !dates[0] || !isBusinessDate(dates[0])) {
    throw new RangeError();
  }
  const limits = searchParams.getAll("historyLimit");
  if (limits.length > 1) throw new RangeError();
  if (limits.length === 0) return { businessDate: dates[0] };
  if (!/^\d+$/u.test(limits[0]!)) throw new RangeError();
  const historyLimit = Number(limits[0]);
  if (
    !Number.isSafeInteger(historyLimit)
    || historyLimit < 1
    || historyLimit > 100
  ) {
    throw new RangeError();
  }
  return { businessDate: dates[0], historyLimit };
}

function handleGet(
  request: Request,
  dependencies: ManualSkincareRequestDependencies,
): Response {
  if (!LOOPBACK_HOSTS.has(new URL(request.url).hostname.toLowerCase())) {
    return noStoreJson({ message: "Local access only." }, 403);
  }
  let input: { businessDate: string; historyLimit?: number };
  try {
    input = parseGetInput(request);
  } catch {
    return noStoreJson({ message: "Invalid manual skincare snapshot request." }, 400);
  }
  try {
    return noStoreJson({ snapshot: dependencies.getSnapshot(input) }, 200);
  } catch {
    return noStoreJson({ message: "Unable to load manual skincare snapshot." }, 500);
  }
}

async function handlePost(
  request: Request,
  dependencies: ManualSkincareRequestDependencies,
): Promise<Response> {
  try {
    assertLocalJsonMutation(request);
  } catch (error) {
    if (error instanceof LocalMutationError) {
      return noStoreJson({ message: error.message }, error.status);
    }
    return noStoreJson({ message: "Unable to process manual skincare request." }, 500);
  }

  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
    return noStoreJson({ message: "A valid idempotency key is required." }, 400);
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return noStoreJson({ message: "Request content must be valid JSON." }, 400);
  }
  const parsed = manualSkincareCommandSchema.safeParse(raw);
  if (!parsed.success) {
    return noStoreJson({ message: "Invalid manual skincare command." }, 422);
  }
  try {
    const result = await dependencies.execute(parsed.data, idempotencyKey);
    return noStoreJson({ result }, 200);
  } catch (error) {
    if (
      error instanceof IdempotentCommandConflictError
      || error instanceof RevisionConflictError
      || error instanceof ManualSkincareConflictError
    ) {
      return noStoreJson(
        { message: "Manual skincare command conflicts with current state." },
        409,
      );
    }
    if (error instanceof ManualSkincareValidationError) {
      return noStoreJson({ message: "Invalid manual skincare command." }, 422);
    }
    return noStoreJson({ message: "Unable to process manual skincare request." }, 500);
  }
}

export async function handleManualSkincareRequest(
  request: Request,
  dependencies: ManualSkincareRequestDependencies,
): Promise<Response> {
  if (request.method === "GET") return handleGet(request, dependencies);
  if (request.method === "POST") return handlePost(request, dependencies);
  return noStoreJson({ message: "Method not allowed." }, 405);
}
