import { resolveAppPaths } from "@/core/config/app-paths";

import { type AppDatabase, openDatabase } from "./client";

const applicationGlobal = globalThis as typeof globalThis & {
  lifePivotDatabase?: AppDatabase;
};

export function getApplicationDatabase(): AppDatabase {
  if (!applicationGlobal.lifePivotDatabase) {
    const paths = resolveAppPaths(process.env);
    applicationGlobal.lifePivotDatabase = openDatabase(paths.databaseFile);
  }

  return applicationGlobal.lifePivotDatabase;
}

/**
 * Forgets the process-wide database handle so the next access reopens the
 * database file from disk. Used after a backup restore replaced the file.
 */
export function resetApplicationDatabase(): void {
  applicationGlobal.lifePivotDatabase = undefined;
}
