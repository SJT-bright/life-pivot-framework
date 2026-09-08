import { resolveAppPaths } from "@/core/config/app-paths";
import { listRestoreCandidates } from "@/core/backup/restore-backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const paths = resolveAppPaths(process.env);
    return Response.json(
      { backups: listRestoreCandidates(paths.backupsRoot) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json(
      { message: "暂时无法读取备份列表" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
