import type Database from "better-sqlite3";

const INTERNAL_TABLE_PREFIXES = ["sqlite_", "drizzle_migrations"];
const BLOB_COLUMN_PREFIX = "$base64:";

export interface ExportedTable {
  name: string;
  columns: string[];
  rows: unknown[][];
}

export interface ArchiveExport {
  format: "personal-archive-export";
  version: 1;
  exportedAt: string;
  schemaVersion: string | null;
  tables: ExportedTable[];
}

function isInternalTable(name: string): boolean {
  return INTERNAL_TABLE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function userTables(sqlite: Database.Database): string[] {
  const rows = sqlite
    .prepare(
      `select name from sqlite_master
       where type = 'table' and name not like 'sqlite_%'
       order by name`,
    )
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name).filter((name) => !isInternalTable(name));
}

function tableColumns(sqlite: Database.Database, table: string): string[] {
  const rows = sqlite.prepare(`pragma table_info(${JSON.stringify(table)})`).all() as Array<{
    name: string;
  }>;
  return rows.map((row) => row.name);
}

function encodeCell(value: unknown): unknown {
  if (Buffer.isBuffer(value)) {
    return `${BLOB_COLUMN_PREFIX}${value.toString("base64")}`;
  }
  return value;
}

export function buildArchiveExport(
  sqlite: Database.Database,
  exportedAt = new Date(),
): ArchiveExport {
  const schemaVersionRow = sqlite
    .prepare("select value from app_meta where key = 'schema_version'")
    .get() as { value?: unknown } | undefined;
  const schemaVersion = typeof schemaVersionRow?.value === "string"
    ? schemaVersionRow.value
    : null;

  const tables: ExportedTable[] = userTables(sqlite).map((name) => {
    const columns = tableColumns(sqlite, name);
    const rawRows = sqlite
      .prepare(`select ${columns.map((column) => JSON.stringify(column)).join(", ")} from ${JSON.stringify(name)}`)
      .all() as Array<Record<string, unknown>>;
    const rows = rawRows.map((row) => columns.map((column) => encodeCell(row[column])));
    return { name, columns, rows };
  });

  return {
    format: "personal-archive-export",
    version: 1,
    exportedAt: exportedAt.toISOString(),
    schemaVersion,
    tables,
  };
}

function tableRows(sqlite: Database.Database, table: string): Array<Record<string, unknown>> {
  const exists = sqlite
    .prepare("select 1 from sqlite_master where type = 'table' and name = ?")
    .get(table) !== undefined;
  if (!exists) return [];
  return sqlite.prepare(`select * from ${JSON.stringify(table)}`).all() as Array<
    Record<string, unknown>
  >;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function shanghaiDate(value: string): string {
  return value.slice(0, 10);
}

function shanghaiClock(value: string): string {
  return value.slice(11, 16);
}

interface DayDigest {
  date: string;
  lines: string[];
}

function pushLine(days: Map<string, DayDigest>, date: string, line: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  let day = days.get(date);
  if (!day) {
    day = { date, lines: [] };
    days.set(date, day);
  }
  day.lines.push(line);
}

function formatClockRange(from: unknown, to: unknown): string {
  const fromText = text(from);
  const toText = text(to);
  if (!fromText || !toText) return "";
  return `（${shanghaiClock(fromText)}–${shanghaiClock(toText)}）`;
}

export function buildMarkdownDigest(sqlite: Database.Database, exportedAt = new Date()): string {
  const days = new Map<string, DayDigest>();

  for (const row of tableRows(sqlite, "capture_items")) {
    if (row.event_type !== "capture") continue;
    pushLine(days, text(row.business_date), `- ${shanghaiClock(text(row.occurred_at))} ${text(row.content)}`);
  }

  for (const row of tableRows(sqlite, "personal_daily_notes")) {
    const date = text(row.business_date);
    const content = text(row.content).trim();
    if (content) pushLine(days, date, `### 每日复盘\n\n${content}`);
  }

  for (const row of tableRows(sqlite, "sleep_daily_records")) {
    const date = text(row.record_date);
    const duration = row.confirmed_duration_minutes ?? row.calculated_duration_minutes;
    pushLine(days, date, `- 睡眠 ${String(duration ?? "")} 分钟 ${formatClockRange(row.asleep_time, row.wake_time)}`.trim());
  }

  for (const row of tableRows(sqlite, "daily_learning_notes")) {
    const title = text(row.title);
    const date = text(row.business_date);
    const content = text(row.content).trim();
    pushLine(days, date, `### 学习：${title}\n\n${content}`);
  }

  for (const row of tableRows(sqlite, "reading_sessions")) {
    if (row.archived_at !== null) continue;
    const date = text(row.business_date);
    const title = sqlite
      .prepare("select title from reading_books where book_id = ?")
      .pluck()
      .get(row.book_id) as string | undefined;
    const bookLabel = title ? `《${title}》` : "";
    pushLine(
      days,
      date,
      `- 阅读${bookLabel} ${String(row.duration_minutes ?? "")} 分钟（${String(row.start_page ?? "")}–${String(row.end_page ?? "")} 页）${text(row.note)}`.trim(),
    );
  }

  for (const row of tableRows(sqlite, "health_checklist_day_items")) {
    if (row.completed !== 1 && row.completed !== true) continue;
    const dayRow = sqlite
      .prepare("select business_date from health_checklist_days where id = ?")
      .pluck()
      .get(row.day_id) as string | undefined;
    if (!dayRow) continue;
    pushLine(days, dayRow, `- 健康清单：${text(row.name)}`);
  }

  const dates = [...days.keys()].sort();
  const parts: string[] = [
    "# 个人积累库导出",
    "",
    `- 导出时间：${exportedAt.toISOString()}`,
    "- 本文件是人类可读的摘要；完整数据请使用 JSON 导出。",
    "",
  ];
  for (const date of dates) {
    parts.push(`## ${date}`, "", ...days.get(date)!.lines, "");
  }
  return parts.join("\n");
}

