import { createVerifiedBackup } from "@/core/backup/create-backup";
import { handleBackupRequest } from "@/core/backup/backup-request-handler";
import { resolveAppPaths } from "@/core/config/app-paths";
import { getApplicationDatabase } from "@/core/db/application-database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const paths = resolveAppPaths(process.env);
  const { sqlite } = getApplicationDatabase();

  return handleBackupRequest(request, {
    create: () => createVerifiedBackup({
      sqlite,
      databaseFile: paths.databaseFile,
      backupsRoot: paths.backupsRoot,
    }),
  });
}
