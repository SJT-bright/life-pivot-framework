import type Database from "better-sqlite3";

import { isBusinessDate } from "@/core/time/business-date";

import {
  type DailySleepRecord,
  DailySleepValidationError,
} from "./contracts";
import {
  type DailySleepRow,
  dailySleepRecordFromRow,
} from "./service";
import { previousCalendarDate } from "./scoring";

export interface DailySleepHistory {
  items: DailySleepRecord[];
}

const SELECT_RECORD = `select id, record_date, asleep_time, wake_time,
  calculated_duration_minutes, confirmed_duration_minutes,
  deep_sleep_minutes, light_sleep_minutes, rem_sleep_minutes, morning_feeling,
  manual_quality_score, awake_episodes, awake_minutes, quality_text, note,
  revision, created_at, updated_at from sleep_daily_records`;

function previousNaturalDay(
  sqlite: Database.Database,
  recordDate: string,
): DailySleepRow | null {
  const previousDate = previousCalendarDate(recordDate);
  if (!previousDate) return null;
  return (sqlite.prepare(`${SELECT_RECORD} where record_date = ?`).get(previousDate) as
    | DailySleepRow
    | undefined) ?? null;
}

export function getDailySleepRecord(
  sqlite: Database.Database,
  input: { recordDate: string },
): DailySleepRecord | null {
  if (!isBusinessDate(input.recordDate)) throw new DailySleepValidationError();
  const row = sqlite.prepare(`${SELECT_RECORD} where record_date = ?`).get(input.recordDate) as
    | DailySleepRow
    | undefined;
  return row ? dailySleepRecordFromRow(row, previousNaturalDay(sqlite, row.record_date)) : null;
}

export function getDailySleepHistory(
  sqlite: Database.Database,
  input: { limit: number; offset?: number },
): DailySleepHistory {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new DailySleepValidationError();
  }
  const offset = input.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new DailySleepValidationError();
  }
  const rows = sqlite.prepare(
    `${SELECT_RECORD} order by record_date desc, id desc limit ? offset ?`,
  ).all(input.limit, offset) as DailySleepRow[];
  return {
    items: rows.map((row) => dailySleepRecordFromRow(
      row,
      previousNaturalDay(sqlite, row.record_date),
    )),
  };
}

export function countDailySleepHistory(sqlite: Database.Database): number {
  const row = sqlite.prepare(
    "select count(*) as count from sleep_daily_records",
  ).get() as { count: number };
  return row.count;
}
