import { getApplicationDatabase } from "@/core/db/application-database";
import {
  SearchInputError,
  parseSearchQuery,
  searchEverything,
} from "@/modules/search/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const rawQuery = new URL(request.url).searchParams.get("q") ?? "";
  let parsed;
  try {
    parsed = parseSearchQuery(rawQuery);
  } catch (error) {
    if (error instanceof SearchInputError) {
      return Response.json(
        { message: error.message },
        { status: 422, headers: { "cache-control": "no-store" } },
      );
    }
    return Response.json(
      { message: "搜索失败，请稍后重试" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const sqlite = getApplicationDatabase().sqlite;
    const outcome = searchEverything(sqlite, parsed);
    return Response.json(outcome, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("search failed:", error);
    return Response.json(
      { message: "搜索失败，请稍后重试" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
