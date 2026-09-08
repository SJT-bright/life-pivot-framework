import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { migrateDatabase } from "./migrate";
import * as schema from "./schema";

export interface AppDatabase {
  sqlite: Database.Database;
  orm: ReturnType<typeof drizzle<typeof schema>>;
  close: () => void;
}

export function openDatabase(databaseFile: string): AppDatabase {
  if (databaseFile !== ":memory:") {
    fs.mkdirSync(path.dirname(databaseFile), { recursive: true });
  }

  const sqlite = new Database(databaseFile);
  migrateDatabase(sqlite);

  return {
    sqlite,
    orm: drizzle(sqlite, { schema }),
    close: () => sqlite.close(),
  };
}
