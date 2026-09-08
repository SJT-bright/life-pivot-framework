import { getApplicationDatabase } from "@/core/db/application-database";
import { handleWeeklyReviewRequest } from "@/modules/weekly-review/request-handler";
import { getWeeklyReviewSnapshot } from "@/modules/weekly-review/query";
import { createWeeklyReviewService } from "@/modules/weekly-review/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store" };
const failed = () => Response.json({ message: "Weekly review is temporarily unavailable." }, { status: 500, headers });
function dependencies() { const { sqlite } = getApplicationDatabase(); const service = createWeeklyReviewService(sqlite); return { get: getWeeklyReviewSnapshot.bind(null, sqlite), execute: service.execute }; }
async function handle(request: Request) { try { return await handleWeeklyReviewRequest(request, dependencies()); } catch { return failed(); } }
const notAllowed = () => Response.json({ message: "Method not allowed." }, { status: 405, headers });
export const GET = (request: Request) => handle(request);
export const POST = (request: Request) => handle(request);
export async function HEAD(request: Request) { const response = await handle(new Request(request, { method: "GET" })); return new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers }); }
export const OPTIONS = () => new Response(null, { status: 204, headers: { allow: "GET, HEAD, OPTIONS, POST", ...headers } });
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
