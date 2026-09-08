import type Database from "better-sqlite3";

import { toShanghaiBusinessDate } from "@/core/time/business-date";

import {
  type WeeklyReviewQuery,
  type WeeklyReviewSnapshot,
  WeeklyReviewValidationError,
  isWeeklyReviewPeriod,
  parseWeeklyReviewQuery,
} from "./contracts";

interface SleepRow { record_date: string; asleep_time: string; wake_time: string; duration_minutes: number; quality_text: string; }
interface TrainingRow { id: string; business_date: string; day_name: string; status: "completed" | "skipped"; duration_minutes: number | null; }
interface SkincareRow { business_date: string; slot: "morning" | "evening"; product_name_snapshot: string; }
interface HealthRow { business_date: string; group_label: string; name: string; }
interface DailyLearningNoteRow { note_id: string; business_date: string; title: string; }
interface SummaryRow { content: string; revision: number; updated_at: string; }
interface RecentEditRow { target_type: WeeklyReviewSnapshot["recentEdits"][number]["targetType"]; target_id: string; title: string; modified_at: string; pinned: number; }

const SUMMARY_FIELDS = [
  ["highlights", "亮点"],
  ["blockers", "阻碍"],
  ["lessons", "经验教训"],
  ["adjustments", "调整"],
  ["nextFocus", "下周重点"],
] as const;

function contentForDisplay(content: string): string {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return content;
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).length !== SUMMARY_FIELDS.length ||
        !SUMMARY_FIELDS.every(([key]) => typeof record[key] === "string")) return content;
    return SUMMARY_FIELDS
      .filter(([key]) => (record[key] as string).trim().length > 0)
      .map(([key, label]) => `${label}：${record[key] as string}`)
      .join("\n");
  } catch { return content; }
}

function inPeriod(date: string, input: WeeklyReviewQuery): boolean {
  return date >= input.periodStart && date < input.periodEndExclusive;
}

export function getWeeklyReviewSnapshot(
  sqlite: Database.Database,
  input: WeeklyReviewQuery,
): WeeklyReviewSnapshot {
  const query = parseWeeklyReviewQuery(input);
  const sleepRecords = sqlite.prepare(`select record_date, asleep_time, wake_time,
      coalesce(confirmed_duration_minutes, calculated_duration_minutes) as duration_minutes, quality_text
    from sleep_daily_records where record_date >= ? and record_date < ? order by record_date, id`)
    .all(query.periodStart, query.periodEndExclusive) as SleepRow[];
  const trainingDays = sqlite.prepare(`select id, business_date, day_name, status,
      coalesce(manual_duration_minutes, confirmed_duration_minutes, calculated_duration_minutes) as duration_minutes
    from manual_exercise_days where business_date >= ? and business_date < ?
      and status in ('completed', 'skipped') order by business_date, id`)
    .all(query.periodStart, query.periodEndExclusive) as TrainingRow[];
  const skincareUses = sqlite.prepare(`select d.business_date, i.slot, i.product_name_snapshot
    from manual_skincare_day_items i join manual_skincare_days d on d.id = i.day_id
    where d.business_date >= ? and d.business_date < ? and i.used = 1
    order by d.business_date, i.slot, i.ordinal, i.id`)
    .all(query.periodStart, query.periodEndExclusive) as SkincareRow[];
  const healthCompletions = sqlite.prepare(`select d.business_date, i.group_label, i.name
    from health_checklist_day_items i join health_checklist_days d on d.id = i.day_id
    where d.business_date >= ? and d.business_date < ? and i.completed = 1
    order by d.business_date, i.ordinal, i.id`)
    .all(query.periodStart, query.periodEndExclusive) as HealthRow[];
  const dailyNotes = sqlite.prepare(`select note_id, business_date, title from daily_learning_notes
    where business_date >= ? and business_date < ? and status = 'active'
    order by business_date, note_id`).all(query.periodStart, query.periodEndExclusive) as DailyLearningNoteRow[];
  const knowledgeAdditions = [
    ...dailyNotes.map((row) => ({ kind: "daily-note" as const, id: row.note_id, businessDate: row.business_date, title: row.title })),
  ].filter((row) => inPeriod(row.businessDate, query)).sort((left, right) =>
    left.businessDate.localeCompare(right.businessDate) || left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
  const active = sqlite.prepare(`select id, name from manual_skincare_recovery_cycles
    where status = 'active' limit 1`).get() as { id: string; name: string } | undefined;
  const summaryRow = sqlite.prepare(`select content, revision, updated_at from reviews
    where review_type = 'weekly' and period_start = ? and period_end_exclusive = ? and archived_at is null
    order by updated_at desc, revision desc, id desc limit 1`).get(query.periodStart, query.periodEndExclusive) as SummaryRow | undefined;
  const personalNoteDays = sqlite.prepare(`select business_date from personal_daily_notes
    where business_date >= ? and business_date < ? and trim(content) <> '' order by business_date`)
    .all(query.periodStart, query.periodEndExclusive) as Array<{ business_date: string }>;
  const recentEdits = sqlite.prepare(`select * from (
      select 'exercise-template' as target_type, item.id as target_id,
        item.name as title, item.updated_at as modified_at,
        exists(select 1 from user_pins pin where pin.target_type = 'exercise-template' and pin.target_id = item.id) as pinned
      from manual_exercise_templates item
      union all select 'skincare-plan', item.id, item.name, item.updated_at,
        exists(select 1 from user_pins pin where pin.target_type = 'skincare-plan' and pin.target_id = item.id)
      from manual_skincare_recovery_plans item
      union all select 'health-template', item.id, item.name, item.updated_at,
        exists(select 1 from user_pins pin where pin.target_type = 'health-template' and pin.target_id = item.id)
      from health_checklist_templates item
    ) order by modified_at desc, target_type, target_id limit ?`).all(query.recentLimit) as RecentEditRow[];
  const dates = new Set<string>();
  for (const row of sleepRecords) dates.add(row.record_date);
  for (const row of trainingDays) dates.add(row.business_date);
  for (const row of skincareUses) dates.add(row.business_date);
  for (const row of healthCompletions) dates.add(row.business_date);
  for (const row of knowledgeAdditions) dates.add(row.businessDate);
  for (const row of personalNoteDays) dates.add(row.business_date);
  return {
    periodStart: query.periodStart, periodEndExclusive: query.periodEndExclusive,
    recordedDays: [...dates].sort(),
    trainingDays: trainingDays.map((row) => ({ id: row.id, businessDate: row.business_date, name: row.day_name, status: row.status, durationMinutes: row.duration_minutes })),
    sleepRecords: sleepRecords.map((row) => ({ recordDate: row.record_date, asleepTime: row.asleep_time, wakeTime: row.wake_time, durationMinutes: row.duration_minutes, qualityText: row.quality_text })),
    skincareUses: skincareUses.map((row) => ({ businessDate: row.business_date, slot: row.slot, productName: row.product_name_snapshot })),
    activeRecoveryCycle: active ?? null,
    healthCompletions: healthCompletions.map((row) => ({ businessDate: row.business_date, groupLabel: row.group_label, name: row.name })),
    knowledgeAdditions,
    summary: summaryRow ? { content: contentForDisplay(summaryRow.content), revision: summaryRow.revision, updatedAt: summaryRow.updated_at } : null,
    recentEdits: recentEdits.map((row) => ({ targetType: row.target_type, targetId: row.target_id, title: row.title, modifiedAt: row.modified_at, pinned: row.pinned === 1 })),
  };
}

export interface WeeklyComparison {
  recordedDays: number;
  trainingCompleted: number;
  sleepAvgMinutes: number | null;
}

export interface WeeklyGoalProgress {
  id: string;
  title: string;
  goalType: "long-term" | "stage";
  progressPercent: number;
  actionsCompletedThisWeek: number;
}

export interface WeeklyExtras {
  previous: WeeklyComparison;
  goals: WeeklyGoalProgress[];
}

interface WeeklyComparisonRow {
  recorded_days: number;
  training_completed: number;
  sleep_avg_minutes: number | null;
}

export function getWeeklyExtras(
  sqlite: Database.Database,
  input: {
    periodStart: string;
    periodEndExclusive: string;
    previousPeriodStart: string;
    previousPeriodEndExclusive: string;
  },
): WeeklyExtras {
  if (!isWeeklyReviewPeriod(input.periodStart, input.periodEndExclusive)
    || !isWeeklyReviewPeriod(input.previousPeriodStart, input.previousPeriodEndExclusive)) {
    throw new WeeklyReviewValidationError();
  }
  const previous = sqlite.prepare(`
    with period_days as (
      select distinct business_date as date from capture_items
        where business_date >= ? and business_date < ? and event_type = 'capture'
        and not exists (select 1 from capture_items void where void.corrects_item_id = capture_items.id and void.event_type = 'void')
      union select record_date from sleep_daily_records
        where record_date >= ? and record_date < ?
      union select business_date from manual_exercise_days
        where business_date >= ? and business_date < ? and status in ('completed', 'skipped')
      union select business_date from personal_daily_notes
        where business_date >= ? and business_date < ? and trim(content) <> ''
    )
    select
      (select count(*) from period_days) as recorded_days,
      (select count(*) from manual_exercise_days
        where business_date >= ? and business_date < ? and status = 'completed') as training_completed,
      (select avg(coalesce(confirmed_duration_minutes, calculated_duration_minutes))
        from sleep_daily_records where record_date >= ? and record_date < ?) as sleep_avg_minutes
  `).get(
    input.previousPeriodStart, input.previousPeriodEndExclusive,
    input.previousPeriodStart, input.previousPeriodEndExclusive,
    input.previousPeriodStart, input.previousPeriodEndExclusive,
    input.previousPeriodStart, input.previousPeriodEndExclusive,
    input.previousPeriodStart, input.previousPeriodEndExclusive,
    input.previousPeriodStart, input.previousPeriodEndExclusive,
  ) as WeeklyComparisonRow;

  const goalRows = sqlite.prepare(`
    select goal.id, goal.title, goal.goal_type, goal.progress_percent,
      (select count(*) from actions action
        where action.goal_id = goal.id and action.status = 'completed'
          and action.business_date >= ? and action.business_date < ?) as actions_completed
    from goals goal
    where goal.status = 'active' and goal.archived_at is null
    order by goal.created_at asc, goal.id asc
    limit 12
  `).all(input.periodStart, input.periodEndExclusive) as Array<{
    id: string; title: string; goal_type: "long-term" | "stage"; progress_percent: number; actions_completed: number;
  }>;

  return {
    previous: {
      recordedDays: previous.recorded_days,
      trainingCompleted: previous.training_completed,
      sleepAvgMinutes: previous.sleep_avg_minutes === null ? null : Math.round(previous.sleep_avg_minutes),
    },
    goals: goalRows.map((row) => ({
      id: row.id,
      title: row.title,
      goalType: row.goal_type,
      progressPercent: row.progress_percent,
      actionsCompletedThisWeek: row.actions_completed,
    })),
  };
}
