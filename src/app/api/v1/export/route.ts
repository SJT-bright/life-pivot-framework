import { getApplicationDatabase } from "@/core/db/application-database";
import { buildArchiveExport, buildMarkdownDigest } from "@/core/backup/export-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function attachmentName(name: string): string {
  return `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function GET(request: Request): Promise<Response> {
  const format = new URL(request.url).searchParams.get("format") ?? "json";
  let sqlite;
  try {
    sqlite = getApplicationDatabase().sqlite;
  } catch {
    return Response.json(
      { message: "暂时无法读取数据库，导出失败" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }

  const stamp = new Date().toISOString().slice(0, 19).replace("T", "-").replace(/:/g, "");

  if (format === "markdown") {
    const body = buildMarkdownDigest(sqlite);
    return new Response(body, {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": attachmentName(`个人积累库摘要-${stamp}.md`),
        "cache-control": "no-store",
      },
    });
  }
  if (format === "json") {
    const body = JSON.stringify(buildArchiveExport(sqlite), null, 2);
    return new Response(body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": attachmentName(`个人积累库导出-${stamp}.json`),
        "cache-control": "no-store",
      },
    });
  }
  return Response.json(
    { message: "不支持的导出格式" },
    { status: 422, headers: { "cache-control": "no-store" } },
  );
}
