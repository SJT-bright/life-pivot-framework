import { LocalMutationError, assertLocalJsonMutation } from "@/core/http/local-request";
import { getApplicationDatabase, resetApplicationDatabase } from "@/core/db/application-database";
import { resolveAppPaths } from "@/core/config/app-paths";
import {
  RESTORE_CONFIRM_PHRASE,
  RestoreBackupError,
  restoreFromBackup,
} from "@/core/backup/restore-backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(value: unknown, status: number): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertLocalJsonMutation(request);
  } catch (error) {
    return error instanceof LocalMutationError
      ? json({ message: error.message }, error.status)
      : json({ message: "恢复失败，请稍后重试" }, 500);
  }

  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return json({ message: "请求内容不是有效 JSON" }, 400);
  }

  const input = value as { backupId?: unknown; confirm?: unknown };
  if (typeof input.backupId !== "string" || input.backupId.length === 0) {
    return json({ message: "请选择要恢复的备份" }, 422);
  }
  if (input.confirm !== RESTORE_CONFIRM_PHRASE) {
    return json({ message: `请在确认框中输入“${RESTORE_CONFIRM_PHRASE}”后再执行` }, 422);
  }

  try {
    const paths = resolveAppPaths(process.env);
    const { sqlite } = getApplicationDatabase();
    const outcome = await restoreFromBackup(
      {
        sqlite,
        databaseFile: paths.databaseFile,
        backupsRoot: paths.backupsRoot,
        onDatabaseReplaced: resetApplicationDatabase,
      },
      { backupId: input.backupId, confirm: input.confirm },
    );
    return json(outcome, 200);
  } catch (error) {
    if (error instanceof RestoreBackupError) {
      return json({ message: error.message }, 422);
    }
    console.error("restore failed:", error);
    return json({ message: "恢复失败，请稍后重试；当前数据未受影响" }, 500);
  }
}
