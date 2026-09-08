import { IdempotentCommandConflictError } from "@/core/db/idempotent-command";
import { LocalMutationError, assertLocalJsonMutation } from "@/core/http/local-request";
import { isBusinessDate } from "@/core/time/business-date";

import {
  type PersonalKnowledgeCommand,
  type PersonalKnowledgeResult,
  type PersonalKnowledgeSnapshot,
  PersonalKnowledgeValidationError,
  personalKnowledgeCommandSchema,
} from "./contracts";
import type { PersonalKnowledgeSnapshotInput } from "./query";
import { PersonalKnowledgeConflictError } from "./service";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/u;
const GET_QUERY_KEYS = new Set(["date", "noteLimit", "itemLimit"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const LIMIT = /^(?:[1-9]|[1-9]\d|100)$/u;

export interface PersonalKnowledgeRequestDependencies {
  getSnapshot: (input: PersonalKnowledgeSnapshotInput) => PersonalKnowledgeSnapshot;
  execute: (
    command: PersonalKnowledgeCommand,
    idempotencyKey: string,
  ) => Promise<PersonalKnowledgeResult>;
}

function json(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export function isPersonalKnowledgeLoopbackRequest(request: Request): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(request.url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function parseLimit(url: URL, name: "noteLimit" | "itemLimit"): number | undefined {
  const values = url.searchParams.getAll(name);
  if (values.length === 0) return undefined;
  if (values.length !== 1 || !LIMIT.test(values[0]!)) throw new PersonalKnowledgeValidationError();
  return Number(values[0]);
}

function parseGetInput(request: Request): PersonalKnowledgeSnapshotInput {
  const url = new URL(request.url);
  for (const key of url.searchParams.keys()) {
    if (!GET_QUERY_KEYS.has(key)) throw new PersonalKnowledgeValidationError();
  }
  const dates = url.searchParams.getAll("date");
  if (dates.length !== 1 || !dates[0] || !isBusinessDate(dates[0])) {
    throw new PersonalKnowledgeValidationError();
  }
  const noteLimit = parseLimit(url, "noteLimit");
  const itemLimit = parseLimit(url, "itemLimit");
  return {
    businessDate: dates[0],
    ...(noteLimit === undefined ? {} : { noteLimit }),
    ...(itemLimit === undefined ? {} : { itemLimit }),
  };
}

function handleGet(
  request: Request,
  dependencies: PersonalKnowledgeRequestDependencies,
): Response {
  if (!isPersonalKnowledgeLoopbackRequest(request)) {
    return json({ message: "Local access only." }, 403);
  }
  let input: PersonalKnowledgeSnapshotInput;
  try {
    input = parseGetInput(request);
  } catch {
    return json({ message: "Invalid personal knowledge snapshot request." }, 400);
  }
  try {
    return json({ snapshot: dependencies.getSnapshot(input) }, 200);
  } catch {
    return json({ message: "Unable to load personal knowledge snapshot." }, 500);
  }
}

async function handlePost(
  request: Request,
  dependencies: PersonalKnowledgeRequestDependencies,
): Promise<Response> {
  try {
    assertLocalJsonMutation(request);
  } catch (error) {
    if (error instanceof LocalMutationError) return json({ message: error.message }, error.status);
    return json({ message: "Unable to process personal knowledge request." }, 500);
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
  const parsed = personalKnowledgeCommandSchema.safeParse(rawCommand);
  if (!parsed.success) return json({ message: "Invalid personal knowledge command." }, 422);

  try {
    return json({ result: await dependencies.execute(parsed.data, idempotencyKey) }, 200);
  } catch (error) {
    if (
      error instanceof PersonalKnowledgeConflictError ||
      error instanceof IdempotentCommandConflictError
    ) {
      return json({ message: "Personal knowledge command conflicts with current state." }, 409);
    }
    if (error instanceof PersonalKnowledgeValidationError) {
      return json({ message: "Invalid personal knowledge command." }, 422);
    }
    return json({ message: "Unable to process personal knowledge request." }, 500);
  }
}

export async function handlePersonalKnowledgeRequest(
  request: Request,
  dependencies: PersonalKnowledgeRequestDependencies,
): Promise<Response> {
  if (request.method === "GET") return handleGet(request, dependencies);
  if (request.method === "POST") return handlePost(request, dependencies);
  return json({ message: "Method not allowed." }, 405);
}
