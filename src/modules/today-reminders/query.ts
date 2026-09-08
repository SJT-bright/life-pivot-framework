import type Database from "better-sqlite3";

import { isBusinessDate } from "@/core/time/business-date";

import type { TodayReminder } from "./contracts";

interface TodayReminderRow {
  id: string;
  business_date: string;
  title: string;
  scheduled_time: string | null;
  completed: number;
  completed_at: string | null;
  alerted_at: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

function mapTodayReminder(row: TodayReminderRow): TodayReminder {
  return {
    id: row.id,
    businessDate: row.business_date,
    title: row.title,
    scheduledTime: row.scheduled_time,
    completed: row.completed === 1,
    completedAt: row.completed_at,
    alertedAt: row.alerted_at,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_REMINDER = `select reminder.id, reminder.business_date, reminder.title,
  reminder.scheduled_time, reminder.completed, reminder.completed_at,
  (select max(alert.occurred_at)
     from audit_events alert
    where alert.resource_type = 'today_reminder'
      and alert.resource_id = reminder.id
      and alert.event_type = 'alerted') as alerted_at,
  reminder.revision, reminder.created_at, reminder.updated_at
  from today_reminders reminder`;

export function listTodayReminders(
  sqlite: Database.Database,
  input: { businessDate: string },
): TodayReminder[] {
  if (!isBusinessDate(input.businessDate)) throw new Error("Invalid reminder business date");
  const rows = sqlite.prepare(`${SELECT_REMINDER}
    where reminder.business_date = ?
    order by reminder.completed asc,
      case when reminder.scheduled_time is null then 1 else 0 end asc,
      reminder.scheduled_time asc,
      reminder.created_at asc,
      reminder.id asc`)
    .all(input.businessDate) as TodayReminderRow[];
  return rows.map(mapTodayReminder);
}

export function listIncompletePastReminders(
  sqlite: Database.Database,
  input: { beforeBusinessDate: string; limit?: number },
): TodayReminder[] {
  if (!isBusinessDate(input.beforeBusinessDate)) {
    throw new Error("Invalid reminder business date");
  }
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("Invalid reminder history limit");
  }
  const rows = sqlite.prepare(`${SELECT_REMINDER}
    where reminder.business_date < ?
      and reminder.completed = 0
    order by reminder.business_date desc,
      case when reminder.scheduled_time is null then 1 else 0 end asc,
      reminder.scheduled_time asc,
      reminder.created_at asc,
      reminder.id asc
    limit ?`)
    .all(input.beforeBusinessDate, limit) as TodayReminderRow[];
  return rows.map(mapTodayReminder);
}

export function getTodayReminder(
  sqlite: Database.Database,
  reminderId: string,
): TodayReminder | null {
  const row = sqlite.prepare(`${SELECT_REMINDER} where reminder.id = ?`).get(reminderId) as
    | TodayReminderRow
    | undefined;
  return row ? mapTodayReminder(row) : null;
}
