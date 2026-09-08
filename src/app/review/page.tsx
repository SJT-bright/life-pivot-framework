import { getApplicationDatabase } from "@/core/db/application-database";
import { toShanghaiBusinessDate } from "@/core/time/business-date";
import {
  type WeeklyReviewSnapshot,
  WeeklyReviewValidationError,
  isWeeklyReviewPeriod,
} from "@/modules/weekly-review/contracts";
import { getWeeklyExtras, type WeeklyExtras } from "@/modules/weekly-review/query";
import { getWeeklyReviewSnapshot } from "@/modules/weekly-review/query";
import { WeeklyReviewWorkspace } from "./weekly-review-workspace";

export const dynamic = "force-dynamic";

function mondayFor(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return value.toISOString().slice(0, 10);
}

function plusDays(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 7);
  return value.toISOString().slice(0, 10);
}

function minusDays(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - 7);
  return value.toISOString().slice(0, 10);
}

function createEmptySnapshot(periodStart: string, periodEndExclusive: string): WeeklyReviewSnapshot {
  return {
    periodStart,
    periodEndExclusive,
    recordedDays: [],
    trainingDays: [],
    sleepRecords: [],
    skincareUses: [],
    activeRecoveryCycle: null,
    healthCompletions: [],
    knowledgeAdditions: [],
    summary: null,
    recentEdits: [],
  };
}

const emptyExtras: WeeklyExtras = {
  previous: { recordedDays: 0, trainingCompleted: 0, sleepAvgMinutes: null },
  goals: [],
};

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ start?: string | string[] }> }) {
  try {
    const resolved = await searchParams;
    const requested = typeof resolved.start === "string" ? resolved.start : undefined;
    const current = mondayFor(toShanghaiBusinessDate(new Date()));
    const start = requested && isBusinessDateString(requested)
      ? mondayFor(requested)
      : current;
    const periodEndExclusive = plusDays(start);

    let initial = createEmptySnapshot(start, periodEndExclusive);
    let extras = emptyExtras;
    let message: string | null = null;

    try {
      initial = getWeeklyReviewSnapshot(getApplicationDatabase().sqlite, {
        periodStart: start,
        periodEndExclusive,
        recentLimit: 20,
      });
    } catch (error) {
      if (error instanceof WeeklyReviewValidationError) {
        message = "周回顾参数异常，已回退到当前周。";
      } else {
        message = "当前周回顾数据加载失败，已展示当前周空内容；你可稍后重试。";
      }
    }

    try {
      extras = getWeeklyExtras(getApplicationDatabase().sqlite, {
        periodStart: start,
        periodEndExclusive,
        previousPeriodStart: minusDays(start),
        previousPeriodEndExclusive: start,
      });
    } catch {
      extras = emptyExtras;
    }

    return (
      <main className="page-shell weekly-review-page">
        {message ? <p className="form-message" role="status">{message}</p> : null}
        <WeeklyReviewWorkspace initial={initial} extras={extras} today={current} />
      </main>
    );
  } catch {
    return (
      <main className="page-shell weekly-review-page">
        <p className="form-message" role="status">周回顾初始化失败，页面将以空内容模式打开。</p>
      </main>
    );
  }
}

function isBusinessDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
