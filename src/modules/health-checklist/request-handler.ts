import { IdempotentCommandConflictError } from "@/core/db/idempotent-command";
import { LocalMutationError, assertLocalJsonMutation } from "@/core/http/local-request";
import { isBusinessDate } from "@/core/time/business-date";

import {
  type HealthChecklistCommand,
  type HealthChecklistDay,
  healthChecklistCommandSchema,
} from "./contracts";
import {
  HealthChecklistConflictError,
  HealthChecklistValidationError,
} from "./service";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/u;

export interface HealthChecklistRequestDependencies {
  materialize: (businessDate: string) => Promise<HealthChecklistDay>;
  execute: (
    command: HealthChecklistCommand,
    idempotencyKey: string,
  ) => Promise<HealthChecklistDay>;
}

function json(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function parseDate(request: Request): string | null {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => key !== "date")) return null;
  const dates = params.getAll("date");
  return dates.length === 1 && dates[0] && isBusinessDate(dates[0]) ? dates[0] : null;
}

async function handleGet(
  request: Request,
  dependencies: HealthChecklistRequestDependencies,
): Promise<Response> {
  const businessDate = parseDate(request);
  if (!businessDate) return json({ message: "健康清单日期无效。" }, 400);
  try {
    return json({ day: await dependencies.materialize(businessDate) }, 200);
  } catch {
    return json({ message: "暂时无法读取健康清单。" }, 500);
  }
}

async function handlePost(
  request: Request,
  dependencies: HealthChecklistRequestDependencies,
): Promise<Response> {
  try {
    assertLocalJsonMutation(request);
  } catch (error) {
    if (error instanceof LocalMutationError) return json({ message: error.message }, error.status);
    return json({ message: "暂时无法处理健康清单。" }, 500);
  }
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
    return json({ message: "需要有效的幂等键。" }, 400);
  }
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return json({ message: "请求内容必须是有效 JSON。" }, 400);
  }
  const parsed = healthChecklistCommandSchema.safeParse(value);
  if (!parsed.success) return json({ message: "健康清单命令无效。" }, 422);
  try {
    return json({ result: await dependencies.execute(parsed.data, idempotencyKey) }, 200);
  } catch (error) {
    if (
      error instanceof IdempotentCommandConflictError ||
      error instanceof HealthChecklistConflictError
    ) return json({ message: "健康清单已变化，请刷新后重试。" }, 409);
    if (error instanceof HealthChecklistValidationError) {
      return json({ message: "健康清单命令无效。" }, 422);
    }
    return json({ message: "暂时无法处理健康清单。" }, 500);
  }
}

export async function handleHealthChecklistRequest(
  request: Request,
  dependencies: HealthChecklistRequestDependencies,
): Promise<Response> {
  if (request.method === "GET") return handleGet(request, dependencies);
  if (request.method === "POST") return handlePost(request, dependencies);
  return json({ message: "不支持此请求方法。" }, 405);
}
