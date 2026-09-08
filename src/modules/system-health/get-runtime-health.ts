import fs from "node:fs";

import { findLatestVerifiedBackup } from "@/core/backup/create-backup";
import { resolveAppPaths } from "@/core/config/app-paths";
import { getApplicationDatabase } from "@/core/db/application-database";

import { getSystemHealth } from "./get-health";

export function getRuntimeHealth() {
  const database = getApplicationDatabase();
  const paths = resolveAppPaths(process.env);

  return getSystemHealth({
    now: () => new Date(),
    checkDatabase: () => {
      database.sqlite.prepare("select 1").get();
    },
    getSchemaVersion: () => {
      const row = database.sqlite
        .prepare("select value from app_meta where key = 'schema_version'")
        .get() as { value: string } | undefined;
      if (!row) throw new Error("missing schema version");
      return row.value;
    },
    checkDataRoot: () => {
      fs.accessSync(paths.dataRoot, fs.constants.R_OK | fs.constants.W_OK);
    },
    getLatestBackup: () => {
      const backup = findLatestVerifiedBackup(paths.backupsRoot);
      return backup ? { completedAt: backup.createdAt } : null;
    },
  });
}
