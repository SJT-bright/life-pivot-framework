import type Database from "better-sqlite3";

import { isBusinessDate } from "@/core/time/business-date";

import type { PersonalDailyNote } from "./contracts";

interface PersonalDailyNoteRow {
  id: string;
  business_date: string;
  content: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

function mapPersonalDailyNote(row: PersonalDailyNoteRow): PersonalDailyNote {
  return {
    id: row.id,
    businessDate: row.business_date,
    content: row.content,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getPersonalDailyNote(
  sqlite: Database.Database,
  input: { businessDate: string },
): PersonalDailyNote | null {
  if (!isBusinessDate(input.businessDate)) {
    throw new Error("Invalid personal note business date");
  }
  const row = sqlite.prepare(`select id, business_date, content, revision, created_at, updated_at
    from personal_daily_notes where business_date = ?`)
    .get(input.businessDate) as PersonalDailyNoteRow | undefined;
  return row ? mapPersonalDailyNote(row) : null;
}

export function listPersonalDailyNotes(
  sqlite: Database.Database,
  input: { limit?: number } = {},
): PersonalDailyNote[] {
  const limit = Math.max(1, Math.min(input.limit ?? 400, 2000));
  const rows = sqlite.prepare(`select id, business_date, content, revision, created_at, updated_at
    from personal_daily_notes
    order by business_date desc
    limit ?`)
    .all(limit) as PersonalDailyNoteRow[];
  return rows.map(mapPersonalDailyNote);
}
