import { IdempotentCommandConflictError } from "@/core/db/idempotent-command";
import { LocalMutationError, assertLocalJsonMutation } from "@/core/http/local-request";

import { type WeeklyReviewSnapshot, parseWeeklyReviewQuery, WeeklyReviewValidationError } from "./contracts";
import { type WeeklyReviewCommand, WeeklyReviewConflictError, WeeklyReviewValidationError as CommandValidationError } from "./service";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/u;
const FAILED = "Weekly review is temporarily unavailable.";
function json(value: unknown, status: number): Response { return Response.json(value, { status, headers: { "cache-control": "no-store" } }); }
export interface WeeklyReviewRequestDependencies {
  get: (input: { periodStart: string; periodEndExclusive: string; recentLimit: number }) => WeeklyReviewSnapshot;
  execute: (command: WeeklyReviewCommand, idempotencyKey: string) => Promise<WeeklyReviewSnapshot>;
}

export async function handleWeeklyReviewRequest(request: Request, dependencies: WeeklyReviewRequestDependencies): Promise<Response> {
  if (request.method === "GET") {
    try { return json({ result: dependencies.get(parseWeeklyReviewQuery(new URL(request.url).searchParams)) }, 200); }
    catch (error) { return json({ message: error instanceof WeeklyReviewValidationError ? "Invalid weekly review query." : FAILED }, error instanceof WeeklyReviewValidationError ? 400 : 500); }
  }
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  try { assertLocalJsonMutation(request); } catch (error) { return json({ message: error instanceof LocalMutationError ? "Invalid local JSON mutation." : FAILED }, error instanceof LocalMutationError ? error.status : 500); }
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) return json({ message: "A valid idempotency key is required." }, 400);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ message: "Request body must be valid JSON." }, 400); }
  let command: WeeklyReviewCommand;
  try { const { parseWeeklyReviewCommand } = await import("./service"); command = parseWeeklyReviewCommand(body); }
  catch { return json({ message: "Invalid weekly review command." }, 422); }
  try { return json({ result: await dependencies.execute(command, idempotencyKey) }, 200); }
  catch (error) {
    if (error instanceof IdempotentCommandConflictError || error instanceof WeeklyReviewConflictError) return json({ message: "Weekly review conflict." }, 409);
    if (error instanceof CommandValidationError) return json({ message: "Invalid weekly review command." }, 422);
    return json({ message: FAILED }, 500);
  }
}
