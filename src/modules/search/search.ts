import type Database from "better-sqlite3";
import { z } from "zod";

const MAX_PER_SOURCE = 10;
const MIN_QUERY_LENGTH = 1;
const MAX_QUERY_LENGTH = 200;

export class SearchInputError extends Error {
  constructor(message = "搜索词格式不正确") {
    super(message);
    this.name = "SearchInputError";
  }
}

export const searchQuerySchema = z.object({
  query: z
    .string()
    .trim()
    .min(MIN_QUERY_LENGTH, "输入至少 1 个字")
    .max(MAX_QUERY_LENGTH, "搜索词过长"),
});

export type SearchQueryInput = z.output<typeof searchQuerySchema>;

export interface SearchHit {
  type: "capture" | "learning" | "review" | "reading" | "reminder" | "goal" | "action" | "health";
  id: string;
  title: string;
  snippet: string;
  businessDate: string | null;
  href: string;
}

export interface SearchOutcome {
  query: string;
  tag: string | null;
  hits: SearchHit[];
}

export function parseSearchQuery(raw: string): SearchQueryInput & { tag: string | null } {
  const trimmed = raw.trim();
  const parsed = searchQuerySchema.safeParse({ query: trimmed });
  if (!parsed.success) {
    throw new SearchInputError(parsed.error.issues[0]?.message ?? "搜索词格式不正确");
  }
  const tagMatch = /^#([\p{L}\p{N}_-]{1,32})$/u.exec(parsed.data.query);
  const tag = tagMatch ? tagMatch[1]! : null;
  return { ...parsed.data, tag };
}

function snippetFor(content: string, query: string, width = 90): string {
  const collapsed = content.replace(/\s+/g, " ").trim();
  const lower = collapsed.toLowerCase();
  const index = lower.indexOf(query.toLowerCase());
  if (index < 0) return collapsed.slice(0, width);
  const start = Math.max(0, index - 20);
  const prefix = start > 0 ? "…" : "";
  return `${prefix}${collapsed.slice(start, start + width)}${collapsed.length > start + width ? "…" : ""}`;
}

function captureVisibilityFilter(alias = "capture_items"): string {
  return `${alias}.event_type = 'capture'
     and not exists (
       select 1 from capture_items void
       where void.corrects_item_id = ${alias}.id and void.event_type = 'void'
     )`;
}

export function searchEverything(
  sqlite: Database.Database,
  input: SearchQueryInput & { tag: string | null },
): SearchOutcome {
  const pattern = `%${input.query.replace(/[%_\\]/g, (match) => `\\${match}`)}%`;
  const hits: SearchHit[] = [];

  const captures = sqlite
    .prepare(
      `select id, business_date, occurred_at, content
       from capture_items
       where ${captureVisibilityFilter()}
         and content like ? escape '\\'
       order by business_date desc, occurred_at desc
       limit ?`,
    )
    .all(pattern, MAX_PER_SOURCE) as Array<{
    id: string;
    business_date: string;
    occurred_at: string;
    content: string;
  }>;
  for (const row of captures) {
    hits.push({
      type: "capture",
      id: row.id,
      title: snippetFor(row.content, input.query, 40),
      snippet: row.content,
      businessDate: row.business_date,
      href: `/today?date=${row.business_date}`,
    });
  }

  const learning = sqlite
    .prepare(
      `select note.note_id, note.business_date, note.title, note.content, module.name as module_name
       from daily_learning_notes note
       join knowledge_modules module on module.module_id = note.module_id
       where note.status = 'active'
         and (note.title like ? escape '\\' or note.content like ? escape '\\')
       order by note.business_date desc
       limit ?`,
    )
    .all(pattern, pattern, MAX_PER_SOURCE) as Array<{
    note_id: string;
    business_date: string;
    title: string;
    content: string;
    module_name: string;
  }>;
  for (const row of learning) {
    hits.push({
      type: "learning",
      id: row.note_id,
      title: row.title || "学习记录",
      snippet: `${row.module_name} · ${snippetFor(row.content, input.query)}`,
      businessDate: row.business_date,
      href: `/knowledge?date=${row.business_date}`,
    });
  }

  const reviews = sqlite
    .prepare(
      `select id, business_date, content
       from personal_daily_notes
       where content like ? escape '\\'
       order by business_date desc
       limit ?`,
    )
    .all(pattern, MAX_PER_SOURCE) as Array<{
    id: string;
    business_date: string;
    content: string;
  }>;
  for (const row of reviews) {
    hits.push({
      type: "review",
      id: row.id,
      title: `每日复盘 · ${row.business_date}`,
      snippet: snippetFor(row.content, input.query),
      businessDate: row.business_date,
      href: `/daily-review?date=${row.business_date}`,
    });
  }

  const reading = sqlite
    .prepare(
      `select note.note_id, note.title, note.content, book.title as book_title
       from reading_notes note
       join reading_books book on book.book_id = note.book_id
       where note.archived_at is null
         and (note.title like ? escape '\\' or note.content like ? escape '\\' or book.title like ? escape '\\')
       order by note.updated_at desc
       limit ?`,
    )
    .all(pattern, pattern, pattern, MAX_PER_SOURCE) as Array<{
    note_id: string;
    title: string;
    content: string;
    book_title: string;
  }>;
  for (const row of reading) {
    hits.push({
      type: "reading",
      id: row.note_id,
      title: row.title || `读后感 · 《${row.book_title}》`,
      snippet: `《${row.book_title}》 · ${snippetFor(row.content, input.query)}`,
      businessDate: null,
      href: "/reading",
    });
  }

  const reminders = sqlite
    .prepare(
      `select id, business_date, title
       from today_reminders
       where title like ? escape '\\'
       order by business_date desc
       limit ?`,
    )
    .all(pattern, MAX_PER_SOURCE) as Array<{ id: string; business_date: string; title: string }>;
  for (const row of reminders) {
    hits.push({
      type: "reminder",
      id: row.id,
      title: row.title,
      snippet: `提醒 · ${row.business_date}`,
      businessDate: row.business_date,
      href: `/today?date=${row.business_date}`,
    });
  }

  const goals = sqlite
    .prepare(
      `select id, title, description
       from goals
       where status = 'active' and (title like ? escape '\\' or description like ? escape '\\')
       limit ?`,
    )
    .all(pattern, pattern, MAX_PER_SOURCE) as Array<{
    id: string;
    title: string;
    description: string;
  }>;
  for (const row of goals) {
    hits.push({
      type: "goal",
      id: row.id,
      title: row.title,
      snippet: `目标 · ${snippetFor(row.description, input.query, 60)}`,
      businessDate: null,
      href: "/goals",
    });
  }

  const actions = sqlite
    .prepare(
      `select id, title, business_date
       from actions
       where status in ('pending', 'completed') and title like ? escape '\\'
       order by business_date desc
       limit ?`,
    )
    .all(pattern, MAX_PER_SOURCE) as Array<{
    id: string;
    title: string;
    business_date: string | null;
  }>;
  for (const row of actions) {
    hits.push({
      type: "action",
      id: row.id,
      title: row.title,
      snippet: `行动 · ${row.business_date ?? "未安排"}`,
      businessDate: row.business_date,
      href: "/goals",
    });
  }

  const healthItems = sqlite
    .prepare(
      `select distinct name from health_checklist_day_items
       where name like ? escape '\\'
       order by name
       limit ?`,
    )
    .all(pattern, MAX_PER_SOURCE) as Array<{ name: string }>;
  for (const row of healthItems) {
    hits.push({
      type: "health",
      id: `health:${row.name}`,
      title: row.name,
      snippet: "健康清单项目",
      businessDate: null,
      href: "/health",
    });
  }

  return {
    query: input.query,
    tag: input.tag,
    hits,
  };
}
