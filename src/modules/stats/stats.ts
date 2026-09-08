import type Database from "better-sqlite3";

function shanghaiDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  return { year, month, day };
}

function todayBusinessDate(now: Date): string {
  const { year, month, day } = shanghaiDateParts(now);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day!));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function visibleCapturesCte(startDate: string, endDateExclusive: string): string {
  return `
    select business_date, occurred_at, content from capture_items
    where business_date >= '${startDate}' and business_date < '${endDateExclusive}'
      and event_type = 'capture'
      and not exists (
        select 1 from capture_items void
        where void.corrects_item_id = capture_items.id and void.event_type = 'void'
      )
  `;
}

export interface ReadingStats {
  waiting: number;
  reading: number;
  finished: number;
  yearSessions: number;
  yearMinutes: number;
  yearPages: number;
  monthlyMinutes: Array<{ month: string; minutes: number }>;
}

export interface ExerciseStats {
  last90Completed: number;
  last90Skipped: number;
  last90Minutes: number;
}

export interface SleepStats {
  last30Count: number;
  last30AvgMinutes: number | null;
}

export interface ReviewStats {
  totalDays: number;
  totalCharacters: number;
  currentStreak: number;
  longestStreak: number;
}

export interface HealthItemFact {
  name: string;
  completions: number;
}

export interface CaptureStats {
  total: number;
  thisMonth: number;
}

export interface StatsOverview {
  reading: ReadingStats;
  exercise: ExerciseStats;
  sleep: SleepStats;
  review: ReviewStats;
  health: HealthItemFact[];
  captures: CaptureStats;
  generatedAt: string;
}

export function getStatsOverview(sqlite: Database.Database, now = new Date()): StatsOverview {
  const today = todayBusinessDate(now);
  const { year, month } = shanghaiDateParts(now);
  const yearStart = `${year}-01-01`;
  const last90Start = addDays(today, -89);
  const last30Start = addDays(today, -29);
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;

  const bookRow = sqlite.prepare(`
    select
      sum(case when status = 'wishlist' then 1 else 0 end) as waiting,
      sum(case when status = 'reading' then 1 else 0 end) as reading,
      sum(case when status = 'finished' then 1 else 0 end) as finished
    from reading_books where archived_at is null
  `).get() as { waiting: number | null; reading: number | null; finished: number | null };

  const sessionRow = sqlite.prepare(`
    select count(*) as sessions,
      coalesce(sum(duration_minutes), 0) as minutes,
      coalesce(sum(end_page - start_page), 0) as pages
    from reading_sessions
    where business_date >= ? and archived_at is null
  `).get(yearStart) as { sessions: number; minutes: number; pages: number };

  const monthlyRows = sqlite.prepare(`
    select substr(business_date, 1, 7) as month, coalesce(sum(duration_minutes), 0) as minutes
    from reading_sessions
    where business_date >= ? and archived_at is null
    group by substr(business_date, 1, 7)
    order by month
  `).all(`${year - 1}-${String(month).padStart(2, "0")}-01`) as Array<{ month: string; minutes: number }>;

  const exerciseRow = sqlite.prepare(`
    select
      sum(case when status = 'completed' then 1 else 0 end) as completed,
      sum(case when status = 'skipped' then 1 else 0 end) as skipped,
      coalesce(sum(case when status <> 'skipped' then
        coalesce(manual_duration_minutes, confirmed_duration_minutes, calculated_duration_minutes) else 0 end), 0) as minutes
    from manual_exercise_days
    where business_date >= ? and business_date <= ?
  `).get(last90Start, today) as { completed: number | null; skipped: number | null; minutes: number };

  const sleepRow = sqlite.prepare(`
    select count(*) as count, avg(coalesce(confirmed_duration_minutes, calculated_duration_minutes)) as avg_minutes
    from sleep_daily_records where record_date >= ? and record_date <= ?
  `).get(last30Start, today) as { count: number; avg_minutes: number | null };

  const reviewRow = sqlite.prepare(`
    select count(*) as days, coalesce(sum(length(trim(content))), 0) as characters
    from personal_daily_notes where trim(content) <> ''
  `).get() as { days: number; characters: number };

  const reviewDates = sqlite.prepare(`
    select business_date from personal_daily_notes
    where trim(content) <> '' order by business_date
  `).all() as Array<{ business_date: string }>;
  const dateSet = new Set(reviewDates.map((row) => row.business_date));
  let currentStreak = 0;
  let cursor = today;
  while (dateSet.has(cursor)) {
    currentStreak += 1;
    cursor = addDays(cursor, -1);
  }
  let longestStreak = 0;
  let streak = 0;
  let previous: string | null = null;
  for (const date of [...dateSet].sort()) {
    streak = previous !== null && addDays(previous, 1) === date ? streak + 1 : 1;
    longestStreak = Math.max(longestStreak, streak);
    previous = date;
  }

  const healthRows = sqlite.prepare(`
    select i.name, count(*) as completions
    from health_checklist_day_items i
    join health_checklist_days d on d.id = i.day_id
    where i.completed = 1 and d.business_date >= ? and d.business_date <= ?
    group by i.name
    order by completions desc, i.name
    limit 8
  `).all(last30Start, today) as Array<{ name: string; completions: number }>;

  const captureTotal = sqlite.prepare(`
    select count(*) as count from capture_items capture
    where capture.event_type = 'capture'
      and not exists (
        select 1 from capture_items void
        where void.corrects_item_id = capture.id and void.event_type = 'void'
      )
  `).get() as { count: number };

  const captureMonth = sqlite.prepare(`
    select count(*) as count from (${visibleCapturesCte(monthStart, addDays(monthStart, 400))})
    where business_date >= ?
  `).get(monthStart) as { count: number };

  return {
    reading: {
      waiting: bookRow.waiting ?? 0,
      reading: bookRow.reading ?? 0,
      finished: bookRow.finished ?? 0,
      yearSessions: sessionRow.sessions,
      yearMinutes: sessionRow.minutes,
      yearPages: sessionRow.pages,
      monthlyMinutes: monthlyRows.slice(-12),
    },
    exercise: {
      last90Completed: exerciseRow.completed ?? 0,
      last90Skipped: exerciseRow.skipped ?? 0,
      last90Minutes: exerciseRow.minutes,
    },
    sleep: {
      last30Count: sleepRow.count,
      last30AvgMinutes: sleepRow.avg_minutes === null ? null : Math.round(sleepRow.avg_minutes),
    },
    review: {
      totalDays: reviewRow.days,
      totalCharacters: reviewRow.characters,
      currentStreak,
      longestStreak,
    },
    health: healthRows,
    captures: {
      total: captureTotal.count,
      thisMonth: captureMonth.count,
    },
    generatedAt: now.toISOString(),
  };
}
