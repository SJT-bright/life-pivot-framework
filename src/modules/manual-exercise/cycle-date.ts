import type Database from "better-sqlite3";

/** Reconstruct the cycle as of a calendar date without changing the live cursor. */
export function cycleDayKeyForDate(
  sqlite: Database.Database,
  templateId: string,
  templateVersionId: string,
  businessDate: string,
  today: string,
  liveDayKey: string,
): string {
  if (businessDate >= today) return liveDayKey;

  const events = sqlite.prepare(
    `select business_date, event_type, from_day_key, to_day_key
     from manual_exercise_cycle_events
     where template_id = ? and business_date <= ?
     order by business_date desc, cycle_revision_after desc`,
  ).all(templateId, businessDate) as Array<{
    business_date: string;
    event_type: string;
    from_day_key: string | null;
    to_day_key: string | null;
  }>;
  const available = new Set(sqlite.prepare(
    "select day_key from manual_exercise_template_days where template_version_id = ? order by ordinal",
  ).pluck().all(templateVersionId) as string[]);
  for (const event of events) {
    const key = event.business_date === businessDate
      && (event.event_type === "completed" || event.event_type === "advanced")
      ? event.from_day_key : event.to_day_key;
    if (key && available.has(key)) return key;
  }
  return available.values().next().value ?? liveDayKey;
}
