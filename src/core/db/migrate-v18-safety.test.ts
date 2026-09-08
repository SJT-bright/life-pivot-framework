import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { loadMigrations } from "./migration-files";
import { migrationManifest } from "./migration-manifest";
import { migrateDatabase } from "./migrate";

const databases: Database.Database[] = [];
const timestamp = "2026-08-23T08:00:00.000Z";

function createDatabase(): Database.Database {
  const sqlite = new Database(":memory:");
  databases.push(sqlite);
  return sqlite;
}

function createMigratedDatabase(): Database.Database {
  const sqlite = createDatabase();
  migrateDatabase(sqlite, { applicationVersion: "0.1.0", now: () => new Date(timestamp) });
  return sqlite;
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

function insertLedger(sqlite: Database.Database, id: string, checksum: string): void {
  sqlite.prepare(`insert into schema_migrations
    (id, checksum, application_version, applied_at) values (?, ?, ?, ?)`)
    .run(id, checksum, "0.1.0", timestamp);
}

function schemaSnapshot(sqlite: Database.Database): string {
  return JSON.stringify(sqlite.prepare(
    "select type, name, tbl_name, rootpage, sql from sqlite_master order by type, name",
  ).all());
}

function ledgerSnapshot(sqlite: Database.Database): string {
  return JSON.stringify(sqlite.prepare(
    "select id, checksum, application_version, applied_at from schema_migrations order by rowid",
  ).all());
}

function tableExists(sqlite: Database.Database, name: string): boolean {
  return sqlite.prepare("select 1 from sqlite_master where type = 'table' and name = ?")
    .get(name) !== undefined;
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe("schema v18 migration safety gates", () => {
  it("keeps the trusted-capture migration checksum synchronized", () => {
    const expected = {
      id: "0001_trusted_today_capture",
      sha256: "b3aa60c65b613d9596c902b4a9fd4b315ca24dd2477e948032194a08b0359fbb",
    };
    expect(migrationManifest).toContainEqual({
      ...expected,
      filename: "0001_trusted_today_capture.sql",
    });
    expect(loadMigrations(process.cwd()).map(({ id, sha256 }) => ({ id, sha256 })))
      .toContainEqual(expected);
  });

  it("rejects a self-referencing capture correction", () => {
    const sqlite = createMigratedDatabase();
    expect(() => sqlite.prepare(`insert into capture_items
      (id, event_type, corrects_item_id, business_date, occurred_at, content, created_at)
      values (?, 'correction', ?, ?, ?, ?, ?)`)
      .run("self-correction", "self-correction", "2026-08-23", timestamp, "不能引用自己", timestamp))
      .toThrow(/check constraint failed/i);
  });

  it("keeps current action and review facts append-only", () => {
    const sqlite = createMigratedDatabase();
    sqlite.prepare(`insert into capture_items
      (id, event_type, corrects_item_id, business_date, occurred_at, content, created_at)
      values ('capture-v18', 'capture', null, '2026-08-23', ?, 'original', ?)`).run(timestamp, timestamp);
    sqlite.prepare(`insert into actions
      (id, goal_id, parent_action_id, action_type, business_date, title, status,
       priority, estimated_minutes, notes, revision, created_at, updated_at, archived_at)
      values ('action-v18', null, null, 'today', '2026-08-23', '训练',
              'completed', 'normal', null, '', 1, ?, ?, null)`).run(timestamp, timestamp);
    sqlite.prepare(`insert into action_events
      (id, action_id, event_type, business_date, from_business_date,
       to_business_date, occurred_at, payload_json)
      values ('event-v18', 'action-v18', 'completed', '2026-08-23', null, null, ?, '{}')`)
      .run(timestamp);
    sqlite.prepare(`insert into reviews
      (id, review_type, period_start, period_end_exclusive, created_at, updated_at)
      values ('review-v18', 'daily', '2026-08-23', '2026-08-24', ?, ?)`).run(timestamp, timestamp);
    sqlite.prepare(`insert into review_revisions
      (id, review_id, revision, snapshot_json, created_at)
      values ('review-revision-v18', 'review-v18', 1, '{}', ?)`).run(timestamp);
    expect(() => sqlite.exec("update capture_items set content = 'changed' where id = 'capture-v18'"))
      .toThrow(/immutable/i);
    expect(() => sqlite.exec("delete from capture_items where id = 'capture-v18'"))
      .toThrow(/immutable/i);

    expect(() => sqlite.exec("update action_events set payload_json = '{\"changed\":true}' where id = 'event-v18'"))
      .toThrow(/immutable/i);
    expect(() => sqlite.exec("delete from action_events where id = 'event-v18'"))
      .toThrow(/immutable/i);
    expect(() => sqlite.exec("update review_revisions set snapshot_json = '{\"changed\":true}' where id = 'review-revision-v18'"))
      .toThrow(/immutable/i);
    expect(() => sqlite.exec("delete from review_revisions where id = 'review-revision-v18'"))
      .toThrow(/immutable/i);
    sqlite.pragma("recursive_triggers = OFF");
    const replacementAttempts = [
      `insert or replace into capture_items
        (id, event_type, corrects_item_id, business_date, occurred_at, content, created_at)
       values ('capture-v18', 'capture', null, '2026-08-23', '${timestamp}', 'changed', '${timestamp}')`,
      `insert or replace into action_events
        (id, action_id, event_type, business_date, from_business_date,
         to_business_date, occurred_at, payload_json)
       values ('event-v18', 'action-v18', 'completed', '2026-08-23', null, null,
               '${timestamp}', '{"changed":true}')`,
      `insert or replace into review_revisions
        (id, review_id, revision, snapshot_json, created_at)
       values ('review-revision-v18', 'review-v18', 1, '{"changed":true}', '${timestamp}')`,
      `insert or replace into review_revisions
        (id, review_id, revision, snapshot_json, created_at)
       values ('review-revision-v18-duplicate', 'review-v18', 1,
               '{"changed":true}', '${timestamp}')`,
    ];
    for (const statement of replacementAttempts) {
      expect(() => sqlite.exec(statement)).toThrow(/immutable|append-only/i);
    }

    expect(sqlite.prepare("select content from capture_items where id = 'capture-v18'").pluck().get())
      .toBe("original");
    expect(sqlite.prepare("select payload_json from action_events where id = 'event-v18'").pluck().get())
      .toBe("{}");
    expect(sqlite.prepare("select snapshot_json from review_revisions where id = 'review-revision-v18'").pluck().get())
      .toBe("{}");
    expect(sqlite.prepare("select count(*) from review_revisions where review_id = 'review-v18'").pluck().get())
      .toBe(1);
  });

  it("rejects a known migration whose required prefix is missing without changing state", () => {
    const sqlite = createDatabase();
    createChecksumLedger(sqlite);
    const captureMigration = migrationManifest.find(({ id }) => id === "0001_trusted_today_capture");
    if (!captureMigration) throw new Error("capture migration fixture missing");
    insertLedger(sqlite, captureMigration.id, captureMigration.sha256);
    const before = { schema: schemaSnapshot(sqlite), ledger: ledgerSnapshot(sqlite) };

    expect(() => migrateDatabase(sqlite)).toThrow(/prefix|顺序/);
    expect(schemaSnapshot(sqlite)).toBe(before.schema);
    expect(ledgerSnapshot(sqlite)).toBe(before.ledger);
    expect(tableExists(sqlite, "capture_items")).toBe(false);
  });

  it.each([
    ["unknown migration", (sqlite: Database.Database) => insertLedger(sqlite, "9999_unknown", "0".repeat(64))],
    ["checksum mismatch", (sqlite: Database.Database) => {
      sqlite.prepare("update schema_migrations set checksum = ? where id = ?")
        .run("0".repeat(64), "0000_foundation");
    }],
  ])("fails closed for %s without rewriting the corrupted ledger", (_name, arrange) => {
    const sqlite = createMigratedDatabase();
    arrange(sqlite);
    const before = { schema: schemaSnapshot(sqlite), ledger: ledgerSnapshot(sqlite) };

    expect(() => migrateDatabase(sqlite)).toThrow();
    expect(schemaSnapshot(sqlite)).toBe(before.schema);
    expect(ledgerSnapshot(sqlite)).toBe(before.ledger);
  });

  it.each([
    ["capture_items", /capture schema/i],
    ["action_events", /daily-loop schema/i],
    ["review_revisions", /daily-loop schema/i],
  ] as const)("fails closed when current table %s is missing", (table, message) => {
    const sqlite = createMigratedDatabase();
    sqlite.exec(`drop table ${table}`);

    expect(() => migrateDatabase(sqlite)).toThrow(message);
    expect(sqlite.prepare("select count(*) from schema_migrations").pluck().get()).toBe(25);
  });
});
