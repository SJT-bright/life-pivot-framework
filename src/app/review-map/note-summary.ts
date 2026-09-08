import type { PersonalDailyNote } from "@/modules/personal-notes/contracts";

export interface DailyReviewSummary {
  readonly businessDate: string;
  /** 三个模板字段的合并文本；旧格式备注整体作为 completed。 */
  readonly completed: string;
  readonly effective: string;
  readonly tomorrow: string;
  /** 合并文本的总字数（不含 JSON 结构）。 */
  readonly chars: number;
}

export function summarizeDailyReview(note: PersonalDailyNote): DailyReviewSummary {
  const content = note.content;
  if (content.trim()) {
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      if (
        parsed.schemaVersion === "daily-review-template-v1"
        && typeof parsed.completed === "string"
        && typeof parsed.effective === "string"
        && typeof parsed.tomorrow === "string"
      ) {
        const { completed, effective, tomorrow } = parsed;
        return {
          businessDate: note.businessDate,
          completed,
          effective,
          tomorrow,
          chars: completed.length + effective.length + tomorrow.length,
        };
      }
    } catch {
      // 旧格式是纯文本，走下面的兜底。
    }
  }
  return {
    businessDate: note.businessDate,
    completed: content,
    effective: "",
    tomorrow: "",
    chars: content.length,
  };
}

/** 复盘卡片墙里的摘要：优先展示“今天做了什么”的开头。 */
export function reviewExcerpt(summary: DailyReviewSummary, maxLength = 96): string {
  const source = summary.completed.trim() || summary.effective.trim();
  const flattened = source.replace(/\s+/gu, " ");
  return flattened.length > maxLength ? `${flattened.slice(0, maxLength)}…` : flattened;
}

export interface ReviewMapStats {
  readonly totalDays: number;
  readonly totalChars: number;
  /** 以最近一次复盘为终点、按天连续的连击长度。 */
  readonly currentStreak: number;
  /** 本月已复盘天数。 */
  readonly monthDays: number;
  readonly monthLabel: string;
}

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

function toUtcDayKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * business_date 是不带时区的民用日期。统一从 UTC 正午/上海时刻中解耦，
 * 只把年月日映射到 UTC 日历做加减，避免服务器时区改变后跨日。
 */
function toUtcCalendarDate(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function shiftDayKey(key: string, days: number): string {
  const date = toUtcCalendarDate(key);
  return toUtcDayKey(new Date(date.getTime() + days * DAY_MILLISECONDS));
}

/** 周一为 0，周日为 6。 */
function weekdayIndex(key: string): number {
  return (toUtcCalendarDate(key).getUTCDay() + 6) % 7;
}

export function computeReviewStats(
  summaries: readonly DailyReviewSummary[],
  today: string,
): ReviewMapStats {
  const reviewed = new Set(summaries.map((summary) => summary.businessDate));
  let currentStreak = 0;
  let cursor = reviewed.has(today) ? today : shiftDayKey(today, -1);
  while (reviewed.has(cursor)) {
    currentStreak += 1;
    cursor = shiftDayKey(cursor, -1);
  }
  const monthPrefix = today.slice(0, 7);
  let monthDays = 0;
  for (const date of reviewed) {
    if (date.startsWith(monthPrefix)) monthDays += 1;
  }
  return {
    totalDays: reviewed.size,
    totalChars: summaries.reduce((total, summary) => total + summary.chars, 0),
    currentStreak,
    monthDays,
    monthLabel: today.slice(0, 7).replace("-", " 年 ") + " 月",
  };
}

export interface HeatmapCell {
  readonly date: string;
  readonly chars: number;
  readonly reviewed: boolean;
  readonly level: 0 | 1 | 2 | 3 | 4;
}

/**
 * 最近 weeks 周的热力日历数据：每列一周（周一起），最后一列到今天为止。
 * level 按字数分档：0 未复盘，1-4 越深越详尽。
 */
export function buildHeatmap(
  summaries: readonly DailyReviewSummary[],
  today: string,
  weeks = 26,
): HeatmapCell[][] {
  const charsByDate = new Map(summaries.map((summary) => [summary.businessDate, summary.chars]));
  const safeWeeks = Math.max(1, Math.floor(weeks));
  const weekday = weekdayIndex(today);
  const cellCount = (safeWeeks - 1) * 7 + weekday + 1;
  let cursor = shiftDayKey(today, -(cellCount - 1));
  const columns: HeatmapCell[][] = [];
  let current: HeatmapCell[] = [];
  for (let index = 0; index < cellCount; index += 1) {
    const chars = charsByDate.get(cursor) ?? 0;
    const reviewed = charsByDate.has(cursor);
    const level: HeatmapCell["level"] = !reviewed ? 0
      : chars < 60 ? 1
      : chars < 150 ? 2
      : chars < 300 ? 3
      : 4;
    current.push({ date: cursor, chars, reviewed, level });
    if (current.length === 7) {
      columns.push(current);
      current = [];
    }
    cursor = shiftDayKey(cursor, 1);
  }
  if (current.length > 0) columns.push(current);
  return columns;
}
