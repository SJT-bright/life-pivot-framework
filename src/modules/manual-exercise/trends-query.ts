import type Database from "better-sqlite3";

import { isBusinessDate } from "@/core/time/business-date";

import {
  buildMuscleProgress,
  summarizeTrainingSet,
  type ExerciseMuscleProgress,
  type TrainingMetricObservation,
} from "./training-metrics";

// 容量分权重：组数是训练容量的主要货币（每周组数与增肌/力量收益呈剂量反应，
// 见 Schoenfeld 2017 / Baz-Valle 2022），因此组数权重显著高于次数。
export const VOLUME_SET_WEIGHT = 5;
export const VOLUME_REP_WEIGHT = 0.5;
// 证据区间：每个部位每周 10–20 组（新手 10–15 组足够）。
export const RECOMMENDED_WEEKLY_SETS = { min: 10, max: 20 } as const;

export interface ExerciseTrendsWeekPoint {
  readonly weekStart: string;
  readonly sets: number;
  readonly reps: number;
  readonly sessions: number;
  /** 容量分 = 组数×5 + 次数×0.5，保留一位小数。 */
  readonly volume: number;
}

export interface ExerciseTrendsSeries {
  readonly bodyPart: string;
  readonly totalSets: number;
  readonly totalSessions: number;
  readonly points: readonly ExerciseTrendsWeekPoint[];
}

export interface ExerciseTrendsSession {
  readonly businessDate: string;
  readonly bodyPart: string;
  readonly dayName: string;
  readonly sets: number;
  readonly reps: number;
  readonly volume: number;
  readonly loadVolumeKg: number | null;
  readonly bestE1rmKg: number | null;
  readonly actions: readonly {
    name: string;
    sets: number;
    reps: number;
    weightKg: number | null;
    loadVolumeKg: number | null;
    e1rmKg: number | null;
  }[];
}

export interface ExerciseTrendsSnapshot {
  readonly today: string;
  readonly weeks: readonly string[];
  readonly series: readonly ExerciseTrendsSeries[];
  readonly recentSessions: readonly ExerciseTrendsSession[];
  readonly muscleProgress: readonly ExerciseMuscleProgress[];
  readonly currentStreakWeeks: number;
}

interface DayRow {
  id: string;
  business_date: string;
  body_part: string;
  day_name: string;
}

interface ActionRow {
  day_id: string;
  name: string;
  actual_sets: number;
  actual_reps_text: string;
  actual_weight_text: string;
}

/**
 * 解析自由文本的次数记录："12, 10, 8" 逐组相加；只写一个数且组数大于 1
 * 时视为“每组次数”（"10" × 3 组 = 30）；无法解析时按 0 处理，只计组数。
 */
export function parseRepsText(repsText: string, sets: number): number {
  const numbers = (repsText.match(/\d+/gu) ?? [])
    .map(Number)
    .filter((value) => value > 0 && value <= 100);
  if (numbers.length === 0) return 0;
  if (numbers.length === 1 && sets > 1 && numbers[0] <= 50) {
    return numbers[0] * sets;
  }
  return numbers.slice(0, Math.max(sets, numbers.length)).reduce((total, value) => total + value, 0);
}

export function computeVolume(sets: number, reps: number): number {
  const volume = sets * VOLUME_SET_WEIGHT + reps * VOLUME_REP_WEIGHT;
  return Math.round(volume * 10) / 10;
}

/** 上海时区日期对应的周一。 */
function mondayOf(businessDate: string): string {
  const date = new Date(`${businessDate}T12:00:00+08:00`);
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday);
  return date.toISOString().slice(0, 10);
}

function shiftWeek(weekStart: string, weeks: number): string {
  const date = new Date(`${weekStart}T12:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + weeks * 7);
  return date.toISOString().slice(0, 10);
}

const BODY_PART_KEYWORDS: readonly string[] = [
  "胸", "肩", "背", "腿", "手臂", "二头", "三头", "核心", "腹", "臀", "有氧",
];

/** 把训练日的部位标签归一成稳定的序列名："推胸日"→"胸"，"肩+三头"→"肩"。 */
export function normalizeBodyPart(raw: string, dayName: string): string {
  const label = raw.trim() || dayName.trim();
  if (!label) return "未分类";
  for (const keyword of BODY_PART_KEYWORDS) {
    if (label.includes(keyword)) return keyword === "二头" || keyword === "三头" ? "手臂" : keyword;
  }
  return label;
}

export function getExerciseTrendsSnapshot(
  sqlite: Database.Database,
  input: { asOfDate: string; weeks?: number },
): ExerciseTrendsSnapshot {
  if (!isBusinessDate(input.asOfDate)) {
    throw new TypeError("Invalid exercise trends date.");
  }
  const weekCount = Math.max(4, Math.min(input.weeks ?? 12, 52));
  const today = input.asOfDate;
  const currentWeekStart = mondayOf(today);
  const weeks: string[] = [];
  for (let index = weekCount - 1; index >= 0; index -= 1) {
    weeks.push(shiftWeek(currentWeekStart, -index));
  }
  const firstWeek = weeks[0];
  const weekIndex = new Map(weeks.map((week, index) => [week, index]));

  const days = sqlite.prepare(
    `select id, business_date, body_part, day_name
     from manual_exercise_days
     where business_date >= ? and business_date <= ? and is_rest = 0 and status <> 'skipped'
     order by business_date asc`,
  ).all(firstWeek, today) as DayRow[];

  const actions = sqlite.prepare(
    `select day_id, name, actual_sets, actual_reps_text, actual_weight_text
     from manual_exercise_day_actions
     where actual_sets > 0 or actual_reps_text <> '' or actual_weight_text <> ''
     order by ordinal asc`,
  ).all() as ActionRow[];

  const actionsByDay = new Map<string, ActionRow[]>();
  for (const action of actions) {
    const bucket = actionsByDay.get(action.day_id) ?? [];
    bucket.push(action);
    actionsByDay.set(action.day_id, bucket);
  }

  interface Session {
    businessDate: string;
    weekStart: string;
    bodyPart: string;
    dayName: string;
    sets: number;
    reps: number;
    volume: number;
    loadVolumeKg: number | null;
    bestE1rmKg: number | null;
    actions: {
      name: string;
      sets: number;
      reps: number;
      weightKg: number | null;
      loadVolumeKg: number | null;
      e1rmKg: number | null;
    }[];
  }
  const sessions: Session[] = [];
  const observations: TrainingMetricObservation[] = [];
  for (const day of days) {
    const dayActions = actionsByDay.get(day.id) ?? [];
    if (dayActions.length === 0) continue;
    let sets = 0;
    let reps = 0;
    let loadVolumeKg = 0;
    let hasLoadVolume = false;
    let bestE1rmKg: number | null = null;
    const actionSummary: Session["actions"] = [];
    for (const action of dayActions) {
      const actionReps = parseRepsText(action.actual_reps_text, action.actual_sets);
      const metrics = summarizeTrainingSet(
        action.actual_sets,
        action.actual_reps_text,
        action.actual_weight_text,
      );
      sets += action.actual_sets;
      reps += actionReps;
      if (metrics.loadVolumeKg !== null) {
        loadVolumeKg += metrics.loadVolumeKg;
        hasLoadVolume = true;
      }
      if (metrics.bestE1rmKg !== null) {
        bestE1rmKg = bestE1rmKg === null
          ? metrics.bestE1rmKg
          : Math.max(bestE1rmKg, metrics.bestE1rmKg);
      }
      actionSummary.push({
        name: action.name,
        sets: action.actual_sets,
        reps: actionReps,
        weightKg: metrics.averageWeightKg,
        loadVolumeKg: metrics.loadVolumeKg,
        e1rmKg: metrics.bestE1rmKg,
      });
      observations.push({
        businessDate: day.business_date,
        dayLabel: `${day.body_part} ${day.day_name}`,
        actionName: action.name,
        sets: action.actual_sets,
        repsText: action.actual_reps_text,
        weightText: action.actual_weight_text,
      });
    }
    sessions.push({
      businessDate: day.business_date,
      weekStart: mondayOf(day.business_date),
      bodyPart: normalizeBodyPart(day.body_part, day.day_name),
      dayName: day.day_name,
      sets,
      reps,
      volume: computeVolume(sets, reps),
      loadVolumeKg: hasLoadVolume ? Math.round(loadVolumeKg * 10) / 10 : null,
      bestE1rmKg,
      actions: actionSummary,
    });
  }
  sessions.sort((left, right) => right.businessDate.localeCompare(left.businessDate));

  const weekRange = new Set(weeks);
  const aggregated = new Map<string, { weekStart: string; sets: number; reps: number; sessions: number; volume: number }[]>();
  for (const session of sessions) {
    if (!weekRange.has(session.weekStart)) continue;
    const index = weekIndex.get(session.weekStart)!;
    const series = aggregated.get(session.bodyPart) ?? weeks.map((weekStart) => ({
      weekStart, sets: 0, reps: 0, sessions: 0, volume: 0,
    }));
    const point = series[index];
    point.sets += session.sets;
    point.reps += session.reps;
    point.sessions += 1;
    point.volume = computeVolume(point.sets, point.reps);
    aggregated.set(session.bodyPart, series);
  }

  const series: ExerciseTrendsSeries[] = [...aggregated.entries()].map(([bodyPart, points]) => ({
    bodyPart,
    totalSets: points.reduce((total, point) => total + point.sets, 0),
    totalSessions: points.reduce((total, point) => total + point.sessions, 0),
    points,
  })).sort((left, right) => right.totalSets - left.totalSets);

  // 连续训练周数：本周尚未练时从上周开始往前数。
  let currentStreakWeeks = 0;
  const weeksWithTraining = new Set(sessions.map((session) => session.weekStart));
  let cursor = weeksWithTraining.has(currentWeekStart)
    ? currentWeekStart
    : shiftWeek(currentWeekStart, -1);
  while (weeksWithTraining.has(cursor)) {
    currentStreakWeeks += 1;
    cursor = shiftWeek(cursor, -1);
  }

  return {
    today,
    weeks,
    series,
    recentSessions: sessions.slice(0, 10),
    muscleProgress: buildMuscleProgress(observations, today),
    currentStreakWeeks,
  };
}
