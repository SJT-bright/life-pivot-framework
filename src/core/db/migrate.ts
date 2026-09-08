import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import { APPLICATION_VERSION } from "../application-version";

import { loadMigrations, type LoadedMigration } from "./migration-files";

const SEMVER_2_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*)|(?:\d*[A-Za-z-][0-9A-Za-z-]*))(?:\.(?:(?:0|[1-9]\d*)|(?:\d*[A-Za-z-][0-9A-Za-z-]*)))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const FOUNDATION_MIGRATION_ID = "0000_foundation";
const FOUNDATION_MIGRATION_CHECKSUM =
  "6fad9626ef61ee698cdae92fabf6bc0785f9b8d8c7db76b1e961bcd972380a7c";
const LEGACY_ADOPTION_MARKER = "migration_ledger_adopted_from_v1";
const REQUIRED_FOUNDATION_TABLES = [
  "app_meta",
  "life_areas",
  "metric_definitions",
  "metric_definition_versions",
  "metric_records",
  "daily_entries",
  "goals",
  "actions",
  "reviews",
  "knowledge_items",
  "audit_events",
  "idempotency_keys",
] as const;
const REQUIRED_CURRENT_FOUNDATION_TABLES = [
  "app_meta",
  "life_areas",
  "goals",
  "actions",
  "reviews",
  "audit_events",
  "idempotency_keys",
] as const;
const REQUIRED_CAPTURE_TABLES = ["capture_items"] as const;
const REQUIRED_DAILY_LOOP_TABLES = [
  "action_events",
  "knowledge_candidates",
  "knowledge_item_revisions",
  "knowledge_asset_events",
  "daily_summaries",
  "daily_summary_revisions",
  "review_revisions",
  "evidence_links",
] as const;
const REQUIRED_CURRENT_DAILY_LOOP_TABLES = [
  "action_events",
  "review_revisions",
] as const;
const REQUIRED_KNOWLEDGE_DOMAIN_TABLES = ["knowledge_domains"] as const;
export const REQUIRED_SKINCARE_TABLES = [
  "skincare_products",
  "skincare_formulations",
  "skincare_ingredients",
  "skincare_formulation_ingredients",
  "skincare_product_units",
  "skincare_ingredient_sensitivities",
  "skincare_formulation_conflicts",
  "skincare_tolerance_events",
  "skincare_plans",
  "skincare_plan_versions",
  "skincare_phases",
  "skincare_steps",
  "skincare_cycles",
  "skincare_safety_assessments",
  "skincare_plan_version_events",
  "skincare_usage_events",
  "skin_observation_events",
  "skincare_adverse_events",
  "skincare_adverse_usage_links",
] as const;
export const REQUIRED_SLEEP_TABLES = [
  "sleep_plans",
  "sleep_plan_versions",
  "sleep_plan_schedule_days",
  "sleep_sessions",
  "sleep_session_events",
  "sleep_awake_intervals",
  "sleep_checkins",
  "sleep_checkin_events",
] as const;
export const REQUIRED_EXERCISE_TABLES = [
  "exercise_movements", "exercise_movement_variants", "training_plans",
  "training_plan_versions", "training_workout_templates", "training_prescriptions",
  "strength_prescriptions", "cardio_prescriptions", "mobility_prescriptions",
  "training_cycles", "training_planned_occurrences", "training_sessions",
  "training_session_events", "strength_set_events", "cardio_segment_events",
  "mobility_hold_events", "training_recovery_observations",
  "training_recovery_observation_events",
] as const;
export const REQUIRED_PERSONAL_ACCUMULATION_TABLES = [
  "sleep_daily_records",
  "health_checklist_templates",
  "health_checklist_versions",
  "health_checklist_template_items",
  "health_checklist_days",
  "health_checklist_day_items",
  "personal_daily_notes",
] as const;
export const REQUIRED_MANUAL_EXERCISE_TABLES = [
  "manual_exercise_templates",
  "manual_exercise_template_versions",
  "manual_exercise_template_days",
  "manual_exercise_template_actions",
  "manual_exercise_cycle_state",
  "manual_exercise_days",
  "manual_exercise_day_actions",
  "manual_exercise_cycle_events",
] as const;
export const REQUIRED_MANUAL_EXERCISE_PROGRESS_TABLES = [
  "manual_exercise_progress_decisions",
] as const;
export const REQUIRED_MANUAL_SKINCARE_TABLES = [
  "manual_skincare_products",
  "manual_skincare_routine_versions",
  "manual_skincare_routine_items",
  "manual_skincare_routine_activations",
  "manual_skincare_days",
  "manual_skincare_day_items",
  "manual_skincare_recovery_plans",
  "manual_skincare_recovery_cycles",
] as const;
export const REQUIRED_PERSONAL_KNOWLEDGE_TABLES = [
  "knowledge_modules",
  "daily_learning_notes",
] as const;
export const REQUIRED_WEEKLY_REVIEW_PIN_TABLES = ["user_pins"] as const;
export const REQUIRED_READING_TABLES = [
  "reading_books",
  "reading_notes",
] as const;
export const REQUIRED_DAILY_READING_TABLES = ["reading_sessions"] as const;
export const REQUIRED_TODAY_REMINDER_TABLES = ["today_reminders"] as const;
const SCHEMA_VERSION_BY_APPLIED_MIGRATION_COUNT = [
  null,
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
  "20",
  "21",
  "22",
  "23",
  "24",
  "25",
] as const;

interface MigrateOptions {
  projectRoot?: string;
  now?: () => Date;
  applicationVersion?: string;
}

interface AppliedMigration {
  id: string;
  checksum: string;
  applicationVersion: string | null;
  appliedAt: string;
  hasLegacyAdoptionMarker: boolean;
}

interface LegacyAppliedMigration {
  id: string;
  appliedAt: string;
}

type LedgerState =
  | { kind: "missing" }
  | { kind: "legacy"; applied: readonly LegacyAppliedMigration[] }
  | { kind: "current"; applied: readonly AppliedMigration[] };

function tableExists(sqlite: Database.Database, tableName: string): boolean {
  return (
    sqlite
      .prepare("select 1 from sqlite_master where type = 'table' and name = ?")
      .get(tableName) !== undefined
  );
}

function tableHasColumn(
  sqlite: Database.Database,
  tableName: string,
  columnName: string,
): boolean {
  return sqlite
    .prepare("select 1 from pragma_table_info(?) where name = ?")
    .get(tableName, columnName) !== undefined;
}

function tableNames(sqlite: Database.Database): ReadonlySet<string> {
  const rows = sqlite
    .prepare("select name from sqlite_master where type = 'table'")
    .all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function hasRequiredFoundationTables(sqlite: Database.Database): boolean {
  const names = tableNames(sqlite);
  return REQUIRED_FOUNDATION_TABLES.every((name) => names.has(name));
}

function hasRequiredTables(
  sqlite: Database.Database,
  requiredTables: readonly string[],
): boolean {
  const names = tableNames(sqlite);
  return requiredTables.every((name) => names.has(name));
}

function hasAnyFoundationTable(sqlite: Database.Database): boolean {
  const names = tableNames(sqlite);
  return REQUIRED_FOUNDATION_TABLES.some((name) => names.has(name));
}

function hasLegacyAdoptionMarker(sqlite: Database.Database): boolean {
  if (!tableExists(sqlite, "app_meta")) {
    return false;
  }

  const marker = sqlite
    .prepare("select value from app_meta where key = ?")
    .pluck()
    .get(LEGACY_ADOPTION_MARKER);
  return marker === "true";
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid ${label} in migration ledger`);
  }
  return value;
}

function readLegacyAppliedMigrations(
  sqlite: Database.Database,
): readonly LegacyAppliedMigration[] {
  const rows = sqlite
    .prepare("select id, applied_at from schema_migrations order by rowid")
    .all() as Array<{ id: unknown; applied_at: unknown }>;

  return rows.map((row) => ({
    id: assertString(row.id, "migration id"),
    appliedAt: assertString(row.applied_at, "migration timestamp"),
  }));
}

function readAppliedMigrations(sqlite: Database.Database): readonly AppliedMigration[] {
  const markerPresent = hasLegacyAdoptionMarker(sqlite);
  const rows = sqlite
    .prepare(
      "select id, checksum, application_version, applied_at from schema_migrations order by rowid",
    )
    .all() as Array<{
    id: unknown;
    checksum: unknown;
    application_version: unknown;
    applied_at: unknown;
  }>;

  return rows.map((row) => {
    if (
      row.application_version !== null &&
      typeof row.application_version !== "string"
    ) {
      throw new Error("Invalid application version in migration ledger");
    }

    return {
      id: assertString(row.id, "migration id"),
      checksum: assertString(row.checksum, "migration checksum"),
      applicationVersion: row.application_version,
      appliedAt: assertString(row.applied_at, "migration timestamp"),
      hasLegacyAdoptionMarker: markerPresent,
    };
  });
}

interface LedgerColumn {
  name: string;
  notnull: number;
  pk: number;
  type: string;
}

function ledgerColumns(sqlite: Database.Database): readonly LedgerColumn[] {
  return sqlite.prepare("pragma table_info(schema_migrations)").all() as LedgerColumn[];
}

function hasColumns(sqlite: Database.Database, expectedColumns: readonly string[]): boolean {
  const columns = ledgerColumns(sqlite);
  return (
    columns.length === expectedColumns.length &&
    columns.every((column, index) => column.name === expectedColumns[index])
  );
}

function hasLegacyLedgerConstraints(sqlite: Database.Database): boolean {
  const columns = ledgerColumns(sqlite);
  const id = columns[0];
  const appliedAt = columns[1];

  return (
    hasColumns(sqlite, ["id", "applied_at"]) &&
    id?.type.toUpperCase() === "TEXT" &&
    id.notnull === 1 &&
    id.pk === 1 &&
    appliedAt?.type.toUpperCase() === "TEXT" &&
    appliedAt.notnull === 1 &&
    appliedAt.pk === 0
  );
}

function isCheckConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "SQLITE_CONSTRAINT_CHECK"
  );
}

function enforcesApplicationVersionCheck(sqlite: Database.Database): boolean {
  const probeToken = randomUUID().replaceAll("-", "");
  const savepoint = `migration_ledger_probe_${probeToken}`;
  const probeId = `migration-ledger-probe-${probeToken}`;
  const probeChecksum = `${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`;
  const probeAppliedAt = "1970-01-01T00:00:00.000Z";
  const insertProbe = sqlite.prepare(
    "insert into schema_migrations (id, checksum, application_version, applied_at) values (?, ?, ?, ?)",
  );

  sqlite.exec(`SAVEPOINT ${savepoint}`);
  try {
    insertProbe.run(probeId, probeChecksum, "1.2.3", probeAppliedAt);
    sqlite.prepare("delete from schema_migrations where id = ?").run(probeId);

    try {
      insertProbe.run(probeId, probeChecksum, null, probeAppliedAt);
      return false;
    } catch (error) {
      if (!isCheckConstraintViolation(error)) {
        throw error;
      }
      return true;
    }
  } finally {
    try {
      sqlite.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    } finally {
      sqlite.exec(`RELEASE SAVEPOINT ${savepoint}`);
    }
  }
}

function hasCurrentLedgerConstraints(sqlite: Database.Database): boolean {
  const columns = ledgerColumns(sqlite);
  const id = columns[0];
  const checksum = columns[1];
  const applicationVersion = columns[2];
  const appliedAt = columns[3];

  return (
    hasColumns(sqlite, ["id", "checksum", "application_version", "applied_at"]) &&
    id?.type.toUpperCase() === "TEXT" &&
    id.notnull === 1 &&
    id.pk === 1 &&
    checksum?.type.toUpperCase() === "TEXT" &&
    checksum.notnull === 1 &&
    checksum.pk === 0 &&
    applicationVersion?.type.toUpperCase() === "TEXT" &&
    applicationVersion.notnull === 0 &&
    applicationVersion.pk === 0 &&
    appliedAt?.type.toUpperCase() === "TEXT" &&
    appliedAt.notnull === 1 &&
    appliedAt.pk === 0 &&
    enforcesApplicationVersionCheck(sqlite)
  );
}

function inspectLedger(sqlite: Database.Database): LedgerState {
  if (!tableExists(sqlite, "schema_migrations")) {
    return { kind: "missing" };
  }

  if (hasLegacyLedgerConstraints(sqlite)) {
    return { kind: "legacy", applied: readLegacyAppliedMigrations(sqlite) };
  }

  if (hasCurrentLedgerConstraints(sqlite)) {
    return { kind: "current", applied: readAppliedMigrations(sqlite) };
  }

  throw new Error("Unsupported schema_migrations ledger shape");
}

function createCurrentLedger(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE schema_migrations (
      id TEXT PRIMARY KEY NOT NULL,
      checksum TEXT NOT NULL,
      application_version TEXT,
      applied_at TEXT NOT NULL,
      CHECK (application_version IS NOT NULL OR id = '0000_foundation')
    )
  `);
}

function assertLegacyLedgerCanBeAdopted(
  sqlite: Database.Database,
  legacy: readonly LegacyAppliedMigration[],
  migrations: readonly LoadedMigration[],
): LoadedMigration {
  const foundation = migrations[0];
  if (
    !foundation ||
    foundation.id !== FOUNDATION_MIGRATION_ID ||
    foundation.sha256 !== FOUNDATION_MIGRATION_CHECKSUM
  ) {
    throw new Error("The released foundation migration is not available for adoption");
  }

  if (legacy.length !== 1 || legacy[0]?.id !== FOUNDATION_MIGRATION_ID) {
    throw new Error("Legacy migration ledger is not a foundation-only ledger");
  }

  if (!hasRequiredFoundationTables(sqlite)) {
    throw new Error("Legacy migration ledger does not match the foundation schema");
  }

  const schemaVersion = sqlite
    .prepare("select value from app_meta where key = ?")
    .pluck()
    .get("schema_version");
  if (schemaVersion !== "1") {
    throw new Error("Legacy migration ledger has an unsupported schema version");
  }

  return foundation;
}

function adoptLegacyLedger(
  sqlite: Database.Database,
  migrations: readonly LoadedMigration[],
): void {
  const state = inspectLedger(sqlite);
  if (state.kind !== "legacy") {
    throw new Error("Migration ledger changed before legacy adoption");
  }

  const foundation = assertLegacyLedgerCanBeAdopted(
    sqlite,
    state.applied,
    migrations,
  );
  const [legacyFoundation] = state.applied;
  if (!legacyFoundation) {
    throw new Error("Legacy foundation migration is missing");
  }

  sqlite.exec("DROP TABLE schema_migrations");
  createCurrentLedger(sqlite);
  sqlite
    .prepare(
      "insert into schema_migrations (id, checksum, application_version, applied_at) values (?, ?, ?, ?)",
    )
    .run(foundation.id, foundation.sha256, null, legacyFoundation.appliedAt);
  sqlite
    .prepare(
      "insert into app_meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value",
    )
    .run(LEGACY_ADOPTION_MARKER, "true");
}

function validateAppliedPrefix(
  applied: readonly AppliedMigration[],
  migrations: readonly LoadedMigration[],
): number {
  if (applied.length > migrations.length) {
    throw new Error("Migration ledger contains extra applied migrations");
  }

  const seenIds = new Set<string>();
  for (const [index, actual] of applied.entries()) {
    const expected = migrations[index];
    if (!expected || !seenIds.add(actual.id)) {
      throw new Error("Migration ledger contains an unknown or duplicate migration");
    }

    if (actual.id !== expected.id) {
      throw new Error("Migration ledger is not a continuous manifest prefix");
    }

    if (actual.checksum !== expected.sha256) {
      throw new Error(`Migration checksum mismatch: ${actual.id}`);
    }

    if (actual.applicationVersion === null) {
      if (
        actual.id !== FOUNDATION_MIGRATION_ID ||
        !actual.hasLegacyAdoptionMarker
      ) {
        throw new Error("Migration ledger has an unproven null application version");
      }
      continue;
    }

    if (!SEMVER_2_PATTERN.test(actual.applicationVersion)) {
      throw new Error("Migration ledger contains an invalid application version");
    }
  }

  return applied.length;
}

const LEGACY_TABLES_DROPPED_AT_COUNT = 18;

function hasLegacyDomains(appliedCount: number): boolean {
  return appliedCount < LEGACY_TABLES_DROPPED_AT_COUNT;
}

function assertAppliedSchema(
  sqlite: Database.Database,
  appliedCount: number,
): void {
  if (
    appliedCount > 0 &&
    !hasRequiredTables(
      sqlite,
      hasLegacyDomains(appliedCount)
        ? REQUIRED_FOUNDATION_TABLES
        : REQUIRED_CURRENT_FOUNDATION_TABLES,
    )
  ) {
    throw new Error("Migration ledger records a missing foundation schema");
  }

  if (appliedCount === 0 && hasAnyFoundationTable(sqlite)) {
    throw new Error("Cannot apply the foundation migration over an existing schema");
  }

  if (appliedCount >= 2 && !hasRequiredTables(sqlite, REQUIRED_CAPTURE_TABLES)) {
    throw new Error("Migration ledger records a missing capture schema");
  }

  if (
    appliedCount >= 3 &&
    !hasRequiredTables(
      sqlite,
      hasLegacyDomains(appliedCount)
        ? REQUIRED_DAILY_LOOP_TABLES
        : REQUIRED_CURRENT_DAILY_LOOP_TABLES,
    )
  ) {
    throw new Error("Migration ledger records a missing daily-loop schema");
  }

  if (
    appliedCount >= 5 &&
    hasLegacyDomains(appliedCount) &&
    !hasRequiredTables(sqlite, REQUIRED_KNOWLEDGE_DOMAIN_TABLES)
  ) {
    throw new Error("Migration ledger records a missing knowledge-domain schema");
  }

  if (
    appliedCount >= 6 &&
    hasLegacyDomains(appliedCount) &&
    !hasRequiredTables(sqlite, REQUIRED_SKINCARE_TABLES)
  ) {
    throw new Error("Migration ledger records a missing skincare schema");
  }

  if (
    appliedCount >= 8 &&
    hasLegacyDomains(appliedCount) &&
    !hasRequiredTables(sqlite, REQUIRED_SLEEP_TABLES)
  ) {
    throw new Error("Migration ledger records a missing Sleep schema");
  }
  if (
    appliedCount >= 9 &&
    hasLegacyDomains(appliedCount) &&
    !hasRequiredTables(sqlite, REQUIRED_EXERCISE_TABLES)
  ) {
    throw new Error("Migration ledger records a missing Exercise schema");
  }
  if (
    appliedCount >= 10 &&
    !hasRequiredTables(sqlite, REQUIRED_PERSONAL_ACCUMULATION_TABLES)
  ) {
    throw new Error("Migration ledger records a missing personal accumulation schema");
  }
  if (
    appliedCount >= 11 &&
    !hasRequiredTables(sqlite, REQUIRED_MANUAL_EXERCISE_TABLES)
  ) {
    throw new Error("Migration ledger records a missing manual exercise schema");
  }
  if (
    appliedCount >= 12 &&
    !hasRequiredTables(sqlite, REQUIRED_MANUAL_SKINCARE_TABLES)
  ) {
    throw new Error("Migration ledger records a missing manual skincare schema");
  }
  if (
    appliedCount >= 13 &&
    !hasRequiredTables(sqlite, REQUIRED_PERSONAL_KNOWLEDGE_TABLES)
  ) {
    throw new Error("Migration ledger records a missing personal knowledge schema");
  }
  if (
    appliedCount >= 14 &&
    !hasRequiredTables(sqlite, REQUIRED_WEEKLY_REVIEW_PIN_TABLES)
  ) {
    throw new Error("Migration ledger records a missing weekly review pin schema");
  }
  if (appliedCount >= 15 && !hasRequiredTables(sqlite, REQUIRED_READING_TABLES)) {
    throw new Error("Migration ledger records a missing reading schema");
  }
  if (
    appliedCount >= 16 &&
    !hasRequiredTables(sqlite, REQUIRED_DAILY_READING_TABLES)
  ) {
    throw new Error("Migration ledger records a missing daily reading schema");
  }
  if (
    appliedCount >= 17 &&
    !hasRequiredTables(sqlite, REQUIRED_MANUAL_EXERCISE_PROGRESS_TABLES)
  ) {
    throw new Error("Migration ledger records a missing manual exercise progress schema");
  }
  if (
    appliedCount >= 19 &&
    !hasRequiredTables(sqlite, REQUIRED_TODAY_REMINDER_TABLES)
  ) {
    throw new Error("Migration ledger records a missing today reminder schema");
  }
  if (
    appliedCount >= 21 &&
    (
      !tableHasColumn(sqlite, "manual_skincare_products", "photo_blob") ||
      !tableHasColumn(sqlite, "manual_skincare_products", "photo_mime")
    )
  ) {
    throw new Error("Migration ledger records a missing manual skincare photo schema");
  }
  if (
    appliedCount >= 22 &&
    !tableHasColumn(sqlite, "sleep_daily_records", "manual_quality_score")
  ) {
    throw new Error("Migration ledger records a missing manual sleep quality score schema");
  }
  if (appliedCount >= 25 && (
    !hasRequiredTables(sqlite, ["manual_exercise_day_resolutions"])
    || !tableHasColumn(sqlite, "manual_exercise_days", "manual_duration_minutes")
  )) {
    throw new Error("Migration ledger records a missing exercise day resolution schema");
  }
}

function assertAppliedSchemaVersion(
  sqlite: Database.Database,
  appliedCount: number,
): void {
  if (appliedCount === 0) return;

  const expectedVersion = SCHEMA_VERSION_BY_APPLIED_MIGRATION_COUNT[appliedCount];
  if (expectedVersion === undefined) {
    throw new Error("Migration manifest has no schema version mapping");
  }

  const actualVersion = sqlite
    .prepare("select value from app_meta where key = ?")
    .pluck()
    .get("schema_version");
  if (actualVersion !== expectedVersion) {
    throw new Error("Migration ledger schema version mismatch");
  }
}

export function migrateDatabase(
  sqlite: Database.Database,
  options: MigrateOptions = {},
): void {
  const migrations = loadMigrations(options.projectRoot);
  const now = options.now ?? (() => new Date());
  const applicationVersion = options.applicationVersion ?? APPLICATION_VERSION;
  if (!SEMVER_2_PATTERN.test(applicationVersion)) {
    throw new Error("Application version format is invalid");
  }

  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("recursive_triggers = ON");
  sqlite.pragma("busy_timeout = 5000");

  const applyPending = sqlite.transaction(() => {
    let ledger = inspectLedger(sqlite);
    if (ledger.kind === "legacy") {
      adoptLegacyLedger(sqlite, migrations);
      ledger = inspectLedger(sqlite);
    }

    if (ledger.kind === "missing" && hasAnyFoundationTable(sqlite)) {
      throw new Error("Migration ledger is missing for an existing foundation schema");
    }

    const applied = ledger.kind === "current" ? ledger.applied : [];
    const startIndex = validateAppliedPrefix(applied, migrations);
    assertAppliedSchema(sqlite, startIndex);
    assertAppliedSchemaVersion(sqlite, startIndex);

    if (ledger.kind === "missing") {
      createCurrentLedger(sqlite);
    }

    for (const migration of migrations.slice(startIndex)) {
      sqlite.exec(migration.sql);
      sqlite
        .prepare(
          "insert into schema_migrations (id, checksum, application_version, applied_at) values (?, ?, ?, ?)",
        )
        .run(
          migration.id,
          migration.sha256,
          applicationVersion,
          now().toISOString(),
        );
    }

    assertAppliedSchema(sqlite, migrations.length);
    assertAppliedSchemaVersion(sqlite, migrations.length);
  });

  applyPending.immediate();
}
