import type Database from "better-sqlite3";

import { isBusinessDate } from "@/core/time/business-date";

import {
  type DailyLearningNote,
  type PersonalKnowledgeModule,
  type PersonalKnowledgeSnapshot,
  PersonalKnowledgeValidationError,
} from "./contracts";

const MAX_MODULES = 500;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 100;

export interface PersonalKnowledgeSnapshotInput {
  businessDate: string;
  noteLimit?: number;
}

interface ModuleRow {
  module_id: string;
  parent_module_id: string | null;
  name: string;
  goal: string;
  current_focus: string;
  description: string;
  status: PersonalKnowledgeModule["status"];
  ordinal: number;
  revision: number;
  created_at: string;
  updated_at: string;
}

interface NoteRow {
  note_id: string;
  business_date: string;
  title: string;
  module_id: string;
  content: string;
  source: string;
  personal_understanding: string;
  open_questions: string;
  application: string;
  status: DailyLearningNote["status"];
  revision: number;
  created_at: string;
  updated_at: string;
}

function limit(value: number | undefined): number {
  const normalized = value ?? DEFAULT_LIMIT;
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > MAX_LIMIT) {
    throw new PersonalKnowledgeValidationError("Invalid personal knowledge snapshot limit.");
  }
  return normalized;
}

function tags(raw: string): string[] {
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error("Invalid stored knowledge tags.");
  }
  return value;
}

function moduleFromRow(row: ModuleRow): PersonalKnowledgeModule {
  return {
    moduleId: row.module_id,
    parentModuleId: row.parent_module_id,
    name: row.name,
    goal: row.goal,
    currentFocus: row.current_focus,
    description: row.description,
    status: row.status,
    ordinal: row.ordinal,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function noteFromRow(row: NoteRow): DailyLearningNote {
  return {
    noteId: row.note_id,
    businessDate: row.business_date,
    title: row.title,
    moduleId: row.module_id,
    content: row.content,
    source: row.source,
    personalUnderstanding: row.personal_understanding,
    openQuestions: row.open_questions,
    application: row.application,
    status: row.status,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getPersonalKnowledgeSnapshot(
  sqlite: Database.Database,
  input: PersonalKnowledgeSnapshotInput,
): PersonalKnowledgeSnapshot {
  if (!isBusinessDate(input.businessDate)) {
    throw new PersonalKnowledgeValidationError("Invalid personal knowledge snapshot date.");
  }
  const noteLimit = limit(input.noteLimit);
  const modules = sqlite.prepare(`with recursive module_tree as (
      select module_id, parent_module_id, name, goal, current_focus, description, status,
             ordinal, revision, created_at, updated_at, 1 as depth,
             printf('%020d:%s', ordinal, module_id) as sort_path
      from knowledge_modules
      where parent_module_id is null
      union all
      select child.module_id, child.parent_module_id, child.name, child.goal,
             child.current_focus, child.description, child.status, child.ordinal,
             child.revision, child.created_at, child.updated_at, parent.depth + 1,
             parent.sort_path || '/' || printf('%020d:%s', child.ordinal, child.module_id)
      from knowledge_modules child
      join module_tree parent on child.parent_module_id = parent.module_id
      where parent.depth < 5
    )
    select module_id, parent_module_id, name, goal, current_focus, description, status,
           ordinal, revision, created_at, updated_at
    from module_tree
    order by sort_path
    limit ?`).all(MAX_MODULES) as ModuleRow[];
  const dailyNotes = sqlite.prepare(`select note_id, business_date, title, module_id, content,
      source, personal_understanding, open_questions, application, status, revision,
      created_at, updated_at
    from daily_learning_notes
    where business_date = ?
    order by updated_at desc, note_id
    limit ?`).all(input.businessDate, noteLimit) as NoteRow[];

  return {
    businessDate: input.businessDate,
    modules: modules.map(moduleFromRow),
    dailyNotes: dailyNotes.map(noteFromRow),
  };
}

export interface RecentLearningNote {
  noteId: string;
  businessDate: string;
  title: string;
  moduleName: string;
  snippet: string;
}

export interface RecentLearningNotesPage {
  items: RecentLearningNote[];
  page: number;
  pageSize: number;
  total: number;
}

export function getRecentLearningNotes(
  sqlite: Database.Database,
  input: { page?: number; pageSize?: number },
): RecentLearningNotesPage {
  const pageSize = input.pageSize ?? 20;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    throw new PersonalKnowledgeValidationError("Invalid learning notes page size.");
  }
  const requestedPage = input.page ?? 1;
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1) {
    throw new PersonalKnowledgeValidationError("Invalid learning notes page.");
  }
  const totalRow = sqlite.prepare(
    "select count(*) as count from daily_learning_notes where status = 'active'",
  ).get() as { count: number };
  const rows = sqlite.prepare(
    `select note.note_id, note.business_date, note.title, note.content, module.name as module_name
     from daily_learning_notes note
     join knowledge_modules module on module.module_id = note.module_id
     where note.status = 'active'
     order by note.business_date desc, note.updated_at desc, note.note_id
     limit ? offset ?`,
  ).all(pageSize, (requestedPage - 1) * pageSize) as Array<{
    note_id: string;
    business_date: string;
    title: string;
    content: string;
    module_name: string;
  }>;
  return {
    items: rows.map((row) => ({
      noteId: row.note_id,
      businessDate: row.business_date,
      title: row.title,
      moduleName: row.module_name,
      snippet: row.content.replace(/\s+/g, " ").trim().slice(0, 120),
    })),
    page: requestedPage,
    pageSize,
    total: totalRow.count,
  };
}
