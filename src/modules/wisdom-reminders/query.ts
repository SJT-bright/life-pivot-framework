import type Database from "better-sqlite3";

import type { WisdomReminder } from "./contracts";

interface WisdomReminderRow {
  id: string;
  content: string;
  context: string;
  archived_at: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

function fromRow(row: WisdomReminderRow): WisdomReminder {
  return {
    id: row.id,
    content: row.content,
    context: row.context,
    archivedAt: row.archived_at,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT = `select id, content, context, archived_at, revision, created_at, updated_at
  from wisdom_reminders`;

export function listWisdomReminders(sqlite: Database.Database): WisdomReminder[] {
  const rows = sqlite.prepare(`${SELECT}
    where archived_at is null
    order by created_at desc, updated_at desc, rowid desc, id desc`).all() as WisdomReminderRow[];
  return rows.map(fromRow);
}

export function getWisdomReminder(
  sqlite: Database.Database,
  reminderId: string,
): WisdomReminder | null {
  const row = sqlite.prepare(`${SELECT} where id = ?`).get(reminderId) as
    | WisdomReminderRow
    | undefined;
  return row ? fromRow(row) : null;
}
