import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { migrationManifest } from "./migration-manifest";

export interface LoadedMigration {
  id: string;
  filename: string;
  sha256: string;
  sql: string;
}

function resolveMigrationPath(projectRoot: string, filename: string): string {
  const pathApi = path.posix.isAbsolute(projectRoot)
    ? path.posix
    : path.win32.isAbsolute(projectRoot) || projectRoot.includes("\\")
      ? path.win32
      : path.posix;
  return pathApi.resolve(projectRoot, "drizzle", filename);
}

export function resolveFoundationMigrationPath(projectRoot = process.cwd()): string {
  return resolveMigrationPath(projectRoot, "0000_foundation.sql");
}

export function normalizeMigrationSql(sql: string): string {
  const normalized = sql.replace(/\r\n/g, "\n");
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

export function loadMigrations(
  projectRoot = process.cwd(),
): readonly LoadedMigration[] {
  return migrationManifest.map((definition) => {
    const file = resolveMigrationPath(projectRoot, definition.filename);
    const sql = normalizeMigrationSql(fs.readFileSync(file, "utf8"));
    const actual = createHash("sha256").update(sql, "utf8").digest("hex");

    if (actual !== definition.sha256) {
      throw new Error(`Migration file checksum verification failed: ${definition.id}`);
    }

    return { ...definition, sql };
  });
}
