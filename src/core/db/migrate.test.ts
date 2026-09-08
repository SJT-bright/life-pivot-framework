import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { loadMigrations } from "./migration-files";
import { migrationManifest } from "./migration-manifest";
import { migrateDatabase } from "./migrate";

const databases: Database.Database[] = [];
const temporaryDirectories: string[] = [];

const REQUIRED_SKINCARE_TABLES = [
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

const REQUIRED_SKINCARE_INDEXES = [
  "skincare_products_status_name_idx",
  "skincare_formulations_product_version_unique",
  "skincare_formulations_one_draft_per_product",
  "skincare_ingredients_normalized_name_unique",
  "skincare_formulation_ingredients_order_unique",
  "skincare_product_units_status_product_idx",
  "skincare_product_units_expiry_idx",
  "skincare_ingredient_sensitivities_active_unique",
  "skincare_formulation_conflicts_pair_unique",
  "skincare_tolerance_events_formulation_date_idx",
  "skincare_plans_status_updated_idx",
  "skincare_plan_versions_plan_version_unique",
  "skincare_plan_versions_effective_idx",
  "skincare_phases_version_range_idx",
  "skincare_steps_phase_slot_order_unique",
  "skincare_cycles_one_active",
  "skincare_safety_assessments_version_time_idx",
  "skincare_plan_version_events_version_time_idx",
  "skincare_usage_events_date_slot_time_idx",
  "skincare_usage_events_step_date_idx",
  "skin_observation_events_date_time_idx",
  "skincare_adverse_events_status_date_idx",
  "skincare_adverse_usage_links_case_usage_idx",
] as const;

const REQUIRED_SLEEP_TABLES = [
  "sleep_plans",
  "sleep_plan_versions",
  "sleep_plan_schedule_days",
  "sleep_sessions",
  "sleep_session_events",
  "sleep_awake_intervals",
  "sleep_checkins",
  "sleep_checkin_events",
] as const;

const REQUIRED_SLEEP_INDEXES = [
  "sleep_plan_versions_effective_idx",
  "sleep_plan_schedule_day_unique",
  "sleep_session_events_date_idx",
  "sleep_session_events_session_idx",
  "sleep_session_events_supersedes_unique",
  "sleep_awake_intervals_event_ordinal_unique",
  "sleep_checkins_date_unique",
  "sleep_checkin_events_checkin_idx",
  "sleep_checkin_events_supersedes_unique",
] as const;

const REQUIRED_PERSONAL_ACCUMULATION_TABLES = [
  "sleep_daily_records",
  "health_checklist_templates",
  "health_checklist_versions",
  "health_checklist_template_items",
  "health_checklist_days",
  "health_checklist_day_items",
  "personal_daily_notes",
] as const;

const REQUIRED_MANUAL_EXERCISE_TABLES = [
  "manual_exercise_templates",
  "manual_exercise_template_versions",
  "manual_exercise_template_days",
  "manual_exercise_template_actions",
  "manual_exercise_cycle_state",
  "manual_exercise_days",
  "manual_exercise_day_actions",
  "manual_exercise_cycle_events",
] as const;
const REQUIRED_MANUAL_EXERCISE_PROGRESS_TABLES = [
  "manual_exercise_progress_decisions",
] as const;

const REQUIRED_MANUAL_SKINCARE_TABLES = [
  "manual_skincare_products",
  "manual_skincare_routine_versions",
  "manual_skincare_routine_items",
  "manual_skincare_routine_activations",
  "manual_skincare_days",
  "manual_skincare_day_items",
  "manual_skincare_recovery_plans",
  "manual_skincare_recovery_cycles",
] as const;

const REQUIRED_PERSONAL_KNOWLEDGE_TABLES = [
  "knowledge_modules",
  "daily_learning_notes",
] as const;

const REQUIRED_PERSONAL_KNOWLEDGE_INDEXES = [
  "knowledge_modules_parent_order_idx",
  "knowledge_modules_status_order_idx",
  "knowledge_modules_active_sibling_name_unique",
  "daily_learning_notes_date_idx",
  "daily_learning_notes_module_date_idx",
] as const;

const APPEND_ONLY_SKINCARE_TABLES = [
  ["skincare_tolerance_events", "tolerance-recorded"],
  ["skincare_safety_assessments", "assessment-recorded"],
  ["skincare_plan_version_events", "plan-event-recorded"],
  ["skincare_usage_events", "usage-recorded"],
  ["skin_observation_events", "observation-recorded"],
  ["skincare_adverse_events", "adverse-recorded"],
  ["skincare_adverse_usage_links", "adverse-link-recorded"],
] as const;

const ISO_TIMESTAMP = "2026-08-11T00:00:00.000Z";
const SHA256 = "a".repeat(64);

function createDatabase(): Database.Database {
  const sqlite = new Database(":memory:");
  databases.push(sqlite);
  return sqlite;
}

function createDatabasePair(): [Database.Database, Database.Database] {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "life-pivot-migrate-"));
  temporaryDirectories.push(directory);
  const databasePath = path.join(directory, "migration.db");
  const first = new Database(databasePath);
  const second = new Database(databasePath);
  databases.push(first, second);
  return [first, second];
}

function createLegacyFoundationDatabase(
  ledgerDefinition = `create table schema_migrations (
    id text primary key not null,
    applied_at text not null
  )`,
): Database.Database {
  const sqlite = createDatabase();
  const [foundation] = loadMigrations(process.cwd());
  if (!foundation) throw new Error("foundation migration missing");

  sqlite.exec(foundation.sql);
  sqlite.exec(ledgerDefinition);
  sqlite
    .prepare("insert into schema_migrations (id, applied_at) values (?, ?)")
    .run("0000_foundation", "2026-08-09T00:00:00.000Z");
  return sqlite;
}

function createMigratedFoundationDatabase(): Database.Database {
  const sqlite = createDatabase();
  migrateDatabase(sqlite, {
    applicationVersion: "0.1.0",
    now: () => new Date("2026-08-10T00:00:00.000Z"),
  });
  return sqlite;
}

function createCurrentDatabaseAtPrefix(appliedCount: number): Database.Database {
  const sqlite = createDatabase();
  sqlite.pragma("foreign_keys = ON");
  createChecksumLedger(sqlite);
  for (const migration of loadMigrations(process.cwd()).slice(0, appliedCount)) {
    sqlite.exec(migration.sql);
    sqlite
      .prepare(
        `insert into schema_migrations
          (id, checksum, application_version, applied_at) values (?, ?, ?, ?)`,
      )
      .run(
        migration.id,
        migration.sha256,
        "0.1.0",
        "2026-08-10T00:00:00.000Z",
      );
  }
  return sqlite;
}

function createVersionTwoDatabase(): Database.Database {
  return createCurrentDatabaseAtPrefix(2);
}

function createVersionThreeDatabase(): Database.Database {
  return createCurrentDatabaseAtPrefix(3);
}

function createVersionFourDatabase(): Database.Database {
  return createCurrentDatabaseAtPrefix(4);
}

function createChecksumLedger(sqlite: Database.Database): void {
  sqlite.exec(`create table schema_migrations (
    id text primary key not null,
    checksum text not null,
    application_version text,
    applied_at text not null,
    check (application_version is not null or id = '0000_foundation')
  )`);
}

function insertAppliedMigration(sqlite: Database.Database, id: string): void {
  const definition = migrationManifest.find((item) => item.id === id);
  if (!definition) throw new Error(`unknown fixture migration: ${id}`);

  sqlite
    .prepare(
      `insert into schema_migrations
        (id, checksum, application_version, applied_at) values (?, ?, ?, ?)`,
    )
    .run(id, definition.sha256, "0.1.0", "2026-08-10T00:00:00.000Z");
}

function tableExists(sqlite: Database.Database, name: string): boolean {
  return (
    sqlite
      .prepare("select 1 from sqlite_master where type = 'table' and name = ?")
      .get(name) !== undefined
  );
}

function schemaSnapshot(sqlite: Database.Database): string {
  return JSON.stringify(
    sqlite
      .prepare("select type, name, tbl_name, rootpage, sql from sqlite_master order by type, name")
      .all(),
  );
}

function ledgerSnapshot(sqlite: Database.Database): string {
  return JSON.stringify(
    sqlite
      .prepare(
        "select id, checksum, application_version, applied_at from schema_migrations order by rowid",
      )
      .all(),
  );
}

function appMetaSnapshot(sqlite: Database.Database): string {
  return JSON.stringify(
    sqlite.prepare("select key, value from app_meta order by key").all(),
  );
}

function indexExists(sqlite: Database.Database, name: string): boolean {
  return (
    sqlite
      .prepare("select 1 from sqlite_master where type = 'index' and name = ?")
      .get(name) !== undefined
  );
}

function assertV7AuthorityBoundary(sqlite: Database.Database): void {
  expect(
    sqlite.prepare("select value from app_meta where key = 'schema_version'").pluck().get(),
  ).toBe("17");
  expect(
    sqlite
      .prepare("select id, checksum from schema_migrations order by rowid")
      .all(),
  ).toEqual(
    migrationManifest.map(({ id, sha256 }) => ({ id, checksum: sha256 })),
  );
  expect(
    sqlite.prepare("select count(*) from schema_migrations").pluck().get(),
  ).toBe(17);
  for (const table of REQUIRED_MANUAL_EXERCISE_PROGRESS_TABLES) {
    expect(tableExists(sqlite, table), `missing manual exercise progress table: ${table}`).toBe(true);
  }
  for (const table of REQUIRED_SKINCARE_TABLES) {
    expect(tableExists(sqlite, table), `missing skincare table: ${table}`).toBe(true);
  }
  for (const index of REQUIRED_SKINCARE_INDEXES) {
    expect(indexExists(sqlite, index), `missing skincare index: ${index}`).toBe(true);
  }
  expect(
    sqlite
      .prepare(
        `select name from sqlite_master
         where type = 'index'
           and tbl_name in (${REQUIRED_SKINCARE_TABLES.map(() => "?").join(", ")})
           and name not like 'sqlite_autoindex_%'
         order by name`,
      )
      .pluck()
      .all(...REQUIRED_SKINCARE_TABLES),
  ).toEqual([...REQUIRED_SKINCARE_INDEXES].sort());
  expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok");
  expect(sqlite.pragma("foreign_key_check")).toEqual([]);
}

function insertV6Fixture(sqlite: Database.Database): void {
  sqlite.exec(`
    insert into skincare_products
      (id, brand, name, model, specification, status, revision, created_at, updated_at, archived_at)
    values
      ('product-1', 'Brand', 'Primary product', 'M1', 'Spec', 'active', 1, '${ISO_TIMESTAMP}', '${ISO_TIMESTAMP}', null),
      ('product-2', 'Brand', 'Second product', 'M2', 'Spec', 'active', 1, '${ISO_TIMESTAMP}', '${ISO_TIMESTAMP}', null);

    insert into skincare_formulations
      (id, product_id, version_number, version_label, state, revision, created_at, updated_at, archived_at)
    values
      ('formulation-draft', 'product-1', 1, 'Draft', 'draft', 1, '${ISO_TIMESTAMP}', '${ISO_TIMESTAMP}', null),
      ('formulation-published', 'product-2', 1, 'Published', 'draft', 1, '${ISO_TIMESTAMP}', '${ISO_TIMESTAMP}', null);

    insert into skincare_ingredients
      (id, canonical_name, normalized_name, category_key, aliases_json, source_note, revision, created_at, updated_at, archived_at)
    values
      ('ingredient-1', 'Ingredient One', 'ingredient one', 'supportive', '[]', '', 1, '${ISO_TIMESTAMP}', '${ISO_TIMESTAMP}', null),
      ('ingredient-2', 'Ingredient Two', 'ingredient two', 'other_active', '[]', '', 1, '${ISO_TIMESTAMP}', '${ISO_TIMESTAMP}', null);

    insert into skincare_formulation_ingredients
      (formulation_id, ingredient_id, display_order, is_key_active, concentration_state,
       concentration_text, function_tags_json, label_warnings_json, created_at)
    values
      ('formulation-draft', 'ingredient-1', 0, 0, 'unknown', null, '[]', '[]', '${ISO_TIMESTAMP}'),
      ('formulation-published', 'ingredient-1', 0, 1, 'known', '1%', '[]', '[]', '${ISO_TIMESTAMP}');

    update skincare_formulations
       set state = 'published', payload_schema_version = '1', canonicalization_version = '1',
           hash_algorithm = 'sha256', content_sha256 = '${SHA256}', snapshot_json = '{}',
           published_at = '${ISO_TIMESTAMP}', updated_at = '${ISO_TIMESTAMP}'
     where id = 'formulation-published';

    insert into skincare_product_units
      (id, product_id, formulation_id, batch_note, purchased_on, opened_on, expires_on,
       pao_months, status, revision, created_at, updated_at, archived_at)
    values
      ('unit-available', 'product-1', 'formulation-draft', '', null, null, null, null, 'available', 1, '${ISO_TIMESTAMP}', '${ISO_TIMESTAMP}', null),
      ('unit-paused', 'product-1', 'formulation-draft', '', null, null, null, null, 'paused', 1, '${ISO_TIMESTAMP}', '${ISO_TIMESTAMP}', null),
      ('unit-published', 'product-2', 'formulation-published', '', null, null, null, null, 'available', 1, '${ISO_TIMESTAMP}', '${ISO_TIMESTAMP}', null);

    insert into skincare_plans
      (id, name, scope, status, revision, created_at, updated_at, archived_at)
    values
      ('plan-published', 'Published plan', 'face', 'active', 1, '${ISO_TIMESTAMP}', '${ISO_TIMESTAMP}', null),
      ('plan-draft', 'Draft plan', 'face', 'active', 1, '${ISO_TIMESTAMP}', '${ISO_TIMESTAMP}', null);

    insert into skincare_plan_versions
      (id, plan_id, version, state, revision, created_at, updated_at)
    values
      ('plan-version-published', 'plan-published', 1, 'draft', 1, '${ISO_TIMESTAMP}', '${ISO_TIMESTAMP}'),
      ('plan-version-draft', 'plan-draft', 1, 'draft', 1, '${ISO_TIMESTAMP}', '${ISO_TIMESTAMP}');

    insert into skincare_phases
      (id, plan_version_id, name, display_order, start_day, end_day_exclusive, created_at)
    values
      ('phase-published', 'plan-version-published', 'Published phase', 0, 0, 7, '${ISO_TIMESTAMP}'),
      ('phase-draft', 'plan-version-draft', 'Draft phase', 0, 0, 7, '${ISO_TIMESTAMP}');

    insert into skincare_steps
      (id, phase_id, slot, display_order, formulation_id, suggested_unit_id, area_key,
       amount_text, frequency_kind, weekday_mask, every_days, created_at)
    values
      ('step-published', 'phase-published', 'morning', 0, 'formulation-published', 'unit-published', 'face', 'one pump', 'daily', null, null, '${ISO_TIMESTAMP}'),
      ('step-draft', 'phase-draft', 'morning', 0, 'formulation-draft', 'unit-available', 'face', 'one pump', 'daily', null, null, '${ISO_TIMESTAMP}');

    update skincare_plan_versions
       set state = 'published', effective_from = '2026-08-11', payload_schema_version = '1',
           canonicalization_version = '1', hash_algorithm = 'sha256', content_sha256 = '${SHA256}',
           snapshot_json = '{}', published_at = '${ISO_TIMESTAMP}', updated_at = '${ISO_TIMESTAMP}'
     where id = 'plan-version-published';

    insert into skincare_tolerance_events
      (id, formulation_id, event_kind, supersedes_event_id, assessment_type, outcome,
       business_date, note, occurred_at, created_at)
    values ('tolerance-recorded', 'formulation-published', 'recorded', null, 'routine', 'tolerated',
            '2026-08-11', '', '${ISO_TIMESTAMP}', '${ISO_TIMESTAMP}');

    insert into skincare_safety_assessments
      (id, plan_version_id, rules_version, input_hash, plan_content_hash, result, findings_json,
       evaluated_at, created_at)
    values ('assessment-recorded', 'plan-version-published', '1', '${SHA256}', '${SHA256}', 'ALLOW',
            '[]', '${ISO_TIMESTAMP}', '${ISO_TIMESTAMP}');

    insert into skincare_plan_version_events
      (id, plan_version_id, event_type, safety_assessment_id, acknowledgements_json, business_date,
       occurred_at, created_at)
    values ('plan-event-recorded', 'plan-version-published', 'activated', 'assessment-recorded', '[]',
            '2026-08-11', '${ISO_TIMESTAMP}', '${ISO_TIMESTAMP}');

    insert into skincare_usage_events
      (id, event_kind, supersedes_event_id, outcome, plan_version_id, step_id, business_date, slot,
       formulation_id, product_unit_id, occurred_at, amount_text, snapshot_schema_version,
       snapshot_json, created_at)
    values ('usage-recorded', 'recorded', null, 'used', 'plan-version-published', 'step-published',
            '2026-08-11', 'morning', 'formulation-published', 'unit-published', '${ISO_TIMESTAMP}',
            'one pump', '1', '{}', '${ISO_TIMESTAMP}');

    insert into skin_observation_events
      (id, event_kind, supersedes_event_id, business_date, occurred_at, area_key, dryness, oiliness,
       redness, acne, stinging, overall, note, created_at)
    values ('observation-recorded', 'recorded', null, '2026-08-11', '${ISO_TIMESTAMP}', 'face', 0,
            null, null, null, null, null, '', '${ISO_TIMESTAMP}');

    insert into skincare_adverse_events
      (id, case_id, event_kind, supersedes_event_id, business_date, occurred_at, description,
       severity, handling_status, note, created_at)
    values ('adverse-recorded', 'adverse-recorded', 'recorded', null, '2026-08-11', '${ISO_TIMESTAMP}',
            'Temporary discomfort', 'mild', 'open', '', '${ISO_TIMESTAMP}');

    insert into skincare_adverse_usage_links
      (id, adverse_case_id, usage_event_id, event_kind, relation_type, supersedes_link_id, created_at)
    values ('adverse-link-recorded', 'adverse-recorded', 'usage-recorded', 'linked', 'temporal', null,
            '${ISO_TIMESTAMP}');
  `);
}

const CORRECTABLE_EVENT_CHAINS = [
  {
    label: "tolerance",
    table: "skincare_tolerance_events",
    columns:
      "id, formulation_id, event_kind, supersedes_event_id, assessment_type, outcome, business_date, note, occurred_at, created_at",
    row: (id: string, supersedes: string | null, eventKind = "corrected") =>
      `('${id}', 'formulation-published', '${eventKind}', ${supersedes === null ? "null" : `'${supersedes}'`}, 'routine', 'tolerated', '2026-08-11', '', '${ISO_TIMESTAMP}', '${ISO_TIMESTAMP}')`,
  },
  {
    label: "usage",
    table: "skincare_usage_events",
    columns:
      "id, event_kind, supersedes_event_id, outcome, plan_version_id, step_id, business_date, slot, formulation_id, product_unit_id, occurred_at, amount_text, snapshot_schema_version, snapshot_json, created_at",
    row: (id: string, supersedes: string | null, eventKind = "corrected") =>
      `('${id}', '${eventKind}', ${supersedes === null ? "null" : `'${supersedes}'`}, 'used', 'plan-version-published', 'step-published', '2026-08-11', 'morning', 'formulation-published', 'unit-published', '${ISO_TIMESTAMP}', 'one pump', '1', '{}', '${ISO_TIMESTAMP}')`,
  },
  {
    label: "observation",
    table: "skin_observation_events",
    columns:
      "id, event_kind, supersedes_event_id, business_date, occurred_at, area_key, dryness, oiliness, redness, acne, stinging, overall, note, created_at",
    row: (id: string, supersedes: string | null, eventKind = "corrected") =>
      `('${id}', '${eventKind}', ${supersedes === null ? "null" : `'${supersedes}'`}, '2026-08-11', '${ISO_TIMESTAMP}', 'face', 0, null, null, null, null, null, '', '${ISO_TIMESTAMP}')`,
  },
] as const;

function insertCorrectableEvents(
  sqlite: Database.Database,
  chain: (typeof CORRECTABLE_EVENT_CHAINS)[number],
  rows: string[],
): void {
  sqlite.exec(`insert into ${chain.table} (${chain.columns}) values ${rows.join(", ")}`);
}

function hasUniqueCandidateSourceConstraint(sqlite: Database.Database): boolean {
  if (!tableExists(sqlite, "knowledge_candidates")) return false;

  const indexes = sqlite.pragma("index_list('knowledge_candidates')") as Array<{
    name: string;
    unique: number;
  }>;
  return indexes.some((index) => {
    if (index.unique !== 1) return false;
    const columns = sqlite.pragma(`index_info('${index.name.replaceAll("'", "''")}')`) as Array<{
      name: string;
    }>;
    return columns.length === 1 && columns[0]?.name === "source_capture_id";
  });
}

function insertLegacyCapture(
  sqlite: Database.Database,
  {
    id,
    content,
    archivedAt = null,
  }: { id: string; content: string; archivedAt?: string | null },
): void {
  sqlite
    .prepare(
      `insert into daily_entries
        (id, entry_type, parent_entry_id, business_date, content, revision,
         created_at, updated_at, archived_at)
       values (?, 'capture', null, '2026-08-09', ?, 1, ?, ?, ?)`,
    )
    .run(
      id,
      content,
      "2026-08-09T10:00:00.000Z",
      "2026-08-09T10:00:00.000Z",
      archivedAt,
    );
}

function createLegacyFoundationDatabaseWithCapture(): Database.Database {
  const sqlite = createLegacyFoundationDatabase();
  insertLegacyCapture(sqlite, { id: "legacy-capture", content: "旧记录" });
  return sqlite;
}

function insertLedger(
  sqlite: Database.Database,
  id: string,
  checksum = "0".repeat(64),
): void {
  sqlite
    .prepare(
      "insert into schema_migrations (id, checksum, application_version, applied_at) values (?, ?, ?, ?)",
    )
    .run(id, checksum, "0.1.0", "2026-08-10T00:00:00.000Z");
}

function changeAppliedChecksum(sqlite: Database.Database, checksum: string): void {
  sqlite
    .prepare("update schema_migrations set checksum = ? where id = ?")
    .run(checksum, "0000_foundation");
}

function createV6PlanFixture(): Database.Database {
  const sqlite = createCurrentDatabaseAtPrefix(6);
  insertV6Fixture(sqlite);
  return sqlite;
}

afterEach(() => {
  while (databases.length > 0) {
    databases.pop()?.close();
  }
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop()!, { force: true, recursive: true });
  }
});

describe("schema v18 legacy-domain closeout", () => {
  const droppedLegacyTables = [...fs
    .readFileSync(path.join(process.cwd(), "drizzle", "0017_drop_legacy_tables.sql"), "utf8")
    .matchAll(/DROP TABLE IF EXISTS\s+([a-z_][a-z0-9_]*)\s*;/g)]
    .map((match) => match[1]);

  it("migrates a fresh database to v18 with every legacy table absent", () => {
    const sqlite = createDatabase();
    migrateDatabase(sqlite);

    expect(sqlite.prepare("select value from app_meta where key = 'schema_version'").pluck().get()).toBe("25");
    expect(sqlite.prepare("select count(*) from schema_migrations").pluck().get()).toBe(25);
    expect(droppedLegacyTables).toHaveLength(58);
    for (const table of droppedLegacyTables) {
      expect(tableExists(sqlite, table), `legacy table still exists: ${table}`).toBe(false);
    }
    for (const table of [
      "capture_items", "action_events", "review_revisions", "knowledge_modules",
      "daily_learning_notes", "manual_exercise_templates",
      "manual_exercise_progress_decisions", "reading_books", "reading_sessions",
    ]) {
      expect(tableExists(sqlite, table), `current table missing: ${table}`).toBe(true);
    }
    expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
  });

  it("upgrades v19 to v20 additively and preserves every existing sleep value", () => {
    const sqlite = createCurrentDatabaseAtPrefix(19);
    sqlite.prepare(`insert into sleep_daily_records
      (id, record_date, asleep_time, wake_time, calculated_duration_minutes,
       confirmed_duration_minutes, quality_text, note, revision, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        "sleep-v19-preserved",
        "2026-08-12",
        "23:30",
        "07:00",
        450,
        null,
        "旧版主观记录",
        "保留备注",
        3,
        "2026-08-12T00:00:00.000Z",
        "2026-08-12T01:00:00.000Z",
      );

    migrateDatabase(sqlite);

    expect(sqlite.prepare("select value from app_meta where key = 'schema_version'").pluck().get()).toBe("25");
    expect(sqlite.prepare("select count(*) from schema_migrations").pluck().get()).toBe(25);
    expect(sqlite.prepare(`select id, record_date, asleep_time, wake_time,
      calculated_duration_minutes, confirmed_duration_minutes, quality_text, note,
      revision, deep_sleep_minutes, light_sleep_minutes, rem_sleep_minutes, morning_feeling
      from sleep_daily_records where id = ?`).get("sleep-v19-preserved")).toEqual({
      id: "sleep-v19-preserved",
      record_date: "2026-08-12",
      asleep_time: "23:30",
      wake_time: "07:00",
      calculated_duration_minutes: 450,
      confirmed_duration_minutes: null,
      quality_text: "旧版主观记录",
      note: "保留备注",
      revision: 3,
      deep_sleep_minutes: null,
      light_sleep_minutes: null,
      rem_sleep_minutes: null,
      morning_feeling: null,
    });
  });

  it("upgrades schema v17 destructively while preserving current-domain rows", () => {
    const sqlite = createCurrentDatabaseAtPrefix(17);
    sqlite.prepare(
      "insert into reading_books (book_id, title, author, status, current_page, revision, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "current-book-v17", "preserve book", "", "wishlist", 0, 1,
      ISO_TIMESTAMP, ISO_TIMESTAMP,
    );
    migrateDatabase(sqlite);

    expect(sqlite.prepare("select value from app_meta where key = 'schema_version'").pluck().get()).toBe("25");
    expect(sqlite.prepare("select count(*) from schema_migrations").pluck().get()).toBe(25);
    for (const table of droppedLegacyTables) expect(tableExists(sqlite, table)).toBe(false);
    expect(sqlite.prepare("select title from reading_books where book_id = ?").pluck().get("current-book-v17")).toBe("preserve book");
    expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
  });
});

describe("schema v21 manual skincare product photos", () => {
  it("upgrades v20 additively, preserves products, and enforces bounded BLOB/MIME pairs", () => {
    const sqlite = createCurrentDatabaseAtPrefix(20);
    sqlite.prepare(`insert into manual_skincare_products
      (id, name, brand, current_purpose, status, added_on, note, revision, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        "product-v20-preserved", "保留产品", "保留品牌", "保留用途", "active",
        "2026-08-13", "保留备注", 3, ISO_TIMESTAMP, ISO_TIMESTAMP,
      );

    migrateDatabase(sqlite);

    expect(sqlite.prepare("select value from app_meta where key = 'schema_version'").pluck().get()).toBe("25");
    expect(sqlite.prepare("select count(*) from schema_migrations").pluck().get()).toBe(25);
    expect(sqlite.prepare(`select id, name, brand, current_purpose, note, revision,
      photo_blob, photo_mime from manual_skincare_products where id = ?`)
      .get("product-v20-preserved")).toEqual({
      id: "product-v20-preserved",
      name: "保留产品",
      brand: "保留品牌",
      current_purpose: "保留用途",
      note: "保留备注",
      revision: 3,
      photo_blob: null,
      photo_mime: null,
    });

    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    sqlite.prepare(`update manual_skincare_products
      set photo_blob = ?, photo_mime = 'image/png' where id = ?`)
      .run(pngBytes, "product-v20-preserved");
    expect(sqlite.prepare(`select typeof(photo_blob) as storage, length(photo_blob) as bytes,
      photo_mime from manual_skincare_products where id = ?`).get("product-v20-preserved"))
      .toEqual({ storage: "blob", bytes: 8, photo_mime: "image/png" });

    expect(() => sqlite.prepare(`update manual_skincare_products
      set photo_blob = ?, photo_mime = 'image/gif' where id = ?`)
      .run(pngBytes, "product-v20-preserved")).toThrow(/check constraint/i);
    expect(() => sqlite.prepare(`update manual_skincare_products
      set photo_blob = null, photo_mime = 'image/png' where id = ?`)
      .run("product-v20-preserved")).toThrow(/check constraint/i);
    expect(() => sqlite.prepare(`update manual_skincare_products
      set photo_blob = ?, photo_mime = 'image/jpeg' where id = ?`)
      .run(Buffer.alloc(2 * 1024 * 1024 + 1), "product-v20-preserved"))
      .toThrow(/check constraint/i);
  });

  it("fails closed when the v21 ledger exists without both photo columns", () => {
    const sqlite = createCurrentDatabaseAtPrefix(20);
    const photoMigration = migrationManifest[20]!;
    insertLedger(sqlite, photoMigration.id, photoMigration.sha256);
    sqlite.prepare("update app_meta set value = '24' where key = 'schema_version'").run();

    expect(() => migrateDatabase(sqlite)).toThrow(/manual skincare photo schema/i);
  });
});

describe.skip("legacy daily-loop v17 migration (removed by schema v18)", () => {
  it("migrates fresh and complete v16 databases through v17", () => {
    const fresh = createDatabase();
    migrateDatabase(fresh);
    expect(
      fresh.prepare("select value from app_meta where key = 'schema_version'").pluck().get(),
    ).toBe("17");
    expect(fresh.prepare("select count(*) from schema_migrations").pluck().get()).toBe(17);
    expect(tableExists(fresh, "reading_sessions")).toBe(true);

    const v16 = createCurrentDatabaseAtPrefix(16);
    migrateDatabase(v16);
    expect(
      v16.prepare("select value from app_meta where key = 'schema_version'").pluck().get(),
    ).toBe("17");
    expect(v16.prepare("select count(*) from schema_migrations").pluck().get()).toBe(17);
  });

  it("enforces session dates, page ranges, duration, ownership, and archive-only deletion", () => {
    const sqlite = createDatabase();
    migrateDatabase(sqlite);
    const timestamp = "2026-08-14T08:00:00.000Z";
    sqlite.prepare(`insert into reading_books
      (book_id, title, author, status, total_pages, current_page, rating,
       revision, created_at, updated_at)
      values (?, ?, '', 'reading', 200, 10, null, 1, ?, ?)`).run(
        "reading-session-book-1",
        "每日阅读测试",
        timestamp,
        timestamp,
      );
    const insert = sqlite.prepare(`insert into reading_sessions
      (session_id, book_id, business_date, start_page, end_page, duration_minutes,
       note, revision, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`);

    expect(() => insert.run(
      "reading-session-1", "reading-session-book-1", "2026-08-14",
      10, 30, 25, "", timestamp, timestamp,
    )).not.toThrow();
    expect(() => insert.run(
      "reading-session-2", "reading-session-book-1", "2026-02-30",
      10, 30, 25, "", timestamp, timestamp,
    )).toThrow(/check constraint/i);
    expect(() => insert.run(
      "reading-session-3", "reading-session-book-1", "2026-08-14",
      31, 30, 25, "", timestamp, timestamp,
    )).toThrow(/check constraint/i);
    expect(() => insert.run(
      "reading-session-4", "reading-session-book-1", "2026-08-14",
      10, 30, 0, "", timestamp, timestamp,
    )).toThrow(/check constraint/i);
    expect(() => sqlite.exec("delete from reading_sessions where session_id = 'reading-session-1'"))
      .toThrow(/archive|physical delete/i);
  });
});

describe.skip("legacy professional-domain migrations (removed by schema v18)", () => {
  it("migrates a fresh database through v13 with all Sleep authority tables", () => {
    const sqlite = createDatabase();

    migrateDatabase(sqlite);

    expect(
      sqlite.prepare("select value from app_meta where key = 'schema_version'").pluck().get(),
    ).toBe("17");
    expect(sqlite.prepare("select count(*) from schema_migrations").pluck().get()).toBe(17);
    for (const table of [
      "sleep_plans",
      "sleep_plan_versions",
      "sleep_plan_schedule_days",
      "sleep_sessions",
      "sleep_session_events",
      "sleep_awake_intervals",
      "sleep_checkins",
      "sleep_checkin_events",
    ]) {
      expect(tableExists(sqlite, table), `missing Sleep table: ${table}`).toBe(true);
    }
  });

  it("creates the exact Sleep indexes and enforces every awakening-mode shape", () => {
    const sqlite = createDatabase();
    migrateDatabase(sqlite);

    for (const index of REQUIRED_SLEEP_INDEXES) {
      expect(indexExists(sqlite, index), `missing Sleep index: ${index}`).toBe(true);
    }
    sqlite.prepare("insert into sleep_sessions (id, created_at) values (?, ?)").run(
      "session-awakening-modes",
      ISO_TIMESTAMP,
    );
    const insert = sqlite.prepare(`
      insert into sleep_session_events
        (id, session_id, event_type, session_kind, sleep_date, timezone, in_bed_at,
         sleep_onset_at, final_wake_at, out_of_bed_at, source, precision,
         awakening_mode, awakening_count, awake_duration_seconds, supersedes_event_id,
         occurred_at)
      values (?, 'session-awakening-modes', 'recorded', 'nap', '2026-08-11', 'Asia/Shanghai',
              ?, null, null, ?, 'manual', 'exact', ?, ?, ?, null, ?)
    `);
    const valid = [
      ["mode-none", "none", 0, 0],
      ["mode-intervals", "intervals", null, null],
      ["mode-summary", "summary", 2, 900],
      ["mode-unknown", "unknown", null, null],
    ] as const;
    for (const [id, mode, count, duration] of valid) {
      expect(() => insert.run(id, ISO_TIMESTAMP, ISO_TIMESTAMP, mode, count, duration, ISO_TIMESTAMP)).not.toThrow();
    }
    for (const [id, mode, count, duration] of [
      ["invalid-none", "none", null, null],
      ["invalid-intervals", "intervals", 1, 60],
      ["invalid-summary", "summary", 1, null],
      ["invalid-unknown", "unknown", 0, 0],
    ] as const) {
      expect(() => insert.run(id, ISO_TIMESTAMP, ISO_TIMESTAMP, mode, count, duration, ISO_TIMESTAMP)).toThrow(/CHECK constraint failed/);
    }
    expect(() =>
      sqlite.prepare(`insert into sleep_awake_intervals
        (id, session_event_id, ordinal, started_at, ended_at) values (?, ?, 0, ?, ?)`)
        .run("missing-parent-interval", "missing-event", ISO_TIMESTAMP, "2026-08-11T00:01:00.000Z"),
    ).toThrow(/parent|foreign key/i);
    expect(() =>
      sqlite.prepare(`insert into sleep_awake_intervals
        (id, session_event_id, ordinal, started_at, ended_at) values (?, ?, 0, ?, ?)`)
        .run("wrong-mode-interval", "mode-unknown", ISO_TIMESTAMP, "2026-08-11T00:01:00.000Z"),
    ).toThrow(/intervals-mode parent/i);
  });

  it("rejects Sleep event self references, ancestor cycles, forks, mutation, and owner switches", () => {
    const sqlite = createDatabase();
    migrateDatabase(sqlite);
    sqlite.exec(`
      insert into sleep_sessions (id, created_at) values ('session-a', '${ISO_TIMESTAMP}');
      insert into sleep_sessions (id, created_at) values ('session-b', '${ISO_TIMESTAMP}');
      insert into sleep_checkins (id, checkin_date, session_id, created_at)
        values ('checkin-a', '2026-08-11', 'session-a', '${ISO_TIMESTAMP}');
      insert into sleep_checkins (id, checkin_date, session_id, created_at)
        values ('checkin-b', '2026-08-12', 'session-b', '${ISO_TIMESTAMP}');
    `);
    const sessionEvent = (id: string, sessionId: string, supersedes: string | null) => [
      id, sessionId, supersedes === null ? "recorded" : "corrected", "main", "2026-08-11",
      "Asia/Shanghai", ISO_TIMESTAMP, null, ISO_TIMESTAMP, ISO_TIMESTAMP, "manual", "exact",
      "unknown", null, null, supersedes, ISO_TIMESTAMP,
    ];
    const insertSessionEvent = sqlite.prepare(`insert into sleep_session_events
      (id, session_id, event_type, session_kind, sleep_date, timezone, in_bed_at,
       sleep_onset_at, final_wake_at, out_of_bed_at, source, precision, awakening_mode,
       awakening_count, awake_duration_seconds, supersedes_event_id, occurred_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    expect(() => insertSessionEvent.run(...sessionEvent("self", "session-a", "self"))).toThrow(/check|cycle/i);
    insertSessionEvent.run(...sessionEvent("root", "session-a", null));
    expect(() => insertSessionEvent.run(...sessionEvent("switch", "session-b", "root"))).toThrow(/switch session/i);
    insertSessionEvent.run(...sessionEvent("leaf", "session-a", "root"));
    expect(() => insertSessionEvent.run(...sessionEvent("fork", "session-a", "root"))).toThrow(/unique|immutable/i);
    expect(() => sqlite.prepare("update sleep_session_events set occurred_at = occurred_at where id = 'root'").run()).toThrow(/immutable/i);
    expect(() => sqlite.prepare("delete from sleep_session_events where id = 'root'").run()).toThrow(/immutable/i);

    sqlite.exec("begin");
    sqlite.pragma("defer_foreign_keys = ON");
    try {
      insertSessionEvent.run(...sessionEvent("cycle-a", "session-a", "cycle-b"));
      expect(() => insertSessionEvent.run(...sessionEvent("cycle-b", "session-a", "cycle-a"))).toThrow(/cycle/i);
    } finally {
      sqlite.exec("rollback");
    }

    const insertCheckinEvent = sqlite.prepare(`insert into sleep_checkin_events
      (id, checkin_id, event_type, scale_version, quality_score, restoration_score,
       daytime_sleepiness_score, note, supersedes_event_id, occurred_at)
      values (?, ?, ?, 'sleep-checkin-v1', 3, null, null, '', ?, ?)`);
    expect(() => insertCheckinEvent.run("check-self", "checkin-a", "corrected", "check-self", ISO_TIMESTAMP)).toThrow(/check|cycle/i);
    insertCheckinEvent.run("check-root", "checkin-a", "recorded", null, ISO_TIMESTAMP);
    expect(() => insertCheckinEvent.run("check-switch", "checkin-b", "corrected", "check-root", ISO_TIMESTAMP)).toThrow(/switch check-in/i);
    insertCheckinEvent.run("check-leaf", "checkin-a", "corrected", "check-root", ISO_TIMESTAMP);
    expect(() => insertCheckinEvent.run("check-fork", "checkin-a", "corrected", "check-root", ISO_TIMESTAMP)).toThrow(/unique|immutable/i);
    sqlite.exec("begin");
    sqlite.pragma("defer_foreign_keys = ON");
    try {
      insertCheckinEvent.run("check-cycle-a", "checkin-a", "corrected", "check-cycle-b", ISO_TIMESTAMP);
      expect(() => insertCheckinEvent.run("check-cycle-b", "checkin-a", "corrected", "check-cycle-a", ISO_TIMESTAMP)).toThrow(/cycle/i);
    } finally {
      sqlite.exec("rollback");
    }
  });

  it("prevents adding or mutating schedule content after a Sleep plan version is published", () => {
    const sqlite = createDatabase();
    migrateDatabase(sqlite);
    sqlite.exec(`
      insert into sleep_plans (id, name, created_at, updated_at, archived_at)
        values ('sleep-plan', 'Plan', '${ISO_TIMESTAMP}', '${ISO_TIMESTAMP}', null);
      insert into sleep_plan_versions
        (id, plan_id, version, timezone, target_duration_min_seconds,
         target_duration_max_seconds, valid_from, valid_to_exclusive,
         normalization_version, hash_algorithm, content_hash,
         normalized_snapshot_json, published_at, terminated_at)
        values ('sleep-plan-v1', 'sleep-plan', 1, 'Asia/Shanghai', 25200, 28800,
                '${ISO_TIMESTAMP}', null, 'sleep-plan-v1', 'sha256', '${SHA256}', '{}',
                '${ISO_TIMESTAMP}', null);
    `);
    expect(() => sqlite.prepare(`insert into sleep_plan_schedule_days
      (id, plan_version_id, wake_weekday, target_in_bed_minute, target_sleep_minute,
       target_final_wake_minute, target_out_of_bed_minute, bed_day_offset,
       early_window_minutes, late_window_minutes)
      values ('schedule-late', 'sleep-plan-v1', 1, 1380, 1410, 420, 450, -1, 30, 30)`).run()).toThrow(/immutable/i);
  });

  it("fails closed for a missing applied Sleep table", () => {
    const sqlite = createDatabase();
    migrateDatabase(sqlite);
    sqlite.exec("drop table sleep_checkin_events");

    expect(() => migrateDatabase(sqlite)).toThrow(/Sleep schema/);
    expect(sqlite.prepare("select count(*) from schema_migrations").pluck().get()).toBe(17);
  });

  it("rolls back every Sleep table, ledger row, and schema version when the final trigger conflicts", () => {
    const sqlite = createCurrentDatabaseAtPrefix(7);
    sqlite.exec(`create trigger sleep_checkin_events_reject_delete
      before delete on app_meta begin select 1; end`);
    const before = { schema: schemaSnapshot(sqlite), ledger: ledgerSnapshot(sqlite), meta: appMetaSnapshot(sqlite) };

    expect(() => migrateDatabase(sqlite)).toThrow(/sleep_checkin_events_reject_delete/i);
    expect(schemaSnapshot(sqlite)).toBe(before.schema);
    expect(ledgerSnapshot(sqlite)).toBe(before.ledger);
    expect(appMetaSnapshot(sqlite)).toBe(before.meta);
    for (const table of REQUIRED_SLEEP_TABLES) expect(tableExists(sqlite, table)).toBe(false);
  });

  it("migrates v4 knowledge rows and revisions into the general domain", () => {
    const sqlite = createVersionFourDatabase();
    const timestamp = "2026-08-11T00:00:00.000Z";
    sqlite.exec(`
      insert into capture_items
        (id, event_type, corrects_item_id, business_date, occurred_at, content, created_at)
      values
        ('capture-domain-old', 'capture', null, '2026-08-11', '${timestamp}', 'Source', '${timestamp}');

      insert into knowledge_items
        (id, title, content, item_type, maturity, tags_json, source_capture_id, revision,
         created_at, updated_at, archived_at)
      values
        ('knowledge-domain-old', 'Old', 'Body', 'note', 'structured', '["legacy"]',
         'capture-domain-old', 1, '${timestamp}', '${timestamp}', null);

      insert into knowledge_candidates
        (id, source_capture_id, title, content, tags_json, status,
         decided_knowledge_item_id, created_at, decided_at)
      values
        ('candidate-domain-old', 'capture-domain-old', 'Candidate', 'Candidate body', '[]',
         'pending', null, '${timestamp}', null);

      insert into knowledge_item_revisions
        (id, knowledge_item_id, revision, snapshot_json, created_at)
      values
        ('revision-domain-old', 'knowledge-domain-old', 1,
         '{"id":"knowledge-domain-old","title":"Old"}', '${timestamp}');
    `);

    migrateDatabase(sqlite);

    expect(
      sqlite.prepare("select value from app_meta where key = 'schema_version'").pluck().get(),
    ).toBe("17");
    expect(
      sqlite.prepare(
        `select key, name, description, display_order
         from knowledge_domains order by display_order`,
      ).all(),
    ).toEqual([
      {
        key: "general",
        name: "通用",
        description: "未特别归类的理念、方法和经验",
        display_order: 0,
      },
      {
        key: "skincare",
        name: "护肤",
        description: "护肤理念、方法和经验",
        display_order: 1,
      },
      {
        key: "sleep",
        name: "睡眠",
        description: "睡眠理念、方法和经验",
        display_order: 2,
      },
      {
        key: "exercise",
        name: "运动",
        description: "训练理念、方法和经验",
        display_order: 3,
      },
    ]);
    expect(
      sqlite.prepare("select domain_key from knowledge_items where id = ?").pluck()
        .get("knowledge-domain-old"),
    ).toBe("general");
    expect(
      sqlite.prepare("select domain_key from knowledge_candidates where id = ?").pluck()
        .get("candidate-domain-old"),
    ).toBe("general");
    expect(JSON.parse(
      sqlite.prepare("select snapshot_json from knowledge_item_revisions where id = ?").pluck()
        .get("revision-domain-old") as string,
    )).toMatchObject({ domainKey: "general" });
    expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 7])(
    "migrates a complete prefix of %i migrations through schema version 13",
    (prefix) => {
      const sqlite = createCurrentDatabaseAtPrefix(prefix);

      migrateDatabase(sqlite);

      expect(
        sqlite.prepare("select value from app_meta where key = 'schema_version'").pluck().get(),
      ).toBe("17");
      expect(sqlite.prepare("select count(*) from schema_migrations").pluck().get()).toBe(17);
      expect(tableExists(sqlite, "knowledge_domains")).toBe(true);
      expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    },
  );

  it("migrates a fresh database to the exact v6 skincare authority boundary", () => {
    const sqlite = createDatabase();

    migrateDatabase(sqlite);

    assertV7AuthorityBoundary(sqlite);
  });

  it.each([1, 2, 3, 4, 5, 6, 7])(
    "migrates a complete v%i prefix to the exact v6 skincare authority boundary",
    (prefix) => {
      const sqlite = createCurrentDatabaseAtPrefix(prefix);

      migrateDatabase(sqlite);

      assertV7AuthorityBoundary(sqlite);
    },
  );

  it.each(CORRECTABLE_EVENT_CHAINS)("rejects $label event self references", (chain) => {
    const sqlite = createDatabase();
    migrateDatabase(sqlite);
    insertV6Fixture(sqlite);

    expect(() =>
      insertCorrectableEvents(sqlite, chain, [chain.row(`${chain.label}-self`, `${chain.label}-self`)]),
    ).toThrow(/check|cycle/i);
  });

  it.each(CORRECTABLE_EVENT_CHAINS)("rejects $label two-row cycles in one statement", (chain) => {
    const sqlite = createDatabase();
    migrateDatabase(sqlite);
    insertV6Fixture(sqlite);

    const first = `${chain.label}-cycle-a`;
    const second = `${chain.label}-cycle-b`;
    expect(() =>
      insertCorrectableEvents(sqlite, chain, [chain.row(first, second), chain.row(second, first)]),
    ).toThrow(/cycle/i);
  });

  it.each(CORRECTABLE_EVENT_CHAINS)("rejects $label cycles with deferred foreign keys", (chain) => {
    const sqlite = createDatabase();
    migrateDatabase(sqlite);
    insertV6Fixture(sqlite);

    const first = `${chain.label}-deferred-a`;
    const second = `${chain.label}-deferred-b`;
    sqlite.exec("begin");
    sqlite.pragma("defer_foreign_keys = ON");
    try {
      insertCorrectableEvents(sqlite, chain, [chain.row(first, second)]);
      expect(() => insertCorrectableEvents(sqlite, chain, [chain.row(second, first)])).toThrow(
        /cycle/i,
      );
    } finally {
      if (sqlite.inTransaction) sqlite.exec("rollback");
    }
  });

  it("rejects three-node correction cycles through the recursive ancestor path", () => {
    const sqlite = createDatabase();
    migrateDatabase(sqlite);
    insertV6Fixture(sqlite);

    sqlite.exec("begin");
    sqlite.pragma("defer_foreign_keys = ON");
    try {
      for (const chain of CORRECTABLE_EVENT_CHAINS) {
        const first = `${chain.label}-three-node-a`;
        const second = `${chain.label}-three-node-b`;
        const third = `${chain.label}-three-node-c`;
        insertCorrectableEvents(sqlite, chain, [chain.row(first, second)]);
        insertCorrectableEvents(sqlite, chain, [chain.row(second, third)]);

        expect(() => insertCorrectableEvents(sqlite, chain, [chain.row(third, first)])).toThrow(
          /cycle/i,
        );
      }
    } finally {
      if (sqlite.inTransaction) sqlite.exec("rollback");
    }
  });

  it.each(CORRECTABLE_EVENT_CHAINS)("allows a linear $label correction chain and rejects forks", (chain) => {
    const sqlite = createDatabase();
    migrateDatabase(sqlite);
    insertV6Fixture(sqlite);

    const root = `${chain.label}-linear-root`;
    const corrected = `${chain.label}-linear-corrected`;
    insertCorrectableEvents(sqlite, chain, [chain.row(root, null, "recorded")]);
    insertCorrectableEvents(sqlite, chain, [chain.row(corrected, root)]);
    expect(() =>
      insertCorrectableEvents(sqlite, chain, [chain.row(`${chain.label}-linear-voided`, corrected, "voided")]),
    ).not.toThrow();
    expect(() =>
      insertCorrectableEvents(sqlite, chain, [chain.row(`${chain.label}-linear-fork`, root)]),
    ).toThrow(/unique|immutable/i);
  });

  it("enforces v6 product-unit composite identity, strict SHA-256, phase ranges, and fact chains", () => {
    const sqlite = createDatabase();
    migrateDatabase(sqlite);
    assertV7AuthorityBoundary(sqlite);
    insertV6Fixture(sqlite);

    expect(
      sqlite
        .prepare(
          `select id, status from skincare_product_units
           where formulation_id = 'formulation-draft' order by id`,
        )
        .all(),
    ).toEqual([
      { id: "unit-available", status: "available" },
      { id: "unit-paused", status: "paused" },
    ]);
    expect(() =>
      sqlite
        .prepare(
          `insert into skincare_product_units
            (id, product_id, formulation_id, batch_note, status, revision, created_at, updated_at)
           values ('unit-wrong-product', 'product-2', 'formulation-draft', '', 'available', 1, ?, ?)`,
        )
        .run(ISO_TIMESTAMP, ISO_TIMESTAMP),
    ).toThrow(/foreign key/i);

    expect(() =>
      sqlite
        .prepare(
          `insert into skincare_formulations
            (id, product_id, version_number, version_label, state, revision,
             payload_schema_version, canonicalization_version, hash_algorithm, content_sha256,
             snapshot_json, published_at, created_at, updated_at)
           values ('formulation-bad-hash', 'product-1', 2, 'Bad hash', 'published', 1,
                   '1', '1', 'sha256', ?, '{}', ?, ?, ?)`,
        )
        .run("g".repeat(64), ISO_TIMESTAMP, ISO_TIMESTAMP, ISO_TIMESTAMP),
    ).toThrow(/check/i);
    expect(() =>
      sqlite
        .prepare(
          `insert into skincare_products
            (id, brand, name, model, specification, status, revision, created_at, updated_at)
           values ('product-invalid-status', '', 'Invalid enum', '', '', 'invalid', 1, ?, ?)`,
        )
        .run(ISO_TIMESTAMP, ISO_TIMESTAMP),
    ).toThrow(/check/i);
    expect(() =>
      sqlite
        .prepare(
          `insert into skincare_safety_assessments
            (id, plan_version_id, rules_version, input_hash, plan_content_hash, result,
             findings_json, evaluated_at, created_at)
           values ('assessment-bad-input-hash', 'plan-version-published', '1', ?, ?, 'ALLOW',
                   '[]', ?, ?)`,
        )
        .run("g".repeat(64), SHA256, ISO_TIMESTAMP, ISO_TIMESTAMP),
    ).toThrow(/check/i);
    expect(() =>
      sqlite
        .prepare(
          `insert into skincare_safety_assessments
            (id, plan_version_id, rules_version, input_hash, plan_content_hash, result,
             findings_json, evaluated_at, created_at)
           values ('assessment-bad-plan-hash', 'plan-version-published', '1', ?, ?, 'ALLOW',
                   '[]', ?, ?)`,
        )
        .run(SHA256, "g".repeat(64), ISO_TIMESTAMP, ISO_TIMESTAMP),
    ).toThrow(/check/i);
    expect(() =>
      sqlite
        .prepare(
          `insert into skincare_plan_versions
            (id, plan_id, version, state, revision, effective_from, payload_schema_version,
             canonicalization_version, hash_algorithm, content_sha256, snapshot_json, published_at,
             created_at, updated_at)
           values ('plan-version-bad-hash', 'plan-draft', 2, 'published', 1, '2026-08-11', '1',
                   '1', 'sha256', ?, '{}', ?, ?, ?)`,
        )
        .run("g".repeat(64), ISO_TIMESTAMP, ISO_TIMESTAMP, ISO_TIMESTAMP),
    ).toThrow(/check/i);

    expect(() =>
      sqlite
        .prepare(
          `insert into skincare_phases
            (id, plan_version_id, name, display_order, start_day, end_day_exclusive, created_at)
           values ('phase-overlap', 'plan-version-draft', 'Overlap', 1, 6, 8, ?)`,
        )
        .run(ISO_TIMESTAMP),
    ).toThrow(/overlap/i);
    expect(() =>
      sqlite
        .prepare(
          `insert into skincare_phases
            (id, plan_version_id, name, display_order, start_day, end_day_exclusive, created_at)
           values ('phase-adjacent', 'plan-version-draft', 'Adjacent', 1, 7, 14, ?)`,
        )
        .run(ISO_TIMESTAMP),
    ).not.toThrow();
    expect(() =>
      sqlite
        .prepare(
          `insert into skincare_steps
            (id, phase_id, slot, display_order, formulation_id, suggested_unit_id, area_key,
             amount_text, frequency_kind, weekday_mask, every_days, created_at)
           values ('step-invalid-weekdays', 'phase-draft', 'evening', 1, 'formulation-draft',
                   'unit-available', 'face', 'one pump', 'weekdays', 0, null, ?)`,
        )
        .run(ISO_TIMESTAMP),
    ).toThrow(/check/i);
    expect(() =>
      sqlite
        .prepare(
          `insert into skincare_steps
            (id, phase_id, slot, display_order, formulation_id, suggested_unit_id, area_key,
             amount_text, frequency_kind, weekday_mask, every_days, created_at)
           values ('step-invalid-interval', 'phase-draft', 'evening', 1, 'formulation-draft',
                   'unit-available', 'face', 'one pump', 'interval', null, 366, ?)`,
        )
        .run(ISO_TIMESTAMP),
    ).toThrow(/check/i);
    expect(() =>
      sqlite
        .prepare(
          `insert into skin_observation_events
            (id, event_kind, supersedes_event_id, business_date, occurred_at, area_key, dryness,
             oiliness, redness, acne, stinging, overall, note, created_at)
           values ('observation-out-of-range', 'recorded', null, '2026-08-11', ?, 'face', 6,
                   null, null, null, null, null, '', ?)`,
        )
        .run(ISO_TIMESTAMP, ISO_TIMESTAMP),
    ).toThrow(/check/i);

    sqlite
      .prepare(
        `insert into skincare_tolerance_events
          (id, formulation_id, event_kind, supersedes_event_id, assessment_type, outcome,
           business_date, note, occurred_at, created_at)
         values ('tolerance-corrected', 'formulation-published', 'corrected', 'tolerance-recorded',
                 'routine', 'tolerated', '2026-08-11', '', ?, ?)`,
      )
      .run(ISO_TIMESTAMP, ISO_TIMESTAMP);
    expect(() =>
      sqlite
        .prepare(
          `insert into skincare_tolerance_events
            (id, formulation_id, event_kind, supersedes_event_id, assessment_type, outcome,
             business_date, note, occurred_at, created_at)
           values ('tolerance-fork', 'formulation-published', 'corrected', 'tolerance-recorded',
                   'routine', 'tolerated', '2026-08-11', '', ?, ?)`,
        )
        .run(ISO_TIMESTAMP, ISO_TIMESTAMP),
    ).toThrow(/unique|immutable/i);

    sqlite
      .prepare(
        `insert into skincare_adverse_events
          (id, case_id, event_kind, supersedes_event_id, business_date, occurred_at, description,
           severity, handling_status, note, created_at)
         values ('adverse-second-case', 'adverse-second-case', 'recorded', null, '2026-08-11', ?,
                 'Different case', 'mild', 'open', '', ?)`,
      )
      .run(ISO_TIMESTAMP, ISO_TIMESTAMP);
    expect(() =>
      sqlite
        .prepare(
          `insert into skincare_adverse_usage_links
            (id, adverse_case_id, usage_event_id, event_kind, relation_type, supersedes_link_id,
             created_at)
           values ('adverse-link-cross-case', 'adverse-second-case', 'usage-recorded', 'voided',
                   'temporal', 'adverse-link-recorded', ?)`,
        )
        .run(ISO_TIMESTAMP),
    ).toThrow(/case/i);
    expect(() =>
      sqlite
        .prepare(
          `insert into skincare_adverse_usage_links
            (id, adverse_case_id, usage_event_id, event_kind, relation_type, supersedes_link_id,
             created_at)
           values ('adverse-link-missing-case', 'missing-case', null, 'linked', 'temporal', null, ?)`,
        )
        .run(ISO_TIMESTAMP),
    ).toThrow(/current non-void case leaf/i);
  });

  it("migrates fresh and v6 databases to v7 and permits one monotonic plan interval close", () => {
    const fresh = createDatabase();
    const upgraded = createV6PlanFixture();

    migrateDatabase(fresh);
    migrateDatabase(upgraded);

    for (const sqlite of [fresh, upgraded]) {
      expect(
        sqlite.prepare("select value from app_meta where key = 'schema_version'").pluck().get(),
      ).toBe("17");
    }
    expect(() =>
      upgraded
        .prepare(
          `update skincare_plan_versions set effective_to_exclusive = '2026-08-12'
           where id = 'plan-version-published'`,
        )
        .run(),
    ).not.toThrow();
    expect(
      upgraded
        .prepare("select effective_to_exclusive from skincare_plan_versions where id = ?")
        .pluck()
        .get("plan-version-published"),
    ).toBe("2026-08-12");
    expect(() =>
      upgraded
        .prepare(
          `update skincare_plan_versions set effective_to_exclusive = '2026-08-13'
           where id = 'plan-version-published'`,
        )
        .run(),
    ).toThrow(/immutable|interval/i);
    expect(() =>
      upgraded
        .prepare(
          `update skincare_plan_versions set effective_to_exclusive = null
           where id = 'plan-version-published'`,
        )
        .run(),
    ).toThrow(/immutable|interval/i);
  });

  it("permits the same one-way close for a retired plan version", () => {
    const sqlite = createV6PlanFixture();
    sqlite.exec(`
      insert into skincare_plan_versions
        (id, plan_id, version, state, revision, effective_from, payload_schema_version,
         canonicalization_version, hash_algorithm, content_sha256, snapshot_json, published_at,
         created_at, updated_at)
      values ('plan-version-retired', 'plan-published', 2, 'retired', 1, '2026-08-01', '1',
              '1', 'sha256', '${SHA256}', '{}', '${ISO_TIMESTAMP}', '${ISO_TIMESTAMP}', '${ISO_TIMESTAMP}')
    `);

    migrateDatabase(sqlite);

    expect(() =>
      sqlite
        .prepare(
          `update skincare_plan_versions set effective_to_exclusive = '2026-08-02'
           where id = 'plan-version-retired'`,
        )
        .run(),
    ).not.toThrow();
  });

  it.each([
    [
      "an equal end date",
      (sqlite: Database.Database) =>
        sqlite
          .prepare(
            `update skincare_plan_versions set effective_to_exclusive = effective_from
             where id = 'plan-version-published'`,
          )
          .run(),
    ],
    [
      "an earlier end date",
      (sqlite: Database.Database) =>
        sqlite
          .prepare(
            `update skincare_plan_versions set effective_to_exclusive = '2026-08-10'
             where id = 'plan-version-published'`,
          )
          .run(),
    ],
    [
      "an impossible business date",
      (sqlite: Database.Database) =>
        sqlite
          .prepare(
            `update skincare_plan_versions set effective_to_exclusive = '2026-02-30'
             where id = 'plan-version-published'`,
          )
          .run(),
    ],
    [
      "an unparseable shape-valid business date",
      (sqlite: Database.Database) =>
        sqlite
          .prepare(
            `update skincare_plan_versions set effective_to_exclusive = '9999-99-99'
             where id = 'plan-version-published'`,
          )
          .run(),
    ],
    [
      "a no-op UPDATE",
      (sqlite: Database.Database) =>
        sqlite
          .prepare("update skincare_plan_versions set id = id where id = 'plan-version-published'")
          .run(),
    ],
    [
      "another field",
      (sqlite: Database.Database) =>
        sqlite
          .prepare("update skincare_plan_versions set revision = 2 where id = 'plan-version-published'")
          .run(),
    ],
    [
      "a close combined with another change",
      (sqlite: Database.Database) =>
        sqlite
          .prepare(
            `update skincare_plan_versions
             set effective_to_exclusive = '2026-08-12', revision = 2
             where id = 'plan-version-published'`,
          )
          .run(),
    ],
  ])("rejects published plan interval bypass via %s", (_name, mutate) => {
    const sqlite = createV6PlanFixture();
    migrateDatabase(sqlite);

    expect(() => mutate(sqlite)).toThrow(/immutable|interval/i);
  });

  it("rolls back v7 trigger replacement and ledger writes after final version corruption", () => {
    const sqlite = createV6PlanFixture();
    const before = {
      ledger: ledgerSnapshot(sqlite),
      meta: appMetaSnapshot(sqlite),
    };
    sqlite.exec(`
      create trigger force_wrong_v8_schema_version
      after update of value on app_meta
       when new.key = 'schema_version' and new.value = '17'
      begin
        update app_meta set value = '999' where key = 'schema_version';
      end;
    `);
    const schemaWithTamperTrigger = schemaSnapshot(sqlite);

    expect(() => migrateDatabase(sqlite)).toThrow(/schema version/i);
    expect(schemaSnapshot(sqlite)).toBe(schemaWithTamperTrigger);
    expect(ledgerSnapshot(sqlite)).toBe(before.ledger);
    expect(appMetaSnapshot(sqlite)).toBe(before.meta);
    expect(() =>
      sqlite
        .prepare(
          `update skincare_plan_versions set effective_to_exclusive = '2026-08-12'
           where id = 'plan-version-published'`,
        )
        .run(),
    ).toThrow(/immutable/i);
  });

  it("rejects UPDATE, DELETE, and INSERT OR REPLACE for every append-only fact and published aggregate", () => {
    const sqlite = createDatabase();
    migrateDatabase(sqlite);
    insertV6Fixture(sqlite);

    for (const [table, id] of APPEND_ONLY_SKINCARE_TABLES) {
      expect(() => sqlite.prepare(`update ${table} set id = id where id = ?`).run(id)).toThrow(
        /immutable|append-only/i,
      );
      expect(() => sqlite.prepare(`delete from ${table} where id = ?`).run(id)).toThrow(
        /immutable|append-only/i,
      );
      sqlite.pragma("recursive_triggers = OFF");
      expect(() => sqlite.prepare(`insert or replace into ${table} (id) values (?)`).run(id)).toThrow(
        /immutable|append-only/i,
      );
      sqlite.pragma("recursive_triggers = ON");
    }

    const publishedMutations = [
      "update skincare_formulations set version_label = 'changed' where id = 'formulation-published'",
      "delete from skincare_formulations where id = 'formulation-published'",
      "insert or replace into skincare_formulations (id) values ('formulation-published')",
      "update skincare_formulation_ingredients set display_order = 1 where formulation_id = 'formulation-published' and ingredient_id = 'ingredient-1'",
      "delete from skincare_formulation_ingredients where formulation_id = 'formulation-published' and ingredient_id = 'ingredient-1'",
      "insert or replace into skincare_formulation_ingredients (formulation_id, ingredient_id) values ('formulation-published', 'ingredient-1')",
      "insert into skincare_formulation_ingredients (formulation_id, ingredient_id, display_order, is_key_active, concentration_state, concentration_text, function_tags_json, label_warnings_json, created_at) values ('formulation-published', 'ingredient-2', 1, 0, 'unknown', null, '[]', '[]', '2026-08-11T00:00:00.000Z')",
      "update skincare_plan_versions set version = 2 where id = 'plan-version-published'",
      "delete from skincare_plan_versions where id = 'plan-version-published'",
      "insert or replace into skincare_plan_versions (id) values ('plan-version-published')",
      "update skincare_phases set name = 'changed' where id = 'phase-published'",
      "delete from skincare_phases where id = 'phase-published'",
      "insert or replace into skincare_phases (id) values ('phase-published')",
      "insert into skincare_phases (id, plan_version_id, name, display_order, start_day, end_day_exclusive, created_at) values ('phase-published-insert', 'plan-version-published', 'Blocked', 1, 7, 14, '2026-08-11T00:00:00.000Z')",
      "update skincare_steps set amount_text = 'changed' where id = 'step-published'",
      "delete from skincare_steps where id = 'step-published'",
      "insert or replace into skincare_steps (id) values ('step-published')",
    ];
    for (const statement of publishedMutations) {
      expect(() => sqlite.exec(statement)).toThrow(/published|immutable/i);
    }
    expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
  });

  it.each([
    {
      name: "a conflicting final skincare index",
      inject: (sqlite: Database.Database) =>
        sqlite.exec("create index skincare_usage_events_date_slot_time_idx on app_meta(value)"),
    },
    {
      name: "a final schema-version corruption trigger",
      inject: (sqlite: Database.Database) =>
        sqlite.exec(`
          create trigger force_wrong_v8_version
          after update of value on app_meta
          when new.key = 'schema_version' and new.value = '17'
          begin update app_meta set value = '999' where key = 'schema_version'; end;
        `),
    },
  ])("rolls back the pending v6/v7 sequence exactly after $name", ({ inject }) => {
    const sqlite = createCurrentDatabaseAtPrefix(5);
    sqlite
      .prepare(
        `insert into knowledge_items
          (id, title, created_at, updated_at)
         values ('knowledge-v5-rollback', 'Preserve exact v5 bytes', ?, ?)`,
      )
      .run(ISO_TIMESTAMP, ISO_TIMESTAMP);
    inject(sqlite);
    const before = {
      schema: schemaSnapshot(sqlite),
      ledger: ledgerSnapshot(sqlite),
      appMeta: appMetaSnapshot(sqlite),
      knowledgeRows: sqlite
        .prepare("select * from knowledge_items where id = 'knowledge-v5-rollback'")
        .all(),
    };

    expect(() => migrateDatabase(sqlite)).toThrow(/skincare_usage_events_date_slot_time_idx|schema version/i);
    expect(schemaSnapshot(sqlite)).toBe(before.schema);
    expect(ledgerSnapshot(sqlite)).toBe(before.ledger);
    expect(appMetaSnapshot(sqlite)).toBe(before.appMeta);
    expect(
      sqlite.prepare("select * from knowledge_items where id = 'knowledge-v5-rollback'").all(),
    ).toEqual(before.knowledgeRows);
    expect(
      sqlite.prepare("select value from app_meta where key = 'schema_version'").pluck().get(),
    ).toBe("5");
    expect(sqlite.prepare("select count(*) from schema_migrations").pluck().get()).toBe(5);
    for (const table of REQUIRED_SKINCARE_TABLES) {
      expect(tableExists(sqlite, table), `rollback leaked skincare table: ${table}`).toBe(false);
    }
    expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
  });

  it("rolls back the complete v5 transaction when a legacy revision contains invalid JSON", () => {
    const sqlite = createVersionFourDatabase();
    const timestamp = "2026-08-11T00:00:00.000Z";
    sqlite.exec(`
      insert into knowledge_items (id, title, created_at, updated_at)
      values ('knowledge-invalid-json', 'Invalid JSON', '${timestamp}', '${timestamp}');
      insert into knowledge_item_revisions
        (id, knowledge_item_id, revision, snapshot_json, created_at)
      values ('revision-invalid-json', 'knowledge-invalid-json', 1, '{invalid', '${timestamp}');
    `);
    const before = {
      schema: schemaSnapshot(sqlite),
      ledger: ledgerSnapshot(sqlite),
      appMeta: appMetaSnapshot(sqlite),
      revision: sqlite.prepare(
        "select snapshot_json from knowledge_item_revisions where id = 'revision-invalid-json'",
      ).pluck().get(),
    };

    expect(() => migrateDatabase(sqlite)).toThrow(/json|check|malformed/i);
    expect(schemaSnapshot(sqlite)).toBe(before.schema);
    expect(ledgerSnapshot(sqlite)).toBe(before.ledger);
    expect(appMetaSnapshot(sqlite)).toBe(before.appMeta);
    expect(
      sqlite.prepare(
        "select snapshot_json from knowledge_item_revisions where id = 'revision-invalid-json'",
      ).pluck().get(),
    ).toBe(before.revision);
    expect(tableExists(sqlite, "knowledge_domains")).toBe(false);
    expect(indexExists(sqlite, "knowledge_items_domain_maturity_time_idx")).toBe(false);
  });

  it.each([
    ["array", "[]"],
    ["number", "42"],
    ["string", '"legacy"'],
    ["null", "null"],
    ["object with numeric domain", '{"domainKey":42}'],
    ["object with array domain", '{"domainKey":[]}'],
    ["object with object domain", '{"domainKey":{}}'],
    ["object with boolean domain", '{"domainKey":true}'],
  ])(
    "rolls back v5 when a legacy revision snapshot is a valid JSON %s",
    (_kind, snapshotJson) => {
      const sqlite = createVersionFourDatabase();
      const timestamp = "2026-08-11T00:00:00.000Z";
      sqlite.prepare(
        `insert into knowledge_items (id, title, created_at, updated_at)
         values ('knowledge-nonobject-json', 'Nonobject JSON', ?, ?)`,
      ).run(timestamp, timestamp);
      sqlite.prepare(
        `insert into knowledge_item_revisions
          (id, knowledge_item_id, revision, snapshot_json, created_at)
         values ('revision-nonobject-json', 'knowledge-nonobject-json', 1, ?, ?)`,
      ).run(snapshotJson, timestamp);
      const before = {
        schema: schemaSnapshot(sqlite),
        ledger: ledgerSnapshot(sqlite),
        appMeta: appMetaSnapshot(sqlite),
        rows: sqlite.prepare(
          "select * from knowledge_item_revisions order by id",
        ).all(),
      };

      expect(() => migrateDatabase(sqlite)).toThrow(/json|object|check/i);
      expect(schemaSnapshot(sqlite)).toBe(before.schema);
      expect(ledgerSnapshot(sqlite)).toBe(before.ledger);
      expect(appMetaSnapshot(sqlite)).toBe(before.appMeta);
      expect(
        sqlite.prepare("select * from knowledge_item_revisions order by id").all(),
      ).toEqual(before.rows);
      expect(tableExists(sqlite, "knowledge_domains")).toBe(false);
      expect(indexExists(sqlite, "knowledge_items_domain_maturity_time_idx")).toBe(false);
    },
  );

  it("normalizes null and missing revision domains so every migrated domain is JSON text", () => {
    const sqlite = createVersionFourDatabase();
    const timestamp = "2026-08-11T00:00:00.000Z";
    sqlite.exec(`
      insert into knowledge_items (id, title, created_at, updated_at)
      values
        ('knowledge-domain-missing', 'Missing domain', '${timestamp}', '${timestamp}'),
        ('knowledge-domain-null', 'Null domain', '${timestamp}', '${timestamp}');
      insert into knowledge_item_revisions
        (id, knowledge_item_id, revision, snapshot_json, created_at)
      values
        ('revision-domain-missing', 'knowledge-domain-missing', 1,
         '{"id":"knowledge-domain-missing"}', '${timestamp}'),
        ('revision-domain-null', 'knowledge-domain-null', 1,
         '{"id":"knowledge-domain-null","domainKey":null}', '${timestamp}');
    `);

    migrateDatabase(sqlite);

    expect(
      sqlite.prepare(
        `select id, json_extract(snapshot_json, '$.domainKey') as domain_key,
                json_type(snapshot_json, '$.domainKey') as domain_type
         from knowledge_item_revisions order by id`,
      ).all(),
    ).toEqual([
      {
        id: "revision-domain-missing",
        domain_key: "general",
        domain_type: "text",
      },
      {
        id: "revision-domain-null",
        domain_key: "general",
        domain_type: "text",
      },
    ]);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
  });

  it("enforces knowledge domain foreign keys and creates both domain indexes", () => {
    const sqlite = createDatabase();
    migrateDatabase(sqlite);
    const timestamp = "2026-08-11T00:00:00.000Z";
    sqlite.prepare(
      `insert into capture_items
        (id, event_type, corrects_item_id, business_date, occurred_at, content, created_at)
       values ('capture-domain-fk', 'capture', null, '2026-08-11', ?, 'Source', ?)`,
    ).run(timestamp, timestamp);

    expect(() => sqlite.prepare(
      `insert into knowledge_items
        (id, title, domain_key, created_at, updated_at)
       values ('knowledge-bad-domain', 'Bad', 'unknown', ?, ?)`,
    ).run(timestamp, timestamp)).toThrow(/foreign key/i);
    expect(() => sqlite.prepare(
      `insert into knowledge_candidates
        (id, source_capture_id, domain_key, title, content, status, created_at)
       values ('candidate-bad-domain', 'capture-domain-fk', 'unknown', 'Bad', 'Body',
               'pending', ?)`,
    ).run(timestamp)).toThrow(/foreign key/i);
    expect(indexExists(sqlite, "knowledge_items_domain_maturity_time_idx")).toBe(true);
    expect(indexExists(sqlite, "knowledge_candidates_domain_status_time_idx")).toBe(true);
    expect(
      sqlite.prepare(
        `select sql from sqlite_master
         where type = 'index' and name = 'knowledge_items_domain_maturity_time_idx'`,
      ).pluck().get(),
    ).toMatch(/domain_key, maturity, updated_at DESC, id DESC/);
    expect(
      sqlite.prepare(
        `select sql from sqlite_master
         where type = 'index' and name = 'knowledge_candidates_domain_status_time_idx'`,
      ).pluck().get(),
    ).toMatch(/domain_key, status, created_at DESC, id DESC/);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
  });

  it("fails closed when a five-migration ledger is missing the domain table", () => {
    const sqlite = createDatabase();
    migrateDatabase(sqlite);
    sqlite.exec("drop table knowledge_domains");
    const before = {
      schema: schemaSnapshot(sqlite),
      ledger: ledgerSnapshot(sqlite),
      appMeta: appMetaSnapshot(sqlite),
    };

    expect(() => migrateDatabase(sqlite)).toThrow(/domain schema/i);
    expect(schemaSnapshot(sqlite)).toBe(before.schema);
    expect(ledgerSnapshot(sqlite)).toBe(before.ledger);
    expect(appMetaSnapshot(sqlite)).toBe(before.appMeta);
  });

  it("rolls back the pending v5-v8 transaction when the final schema version is corrupted", () => {
    const sqlite = createVersionFourDatabase();
    const timestamp = "2026-08-11T00:00:00.000Z";
    const originalSnapshotJson = '{  "title" : "preserve exact v4 bytes"  }';
    sqlite
      .prepare(
        `insert into knowledge_items (id, title, created_at, updated_at)
         values ('knowledge-rollback-revision', 'Rollback revision', ?, ?)`,
      )
      .run(timestamp, timestamp);
    sqlite
      .prepare(
        `insert into knowledge_item_revisions
          (id, knowledge_item_id, revision, snapshot_json, created_at)
         values ('revision-rollback-revision', 'knowledge-rollback-revision', 1, ?, ?)`,
      )
      .run(originalSnapshotJson, timestamp);
    sqlite.exec(`
      create trigger force_wrong_v8_schema_version
      after update of value on app_meta
      when new.key = 'schema_version' and new.value = '17'
      begin
        update app_meta set value = '999' where key = 'schema_version';
      end
    `);
    const before = {
      schema: schemaSnapshot(sqlite),
      ledger: ledgerSnapshot(sqlite),
      appMeta: appMetaSnapshot(sqlite),
      revisions: sqlite
        .prepare(
          `select id, knowledge_item_id, revision, snapshot_json, created_at
           from knowledge_item_revisions
           where id = 'revision-rollback-revision'`,
        )
        .all(),
    };

    expect(() => migrateDatabase(sqlite)).toThrow(/schema version/i);
    expect(schemaSnapshot(sqlite)).toBe(before.schema);
    expect(ledgerSnapshot(sqlite)).toBe(before.ledger);
    expect(appMetaSnapshot(sqlite)).toBe(before.appMeta);
    expect(
      sqlite
        .prepare(
          `select id, knowledge_item_id, revision, snapshot_json, created_at
           from knowledge_item_revisions
           where id = 'revision-rollback-revision'`,
        )
        .all(),
    ).toEqual(before.revisions);
    expect(
      sqlite.prepare(
        "select snapshot_json from knowledge_item_revisions where id = 'revision-rollback-revision'",
      ).pluck().get(),
    ).toBe(originalSnapshotJson);
    expect(tableExists(sqlite, "knowledge_domains")).toBe(false);
  });

  it("creates the complete v13 schema while retaining daily-loop, knowledge, skincare, and Sleep", () => {
    const sqlite = createDatabase();

    migrateDatabase(sqlite, {
      applicationVersion: "0.1.0",
      now: () => new Date("2026-08-10T00:00:00.000Z"),
    });

    const names = sqlite
      .prepare("select name from sqlite_master where type = 'table' order by name")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(names).toEqual(
      expect.arrayContaining([
        "action_events",
        "daily_summaries",
        "daily_summary_revisions",
        "evidence_links",
        "knowledge_asset_events",
        "knowledge_candidates",
        "knowledge_domains",
        "knowledge_item_revisions",
        "review_revisions",
      ]),
    );
    expect(
      sqlite.prepare("select value from app_meta where key = 'schema_version'").pluck().get(),
    ).toBe("17");
    expect(sqlite.prepare("select count(*) from schema_migrations").pluck().get()).toBe(17);
    expect(
      sqlite
        .prepare(
          `select name from sqlite_master
           where type = 'index'
             and tbl_name = 'knowledge_candidates'
             and name not like 'sqlite_autoindex_%'
           order by name`,
        )
        .pluck()
        .all(),
    ).toEqual([
      "knowledge_candidates_domain_status_time_idx",
      "knowledge_candidates_source_time_idx",
      "knowledge_candidates_status_time_idx",
    ]);
    expect(
      sqlite
        .prepare(
          `select sql from sqlite_master
           where type = 'index' and name = 'knowledge_candidates_source_time_idx'`,
        )
        .pluck()
        .get(),
    ).toMatch(/source_capture_id, created_at DESC, id DESC/);
  });

  it("preserves version 2 actions and legacy documents while adding daily-loop fields", () => {
    const sqlite = createVersionTwoDatabase();
    const timestamp = "2026-08-09T12:00:00.000Z";
    sqlite
      .prepare(
        `insert into life_areas
          (id, name, display_order, revision, created_at, updated_at, archived_at)
         values ('area-existing', '成长', 0, 1, ?, ?, null)`,
      )
      .run(timestamp, timestamp);
    sqlite
      .prepare(
        `insert into goals
          (id, life_area_id, parent_goal_id, goal_type, title, status, revision,
           created_at, updated_at, archived_at)
         values ('goal-existing', 'area-existing', null, 'long-term', '长期目标',
                 'active', 4, ?, ?, null)`,
      )
      .run(timestamp, timestamp);
    sqlite
      .prepare(
        `insert into actions
          (id, goal_id, parent_action_id, action_type, business_date, title, status,
           revision, created_at, updated_at, archived_at)
         values ('weekly-existing', 'goal-existing', null, 'weekly', null,
                 '本周行动', 'pending', 2, ?, ?, null)`,
      )
      .run(timestamp, timestamp);
    sqlite
      .prepare(
        `insert into actions
          (id, goal_id, parent_action_id, action_type, business_date, title, status,
           revision, created_at, updated_at, archived_at)
         values ('today-existing', 'goal-existing', 'weekly-existing', 'today',
                 '2026-08-10', '今日任务', 'completed', 3, ?, ?, null)`,
      )
      .run(timestamp, timestamp);
    sqlite
      .prepare(
        `insert into knowledge_items
          (id, title, background, problem, insight, method, revision,
           created_at, updated_at, archived_at)
         values ('knowledge-existing', '旧知识', '背景', '问题', '洞察', '方法',
                 2, ?, ?, null)`,
      )
      .run(timestamp, timestamp);
    sqlite
      .prepare(
        `insert into daily_entries
          (id, entry_type, parent_entry_id, business_date, content, revision,
           created_at, updated_at, archived_at)
         values ('summary-existing', 'summary', null, '2026-08-09', '旧版晚间总结',
                 2, ?, ?, null)`,
      )
      .run(timestamp, timestamp);
    sqlite
      .prepare(
        `insert into reviews
          (id, review_type, period_start, period_end_exclusive, content, revision,
           created_at, updated_at, archived_at)
         values ('review-existing', 'daily', '2026-08-09', '2026-08-10',
                 '旧版复盘', 2, ?, ?, null)`,
      )
      .run(timestamp, timestamp);

    migrateDatabase(sqlite, {
      applicationVersion: "0.1.0",
      now: () => new Date("2026-08-10T00:00:00.000Z"),
    });

    expect(
      sqlite
        .prepare(
          `select id, goal_id, parent_action_id, status, priority,
                  estimated_minutes, notes, revision
           from actions order by id`,
        )
        .all(),
    ).toEqual([
      {
        id: "today-existing",
        goal_id: "goal-existing",
        parent_action_id: "weekly-existing",
        status: "completed",
        priority: "normal",
        estimated_minutes: null,
        notes: "",
        revision: 3,
      },
      {
        id: "weekly-existing",
        goal_id: "goal-existing",
        parent_action_id: null,
        status: "pending",
        priority: "normal",
        estimated_minutes: null,
        notes: "",
        revision: 2,
      },
    ]);
    expect(() =>
      sqlite
        .prepare(
          `insert into actions
            (id, goal_id, parent_action_id, action_type, business_date, title, status,
             priority, estimated_minutes, notes, revision, created_at, updated_at, archived_at)
           values ('independent-action', null, null, 'today', '2026-08-10',
                   '临时任务', 'pending', 'high', 30, '', 1, ?, ?, null)`,
        )
        .run(timestamp, timestamp),
    ).not.toThrow();
    expect(
      sqlite.prepare("select content from knowledge_items where id = 'knowledge-existing'").pluck().get(),
    ).toContain("洞察");
    expect(
      sqlite
        .prepare(
          "select count(*) from knowledge_item_revisions where knowledge_item_id = 'knowledge-existing'",
        )
        .pluck()
        .get(),
    ).toBe(1);
    expect(
      sqlite
        .prepare(
          "select important_events from daily_summaries where business_date = '2026-08-09'",
        )
        .pluck()
        .get(),
    ).toBe("旧版晚间总结");
    expect(
      sqlite
        .prepare("select count(*) from review_revisions where review_id = 'review-existing'")
        .pluck()
        .get(),
    ).toBe(1);
    expect(
      sqlite.prepare("select content from daily_entries where id = 'summary-existing'").pluck().get(),
    ).toBe("旧版晚间总结");
  });

  it("preserves a legacy today action whose business date is unknown", () => {
    const sqlite = createVersionTwoDatabase();
    const timestamp = "2026-08-09T08:00:00.000Z";
    sqlite
      .prepare(
        `insert into life_areas
          (id, name, display_order, revision, created_at, updated_at, archived_at)
         values ('area-legacy', 'Legacy', 0, 1, ?, ?, null)`,
      )
      .run(timestamp, timestamp);
    sqlite
      .prepare(
        `insert into goals
          (id, life_area_id, parent_goal_id, goal_type, title, status,
           revision, created_at, updated_at, archived_at)
         values ('goal-legacy', 'area-legacy', null, 'long-term', 'Legacy goal',
                 'active', 1, ?, ?, null)`,
      )
      .run(timestamp, timestamp);
    sqlite
      .prepare(
        `insert into actions
          (id, goal_id, parent_action_id, action_type, business_date, title, status,
           revision, created_at, updated_at, archived_at)
         values ('today-without-date', 'goal-legacy', null, 'today', null,
                 'Legacy task without a known date', 'pending', 1, ?, ?, null)`,
      )
      .run(timestamp, timestamp);

    expect(() => migrateDatabase(sqlite)).not.toThrow();
    expect(
      sqlite
        .prepare("select business_date from actions where id = 'today-without-date'")
        .pluck()
        .get(),
    ).toBeNull();
    expect(() =>
      sqlite
        .prepare(
          `insert into actions
            (id, goal_id, parent_action_id, action_type, business_date, title, status,
             revision, created_at, updated_at, archived_at)
           values ('new-today-without-date', 'goal-legacy', null, 'today', null,
                   'New invalid task', 'pending', 1, ?, ?, null)`,
        )
        .run(timestamp, timestamp),
    ).toThrow(/business date/i);
    expect(() =>
      sqlite
        .prepare(
          "update actions set title = 'Changed without repair' where id = 'today-without-date'",
        )
        .run(),
    ).toThrow(/business date/i);
    expect(
      sqlite
        .prepare("select title from actions where id = 'today-without-date'")
        .pluck()
        .get(),
    ).toBe("Legacy task without a known date");
  });

  it("imports the most recently updated legacy summary for each day", () => {
    const sqlite = createVersionTwoDatabase();
    sqlite
      .prepare(
        `insert into daily_entries
          (id, entry_type, parent_entry_id, business_date, content, revision,
           created_at, updated_at, archived_at)
         values (?, 'summary', null, '2026-08-09', ?, ?, ?, ?, null)`,
      )
      .run(
        "summary-high-revision",
        "older update",
        99,
        "2026-08-09T08:00:00.000Z",
        "2026-08-09T08:00:00.000Z",
      );
    sqlite
      .prepare(
        `insert into daily_entries
          (id, entry_type, parent_entry_id, business_date, content, revision,
           created_at, updated_at, archived_at)
         values (?, 'summary', null, '2026-08-09', ?, ?, ?, ?, null)`,
      )
      .run(
        "summary-latest-update",
        "latest update",
        1,
        "2026-08-09T21:00:00.000Z",
        "2026-08-09T21:00:00.000Z",
      );

    migrateDatabase(sqlite);

    expect(
      sqlite
        .prepare("select important_events from daily_summaries where business_date = ?")
        .pluck()
        .get("2026-08-09"),
    ).toBe("latest update");
  });

  it("preserves duplicate legacy reviews while selecting one active current review", () => {
    const sqlite = createVersionTwoDatabase();
    const insert = sqlite.prepare(
      `insert into reviews
        (id, review_type, period_start, period_end_exclusive, content, revision,
         created_at, updated_at, archived_at)
       values (?, 'daily', '2026-08-09', '2026-08-10', ?, ?, ?, ?, null)`,
    );
    insert.run(
      "review-older",
      "older review",
      9,
      "2026-08-09T08:00:00.000Z",
      "2026-08-09T08:00:00.000Z",
    );
    insert.run(
      "review-latest",
      "latest review",
      1,
      "2026-08-09T21:00:00.000Z",
      "2026-08-09T21:00:00.000Z",
    );

    expect(() => migrateDatabase(sqlite)).not.toThrow();
    expect(
      sqlite
        .prepare(
          `select id from reviews
           where review_type = 'daily' and period_start = '2026-08-09'
             and period_end_exclusive = '2026-08-10' and archived_at is null`,
        )
        .pluck()
        .all(),
    ).toEqual(["review-latest"]);
    expect(sqlite.prepare("select count(*) from reviews").pluck().get()).toBe(2);
    expect(sqlite.prepare("select count(*) from review_revisions").pluck().get()).toBe(2);
  });

  it("requires rescheduled action facts to carry both source and destination dates", () => {
    const sqlite = createDatabase();
    const timestamp = "2026-08-10T08:00:00.000Z";
    migrateDatabase(sqlite);
    sqlite
      .prepare(
        `insert into actions
          (id, goal_id, parent_action_id, action_type, business_date, title, status,
           priority, estimated_minutes, notes, revision, created_at, updated_at, archived_at)
         values ('action-for-reschedule', null, null, 'today', '2026-08-10', '待改期行动',
                 'pending', 'normal', null, '', 1, ?, ?, null)`,
      )
      .run(timestamp, timestamp);

    const insertEvent = sqlite.prepare(
      `insert into action_events
        (id, action_id, event_type, business_date, from_business_date,
         to_business_date, occurred_at, payload_json)
       values (?, 'action-for-reschedule', ?, '2026-08-10', ?, ?, ?, '{}')`,
    );

    expect(() =>
      insertEvent.run(
        "event-rescheduled",
        "rescheduled",
        "2026-08-10",
        "2026-08-11",
        timestamp,
      ),
    ).not.toThrow();
    expect(() =>
      insertEvent.run(
        "event-incomplete-reschedule",
        "rescheduled",
        "2026-08-10",
        null,
        timestamp,
      ),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      insertEvent.run(
        "event-completed-with-date-range",
        "completed",
        "2026-08-10",
        "2026-08-11",
        timestamp,
      ),
    ).toThrow(/CHECK constraint failed/);
  });

  it("requires knowledge candidate decision fields to match their lifecycle state", () => {
    const sqlite = createDatabase();
    const timestamp = "2026-08-10T08:00:00.000Z";
    migrateDatabase(sqlite);
    const insertCapture = sqlite.prepare(
      `insert into capture_items
        (id, event_type, corrects_item_id, business_date, occurred_at, content, created_at)
       values (?, 'capture', null, '2026-08-10', ?, ?, ?)`,
    );
    for (const id of [
      "capture-pending",
      "capture-approved",
      "capture-rejected",
      "capture-invalid",
    ]) {
      insertCapture.run(id, timestamp, `内容 ${id}`, timestamp);
    }
    sqlite
      .prepare(
        `insert into knowledge_items (id, title, created_at, updated_at)
         values ('knowledge-approved', '已批准知识', ?, ?)`,
      )
      .run(timestamp, timestamp);

    const insertCandidate = sqlite.prepare(
      `insert into knowledge_candidates
        (id, source_capture_id, title, content, tags_json, status,
         decided_knowledge_item_id, created_at, decided_at)
       values (?, ?, '候选知识', '候选内容', '[]', ?, ?, ?, ?)`,
    );

    expect(() =>
      insertCandidate.run(
        "candidate-pending",
        "capture-pending",
        "pending",
        null,
        timestamp,
        null,
      ),
    ).not.toThrow();
    expect(() =>
      insertCandidate.run(
        "candidate-approved",
        "capture-approved",
        "approved",
        "knowledge-approved",
        timestamp,
        timestamp,
      ),
    ).not.toThrow();
    expect(() =>
      insertCandidate.run(
        "candidate-rejected",
        "capture-rejected",
        "rejected",
        null,
        timestamp,
        timestamp,
      ),
    ).not.toThrow();
    expect(() =>
      insertCandidate.run(
        "candidate-invalid",
        "capture-invalid",
        "approved",
        null,
        timestamp,
        timestamp,
      ),
    ).toThrow(/CHECK constraint failed/);
  });

  it("migrates an approved v3 candidate without field loss and allows independent candidates for one capture", () => {
    const sqlite = createVersionThreeDatabase();
    const timestamp = "2026-08-10T08:00:00.000Z";
    const decidedAt = "2026-08-10T08:30:00.000Z";
    sqlite
      .prepare(
        `insert into capture_items
          (id, event_type, corrects_item_id, business_date, occurred_at, content, created_at)
         values ('capture-many', 'capture', null, '2026-08-10', ?, 'source', ?)`,
      )
      .run(timestamp, timestamp);
    sqlite
      .prepare(
        `insert into knowledge_items (id, title, created_at, updated_at)
         values ('knowledge-approved', 'approved item', ?, ?)`,
      )
      .run(timestamp, timestamp);
    sqlite
      .prepare(
        `insert into knowledge_candidates
          (id, source_capture_id, title, content, tags_json, status,
           decided_knowledge_item_id, created_at, decided_at)
         values ('candidate-existing', 'capture-many', 'existing title', 'existing content',
                 '["legacy"]', 'approved', 'knowledge-approved', ?, ?)`,
      )
      .run(timestamp, decidedAt);

    migrateDatabase(sqlite, {
      applicationVersion: "0.1.0",
      now: () => new Date("2026-08-10T09:00:00.000Z"),
    });

    expect(
      sqlite
        .prepare(
          `select id, source_capture_id, title, content, tags_json, status,
                  decided_knowledge_item_id, created_at, decided_at
           from knowledge_candidates order by id`,
        )
        .all(),
    ).toEqual([
      {
        id: "candidate-existing",
        source_capture_id: "capture-many",
        title: "existing title",
        content: "existing content",
        tags_json: '["legacy"]',
        status: "approved",
        decided_knowledge_item_id: "knowledge-approved",
        created_at: timestamp,
        decided_at: decidedAt,
      },
    ]);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);

    const insertCandidate = sqlite.prepare(
      `insert into knowledge_candidates
        (id, source_capture_id, title, content, tags_json, status,
         decided_knowledge_item_id, created_at, decided_at)
       values (?, ?, ?, 'candidate content', '[]', ?, ?, ?, ?)`,
    );
    expect(() =>
      insertCandidate.run(
        "candidate-approved",
        "capture-many",
        "approved title",
        "approved",
        "knowledge-approved",
        timestamp,
        timestamp,
      ),
    ).not.toThrow();
    expect(() =>
      insertCandidate.run(
        "candidate-invalid-lifecycle",
        "capture-many",
        "invalid title",
        "approved",
        null,
        timestamp,
        timestamp,
      ),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      insertCandidate.run(
        "candidate-missing-capture",
        "missing-capture",
        "foreign key title",
        "pending",
        null,
        timestamp,
        null,
      ),
    ).toThrow(/FOREIGN KEY constraint failed/);
    expect(
      sqlite
        .prepare(
          `select id, status, decided_knowledge_item_id, decided_at
           from knowledge_candidates where source_capture_id = 'capture-many' order by id`,
        )
        .all(),
    ).toEqual([
      {
        id: "candidate-approved",
        status: "approved",
        decided_knowledge_item_id: "knowledge-approved",
        decided_at: timestamp,
      },
      {
        id: "candidate-existing",
        status: "approved",
        decided_knowledge_item_id: "knowledge-approved",
        decided_at: decidedAt,
      },
    ]);
    expect(
      sqlite.prepare("select value from app_meta where key = 'schema_version'").pluck().get(),
    ).toBe("17");
  });

  it("rolls back a failed v3-to-v4 candidate migration without losing the v3 table or rows", () => {
    const sqlite = createVersionThreeDatabase();
    const timestamp = "2026-08-10T08:00:00.000Z";
    sqlite
      .prepare(
        `insert into capture_items
          (id, event_type, corrects_item_id, business_date, occurred_at, content, created_at)
         values ('capture-atomic', 'capture', null, '2026-08-10', ?, 'source', ?)`,
      )
      .run(timestamp, timestamp);
    sqlite
      .prepare(
        `insert into knowledge_candidates
          (id, source_capture_id, title, content, tags_json, status,
           decided_knowledge_item_id, created_at, decided_at)
         values ('candidate-atomic', 'capture-atomic', 'title', 'content', '[]', 'pending',
                 null, ?, null)`,
      )
      .run(timestamp);
    sqlite.exec("create index knowledge_candidates_source_time_idx on app_meta (value)");

    expect(() => migrateDatabase(sqlite)).toThrow(/knowledge_candidates_source_time_idx/);
    expect(
      sqlite.prepare("select value from app_meta where key = 'schema_version'").pluck().get(),
    ).toBe("3");
    expect(sqlite.prepare("select count(*) from schema_migrations").pluck().get()).toBe(3);
    expect(
      sqlite.prepare("select id, source_capture_id from knowledge_candidates").all(),
    ).toEqual([{ id: "candidate-atomic", source_capture_id: "capture-atomic" }]);
    expect(() =>
      sqlite
        .prepare(
          `insert into knowledge_candidates
            (id, source_capture_id, title, content, tags_json, status,
             decided_knowledge_item_id, created_at, decided_at)
           values ('candidate-atomic-second', 'capture-atomic', 'title', 'content', '[]',
                   'pending', null, ?, null)`,
        )
        .run(timestamp),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it.each(
    [1, 2, 3, 4, 5, 6, 7].flatMap((prefix) => [
      {
        prefix,
        corruption: "missing",
        corrupt: (sqlite: Database.Database) =>
          sqlite.prepare("delete from app_meta where key = 'schema_version'").run(),
      },
      {
        prefix,
        corruption: "invalid",
        corrupt: (sqlite: Database.Database) =>
          sqlite
            .prepare("update app_meta set value = 'not-a-version' where key = 'schema_version'")
            .run(),
      },
      {
        prefix,
        corruption: "future",
        corrupt: (sqlite: Database.Database) =>
          sqlite
            .prepare("update app_meta set value = '999' where key = 'schema_version'")
            .run(),
      },
    ]),
  )(
    "fails closed for current ledger prefix $prefix with $corruption schema version",
    ({ prefix, corrupt }) => {
      const sqlite = createCurrentDatabaseAtPrefix(prefix);
      const entryId = `version-guard-entry-${prefix}`;
      sqlite
        .prepare(
          `insert into daily_entries
            (id, entry_type, parent_entry_id, business_date, content, revision,
             created_at, updated_at, archived_at)
           values (?, 'diary', null, '2026-08-10', 'preserve me', 1, ?, ?, null)`,
        )
        .run(entryId, "2026-08-10T08:00:00.000Z", "2026-08-10T08:00:00.000Z");
      corrupt(sqlite);

      const before = {
        schema: schemaSnapshot(sqlite),
        ledger: ledgerSnapshot(sqlite),
        appMeta: appMetaSnapshot(sqlite),
        uniqueSource: hasUniqueCandidateSourceConstraint(sqlite),
        sourceIndex: indexExists(sqlite, "knowledge_candidates_source_time_idx"),
      };

      expect(() => migrateDatabase(sqlite)).toThrow(/schema version/i);
      expect(schemaSnapshot(sqlite)).toBe(before.schema);
      expect(ledgerSnapshot(sqlite)).toBe(before.ledger);
      expect(appMetaSnapshot(sqlite)).toBe(before.appMeta);
      expect(hasUniqueCandidateSourceConstraint(sqlite)).toBe(before.uniqueSource);
      expect(indexExists(sqlite, "knowledge_candidates_source_time_idx")).toBe(
        before.sourceIndex,
      );
      expect(
        sqlite.prepare("select content from daily_entries where id = ?").pluck().get(entryId),
      ).toBe("preserve me");
      expect(before.uniqueSource).toBe(prefix === 3);
      expect(before.sourceIndex).toBe(prefix >= 4);
    },
  );

  it("rolls back v5-v8 when the transaction finishes with the wrong schema version", () => {
    const sqlite = createVersionFourDatabase();
    const timestamp = "2026-08-10T08:00:00.000Z";
    sqlite
      .prepare(
        `insert into capture_items
          (id, event_type, corrects_item_id, business_date, occurred_at, content, created_at)
         values ('capture-postcondition', 'capture', null, '2026-08-10', ?, 'source', ?)`,
      )
      .run(timestamp, timestamp);
    sqlite
      .prepare(
        `insert into knowledge_candidates
          (id, source_capture_id, title, content, tags_json, status,
           decided_knowledge_item_id, created_at, decided_at)
         values ('candidate-postcondition', 'capture-postcondition', 'title', 'content', '[]',
                 'pending', null, ?, null)`,
      )
      .run(timestamp);
    sqlite.exec(`
      create trigger force_wrong_migration_schema_version
      after update of value on app_meta
      when new.key = 'schema_version' and new.value = '17'
      begin
        update app_meta set value = '999' where key = 'schema_version';
      end
    `);

    const before = {
      schema: schemaSnapshot(sqlite),
      ledger: ledgerSnapshot(sqlite),
      candidates: sqlite
        .prepare("select id, source_capture_id from knowledge_candidates order by id")
        .all(),
    };

    expect(() => migrateDatabase(sqlite)).toThrow(/schema version/i);
    expect(schemaSnapshot(sqlite)).toBe(before.schema);
    expect(ledgerSnapshot(sqlite)).toBe(before.ledger);
    expect(
      sqlite.prepare("select value from app_meta where key = 'schema_version'").pluck().get(),
    ).toBe("4");
    expect(
      sqlite.prepare("select id, source_capture_id from knowledge_candidates order by id").all(),
    ).toEqual(before.candidates);
    expect(indexExists(sqlite, "knowledge_candidates_source_time_idx")).toBe(true);
    expect(indexExists(sqlite, "knowledge_candidates_domain_status_time_idx")).toBe(false);
    expect(hasUniqueCandidateSourceConstraint(sqlite)).toBe(false);
  });

  it("rejects mutation of new append-only daily-loop facts", () => {
    const sqlite = createDatabase();
    migrateDatabase(sqlite);
    const timestamp = "2026-08-10T08:00:00.000Z";
    sqlite
      .prepare(
        `insert into actions
          (id, goal_id, parent_action_id, action_type, business_date, title, status,
           priority, estimated_minutes, notes, revision, created_at, updated_at, archived_at)
         values ('action-immutable', null, null, 'today', '2026-08-10', '不可变测试',
                 'completed', 'normal', null, '', 1, ?, ?, null)`,
      )
      .run(timestamp, timestamp);
    sqlite
      .prepare(
        `insert into action_events
          (id, action_id, event_type, business_date, from_business_date,
           to_business_date, occurred_at, payload_json)
         values ('event-immutable', 'action-immutable', 'completed', '2026-08-10',
                 null, null, ?, '{}')`,
      )
      .run(timestamp);

    expect(() =>
      sqlite.prepare("update action_events set payload_json = '{}' where id = 'event-immutable'").run(),
    ).toThrow(/immutable/i);
    expect(() =>
      sqlite.prepare("delete from action_events where id = 'event-immutable'").run(),
    ).toThrow(/immutable/i);
    sqlite.pragma("recursive_triggers = OFF");
    expect(() =>
      sqlite
        .prepare(
          `insert or replace into action_events
            (id, action_id, event_type, business_date, from_business_date,
             to_business_date, occurred_at, payload_json)
           values ('event-immutable', 'action-immutable', 'completed', '2026-08-10',
                   null, null, ?, '{"changed":true}')`,
        )
        .run(timestamp),
    ).toThrow(/immutable/i);
    expect(
      sqlite
        .prepare("select payload_json from action_events where id = 'event-immutable'")
        .pluck()
        .get(),
    ).toBe("{}");

    sqlite
      .prepare(
        `insert into capture_items
          (id, event_type, corrects_item_id, business_date, occurred_at, content, created_at)
         values ('capture-immutable', 'capture', null, '2026-08-10', ?, 'original', ?)`,
      )
      .run(timestamp, timestamp);
    sqlite
      .prepare(
        "insert into knowledge_items (id, title, created_at, updated_at) values ('knowledge-immutable', 'Knowledge', ?, ?)",
      )
      .run(timestamp, timestamp);
    sqlite
      .prepare(
        `insert into knowledge_item_revisions
          (id, knowledge_item_id, revision, snapshot_json, created_at)
         values ('knowledge-revision-original', 'knowledge-immutable', 1, '{}', ?)`,
      )
      .run(timestamp);
    sqlite
      .prepare(
        `insert into knowledge_asset_events
          (id, knowledge_item_id, event_type, note, occurred_at)
         values ('asset-event-immutable', 'knowledge-immutable', 'promoted', 'original', ?)`,
      )
      .run(timestamp);
    sqlite
      .prepare(
        `insert into daily_summaries
          (id, business_date, created_at, updated_at)
         values ('summary-immutable', '2026-08-10', ?, ?)`,
      )
      .run(timestamp, timestamp);
    sqlite
      .prepare(
        `insert into daily_summary_revisions
          (id, daily_summary_id, revision, snapshot_json, created_at)
         values ('summary-revision-original', 'summary-immutable', 1, '{}', ?)`,
      )
      .run(timestamp);
    sqlite
      .prepare(
        `insert into reviews
          (id, review_type, period_start, period_end_exclusive, created_at, updated_at)
         values ('review-immutable', 'daily', '2026-08-10', '2026-08-11', ?, ?)`,
      )
      .run(timestamp, timestamp);
    sqlite
      .prepare(
        `insert into review_revisions
          (id, review_id, revision, snapshot_json, created_at)
         values ('review-revision-original', 'review-immutable', 1, '{}', ?)`,
      )
      .run(timestamp);
    sqlite
      .prepare(
        `insert into evidence_links
          (id, target_type, target_id, target_revision, source_type, source_id, created_at)
         values ('evidence-original', 'knowledge_item', 'knowledge-immutable', 1,
                 'knowledge_item', 'knowledge-immutable', ?)`,
      )
      .run(timestamp);

    const replacementAttempts = [
      `insert or replace into capture_items
        (id, event_type, corrects_item_id, business_date, occurred_at, content, created_at)
       values ('capture-immutable', 'capture', null, '2026-08-10', '${timestamp}', 'changed', '${timestamp}')`,
      `insert or replace into knowledge_item_revisions
        (id, knowledge_item_id, revision, snapshot_json, created_at)
       values ('knowledge-revision-replacement', 'knowledge-immutable', 1, '{"changed":true}', '${timestamp}')`,
      `insert or replace into knowledge_asset_events
        (id, knowledge_item_id, event_type, note, occurred_at)
       values ('asset-event-immutable', 'knowledge-immutable', 'validated', 'changed', '${timestamp}')`,
      `insert or replace into daily_summary_revisions
        (id, daily_summary_id, revision, snapshot_json, created_at)
       values ('summary-revision-replacement', 'summary-immutable', 1, '{"changed":true}', '${timestamp}')`,
      `insert or replace into review_revisions
        (id, review_id, revision, snapshot_json, created_at)
       values ('review-revision-replacement', 'review-immutable', 1, '{"changed":true}', '${timestamp}')`,
      `insert or replace into evidence_links
        (id, target_type, target_id, target_revision, source_type, source_id, created_at)
       values ('evidence-replacement', 'knowledge_item', 'knowledge-immutable', 1,
               'knowledge_item', 'knowledge-immutable', '${timestamp}')`,
    ];

    for (const statement of replacementAttempts) {
      expect(() => sqlite.exec(statement)).toThrow(/immutable/i);
    }
  });

  it("creates the foundation tables and enables foreign keys", () => {
    const sqlite = createDatabase();

    migrateDatabase(sqlite);

    const names = sqlite
      .prepare("select name from sqlite_master where type = 'table' order by name")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(names).toEqual(
      expect.arrayContaining([
        "actions",
        "audit_events",
        "capture_items",
        "daily_entries",
        "goals",
        "knowledge_items",
        "life_areas",
        "metric_definition_versions",
        "metric_definitions",
        "metric_records",
        "reviews",
      ]),
    );
    expect(names).not.toEqual(expect.arrayContaining(["users", "tenants", "roles"]));
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(sqlite.pragma("recursive_triggers", { simple: true })).toBe(1);
  });

  it("is idempotent and records the single-owner schema identity", () => {
    const sqlite = createDatabase();

    const now = () => new Date("2026-08-10T00:00:00.000Z");
    migrateDatabase(sqlite, { applicationVersion: "0.1.0", now });
    migrateDatabase(sqlite, { applicationVersion: "0.1.0", now });

    const metadata = sqlite
      .prepare("select key, value from app_meta order by key")
      .all() as Array<{ key: string; value: string }>;
    expect(metadata).toEqual([
      { key: "ownership_mode", value: "single-owner" },
      { key: "schema_version", value: "17" },
    ]);
    expect(
      sqlite
        .prepare(
          "select id, checksum, application_version, applied_at from schema_migrations",
        )
        .all(),
    ).toEqual([
      {
        id: "0000_foundation",
        checksum: "6fad9626ef61ee698cdae92fabf6bc0785f9b8d8c7db76b1e961bcd972380a7c",
        application_version: "0.1.0",
        applied_at: "2026-08-10T00:00:00.000Z",
      },
      {
        id: "0001_trusted_today_capture",
        checksum: "b3aa60c65b613d9596c902b4a9fd4b315ca24dd2477e948032194a08b0359fbb",
        application_version: "0.1.0",
        applied_at: "2026-08-10T00:00:00.000Z",
      },
      {
        id: "0002_daily_closed_loop",
        checksum: "a9f558277032f0e054a54833a978a978e64650c4a786430a0808ef0224bb5c6e",
        application_version: "0.1.0",
        applied_at: "2026-08-10T00:00:00.000Z",
      },
      {
        id: "0003_knowledge_candidates_many",
        checksum: "01706a04d54a6e13a772af8f4c9af1aa393042b7ca58bfe5cc99d36dcd984b62",
        application_version: "0.1.0",
        applied_at: "2026-08-10T00:00:00.000Z",
      },
      {
        id: "0004_knowledge_domains",
        checksum: "bd69632a950ccbc21c096fd61a2c22f9dd846998d161048fef7b64898e956209",
        application_version: "0.1.0",
        applied_at: "2026-08-10T00:00:00.000Z",
      },
      {
        id: "0005_skincare_domain",
        checksum: "146ae498f7cef369de1f3884f7ddf6136d70f7c6a03b7f64dfb9695ca14c5e08",
        application_version: "0.1.0",
        applied_at: "2026-08-10T00:00:00.000Z",
      },
      {
        id: "0006_skincare_plan_interval",
        checksum: "b6d723c5383987ab08a39c9b166f7fcb00867b61a562a2794ee8c9b58472d709",
        application_version: "0.1.0",
        applied_at: "2026-08-10T00:00:00.000Z",
      },
      {
        id: "0007_sleep_domain",
        checksum: "ad3d5fbcbe79813242024ea67688e0da211e88a86f668c25c6825b4895011466",
        application_version: "0.1.0",
        applied_at: "2026-08-10T00:00:00.000Z",
      },
      {
        id: "0008_exercise_domain",
        checksum: "95e90f3b5d5d361b3655ceefad29d8737a499ed0e49c7000f0dffafd830800cf",
        application_version: "0.1.0",
        applied_at: "2026-08-10T00:00:00.000Z",
      },
      {
        id: "0009_personal_accumulation_foundation",
        checksum: "88e8f4e139133cd602f6a8ea2bda25359d86191555957a12040fe5872d4b7a73",
        application_version: "0.1.0",
        applied_at: "2026-08-10T00:00:00.000Z",
      },
      {
        id: "0010_manual_exercise_records",
        checksum: "90d1ce0540dc127a79f870c6540a7d425ed75c1fd998866a7664361fe9c539cf",
        application_version: "0.1.0",
        applied_at: "2026-08-10T00:00:00.000Z",
      },
      {
        id: "0011_manual_skincare_records",
        checksum: "2018b24e71dd0026ff2fa1c34553889acba9fdb8e2bfad1b28616b6d462b7543",
        application_version: "0.1.0",
        applied_at: "2026-08-10T00:00:00.000Z",
      },
      {
        id: "0012_personal_knowledge_foundation",
        checksum: "31d7e0cf4cd8c81ba572c714b74b17d873e8be4770d91a3155f80dfb89eb1256",
        application_version: "0.1.0",
        applied_at: "2026-08-10T00:00:00.000Z",
      },
      {
        id: "0013_weekly_review_pins",
        checksum: "a6ec07129aea012e0a0b5b7fa9e5d4d01865f3d9699086ed6a5a89c60566f710",
        application_version: "0.1.0",
        applied_at: "2026-08-10T00:00:00.000Z",
      },
      {
        id: "0014_reading_domain",
        checksum: "2cad12a10d3e94963ca73e67e28167a8d0653b34857315832914131b7bee84b9",
        application_version: "0.1.0",
        applied_at: "2026-08-10T00:00:00.000Z",
      },
      {
        id: "0015_reading_sessions",
        checksum: "7c1815245c5535ffdc5c9361b956f4eba27173b5076a89f5f2594f667bcea540",
        application_version: "0.1.0",
        applied_at: "2026-08-10T00:00:00.000Z",
      },
      {
        id: "0016_manual_exercise_progress",
        checksum: "e8fc8147c077f1c746feeba101471e2faa56e13889ed9f43bf5b3f4cac5868f1",
        application_version: "0.1.0",
        applied_at: "2026-08-10T00:00:00.000Z",
      },
    ]);
  });

  it("migrates fresh and legacy foundations to the same v13 ID and checksum sequence", () => {
    const fresh = createDatabase();
    const legacy = createLegacyFoundationDatabase();

    const options = {
      now: () => new Date("2026-08-10T00:00:00.000Z"),
      applicationVersion: "0.1.0",
    };
    migrateDatabase(fresh, options);
    migrateDatabase(legacy, options);

    const selectLedger = (sqlite: Database.Database) =>
      sqlite
        .prepare(
          "select id, checksum, application_version from schema_migrations order by rowid",
        )
        .all() as Array<{
        id: string;
        checksum: string;
        application_version: string | null;
      }>;
    const freshLedger = selectLedger(fresh);
    const legacyLedger = selectLedger(legacy);

    expect(
      freshLedger.map(({ id, checksum }) => ({ id, checksum })),
    ).toEqual(legacyLedger.map(({ id, checksum }) => ({ id, checksum })));
    expect(
      fresh
        .prepare("select value from app_meta where key = 'schema_version'")
        .pluck()
        .get(),
    ).toBe("17");
    expect(
      legacy
        .prepare("select value from app_meta where key = 'schema_version'")
        .pluck()
        .get(),
    ).toBe("17");
    expect(freshLedger.map((item) => item.application_version)).toEqual([
      "0.1.0",
      "0.1.0",
      "0.1.0",
      "0.1.0",
      "0.1.0",
      "0.1.0",
      "0.1.0",
      "0.1.0",
      "0.1.0",
      "0.1.0",
      "0.1.0",
      "0.1.0",
      "0.1.0",
      "0.1.0",
      "0.1.0",
      "0.1.0",
      "0.1.0",
    ]);
    expect(legacyLedger).toEqual([
      {
        id: "0000_foundation",
        checksum: "6fad9626ef61ee698cdae92fabf6bc0785f9b8d8c7db76b1e961bcd972380a7c",
        application_version: null,
      },
      {
        id: "0001_trusted_today_capture",
        checksum: "b3aa60c65b613d9596c902b4a9fd4b315ca24dd2477e948032194a08b0359fbb",
        application_version: "0.1.0",
      },
      {
        id: "0002_daily_closed_loop",
        checksum: "a9f558277032f0e054a54833a978a978e64650c4a786430a0808ef0224bb5c6e",
        application_version: "0.1.0",
      },
      {
        id: "0003_knowledge_candidates_many",
        checksum: "01706a04d54a6e13a772af8f4c9af1aa393042b7ca58bfe5cc99d36dcd984b62",
        application_version: "0.1.0",
      },
      {
        id: "0004_knowledge_domains",
        checksum: "bd69632a950ccbc21c096fd61a2c22f9dd846998d161048fef7b64898e956209",
        application_version: "0.1.0",
      },
      {
        id: "0005_skincare_domain",
        checksum: "146ae498f7cef369de1f3884f7ddf6136d70f7c6a03b7f64dfb9695ca14c5e08",
        application_version: "0.1.0",
      },
      {
        id: "0006_skincare_plan_interval",
        checksum: "b6d723c5383987ab08a39c9b166f7fcb00867b61a562a2794ee8c9b58472d709",
        application_version: "0.1.0",
      },
      {
        id: "0007_sleep_domain",
        checksum: "ad3d5fbcbe79813242024ea67688e0da211e88a86f668c25c6825b4895011466",
        application_version: "0.1.0",
      },
      {
        id: "0008_exercise_domain",
        checksum: "95e90f3b5d5d361b3655ceefad29d8737a499ed0e49c7000f0dffafd830800cf",
        application_version: "0.1.0",
      },
      {
        id: "0009_personal_accumulation_foundation",
        checksum: "88e8f4e139133cd602f6a8ea2bda25359d86191555957a12040fe5872d4b7a73",
        application_version: "0.1.0",
      },
      {
        id: "0010_manual_exercise_records",
        checksum: "90d1ce0540dc127a79f870c6540a7d425ed75c1fd998866a7664361fe9c539cf",
        application_version: "0.1.0",
      },
      {
        id: "0011_manual_skincare_records",
        checksum: "2018b24e71dd0026ff2fa1c34553889acba9fdb8e2bfad1b28616b6d462b7543",
        application_version: "0.1.0",
      },
      {
        id: "0012_personal_knowledge_foundation",
        checksum: "31d7e0cf4cd8c81ba572c714b74b17d873e8be4770d91a3155f80dfb89eb1256",
        application_version: "0.1.0",
      },
      {
        id: "0013_weekly_review_pins",
        checksum: "a6ec07129aea012e0a0b5b7fa9e5d4d01865f3d9699086ed6a5a89c60566f710",
        application_version: "0.1.0",
      },
      {
        id: "0014_reading_domain",
        checksum: "2cad12a10d3e94963ca73e67e28167a8d0653b34857315832914131b7bee84b9",
        application_version: "0.1.0",
      },
      {
        id: "0015_reading_sessions",
        checksum: "7c1815245c5535ffdc5c9361b956f4eba27173b5076a89f5f2594f667bcea540",
        application_version: "0.1.0",
      },
      {
        id: "0016_manual_exercise_progress",
        checksum: "e8fc8147c077f1c746feeba101471e2faa56e13889ed9f43bf5b3f4cac5868f1",
        application_version: "0.1.0",
      },
    ]);
    expect(
      legacy
        .prepare("select value from app_meta where key = ?")
        .pluck()
        .get("migration_ledger_adopted_from_v1"),
    ).toBe("true");
  });

  it.each([
    [
      "missing",
      (sqlite: Database.Database) =>
        sqlite.prepare("delete from app_meta where key = 'schema_version'").run(),
    ],
    [
      "invalid",
      (sqlite: Database.Database) =>
        sqlite
          .prepare("update app_meta set value = 'not-a-version' where key = 'schema_version'")
          .run(),
    ],
    [
      "future",
      (sqlite: Database.Database) =>
        sqlite.prepare("update app_meta set value = '999' where key = 'schema_version'").run(),
    ],
  ])(
    "rejects legacy ledger adoption with a %s schema version without changing legacy state",
    (_case, corrupt) => {
      const sqlite = createLegacyFoundationDatabase();
      insertLegacyCapture(sqlite, {
        id: "legacy-version-guard",
        content: "preserve legacy capture",
      });
      corrupt(sqlite);
      const before = {
        schema: schemaSnapshot(sqlite),
        ledger: JSON.stringify(
          sqlite.prepare("select id, applied_at from schema_migrations order by rowid").all(),
        ),
        appMeta: appMetaSnapshot(sqlite),
        dailyEntries: JSON.stringify(
          sqlite.prepare("select * from daily_entries order by id").all(),
        ),
      };

      expect(() => migrateDatabase(sqlite)).toThrow(/unsupported schema version/i);
      expect(schemaSnapshot(sqlite)).toBe(before.schema);
      expect(
        JSON.stringify(
          sqlite.prepare("select id, applied_at from schema_migrations order by rowid").all(),
        ),
      ).toBe(before.ledger);
      expect(appMetaSnapshot(sqlite)).toBe(before.appMeta);
      expect(JSON.stringify(sqlite.prepare("select * from daily_entries order by id").all())).toBe(
        before.dailyEntries,
      );
      expect(tableExists(sqlite, "capture_items")).toBe(false);
      expect(
        sqlite
          .prepare("select value from app_meta where key = ?")
          .pluck()
          .get("migration_ledger_adopted_from_v1"),
      ).toBeUndefined();
    },
  );

  it("keeps the capture migration manifest checksum synchronized with normalized SQL", () => {
    expect(migrationManifest).toContainEqual({
      id: "0001_trusted_today_capture",
      filename: "0001_trusted_today_capture.sql",
      sha256: "b3aa60c65b613d9596c902b4a9fd4b315ca24dd2477e948032194a08b0359fbb",
    });
    expect(loadMigrations(process.cwd()).map(({ id, sha256 }) => ({ id, sha256 }))).toContainEqual({
      id: "0001_trusted_today_capture",
      sha256: "b3aa60c65b613d9596c902b4a9fd4b315ca24dd2477e948032194a08b0359fbb",
    });
  });

  it("migrates legacy captures once and rejects mutation", () => {
    const sqlite = createLegacyFoundationDatabaseWithCapture();

    migrateDatabase(sqlite);
    migrateDatabase(sqlite);

    expect(
      sqlite.prepare("select id, content from capture_items order by id").all(),
    ).toEqual([{ id: "legacy-capture", content: "旧记录" }]);
    expect(
      () =>
        sqlite
          .prepare("update capture_items set content = '改写' where id = ?")
          .run("legacy-capture"),
    ).toThrow(/immutable/);
    expect(
      () =>
        sqlite.prepare("delete from capture_items where id = ?").run("legacy-capture"),
    ).toThrow(/immutable/);
  });

  it("preserves legacy capture content beyond the future input limit", () => {
    const sqlite = createLegacyFoundationDatabase();
    const legacyContent = "a".repeat(20_001);
    insertLegacyCapture(sqlite, {
      id: "legacy-20001",
      content: legacyContent,
    });

    migrateDatabase(sqlite);

    expect(
      sqlite
        .prepare("select content from capture_items where id = ?")
        .pluck()
        .get("legacy-20001"),
    ).toBe(legacyContent);
  });

  it("backfills archived legacy captures with opaque void IDs despite a void-like legacy ID", () => {
    const sqlite = createLegacyFoundationDatabase();
    insertLegacyCapture(sqlite, {
      id: "capture",
      content: "已归档记录",
      archivedAt: "2026-08-09T11:00:00.000Z",
    });
    insertLegacyCapture(sqlite, {
      id: "legacy-void-capture",
      content: "void 前缀记录",
      archivedAt: "2026-08-09T12:00:00.000Z",
    });

    migrateDatabase(sqlite);

    const voids = sqlite
      .prepare(
        `select id, corrects_item_id, occurred_at, content
         from capture_items where event_type = 'void' order by corrects_item_id`,
      )
      .all() as Array<{
      id: string;
      corrects_item_id: string;
      occurred_at: string;
      content: string;
    }>;
    expect(voids.map(({ corrects_item_id }) => corrects_item_id)).toEqual([
      "capture",
      "legacy-void-capture",
    ]);
    expect(voids).toHaveLength(2);
    for (const item of voids) {
      expect(item.id).toMatch(/^[a-f0-9]{32}$/);
      expect(item.id).not.toMatch(/^legacy-void-/);
      expect(item.content).toBe("由旧版归档状态迁移");
    }
    expect(
      voids.find((item) => item.corrects_item_id === "capture")?.occurred_at,
    ).toBe("2026-08-09T11:00:00.000Z");
  });

  it("rejects a self-referencing capture correction", () => {
    const sqlite = createMigratedFoundationDatabase();

    expect(() =>
      sqlite
        .prepare(
          `insert into capture_items
            (id, event_type, corrects_item_id, business_date, occurred_at, content, created_at)
           values (?, 'correction', ?, ?, ?, ?, ?)`,
        )
        .run(
          "self-correction",
          "self-correction",
          "2026-08-09",
          "2026-08-09T10:00:00.000Z",
          "不能引用自己",
          "2026-08-09T10:00:00.000Z",
        ),
    ).toThrow(/CHECK constraint failed/);
  });

  it("rejects a known migration when its required prefix is missing without changing state", () => {
    const sqlite = createDatabase();
    createChecksumLedger(sqlite);
    insertAppliedMigration(sqlite, "0001_trusted_today_capture");
    const schemaBefore = JSON.stringify(
      sqlite
        .prepare(
          "select type, name, tbl_name, rootpage, sql from sqlite_master order by type, name",
        )
        .all(),
    );
    const ledgerBefore = JSON.stringify(
      sqlite
        .prepare(
          "select id, checksum, application_version, applied_at from schema_migrations order by rowid",
        )
        .all(),
    );

    expect(() => migrateDatabase(sqlite)).toThrow(/prefix|顺序/);

    expect(
      JSON.stringify(
        sqlite
          .prepare(
            "select type, name, tbl_name, rootpage, sql from sqlite_master order by type, name",
          )
          .all(),
      ),
    ).toBe(schemaBefore);
    expect(
      JSON.stringify(
        sqlite
          .prepare(
            "select id, checksum, application_version, applied_at from schema_migrations order by rowid",
          )
          .all(),
      ),
    ).toBe(ledgerBefore);
    expect(tableExists(sqlite, "capture_items")).toBe(false);
  });

  it("rejects a current prefix-zero ledger over foundation state without changing it", () => {
    const sqlite = createDatabase();
    createChecksumLedger(sqlite);
    sqlite.exec(`
      create table app_meta (
        key text primary key not null,
        value text not null
      );
      insert into app_meta (key, value) values ('preexisting', 'preserve me');
    `);
    const before = {
      schema: schemaSnapshot(sqlite),
      ledger: ledgerSnapshot(sqlite),
      appMeta: appMetaSnapshot(sqlite),
    };

    expect(() => migrateDatabase(sqlite)).toThrow(/foundation migration over an existing schema/i);
    expect(schemaSnapshot(sqlite)).toBe(before.schema);
    expect(ledgerSnapshot(sqlite)).toBe(before.ledger);
    expect(appMetaSnapshot(sqlite)).toBe(before.appMeta);
    expect(tableExists(sqlite, "life_areas")).toBe(false);
  });

  it.each([
    [
      "unknown migration",
      (sqlite: Database.Database) => insertLedger(sqlite, "9999_unknown"),
    ],
    [
      "checksum mismatch",
      (sqlite: Database.Database) => changeAppliedChecksum(sqlite, "0".repeat(64)),
    ],
  ])("fails closed for %s", (_name, arrange) => {
    const sqlite = createMigratedFoundationDatabase();
    arrange(sqlite);

    expect(() => migrateDatabase(sqlite)).toThrow();
  });

  it("rejects a null foundation application version without adoption evidence", () => {
    const sqlite = createMigratedFoundationDatabase();
    sqlite
      .prepare("update schema_migrations set application_version = null where id = ?")
      .run("0000_foundation");

    expect(() => migrateDatabase(sqlite)).toThrow();
  });

  it.each(["01.2.3", "1.2.3-01", "1.2.3-alpha..1"])(
    "rejects a SemVer-invalid recorded application version: %s",
    (applicationVersion) => {
    const sqlite = createMigratedFoundationDatabase();
    sqlite
      .prepare("update schema_migrations set application_version = ? where id = ?")
        .run(applicationVersion, "0000_foundation");

    expect(() => migrateDatabase(sqlite)).toThrow();
    },
  );

  it.each(["01.2.3", "1.2.3-01", "1.2.3-alpha..1"])(
    "rejects a SemVer-invalid applying application version: %s",
    (applicationVersion) => {
      const sqlite = createDatabase();

      expect(() => migrateDatabase(sqlite, { applicationVersion })).toThrow();
      expect(
        sqlite
          .prepare(
            "select name from sqlite_master where type = 'table' and name = 'schema_migrations'",
          )
          .get(),
      ).toBeUndefined();
    },
  );

  it("accepts a complete SemVer prerelease with build metadata", () => {
    const sqlite = createDatabase();

    migrateDatabase(sqlite, {
      applicationVersion: "1.2.3-rc.1+build.7",
      now: () => new Date("2026-08-10T00:00:00.000Z"),
    });

    expect(
      sqlite
        .prepare("select application_version from schema_migrations")
        .pluck()
        .get(),
    ).toBe("1.2.3-rc.1+build.7");
  });

  it("rejects a current-shaped ledger that lacks the required constraints", () => {
    const sqlite = createDatabase();
    sqlite.exec(`
      create table schema_migrations (
        id text,
        checksum text,
        application_version text,
        applied_at text
      )
    `);

    expect(() => migrateDatabase(sqlite, { applicationVersion: "0.1.0" })).toThrow();
    expect(
      sqlite
        .prepare("select name from sqlite_master where type = 'table' and name = 'app_meta'")
        .get(),
    ).toBeUndefined();
  });

  it("rejects a current-shaped ledger with a composite primary key", () => {
    const sqlite = createDatabase();
    sqlite.exec(`
      create table schema_migrations (
        id text not null,
        checksum text not null,
        application_version text,
        applied_at text not null,
        primary key (id, checksum),
        check (application_version is not null or id = '0000_foundation')
      )
    `);

    expect(() => migrateDatabase(sqlite, { applicationVersion: "0.1.0" })).toThrow();
    expect(
      sqlite
        .prepare("select name from sqlite_master where type = 'table' and name = 'app_meta'")
        .get(),
    ).toBeUndefined();
  });

  it("rejects a current ledger whose constraint name only spoofs the version check", () => {
    const sqlite = createDatabase();
    sqlite.exec(`
      create table schema_migrations (
        id text primary key not null,
        checksum text not null,
        application_version text,
        applied_at text not null,
        constraint "CHECK (application_version IS NOT NULL OR id = '0000_foundation')" check (1)
      )
    `);

    expect(() => migrateDatabase(sqlite, { applicationVersion: "0.1.0" })).toThrow();
    expect(
      sqlite.prepare("select count(*) as count from schema_migrations").get(),
    ).toEqual({ count: 0 });
    expect(
      sqlite
        .prepare("select name from sqlite_master where type = 'table' and name = 'app_meta'")
        .get(),
    ).toBeUndefined();
  });

  it("propagates non-check constraint failures from the ledger probe", () => {
    const sqlite = createDatabase();
    sqlite.exec(`
      create table schema_migrations (
        id text primary key not null,
        checksum text not null,
        application_version text,
        applied_at text not null,
        check (application_version is not null or id = '0000_foundation')
      );
      create trigger schema_migrations_probe_error
      before insert on schema_migrations
      when new.application_version is null
      begin
        select raise(abort, 'unexpected migration probe failure');
      end;
    `);

    expect(() => migrateDatabase(sqlite, { applicationVersion: "0.1.0" })).toThrow(
      /unexpected migration probe failure/,
    );
    expect(
      sqlite.prepare("select count(*) as count from schema_migrations").get(),
    ).toEqual({ count: 0 });
    expect(
      sqlite
        .prepare("select name from sqlite_master where type = 'table' and name = 'app_meta'")
        .get(),
    ).toBeUndefined();
  });

  it("uses a checksum-shaped legal probe for a stricter current ledger", () => {
    const sqlite = createDatabase();
    sqlite.exec(`
      create table schema_migrations (
        id text primary key not null,
        checksum text not null check (length(checksum) = 64),
        application_version text,
        applied_at text not null,
        check (application_version is not null or id = '0000_foundation')
      )
    `);

    migrateDatabase(sqlite, {
      applicationVersion: "0.1.0",
      now: () => new Date("2026-08-10T00:00:00.000Z"),
    });

    expect(
      sqlite.prepare("select count(*) as count from schema_migrations").get(),
    ).toEqual({ count: 17 });
  });

  it.each([
    [
      "a non-primary id",
      `create table schema_migrations (
        id text not null,
        applied_at text not null
      )`,
    ],
    [
      "a non-text id",
      `create table schema_migrations (
        id varchar primary key not null,
        applied_at text not null
      )`,
    ],
    [
      "a nullable timestamp",
      `create table schema_migrations (
        id text primary key not null,
        applied_at text
      )`,
    ],
  ])("rejects a malformed legacy ledger with %s", (_name, ledgerDefinition) => {
    const sqlite = createLegacyFoundationDatabase(ledgerDefinition);

    expect(() => migrateDatabase(sqlite)).toThrow();
    expect(
      sqlite
        .prepare("select value from app_meta where key = ?")
        .pluck()
        .get("migration_ledger_adopted_from_v1"),
    ).toBeUndefined();
  });

  it("re-checks the ledger after another connection migrates before its write lock", () => {
    const [first, second] = createDatabasePair();
    let interleaved = false;
    const firstWithInterleaving = new Proxy(first, {
      get(target, property) {
        if (property === "transaction" && !interleaved) {
          interleaved = true;
          migrateDatabase(second, {
            applicationVersion: "0.1.0",
            now: () => new Date("2026-08-10T00:00:00.000Z"),
          });
        }

        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as Database.Database;

    migrateDatabase(firstWithInterleaving, {
      applicationVersion: "0.1.0",
      now: () => new Date("2026-08-10T00:00:00.000Z"),
    });

    expect(
      first.prepare("select count(*) as count from schema_migrations").get(),
    ).toEqual({ count: 17 });
  });

  it("fails closed when an applied daily-loop table is missing", () => {
    const sqlite = createDatabase();
    migrateDatabase(sqlite);
    sqlite.exec("drop table evidence_links");

    expect(() => migrateDatabase(sqlite)).toThrow(/daily-loop schema/);
    expect(
      sqlite.prepare("select count(*) as count from schema_migrations").get(),
    ).toEqual({ count: 17 });
  });

  it("fails closed when an applied capture table is missing", () => {
    const sqlite = createDatabase();
    migrateDatabase(sqlite);
    sqlite.exec("drop table capture_items");

    expect(() => migrateDatabase(sqlite)).toThrow(/capture schema/);
  });

  it("rejects records whose required parent does not exist", () => {
    const sqlite = createDatabase();
    migrateDatabase(sqlite);

    expect(() =>
      sqlite
        .prepare(
          `insert into metric_definitions
            (id, life_area_id, stable_key, revision, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "metric-1",
          "missing-area",
          "sleep-duration",
          1,
          "2026-08-09T12:00:00.000Z",
          "2026-08-09T12:00:00.000Z",
        ),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });
});
describe.skip("legacy professional Exercise schema v9 (removed by schema v18)", () => {
  it("retains all 18 authoritative Exercise tables after migrating through v10", () => {
    const sqlite = new Database(":memory:");
    try {
      migrateDatabase(sqlite);
      expect(sqlite.prepare("select value from app_meta where key = 'schema_version'").pluck().get()).toBe("17");
      const tables = new Set((sqlite.prepare("select name from sqlite_master where type = 'table'").all() as Array<{ name: string }>).map((row) => row.name));
      for (const table of ["exercise_movements", "exercise_movement_variants", "training_plans", "training_plan_versions", "training_workout_templates", "training_prescriptions", "strength_prescriptions", "cardio_prescriptions", "mobility_prescriptions", "training_cycles", "training_planned_occurrences", "training_sessions", "training_session_events", "strength_set_events", "cardio_segment_events", "mobility_hold_events", "training_recovery_observations", "training_recovery_observation_events"]) expect(tables.has(table), table).toBe(true);
    } finally { sqlite.close(); }
  });
});

describe("Personal accumulation schema v10", () => {
  const timestamp = "2026-08-12T00:00:00.000Z";

  function seedHealthTemplate(sqlite: Database.Database): void {
    sqlite.exec(`
      insert into health_checklist_templates
        (id, name, current_revision, created_at, updated_at)
      values ('health-template-1', 'Daily health', 1, '${timestamp}', '${timestamp}');
      insert into health_checklist_versions
        (id, template_id, revision, effective_from, change_note, created_at)
      values ('health-version-1', 'health-template-1', 1, '2026-08-12', '', '${timestamp}');
    `);
  }

  it.skip("legacy professional-domain row preservation removed by schema v18", () => {
    const fresh = createDatabase();
    migrateDatabase(fresh);
    expect(fresh.prepare("select value from app_meta where key = 'schema_version'").pluck().get()).toBe("25");
    for (const table of REQUIRED_PERSONAL_ACCUMULATION_TABLES) {
      expect(tableExists(fresh, table), `missing personal accumulation table: ${table}`).toBe(true);
    }

    const v9 = createCurrentDatabaseAtPrefix(9);
    v9.exec(`
      insert into knowledge_items (id, title, created_at, updated_at)
      values ('knowledge-v9-preserved', 'Keep knowledge', '${timestamp}', '${timestamp}');
      insert into skincare_products
        (id, brand, name, model, specification, status, revision, created_at, updated_at, archived_at)
      values ('skincare-v9-preserved', '', 'Keep skincare', '', '', 'active', 1, '${timestamp}', '${timestamp}', null);
      insert into sleep_plans (id, name, created_at, updated_at, archived_at)
      values ('sleep-v9-preserved', 'Keep sleep', '${timestamp}', '${timestamp}', null);
      insert into exercise_movements
        (id, name, category, revision, created_at, updated_at, archived_at)
      values ('exercise-v9-preserved', 'Keep exercise', 'strength', 1,
              '${timestamp}', '${timestamp}', null);
    `);

    migrateDatabase(v9);

    expect(v9.prepare("select value from app_meta where key = 'schema_version'").pluck().get()).toBe("25");
    expect(v9.prepare("select title from knowledge_items where id = 'knowledge-v9-preserved'").pluck().get()).toBe("Keep knowledge");
    expect(v9.prepare("select name from skincare_products where id = 'skincare-v9-preserved'").pluck().get()).toBe("Keep skincare");
    expect(v9.prepare("select name from sleep_plans where id = 'sleep-v9-preserved'").pluck().get()).toBe("Keep sleep");
    expect(v9.prepare("select name from exercise_movements where id = 'exercise-v9-preserved'").pluck().get()).toBe("Keep exercise");
  });

  it("enforces unique business dates and rejects nonexistent calendar dates", () => {
    const sqlite = createMigratedFoundationDatabase();
    seedHealthTemplate(sqlite);
    sqlite.prepare(`insert into sleep_daily_records
      (id, record_date, asleep_time, wake_time, calculated_duration_minutes,
       confirmed_duration_minutes, quality_text, note, revision, created_at, updated_at)
      values (?, ?, '23:30', '07:00', 450, null, 'Fine', '', 1, ?, ?)`)
      .run("sleep-day-1", "2026-08-12", timestamp, timestamp);
    expect(() => sqlite.prepare(`insert into sleep_daily_records
      (id, record_date, asleep_time, wake_time, calculated_duration_minutes,
       confirmed_duration_minutes, quality_text, note, revision, created_at, updated_at)
      values (?, ?, '23:30', '07:00', 450, null, 'Fine', '', 1, ?, ?)`)
      .run("sleep-day-2", "2026-08-12", timestamp, timestamp)).toThrow(/unique/i);

    sqlite.prepare(`insert into health_checklist_days
      (id, business_date, template_version_id, note, revision, created_at, updated_at)
      values (?, ?, 'health-version-1', '', 1, ?, ?)`)
      .run("health-day-1", "2026-08-12", timestamp, timestamp);
    expect(() => sqlite.prepare(`insert into health_checklist_days
      (id, business_date, template_version_id, note, revision, created_at, updated_at)
      values (?, ?, 'health-version-1', '', 1, ?, ?)`)
      .run("health-day-2", "2026-08-12", timestamp, timestamp)).toThrow(/unique/i);

    sqlite.prepare(`insert into personal_daily_notes
      (id, business_date, content, revision, created_at, updated_at)
      values (?, ?, '', 1, ?, ?)`)
      .run("personal-note-1", "2026-08-12", timestamp, timestamp);
    expect(() => sqlite.prepare(`insert into personal_daily_notes
      (id, business_date, content, revision, created_at, updated_at)
      values (?, ?, '', 1, ?, ?)`)
      .run("personal-note-2", "2026-08-12", timestamp, timestamp)).toThrow(/unique/i);

    for (const statement of [
      `insert into sleep_daily_records
        (id, record_date, asleep_time, wake_time, calculated_duration_minutes,
         confirmed_duration_minutes, quality_text, note, revision, created_at, updated_at)
       values ('sleep-invalid-date', '2026-02-30', '23:30', '07:00', 450, null, 'Fine', '', 1, '${timestamp}', '${timestamp}')`,
      `insert into health_checklist_versions
        (id, template_id, revision, effective_from, change_note, created_at)
       values ('health-version-invalid-date', 'health-template-1', 2, '2026-02-30', '', '${timestamp}')`,
      `insert into health_checklist_days
        (id, business_date, template_version_id, note, revision, created_at, updated_at)
       values ('health-day-invalid-date', '2026-02-30', 'health-version-1', '', 1,
               '${timestamp}', '${timestamp}')`,
      `insert into personal_daily_notes
        (id, business_date, content, revision, created_at, updated_at)
       values ('personal-note-invalid-date', '2026-02-30', '', 1, '${timestamp}', '${timestamp}')`,
    ]) {
      expect(() => sqlite.exec(statement)).toThrow(/check constraint/i);
    }
  });

  it("keeps health template versions and their item rows immutable, including replace", () => {
    const sqlite = createMigratedFoundationDatabase();
    seedHealthTemplate(sqlite);
    sqlite.exec(`insert into health_checklist_template_items
      (id, template_version_id, item_key, group_key, group_label, name,
       target_text, note, ordinal)
      values ('health-item-1', 'health-version-1', 'water-item', 'all-day',
              'All day', 'Drink water', '', '', 0)`);

    for (const statement of [
      "update health_checklist_versions set change_note = 'changed' where id = 'health-version-1'",
      "delete from health_checklist_versions where id = 'health-version-1'",
      `insert or replace into health_checklist_versions
        (id, template_id, revision, effective_from, change_note, created_at)
       values ('health-version-1', 'health-template-1', 1, '2026-08-12', 'changed', '${timestamp}')`,
      "update health_checklist_template_items set name = 'Changed' where id = 'health-item-1'",
      "delete from health_checklist_template_items where id = 'health-item-1'",
      `insert or replace into health_checklist_template_items
        (id, template_version_id, item_key, group_key, group_label, name,
         target_text, note, ordinal)
       values ('health-item-1', 'health-version-1', 'water-item', 'all-day',
               'All day', 'Changed', '', '', 0)`,
    ]) {
      expect(() => sqlite.exec(statement)).toThrow(/immutable/i);
    }
  });

  it("requires a real health day and consistent completion timestamps", () => {
    const sqlite = createMigratedFoundationDatabase();
    seedHealthTemplate(sqlite);
    sqlite.exec(`insert into health_checklist_days
      (id, business_date, template_version_id, note, revision, created_at, updated_at)
      values ('health-day-1', '2026-08-12', 'health-version-1', '', 1, '${timestamp}', '${timestamp}')`);

    const itemValues = (id: string, dayId: string, completed: number, completedAt: string) =>
      `('${id}', '${dayId}', '${id}-key', 'all-day', 'All day', 'Item', '', '', 0,
        ${completed}, ${completedAt})`;
    expect(() => sqlite.exec(`insert into health_checklist_day_items
      (id, day_id, item_key, group_key, group_label, name, target_text, note,
       ordinal, completed, completed_at) values ${itemValues("orphan", "missing-day", 0, "null")}`))
      .toThrow(/foreign key/i);
    expect(() => sqlite.exec(`insert into health_checklist_day_items
      (id, day_id, item_key, group_key, group_label, name, target_text, note,
       ordinal, completed, completed_at) values ${itemValues("missing-time", "health-day-1", 1, "null")}`))
      .toThrow(/check constraint/i);
    expect(() => sqlite.exec(`insert into health_checklist_day_items
      (id, day_id, item_key, group_key, group_label, name, target_text, note,
       ordinal, completed, completed_at) values ${itemValues("unexpected-time", "health-day-1", 0, `'${timestamp}'`)}`))
      .toThrow(/check constraint/i);
  });

  it.each(REQUIRED_PERSONAL_ACCUMULATION_TABLES)(
    "fails closed on reopen when required v10 table %s is missing",
    (table) => {
      const sqlite = createMigratedFoundationDatabase();
      sqlite.exec(`drop table ${table}`);

      expect(() => migrateDatabase(sqlite)).toThrow(/personal accumulation schema/i);
      expect(sqlite.prepare("select count(*) from schema_migrations").pluck().get()).toBe(25);
    },
  );

  it("rolls back all v10 state when the final migration fails", () => {
    const sqlite = createCurrentDatabaseAtPrefix(9);
    sqlite.exec("create index personal_daily_notes_date_idx on app_meta(key)");
    const before = {
      schema: schemaSnapshot(sqlite),
      ledger: ledgerSnapshot(sqlite),
      meta: appMetaSnapshot(sqlite),
    };

    expect(() => migrateDatabase(sqlite)).toThrow(/personal_daily_notes_date_idx/i);
    expect(schemaSnapshot(sqlite)).toBe(before.schema);
    expect(ledgerSnapshot(sqlite)).toBe(before.ledger);
    expect(appMetaSnapshot(sqlite)).toBe(before.meta);
    for (const table of REQUIRED_PERSONAL_ACCUMULATION_TABLES) {
      expect(tableExists(sqlite, table)).toBe(false);
    }
  });
});

describe("Manual exercise schema v11", () => {
  const timestamp = "2026-08-13T00:00:00.000Z";

  function seedManualExerciseTemplate(sqlite: Database.Database): void {
    sqlite.exec(`
      insert into manual_exercise_templates
        (id, name, current_revision, created_at, updated_at)
      values ('manual-template-1', 'Simple plan', 1, '${timestamp}', '${timestamp}');
      insert into manual_exercise_template_versions
        (id, template_id, revision, effective_from, change_note, created_at)
      values ('manual-version-1', 'manual-template-1', 1, '2026-08-13', '', '${timestamp}');
      insert into manual_exercise_template_days
        (id, template_version_id, day_key, name, body_part, is_rest, note, ordinal)
      values ('manual-template-day-1', 'manual-version-1', 'day-1', 'Push', 'chest', 0, '', 0);
      insert into manual_exercise_template_actions
        (id, template_day_id, action_key, name, planned_sets, planned_reps_text,
         planned_weight_text, target_text, note, ordinal)
      values ('manual-template-action-1', 'manual-template-day-1', 'bench', 'Bench press',
              3, '8', '60kg', '', '', 0);
      insert into manual_exercise_cycle_state
        (template_id, current_day_key, revision, updated_at)
      values ('manual-template-1', 'day-1', 1, '${timestamp}');
    `);
  }

  function insertManualExerciseDay(
    sqlite: Database.Database,
    id = "manual-day-1",
    businessDate = "2026-08-13",
    status = "not-started",
  ): void {
    sqlite.prepare(`insert into manual_exercise_days
      (id, business_date, template_version_id, day_key, day_name, body_part, is_rest,
       status, started_at, paused_at, accumulated_pause_seconds, ended_at,
       calculated_duration_minutes, confirmed_duration_minutes, creatine_taken,
       protein_powder_taken, supplement_note, note, completion_text, revision,
       created_at, updated_at)
      values (?, ?, 'manual-version-1', 'day-1', 'Push', 'chest', 0,
              ?, null, null, 0, null, null, null, null, null, '', '', '', 1, ?, ?)`)
      .run(id, businessDate, status, timestamp, timestamp);
  }

  it("upgrades v24 additively, preserving training values and cycle while adding daily outcomes", () => {
    const sqlite = createCurrentDatabaseAtPrefix(24);
    seedManualExerciseTemplate(sqlite);
    insertManualExerciseDay(sqlite, "kept-day", "2026-08-13", "partial");
    sqlite.prepare("update manual_exercise_days set note = ?, creatine_taken = 1 where id = ?")
      .run("保留原始记录", "kept-day");
    const before = sqlite.prepare("select * from manual_exercise_days where id = ?").get("kept-day");
    const cycleBefore = sqlite.prepare("select * from manual_exercise_cycle_state").all();
    migrateDatabase(sqlite);
    expect(sqlite.prepare("select * from manual_exercise_days where id = ?").get("kept-day"))
      .toEqual({ ...(before as object), manual_duration_minutes: null });
    expect(sqlite.prepare("select * from manual_exercise_cycle_state").all()).toEqual(cycleBefore);
    expect(sqlite.prepare("select count(*) from manual_exercise_day_resolutions").pluck().get()).toBe(0);
    sqlite.prepare("update manual_exercise_days set manual_duration_minutes = 35 where id = ?").run("kept-day");
    expect(() => sqlite.prepare("update manual_exercise_days set manual_duration_minutes = -1 where id = ?").run("kept-day"))
      .toThrow(/check constraint/i);
    migrateDatabase(sqlite);
    expect(sqlite.prepare("select manual_duration_minutes from manual_exercise_days where id = ?").pluck().get("kept-day")).toBe(35);
  });

  it("migrates fresh and v10 databases to v11 with all manual exercise authorities", () => {
    const fresh = createDatabase();
    migrateDatabase(fresh);
    expect(fresh.prepare("select value from app_meta where key = 'schema_version'").pluck().get()).toBe("25");
    for (const table of REQUIRED_MANUAL_EXERCISE_TABLES) {
      expect(tableExists(fresh, table), `missing manual exercise table: ${table}`).toBe(true);
    }

    const v10 = createCurrentDatabaseAtPrefix(10);
    v10.exec(`insert into personal_daily_notes
      (id, business_date, content, revision, created_at, updated_at)
      values ('v10-preserved-note', '2026-08-13', 'Keep this', 1, '${timestamp}', '${timestamp}')`);
    migrateDatabase(v10);
    expect(v10.prepare("select value from app_meta where key = 'schema_version'").pluck().get()).toBe("25");
    expect(v10.prepare("select content from personal_daily_notes where id = 'v10-preserved-note'").pluck().get()).toBe("Keep this");
  });

  it("enforces immutable versions, unique ordinals and daily data constraints", () => {
    const sqlite = createMigratedFoundationDatabase();
    seedManualExerciseTemplate(sqlite);
    insertManualExerciseDay(sqlite);
    sqlite.exec(`insert into manual_exercise_day_actions
      (id, day_id, action_key, name, planned_sets, planned_reps_text, planned_weight_text,
       target_text, actual_sets, actual_reps_text, actual_weight_text, actual_text,
       completion, note, ordinal)
      values ('manual-day-action-1', 'manual-day-1', 'bench', 'Bench press', 3, '8', '60kg',
              '', 3, '8,8,8', '60kg', '', '', '', 0);
      insert into manual_exercise_cycle_events
      (id, template_id, business_date, event_type, from_day_key, to_day_key, day_id,
       note, cycle_revision_before, cycle_revision_after, created_at)
      values ('manual-event-1', 'manual-template-1', '2026-08-13', 'advanced', 'day-1',
              'day-2', 'manual-day-1', '', 1, 2, '${timestamp}');`);

    expect(() => sqlite.exec(`insert into manual_exercise_template_versions
      (id, template_id, revision, effective_from, change_note, created_at)
      values ('manual-version-2', 'manual-template-1', 1, '2026-08-14', '', '${timestamp}')`))
      .toThrow(/immutable|unique/i);
    expect(() => sqlite.exec("update manual_exercise_template_versions set change_note = 'changed' where id = 'manual-version-1'"))
      .toThrow(/immutable/i);
    expect(() => sqlite.exec(`insert into manual_exercise_template_days
      (id, template_version_id, day_key, name, body_part, is_rest, note, ordinal)
      values ('manual-template-day-2', 'manual-version-1', 'day-2', 'Pull', 'back', 0, '', 0)`))
      .toThrow(/immutable|unique/i);
    expect(() => insertManualExerciseDay(sqlite, "manual-day-2")).toThrow(/unique/i);
    expect(() => sqlite.exec("update manual_exercise_days set status = 'unknown' where id = 'manual-day-1'"))
      .toThrow(/check constraint/i);
    expect(() => sqlite.exec("update manual_exercise_days set creatine_taken = 2 where id = 'manual-day-1'"))
      .toThrow(/check constraint/i);
    expect(() => sqlite.exec("update manual_exercise_day_actions set actual_sets = -1 where id = 'manual-day-action-1'"))
      .toThrow(/check constraint/i);
    expect(() => sqlite.exec("update manual_exercise_cycle_events set note = 'changed' where id = 'manual-event-1'"))
      .toThrow(/immutable/i);
  });

  it("accepts exactly the product exercise statuses and preserves timer invariants", () => {
    const sqlite = createMigratedFoundationDatabase();
    seedManualExerciseTemplate(sqlite);

    const exactStatuses = [
      "not-started",
      "in-progress",
      "partial",
      "completed",
      "skipped",
    ];
    for (const [index, status] of exactStatuses.entries()) {
      insertManualExerciseDay(
        sqlite,
        `manual-status-${status}`,
        `2026-08-${String(13 + index).padStart(2, "0")}`,
        status,
      );
    }
    for (const legacyStatus of ["planned", "in_progress", "paused"]) {
      expect(() =>
        sqlite
          .prepare("update manual_exercise_days set status = ? where id = ?")
          .run(legacyStatus, "manual-status-not-started"),
      ).toThrow(/check constraint/i);
    }

    expect(() =>
      sqlite
        .prepare("update manual_exercise_days set paused_at = ? where id = ?")
        .run(timestamp, "manual-status-not-started"),
    ).toThrow(/check constraint/i);
    expect(() =>
      sqlite
        .prepare("update manual_exercise_days set ended_at = ? where id = ?")
        .run(timestamp, "manual-status-not-started"),
    ).toThrow(/check constraint/i);

    sqlite
      .prepare("update manual_exercise_days set started_at = ? where id = ?")
      .run(timestamp, "manual-status-in-progress");
    sqlite
      .prepare("update manual_exercise_days set paused_at = ? where id = ?")
      .run(timestamp, "manual-status-in-progress");
    expect(() =>
      sqlite
        .prepare("update manual_exercise_days set ended_at = ? where id = ?")
        .run(timestamp, "manual-status-in-progress"),
    ).toThrow(/check constraint/i);

    sqlite
      .prepare("update manual_exercise_days set started_at = ? where id = ?")
      .run(timestamp, "manual-status-partial");
    expect(() =>
      sqlite
        .prepare("update manual_exercise_days set calculated_duration_minutes = ? where id = ?")
        .run(45, "manual-status-partial"),
    ).toThrow(/check constraint/i);
  });

  it.each(REQUIRED_MANUAL_EXERCISE_TABLES)(
    "fails closed on reopen when required v11 table %s is missing",
    (table) => {
      const sqlite = createMigratedFoundationDatabase();
      sqlite.exec(`drop table ${table}`);

      expect(() => migrateDatabase(sqlite)).toThrow(/manual exercise schema/i);
      expect(sqlite.prepare("select count(*) from schema_migrations").pluck().get()).toBe(25);
    },
  );

  it("rolls back all v11 state when the final migration fails", () => {
    const sqlite = createCurrentDatabaseAtPrefix(10);
    sqlite.exec("create index manual_exercise_days_business_date_idx on app_meta(key)");
    const before = {
      schema: schemaSnapshot(sqlite),
      ledger: ledgerSnapshot(sqlite),
      meta: appMetaSnapshot(sqlite),
    };

    expect(() => migrateDatabase(sqlite)).toThrow(/manual_exercise_days_business_date_idx/i);
    expect(schemaSnapshot(sqlite)).toBe(before.schema);
    expect(ledgerSnapshot(sqlite)).toBe(before.ledger);
    expect(appMetaSnapshot(sqlite)).toBe(before.meta);
    for (const table of REQUIRED_MANUAL_EXERCISE_TABLES) {
      expect(tableExists(sqlite, table)).toBe(false);
    }
  });
});

describe("Manual skincare schema v12", () => {
  const timestamp = "2026-08-13T08:00:00.000Z";

  function seedManualSkincareAuthority(sqlite: Database.Database): void {
    sqlite.exec(`
      insert into manual_skincare_products
        (id, name, brand, current_purpose, status, added_on, note, revision,
         created_at, updated_at)
      values ('manual-skin-product-1', 'Gentle cleanser', 'Simple', 'Cleanse',
              'active', '2026-08-13', '', 1, '${timestamp}', '${timestamp}');
      insert into manual_skincare_routine_versions
        (id, revision, change_note, created_at)
      values ('manual-skin-routine-1', 1, 'Initial routine', '${timestamp}');
      insert into manual_skincare_routine_items
        (id, routine_version_id, item_key, slot, product_id,
         product_name_snapshot, brand_snapshot, purpose_snapshot, ordinal, created_at)
      values ('manual-skin-routine-item-1', 'manual-skin-routine-1', 'cleanser-am',
              'morning', 'manual-skin-product-1', 'Gentle cleanser', 'Simple',
              'Cleanse', 0, '${timestamp}');
      insert into manual_skincare_recovery_plans
        (id, name, note, revision, created_at, updated_at)
      values ('manual-skin-plan-1', 'Recovery', '', 1, '${timestamp}', '${timestamp}');
      insert into manual_skincare_recovery_cycles
        (id, plan_id, ordinal, name, goal, expected_end_on, routine_version_id,
         status, actual_started_on, actual_completed_on, note, revision,
         created_at, updated_at)
      values ('manual-skin-cycle-1', 'manual-skin-plan-1', 0, 'Week one', 'Calm',
              '2026-08-20', 'manual-skin-routine-1', 'draft', null, null, '', 1,
              '${timestamp}', '${timestamp}');
      insert into manual_skincare_routine_activations
        (id, routine_version_id, recovery_cycle_id, activation_sequence,
         effective_from, reason, created_at)
      values ('manual-skin-activation-1', 'manual-skin-routine-1', null, 1,
              '2026-08-13', 'manual-routine-update', '${timestamp}');
      insert into manual_skincare_days
        (id, business_date, routine_activation_id, routine_version_id,
         recovery_cycle_id, recovery_cycle_name_snapshot, morning_note,
         evening_note, overall_note, revision, created_at, updated_at)
      values ('manual-skin-day-1', '2026-08-13', 'manual-skin-activation-1',
              'manual-skin-routine-1', null, '', '', '', '', 1,
              '${timestamp}', '${timestamp}');
      insert into manual_skincare_day_items
        (id, day_id, item_key, slot, product_id, product_name_snapshot,
         brand_snapshot, purpose_snapshot, ordinal, used, used_at)
      values ('manual-skin-day-item-1', 'manual-skin-day-1', 'cleanser-am',
              'morning', 'manual-skin-product-1', 'Gentle cleanser', 'Simple',
              'Cleanse', 0, 0, null);
    `);
  }

  it("retains the v12 authorities while migrating fresh and complete v11 databases through v13", () => {
    const fresh = createDatabase();
    migrateDatabase(fresh);
    expect(
      fresh.prepare("select value from app_meta where key = 'schema_version'").pluck().get(),
    ).toBe("25");
    expect(fresh.prepare("select count(*) from schema_migrations").pluck().get()).toBe(25);
    for (const table of REQUIRED_MANUAL_SKINCARE_TABLES) {
      expect(tableExists(fresh, table), `missing manual skincare table: ${table}`).toBe(true);
    }

    const v11 = createCurrentDatabaseAtPrefix(11);
    v11.exec(`insert into personal_daily_notes
      (id, business_date, content, revision, created_at, updated_at)
      values ('v11-preserved-note', '2026-08-13', 'Keep this', 1,
              '${timestamp}', '${timestamp}')`);
    migrateDatabase(v11);
    expect(
      v11.prepare("select value from app_meta where key = 'schema_version'").pluck().get(),
    ).toBe("25");
    expect(v11.prepare("select count(*) from schema_migrations").pluck().get()).toBe(25);
    expect(
      v11.prepare("select content from personal_daily_notes where id = 'v11-preserved-note'")
        .pluck().get(),
    ).toBe("Keep this");
  });

  it("enforces product archival, immutable routine facts, snapshots, and explicit cycle activation", () => {
    const sqlite = createMigratedFoundationDatabase();
    seedManualSkincareAuthority(sqlite);

    expect(() =>
      sqlite.exec("delete from manual_skincare_products where id = 'manual-skin-product-1'"),
    ).toThrow(/archive|physical delete/i);
    for (const statement of [
      "update manual_skincare_routine_versions set change_note = 'changed' where id = 'manual-skin-routine-1'",
      "delete from manual_skincare_routine_items where id = 'manual-skin-routine-item-1'",
      "update manual_skincare_routine_activations set effective_from = '2026-08-14' where id = 'manual-skin-activation-1'",
    ]) {
      expect(() => sqlite.exec(statement)).toThrow(/immutable/i);
    }

    sqlite.exec(`update manual_skincare_products
      set name = 'Renamed cleanser', current_purpose = 'New purpose', revision = 2,
          updated_at = '${timestamp}'
      where id = 'manual-skin-product-1'`);
    expect(
      sqlite.prepare(`select product_name_snapshot, purpose_snapshot
        from manual_skincare_day_items where id = 'manual-skin-day-item-1'`).get(),
    ).toEqual({ product_name_snapshot: "Gentle cleanser", purpose_snapshot: "Cleanse" });

    expect(() => sqlite.exec(`insert into manual_skincare_recovery_cycles
      (id, plan_id, ordinal, name, goal, expected_end_on, routine_version_id,
       status, actual_started_on, actual_completed_on, note, revision, created_at, updated_at)
      values ('manual-skin-cycle-2', 'manual-skin-plan-1', 1, 'Week two', 'Repair',
              '2026-08-27', 'manual-skin-routine-1', 'active', '2026-08-14', null,
              '', 1, '${timestamp}', '${timestamp}');
      insert into manual_skincare_recovery_cycles
      (id, plan_id, ordinal, name, goal, expected_end_on, routine_version_id,
       status, actual_started_on, actual_completed_on, note, revision, created_at, updated_at)
      values ('manual-skin-cycle-3', 'manual-skin-plan-1', 2, 'Week three', 'Maintain',
              null, 'manual-skin-routine-1', 'active', '2026-08-21', null,
              '', 1, '${timestamp}', '${timestamp}')`)).toThrow(/unique/i);

    const automaticTriggers = sqlite.prepare(`select name, sql from sqlite_master
      where type = 'trigger' and tbl_name like 'manual_skincare_%'`).all() as Array<{
        name: string;
        sql: string;
      }>;
    expect(automaticTriggers.some(({ sql }) => /expected_end_on/i.test(sql))).toBe(false);
    expect(
      sqlite.prepare("select count(*) from manual_skincare_routine_activations").pluck().get(),
    ).toBe(1);
  });

  it("rejects invalid dates, enums, duplicate placement, and inconsistent used timestamps", () => {
    const sqlite = createMigratedFoundationDatabase();
    seedManualSkincareAuthority(sqlite);

    for (const statement of [
      `insert into manual_skincare_products
        (id, name, brand, current_purpose, status, added_on, note, revision,
         created_at, updated_at)
       values ('bad-date', 'Product', '', '', 'active', '2026-02-30', '', 1,
               '${timestamp}', '${timestamp}')`,
      "update manual_skincare_products set status = 'archived' where id = 'manual-skin-product-1'",
      `insert into manual_skincare_routine_items
        (id, routine_version_id, item_key, slot, product_id,
         product_name_snapshot, brand_snapshot, purpose_snapshot, ordinal, created_at)
       values ('duplicate-placement', 'manual-skin-routine-1', 'other-key', 'morning',
               'manual-skin-product-1', 'Gentle cleanser', 'Simple', 'Cleanse', 1,
               '${timestamp}')`,
      "update manual_skincare_day_items set used = 1 where id = 'manual-skin-day-item-1'",
    ]) {
      expect(() => sqlite.exec(statement)).toThrow(/check constraint|immutable|unique/i);
    }
  });

  it.each(REQUIRED_MANUAL_SKINCARE_TABLES)(
    "fails closed on reopen when required v12 table %s is missing",
    (table) => {
      const sqlite = createMigratedFoundationDatabase();
      sqlite.exec(`drop table ${table}`);

      expect(() => migrateDatabase(sqlite)).toThrow(/manual skincare schema/i);
      expect(sqlite.prepare("select count(*) from schema_migrations").pluck().get()).toBe(25);
    },
  );

  it("rolls back every v12 schema and ledger change when the migration fails", () => {
    const sqlite = createCurrentDatabaseAtPrefix(11);
    sqlite.exec("create index manual_skincare_days_business_date_idx on app_meta(key)");
    const before = {
      schema: schemaSnapshot(sqlite),
      ledger: ledgerSnapshot(sqlite),
      meta: appMetaSnapshot(sqlite),
    };

    expect(() => migrateDatabase(sqlite)).toThrow(/manual_skincare_days_business_date_idx/i);
    expect(schemaSnapshot(sqlite)).toBe(before.schema);
    expect(ledgerSnapshot(sqlite)).toBe(before.ledger);
    expect(appMetaSnapshot(sqlite)).toBe(before.meta);
    for (const table of REQUIRED_MANUAL_SKINCARE_TABLES) {
      expect(tableExists(sqlite, table)).toBe(false);
    }
  });
});

describe("Personal knowledge schema v13", () => {
  const timestamp = "2026-08-13T08:00:00.000Z";

  function insertModule(
    sqlite: Database.Database,
    moduleId: string,
    name: string,
    parentModuleId: string | null = null,
    status = "learning",
  ): void {
    sqlite.prepare(`insert into knowledge_modules
      (module_id, parent_module_id, name, goal, current_focus, description, status,
       ordinal, revision, created_at, updated_at)
      values (?, ?, ?, '', '', '', ?, 0, 1, ?, ?)`)
      .run(moduleId, parentModuleId, name, status, timestamp, timestamp);
  }

  function insertDailyNote(
    sqlite: Database.Database,
    noteId = "note-1",
    businessDate = "2026-08-13",
    status = "active",
  ): void {
    sqlite.prepare(`insert into daily_learning_notes
      (note_id, business_date, title, module_id, content, source,
       personal_understanding, open_questions, application, status, revision,
       created_at, updated_at)
      values (?, ?, 'SQLite constraints', 'module-1', 'Learned content', '', '', '', '',
              ?, 1, ?, ?)`)
      .run(noteId, businessDate, status, timestamp, timestamp);
  }

  it.skip("legacy knowledge-item preservation removed by schema v18", () => {
    const fresh = createDatabase();
    migrateDatabase(fresh);
    expect(fresh.prepare("select value from app_meta where key = 'schema_version'").pluck().get()).toBe("25");
    expect(fresh.prepare("select count(*) from schema_migrations").pluck().get()).toBe(25);
    for (const table of REQUIRED_PERSONAL_KNOWLEDGE_TABLES) {
      expect(tableExists(fresh, table), `missing personal knowledge table: ${table}`).toBe(true);
    }
    for (const index of REQUIRED_PERSONAL_KNOWLEDGE_INDEXES) {
      expect(indexExists(fresh, index), `missing personal knowledge index: ${index}`).toBe(true);
    }

    const v12 = createCurrentDatabaseAtPrefix(12);
    v12.exec(`insert into knowledge_items
      (id, domain_key, title, background, problem, insight, method, content,
       item_type, maturity, tags_json, revision, created_at, updated_at)
      values ('knowledge-before-v13', 'general', 'Keep title', '', '', '', '', 'Keep content',
              'note', 'structured', '[]', 7, '${timestamp}', '${timestamp}');
      insert into knowledge_item_revisions
      (id, knowledge_item_id, revision, snapshot_json, created_at)
      values ('revision-before-v13', 'knowledge-before-v13', 7,
              '{"title":"Keep title","revision":7}', '${timestamp}');`);
    const beforeItem = JSON.stringify(v12.prepare(
      "select * from knowledge_items where id = 'knowledge-before-v13'",
    ).get());
    const beforeRevision = JSON.stringify(v12.prepare(
      "select * from knowledge_item_revisions where id = 'revision-before-v13'",
    ).get());

    migrateDatabase(v12);

    expect(v12.prepare("select value from app_meta where key = 'schema_version'").pluck().get()).toBe("25");
    expect(JSON.stringify(v12.prepare(
      "select * from knowledge_items where id = 'knowledge-before-v13'",
    ).get())).toBe(beforeItem);
    expect(JSON.stringify(v12.prepare(
      "select * from knowledge_item_revisions where id = 'revision-before-v13'",
    ).get())).toBe(beforeRevision);
  });

  it("enforces module hierarchy fields, active sibling names, and archive-only deletion", () => {
    const sqlite = createMigratedFoundationDatabase();
    insertModule(sqlite, "module-1", "Databases");
    insertModule(sqlite, "module-2", "SQLite", "module-1", "paused");
    insertModule(sqlite, "module-3", "Long term", null, "long-term");
    insertModule(sqlite, "module-4", "Old", null, "archived");

    const selfForeignKey = (sqlite.pragma("foreign_key_list('knowledge_modules')") as Array<{
      table: string;
      from: string;
      to: string;
      on_delete: string;
    }>).find(({ from }) => from === "parent_module_id");
    expect(selfForeignKey).toMatchObject({
      table: "knowledge_modules",
      from: "parent_module_id",
      to: "module_id",
      on_delete: "RESTRICT",
    });

    expect(() => insertModule(sqlite, "module-duplicate", "  databases  ")).toThrow(/unique/i);
    insertModule(sqlite, "module-archived-duplicate", "Databases", null, "archived");
    expect(() => sqlite.exec("update knowledge_modules set status = 'unknown' where module_id = 'module-1'"))
      .toThrow(/check constraint/i);
    expect(() => sqlite.exec("update knowledge_modules set ordinal = -1 where module_id = 'module-1'"))
      .toThrow(/check constraint/i);
    expect(() => sqlite.exec("update knowledge_modules set revision = 0 where module_id = 'module-1'"))
      .toThrow(/check constraint/i);
    expect(() => sqlite.exec("update knowledge_modules set name = '' where module_id = 'module-1'"))
      .toThrow(/check constraint/i);
    expect(() => sqlite.exec("delete from knowledge_modules where module_id = 'module-4'"))
      .toThrow(/archive|physical delete/i);
  });

  it.skip("legacy knowledge-item organization removed by schema v18", () => {
    const sqlite = createMigratedFoundationDatabase();
    insertModule(sqlite, "module-1", "Databases");
    insertDailyNote(sqlite);
    sqlite.exec(`insert into knowledge_items
      (id, domain_key, title, content, created_at, updated_at)
      values ('knowledge-1', 'general', 'Existing item', 'Existing body', '${timestamp}', '${timestamp}');
      insert into knowledge_item_organization
      (knowledge_item_id, module_id, source_daily_note_id, revision, created_at, updated_at)
      values ('knowledge-1', null, null, 1, '${timestamp}', '${timestamp}');`);

    expect(sqlite.prepare(
      "select module_id, source_daily_note_id from knowledge_item_organization where knowledge_item_id = 'knowledge-1'",
    ).get()).toEqual({ module_id: null, source_daily_note_id: null });
    expect(() => insertDailyNote(sqlite, "bad-date", "2026-02-30")).toThrow(/check constraint/i);
    expect(() => sqlite.exec("update daily_learning_notes set title = '' where note_id = 'note-1'"))
      .toThrow(/check constraint/i);
    expect(() => sqlite.exec("update daily_learning_notes set content = '' where note_id = 'note-1'"))
      .toThrow(/check constraint/i);
    expect(() => sqlite.exec("update daily_learning_notes set status = 'paused' where note_id = 'note-1'"))
      .toThrow(/check constraint/i);
    expect(() => sqlite.exec("update daily_learning_notes set revision = 0 where note_id = 'note-1'"))
      .toThrow(/check constraint/i);
    expect(() => sqlite.exec("update knowledge_item_organization set revision = 0 where knowledge_item_id = 'knowledge-1'"))
      .toThrow(/check constraint/i);
    expect(() => sqlite.exec("delete from daily_learning_notes where note_id = 'note-1'"))
      .toThrow(/archive|physical delete/i);
  });

  it.each(REQUIRED_PERSONAL_KNOWLEDGE_TABLES)(
    "fails closed on reopen when required v13 table %s is missing",
    (table) => {
      const sqlite = createMigratedFoundationDatabase();
      sqlite.exec(`drop table ${table}`);

      expect(() => migrateDatabase(sqlite)).toThrow(/personal knowledge schema/i);
      expect(sqlite.prepare("select count(*) from schema_migrations").pluck().get()).toBe(25);
    },
  );

  it("rolls back every v13 schema and ledger change when the migration fails", () => {
    const sqlite = createCurrentDatabaseAtPrefix(12);
    sqlite.exec("create index knowledge_modules_parent_order_idx on app_meta(key)");
    const before = {
      schema: schemaSnapshot(sqlite),
      ledger: ledgerSnapshot(sqlite),
      meta: appMetaSnapshot(sqlite),
    };

    expect(() => migrateDatabase(sqlite)).toThrow(/knowledge_modules_parent_order_idx/i);
    expect(schemaSnapshot(sqlite)).toBe(before.schema);
    expect(ledgerSnapshot(sqlite)).toBe(before.ledger);
    expect(appMetaSnapshot(sqlite)).toBe(before.meta);
    for (const table of REQUIRED_PERSONAL_KNOWLEDGE_TABLES) {
      expect(tableExists(sqlite, table)).toBe(false);
    }
  });
});

describe("Weekly review pins schema v14", () => {
  const pinTargetTypes = [
    "knowledge-module",
    "knowledge-item",
    "exercise-template",
    "skincare-plan",
    "health-template",
  ] as const;

  it("upgrades v13 without changing existing rows and adds only the pin authority", () => {
    const sqlite = createCurrentDatabaseAtPrefix(13);
    sqlite.prepare(`insert into personal_daily_notes
      (id, business_date, content, revision, created_at, updated_at)
      values ('v13-preserved-note', '2026-08-13', 'Keep this row', 1, ?, ?)`).run(
      ISO_TIMESTAMP,
      ISO_TIMESTAMP,
    );
    const before = JSON.stringify(sqlite.prepare(
      "select * from personal_daily_notes where id = 'v13-preserved-note'",
    ).get());
    const schemaBefore = new Set(sqlite.prepare(
      "select name from sqlite_master where type = 'table'",
    ).pluck().all() as string[]);
    const indexesBefore = new Set(sqlite.prepare(
      `select name from sqlite_master
       where type = 'index' and name not like 'sqlite_autoindex_%'
       order by name`,
    ).pluck().all() as string[]);

    migrateDatabase(sqlite);

    expect(sqlite.prepare("select value from app_meta where key = 'schema_version'").pluck().get()).toBe("25");
    expect(JSON.stringify(sqlite.prepare(
      "select * from personal_daily_notes where id = 'v13-preserved-note'",
    ).get())).toBe(before);
    expect(tableExists(sqlite, "user_pins")).toBe(true);
    expect(indexExists(sqlite, "user_pins_order_idx")).toBe(true);
    const tablesAfter = new Set(sqlite.prepare(
      "select name from sqlite_master where type = 'table'",
    ).pluck().all() as string[]);
    expect(
      [...tablesAfter]
        .filter((name) => !schemaBefore.has(name))
        .sort(),
    ).toEqual([
      "manual_exercise_day_resolutions",
      "manual_exercise_progress_decisions",
      "reading_books",
      "reading_notes",
      "reading_sessions",
      "today_reminders",
      "user_pins",
      "wisdom_reminders",
    ]);

    const indexesAfter = new Set(sqlite.prepare(
      `select name from sqlite_master
       where type = 'index' and name not like 'sqlite_autoindex_%'
       order by name`,
    ).pluck().all() as string[]);
    expect([...indexesAfter].filter((name) => !indexesBefore.has(name))).toEqual([
      "manual_exercise_progress_decisions_template_idx",
      "reading_books_created_idx",
      "reading_books_status_updated_idx",
      "reading_notes_book_updated_idx",
      "reading_notes_created_idx",
      "reading_sessions_book_date_idx",
      "reading_sessions_date_created_idx",
      "today_reminders_day_status_time_idx",
      "today_reminders_updated_idx",
      "user_pins_order_idx",
      "wisdom_reminders_created_idx",
    ]);
  });

  it.each(pinTargetTypes)("accepts the allowed user pin target type %s", (targetType) => {
    const sqlite = createDatabase();
    migrateDatabase(sqlite);
    sqlite.prepare(
      "insert into user_pins (target_type, target_id, pinned_at) values (?, ?, ?)",
    ).run(targetType, `target-${targetType}`, ISO_TIMESTAMP);
    expect(sqlite.prepare("select target_type from user_pins where target_id = ?").pluck().get(
      `target-${targetType}`,
    )).toBe(targetType);
  });

  it("rejects invalid pin types and duplicate targets", () => {
    const sqlite = createDatabase();
    migrateDatabase(sqlite);
    const insertPin = sqlite.prepare(
      "insert into user_pins (target_type, target_id, pinned_at) values (?, ?, ?)",
    );
    expect(() => insertPin.run("other", "target-1", ISO_TIMESTAMP)).toThrow(/check constraint/i);
    insertPin.run("knowledge-item", "target-1", ISO_TIMESTAMP);
    expect(() => insertPin.run("knowledge-item", "target-1", ISO_TIMESTAMP)).toThrow(/unique/i);
  });
});

describe("Reading schema v15", () => {
  const timestamp = "2026-08-14T08:00:00.000Z";

  function seedReadingBook(sqlite: Database.Database, bookId = "reading-book-1"): void {
    sqlite.prepare(`insert into reading_books
      (book_id, title, author, status, total_pages, current_page, rating,
       revision, created_at, updated_at)
      values (?, ?, '', 'wishlist', null, 0, null, 1, ?, ?)`).run(
      bookId,
      "测试书籍",
      timestamp,
      timestamp,
    );
  }

  function seedReadingNote(
    sqlite: Database.Database,
    noteId = "reading-note-1",
    bookId = "reading-book-1",
  ): void {
    sqlite.prepare(`insert into reading_notes
      (note_id, book_id, title, content, revision, created_at, updated_at)
      values (?, ?, '', '这是一篇读后感', 1, ?, ?)`).run(
      noteId,
      bookId,
      timestamp,
      timestamp,
    );
  }

  it("migrates fresh and complete v14 databases through v15 with reading authorities", () => {
    const fresh = createDatabase();
    migrateDatabase(fresh);
    expect(
      fresh.prepare("select value from app_meta where key = 'schema_version'").pluck().get(),
    ).toBe("25");
    expect(fresh.prepare("select count(*) from schema_migrations").pluck().get()).toBe(25);
    for (const table of ["reading_books", "reading_notes"]) {
      expect(tableExists(fresh, table), `missing reading table: ${table}`).toBe(true);
    }

    const v14 = createCurrentDatabaseAtPrefix(14);
    migrateDatabase(v14);
    expect(
      v14.prepare("select value from app_meta where key = 'schema_version'").pluck().get(),
    ).toBe("25");
    expect(v14.prepare("select count(*) from schema_migrations").pluck().get()).toBe(25);
  });

  it("enforces book status, progress, rating, and pdf shapes", () => {
    const sqlite = createDatabase();
    migrateDatabase(sqlite);

    seedReadingBook(sqlite);
    expect(() => sqlite.exec("update reading_books set status = 'unknown' where book_id = 'reading-book-1'"))
      .toThrow(/check constraint/i);
    expect(() => sqlite.exec("update reading_books set current_page = -1 where book_id = 'reading-book-1'"))
      .toThrow(/check constraint/i);
    expect(() => sqlite.exec("update reading_books set rating = 6 where book_id = 'reading-book-1'"))
      .toThrow(/check constraint/i);
    expect(() => sqlite.exec("update reading_books set title = '' where book_id = 'reading-book-1'"))
      .toThrow(/check constraint/i);
    expect(() => sqlite.exec("update reading_books set revision = 0 where book_id = 'reading-book-1'"))
      .toThrow(/check constraint/i);
  });

  it("enforces reading note content and archive-only deletion", () => {
    const sqlite = createDatabase();
    migrateDatabase(sqlite);
    seedReadingBook(sqlite);
    seedReadingNote(sqlite);

    expect(() => sqlite.exec("update reading_notes set content = '' where note_id = 'reading-note-1'"))
      .toThrow(/check constraint/i);
    expect(() => sqlite.exec("update reading_notes set revision = 0 where note_id = 'reading-note-1'"))
      .toThrow(/check constraint/i);
    expect(() => sqlite.exec("delete from reading_notes where note_id = 'reading-note-1'"))
      .toThrow(/archive|physical delete/i);
    expect(() => sqlite.exec("delete from reading_books where book_id = 'reading-book-1'"))
      .toThrow(/archive|physical delete/i);
  });

  it.each(["reading_books", "reading_notes"])(
    "fails closed on reopen when required v15 table %s is missing",
    (table) => {
      const sqlite = createMigratedFoundationDatabase();
      sqlite.exec(`drop table ${table}`);

      expect(() => migrateDatabase(sqlite)).toThrow(/reading schema/i);
      expect(sqlite.prepare("select count(*) from schema_migrations").pluck().get()).toBe(25);
    },
  );

  it("rolls back every v15 schema and ledger change when the migration fails", () => {
    const sqlite = createCurrentDatabaseAtPrefix(14);
    sqlite.exec("create index reading_books_status_updated_idx on app_meta(key)");
    const before = {
      schema: schemaSnapshot(sqlite),
      ledger: ledgerSnapshot(sqlite),
      meta: appMetaSnapshot(sqlite),
    };

    expect(() => migrateDatabase(sqlite)).toThrow(/reading_books_status_updated_idx/i);
    expect(schemaSnapshot(sqlite)).toBe(before.schema);
    expect(ledgerSnapshot(sqlite)).toBe(before.ledger);
    expect(appMetaSnapshot(sqlite)).toBe(before.meta);
    for (const table of ["reading_books", "reading_notes"]) {
      expect(tableExists(sqlite, table)).toBe(false);
    }
  });
});
