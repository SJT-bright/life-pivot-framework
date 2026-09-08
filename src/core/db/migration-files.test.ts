import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { sql } from "drizzle-orm";
import {
  getTableConfig,
  type SQLiteTable,
  SQLiteSyncDialect,
} from "drizzle-orm/sqlite-core";
import { afterEach, describe, expect, it } from "vitest";

import {
  loadMigrations,
  resolveFoundationMigrationPath,
} from "./migration-files";
import { migrationManifest } from "./migration-manifest";
import * as databaseSchema from "./schema";


const REQUIRED_PERSONAL_ACCUMULATION_EXPORTS = [
  "sleepDailyRecords",
  "healthChecklistTemplates",
  "healthChecklistVersions",
  "healthChecklistTemplateItems",
  "healthChecklistDays",
  "healthChecklistDayItems",
  "personalDailyNotes",
] as const;

const REQUIRED_MANUAL_EXERCISE_EXPORTS = [
  "manualExerciseTemplates",
  "manualExerciseTemplateVersions",
  "manualExerciseTemplateDays",
  "manualExerciseTemplateActions",
  "manualExerciseCycleState",
  "manualExerciseDays",
  "manualExerciseDayActions",
  "manualExerciseCycleEvents",
  "manualExerciseProgressDecisions",
] as const;

const REQUIRED_MANUAL_SKINCARE_EXPORTS = [
  "manualSkincareProducts",
  "manualSkincareRoutineVersions",
  "manualSkincareRoutineItems",
  "manualSkincareRoutineActivations",
  "manualSkincareDays",
  "manualSkincareDayItems",
  "manualSkincareRecoveryPlans",
  "manualSkincareRecoveryCycles",
] as const;

const REQUIRED_PERSONAL_KNOWLEDGE_EXPORTS = [
  "knowledgeModules",
  "dailyLearningNotes",
] as const;

const WEEKLY_REVIEW_PIN_TARGET_TYPES = [
  "knowledge-module",
  "knowledge-item",
  "exercise-template",
  "skincare-plan",
  "health-template",
] as const;

const temporaryDirectories: string[] = [];

function createMigrationProject(sql: string): string {
  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "life-pivot-migration-files-"),
  );
  temporaryDirectories.push(projectRoot);
  const migrationDirectory = path.join(projectRoot, "drizzle");
  fs.mkdirSync(migrationDirectory);
  fs.writeFileSync(path.join(migrationDirectory, "0000_foundation.sql"), sql, "utf8");
  for (const migration of migrationManifest.slice(1)) {
    fs.copyFileSync(
      path.join(process.cwd(), "drizzle", migration.filename),
      path.join(migrationDirectory, migration.filename),
    );
  }
  return projectRoot;
}

function loadFoundationSql(): string {
  const [foundation] = loadMigrations(process.cwd());
  if (!foundation) throw new Error("foundation migration missing");
  return foundation.sql;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop()!, { force: true, recursive: true });
  }
});

describe("daily reading migration contract", () => {
  it("registers the v16 reading sessions migration and Drizzle mirror", () => {
    expect(migrationManifest.find((migration) => migration.id === "0015_reading_sessions")).toMatchObject({
      id: "0015_reading_sessions",
      filename: "0015_reading_sessions.sql",
    });
    expect(databaseSchema.readingSessions).toBeDefined();
  });
});

describe("manual exercise progress migration contract", () => {
  it("registers the v17 progress migration and Drizzle mirror", () => {
    expect(migrationManifest.find((migration) => migration.id === "0016_manual_exercise_progress")).toMatchObject({
      id: "0016_manual_exercise_progress",
      filename: "0016_manual_exercise_progress.sql",
    });
    expect(databaseSchema.manualExerciseProgressDecisions).toBeDefined();
  });

  it("registers the v18 legacy drop migration", () => {
    expect(migrationManifest.find((migration) => migration.id === "0017_drop_legacy_tables")).toMatchObject({
      id: "0017_drop_legacy_tables",
      filename: "0017_drop_legacy_tables.sql",
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    const dropSql = fs.readFileSync(
      path.join(process.cwd(), "drizzle", "0017_drop_legacy_tables.sql"),
      "utf8",
    );
    expect(dropSql).toContain("DROP TABLE IF EXISTS knowledge_items");
    expect(dropSql).toContain("DROP TABLE IF EXISTS training_sessions");
    expect(dropSql).toContain("DROP TABLE IF EXISTS skincare_products");
    expect(dropSql).toContain("DROP TABLE IF EXISTS sleep_plans");
    expect(dropSql).toContain("DROP TABLE IF EXISTS metric_records");
    expect(dropSql).toContain("DROP TABLE IF EXISTS knowledge_item_organization");
    expect(dropSql).toContain("UPDATE app_meta SET value = '18'");
  });

  it("keeps v19 reminders and v20 sleep inputs, then registers v21 product photos", () => {
    expect(migrationManifest.find((migration) => migration.id === "0018_today_reminders")).toMatchObject({
      id: "0018_today_reminders",
      filename: "0018_today_reminders.sql",
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(migrationManifest.find((migration) => migration.id === "0019_sleep_wellness_inputs"))
      .toMatchObject({
      id: "0019_sleep_wellness_inputs",
      filename: "0019_sleep_wellness_inputs.sql",
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(migrationManifest.at(-1)).toMatchObject({
      id: "0024_manual_exercise_day_resolution",
      filename: "0024_manual_exercise_day_resolution.sql",
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(loadMigrations(process.cwd()).at(-1)?.id).toBe("0024_manual_exercise_day_resolution");
    expect(databaseSchema.manualExerciseDayResolutions).toBeDefined();
    expect(databaseSchema.manualExerciseDays.manualDurationMinutes).toBeDefined();
    expect(databaseSchema.todayReminders).toBeDefined();
    expect(databaseSchema.sleepDailyRecords.deepSleepMinutes).toBeDefined();
    expect(databaseSchema.sleepDailyRecords.lightSleepMinutes).toBeDefined();
    expect(databaseSchema.sleepDailyRecords.remSleepMinutes).toBeDefined();
    expect(databaseSchema.sleepDailyRecords.morningFeeling).toBeDefined();
    expect(databaseSchema.sleepDailyRecords.manualQualityScore).toBeDefined();
    expect(databaseSchema.manualSkincareProducts.photoBlob).toBeDefined();
    expect(databaseSchema.manualSkincareProducts.photoMime).toBeDefined();
  });
});

describe("resolveFoundationMigrationPath", () => {
  it("keeps the v14 weekly-review pin migration, manifest, and Drizzle authority aligned", () => {
    expect(migrationManifest.find((migration) => migration.id === "0013_weekly_review_pins")).toMatchObject({
      id: "0013_weekly_review_pins",
      filename: "0013_weekly_review_pins.sql",
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(loadMigrations(process.cwd()).find((migration) => migration.id === "0013_weekly_review_pins")?.id).toBe(
      "0013_weekly_review_pins",
    );

    const pins = databaseSchema.userPins;
    expect(pins).toBeDefined();
    const config = getTableConfig(pins);
    expect(config.name).toBe("user_pins");
    expect(config.indexes.map((item) => item.config.name)).toContain(
      "user_pins_order_idx",
    );
    expect(config.primaryKeys).toHaveLength(1);
    expect(config.primaryKeys[0]?.columns.map((column) => column.name)).toEqual([
      "target_type",
      "target_id",
    ]);
    expect(config.checks.map((item) => item.name)).toEqual(
      expect.arrayContaining([
        "user_pins_target_type_valid",
        "user_pins_target_id_length",
      ]),
    );
    expect(WEEKLY_REVIEW_PIN_TARGET_TYPES).toHaveLength(5);
  });

  it("keeps the v13 personal-knowledge migration, manifest, and three Drizzle authorities aligned", () => {
    expect(migrationManifest.find((migration) => migration.id === "0012_personal_knowledge_foundation")).toMatchObject({
      id: "0012_personal_knowledge_foundation",
      filename: "0012_personal_knowledge_foundation.sql",
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(loadMigrations(process.cwd()).find((migration) => migration.id === "0012_personal_knowledge_foundation")?.id).toBe(
      "0012_personal_knowledge_foundation",
    );
    for (const exportName of REQUIRED_PERSONAL_KNOWLEDGE_EXPORTS) {
      expect(
        Reflect.get(databaseSchema, exportName),
        `missing Drizzle export: ${exportName}`,
      ).toBeDefined();
    }
  });

  it("keeps the v12 manual-skincare migration, manifest, and eight Drizzle authorities aligned", () => {
    const definition = migrationManifest.find(
      (migration) => migration.id === "0011_manual_skincare_records",
    );
    expect(definition).toMatchObject({
      id: "0011_manual_skincare_records",
      filename: "0011_manual_skincare_records.sql",
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(loadMigrations(process.cwd())).toContainEqual(
      expect.objectContaining(definition),
    );
    for (const exportName of REQUIRED_MANUAL_SKINCARE_EXPORTS) {
      expect(
        Reflect.get(databaseSchema, exportName),
        `missing Drizzle export: ${exportName}`,
      ).toBeDefined();
    }
  });

  it("keeps the v11 manual-exercise migration, manifest, and eight Drizzle authorities aligned", () => {
    const definition = migrationManifest.find(
      (migration) => migration.id === "0010_manual_exercise_records",
    );
    expect(definition).toMatchObject({
      id: "0010_manual_exercise_records",
      filename: "0010_manual_exercise_records.sql",
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(loadMigrations(process.cwd())).toContainEqual(expect.objectContaining(definition));
    for (const exportName of REQUIRED_MANUAL_EXERCISE_EXPORTS) {
      expect(
        Reflect.get(databaseSchema, exportName),
        `missing Drizzle export: ${exportName}`,
      ).toBeDefined();
    }
  });

  it("keeps the v10 personal-accumulation migration, manifest, and seven Drizzle authorities aligned", () => {
    const definition = migrationManifest.find(
      (migration) => migration.id === "0009_personal_accumulation_foundation",
    );
    expect(definition).toMatchObject({
      id: "0009_personal_accumulation_foundation",
      filename: "0009_personal_accumulation_foundation.sql",
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(loadMigrations(process.cwd())).toContainEqual(
      expect.objectContaining(definition),
    );
    for (const exportName of REQUIRED_PERSONAL_ACCUMULATION_EXPORTS) {
      expect(
        Reflect.get(databaseSchema, exportName),
        `missing Drizzle export: ${exportName}`,
      ).toBeDefined();
    }
  });

  it("resolves from the application root instead of a bundled asset URL", () => {
    expect(resolveFoundationMigrationPath("D:\\life-pivot-app")).toBe(
      path.win32.join("D:\\life-pivot-app", "drizzle", "0000_foundation.sql"),
    );
  });

  it("preserves an absolute POSIX application root", () => {
    const projectRoot = "/Users/friend/个人成长系统";

    expect(resolveFoundationMigrationPath(projectRoot)).toBe(
      path.posix.join(projectRoot, "drizzle", "0000_foundation.sql"),
    );
  });

  it("loads the ordered manifest and verifies normalized SQL checksums", () => {
    const migrations = loadMigrations(process.cwd());
    const [migration] = migrations;

    expect(migration).toMatchObject({
      id: "0000_foundation",
      filename: "0000_foundation.sql",
      sha256: "6fad9626ef61ee698cdae92fabf6bc0785f9b8d8c7db76b1e961bcd972380a7c",
    });
    expect(migration?.sql).toMatch(/\n$/);
    expect(migrations.map((item) => item.id)).toEqual([
      "0000_foundation",
      "0001_trusted_today_capture",
      "0002_daily_closed_loop",
      "0003_knowledge_candidates_many",
      "0004_knowledge_domains",
      "0005_skincare_domain",
      "0006_skincare_plan_interval",
      "0007_sleep_domain",
      "0008_exercise_domain",
      "0009_personal_accumulation_foundation",
      "0010_manual_exercise_records",
      "0011_manual_skincare_records",
      "0012_personal_knowledge_foundation",
      "0013_weekly_review_pins",
      "0014_reading_domain",
      "0015_reading_sessions",
      "0016_manual_exercise_progress",
      "0017_drop_legacy_tables",
      "0018_today_reminders",
      "0019_sleep_wellness_inputs",
      "0020_manual_skincare_product_photos",
      "0021_manual_sleep_quality_score",
      "0022_wisdom_reminders",
      "0023_awake_sleep_tracking",
      "0024_manual_exercise_day_resolution",
    ]);
  });






  it("rejects a migration file whose normalized SQL was tampered with", () => {
    const projectRoot = createMigrationProject(`${loadFoundationSql()}-- tampered\n`);

    expect(() => loadMigrations(projectRoot)).toThrow(/checksum/i);
  });

  it("rejects a tampered daily-loop migration instead of validating only the foundation", () => {
    const projectRoot = createMigrationProject(loadFoundationSql());
    const dailyLoopMigration = migrationManifest.find(
      (migration) => migration.id === "0002_daily_closed_loop",
    );
    if (!dailyLoopMigration) throw new Error("daily-loop migration missing");
    fs.appendFileSync(
      path.join(projectRoot, "drizzle", dailyLoopMigration.filename),
      "-- tampered daily-loop migration\n",
      "utf8",
    );

    expect(() => loadMigrations(projectRoot)).toThrow(/0002_daily_closed_loop/);
  });

  it("rejects a tampered v4 candidate migration", () => {
    const projectRoot = createMigrationProject(loadFoundationSql());
    const candidateMigration = migrationManifest.find(
      (migration) => migration.id === "0003_knowledge_candidates_many",
    );
    if (!candidateMigration) throw new Error("v4 candidate migration missing");
    fs.appendFileSync(
      path.join(projectRoot, "drizzle", candidateMigration.filename),
      "-- tampered v4 candidate migration\n",
      "utf8",
    );

    expect(() => loadMigrations(projectRoot)).toThrow(/0003_knowledge_candidates_many/);
  });

  it("rejects a tampered skincare migration", () => {
    const projectRoot = createMigrationProject(loadFoundationSql());
    const migration = migrationManifest.find(
      (item) => item.id === "0005_skincare_domain",
    );
    if (!migration) throw new Error("skincare migration missing");
    fs.appendFileSync(
      path.join(projectRoot, "drizzle", migration.filename),
      "-- tampered skincare migration\n",
      "utf8",
    );

    expect(() => loadMigrations(projectRoot)).toThrow(/0005_skincare_domain/);
  });

  it("rejects a tampered v7 plan-interval migration", () => {
    const projectRoot = createMigrationProject(loadFoundationSql());
    const migration = migrationManifest.find(
      (item) => item.id === "0006_skincare_plan_interval",
    );
    if (!migration) throw new Error("v7 plan-interval migration missing");
    fs.appendFileSync(
      path.join(projectRoot, "drizzle", migration.filename),
      "-- tampered v7 plan-interval migration\n",
      "utf8",
    );

    expect(() => loadMigrations(projectRoot)).toThrow(/0006_skincare_plan_interval/);
  });

  it("normalizes CRLF SQL without a final newline before verifying its checksum", () => {
    const normalizedSql = loadFoundationSql();
    const projectRoot = createMigrationProject(
      normalizedSql.replace(/\n/g, "\r\n").replace(/\r\n$/, ""),
    );

    const [migration] = loadMigrations(projectRoot);

    expect(migration?.sql).toBe(normalizedSql);
    expect(migration?.sha256).toBe(
      "6fad9626ef61ee698cdae92fabf6bc0785f9b8d8c7db76b1e961bcd972380a7c",
    );
  });
});
