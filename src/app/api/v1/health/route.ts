import { getRuntimeHealth } from "@/modules/system-health/get-runtime-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(getRuntimeHealth(), {
    headers: { "cache-control": "no-store" },
  });
}
