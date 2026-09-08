import { isBusinessDate } from "@/core/time/business-date";

export interface WeeklyReviewQuery {
  periodStart: string;
  periodEndExclusive: string;
  recentLimit: number;
}

export interface WeeklyReviewSnapshot {
  periodStart: string;
  periodEndExclusive: string;
  recordedDays: string[];
  trainingDays: Array<{ id: string; businessDate: string; name: string; status: "completed" | "skipped"; durationMinutes: number | null }>;
  sleepRecords: Array<{ recordDate: string; asleepTime: string; wakeTime: string; durationMinutes: number; qualityText: string }>;
  skincareUses: Array<{ businessDate: string; slot: "morning" | "evening"; productName: string }>;
  activeRecoveryCycle: { id: string; name: string } | null;
  healthCompletions: Array<{ businessDate: string; groupLabel: string; name: string }>;
  knowledgeAdditions: Array<{ kind: "daily-note"; id: string; businessDate: string; title: string }>;
  summary: { content: string; revision: number; updatedAt: string } | null;
  recentEdits: Array<{ targetType: "exercise-template" | "skincare-plan" | "health-template"; targetId: string; title: string; modifiedAt: string; pinned: boolean }>;
}

export class WeeklyReviewValidationError extends Error {
  constructor() { super("Invalid weekly review query."); }
}

const DEFAULT_RECENT_LIMIT = 20;
const MAX_RECENT_LIMIT = 100;

export function isWeeklyReviewPeriod(start: string, end: string): boolean {
  if (!isBusinessDate(start) || !isBusinessDate(end)) return false;
  const startAt = new Date(`${start}T00:00:00.000Z`);
  const endAt = new Date(`${end}T00:00:00.000Z`);
  return startAt.getUTCDay() === 1 && endAt.getTime() - startAt.getTime() === 7 * 86_400_000;
}

function readRecord(input: unknown): WeeklyReviewQuery {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new WeeklyReviewValidationError();
  const value = input as Record<string, unknown>;
  const keys = Object.keys(value);
  if (!keys.every((key) => key === "periodStart" || key === "periodEndExclusive" || key === "recentLimit")) {
    throw new WeeklyReviewValidationError();
  }
  return parseValues(value.periodStart, value.periodEndExclusive, value.recentLimit ?? DEFAULT_RECENT_LIMIT);
}

function parseValues(start: unknown, end: unknown, recentLimit: unknown): WeeklyReviewQuery {
  if (typeof start !== "string" || typeof end !== "string" || typeof recentLimit !== "number" ||
      !Number.isSafeInteger(recentLimit) || recentLimit < 1 || recentLimit > MAX_RECENT_LIMIT ||
      !isWeeklyReviewPeriod(start, end)) {
    throw new WeeklyReviewValidationError();
  }
  return { periodStart: start, periodEndExclusive: end, recentLimit };
}

function readSearchParams(input: URLSearchParams): WeeklyReviewQuery {
  const allowed = new Set(["start", "end", "recentLimit"]);
  for (const key of input.keys()) if (!allowed.has(key)) throw new WeeklyReviewValidationError();
  const start = input.getAll("start");
  const end = input.getAll("end");
  const limit = input.getAll("recentLimit");
  if (start.length !== 1 || end.length !== 1 || limit.length > 1) throw new WeeklyReviewValidationError();
  const parsedLimit = limit.length === 0
    ? DEFAULT_RECENT_LIMIT
    : /^(?:[1-9]|[1-9]\d|100)$/u.test(limit[0]!) ? Number(limit[0]) : Number.NaN;
  return parseValues(start[0], end[0], parsedLimit);
}

export function parseWeeklyReviewQuery(input: unknown): WeeklyReviewQuery {
  return input instanceof URLSearchParams ? readSearchParams(input) : readRecord(input);
}
