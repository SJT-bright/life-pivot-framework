import { isBusinessDate, toShanghaiBusinessDate } from "@/core/time/business-date";

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
const SHANGHAI_OFFSET_MILLISECONDS = 8 * 60 * 60 * 1000;

export const DEFAULT_RECOVERY_DURATION_DAYS = 14;
export const MIN_RECOVERY_DURATION_DAYS = 1;
export const MAX_RECOVERY_DURATION_DAYS = 365;

export interface RecoveryCountdownInput {
  readonly status: "draft" | "active" | "completed";
  readonly durationDays?: number | null;
  readonly actualStartedOn: string | null;
  readonly actualCompletedOn: string | null;
  readonly expectedEndOn: string | null;
}

export interface RecoveryCountdown {
  readonly totalDays: number;
  /** Full natural days that have passed since the start date. */
  readonly elapsedDays: number;
  /** Planned natural days still available, including the current date. */
  readonly remainingDays: number;
  readonly currentDay: number;
  readonly expectedEndOn: string;
  readonly state: "scheduled" | "active" | "due" | "completed";
}

function utcDateMilliseconds(businessDate: string): number {
  if (!isBusinessDate(businessDate)) throw new TypeError("Invalid recovery calendar date.");
  const [year, month, day] = businessDate.split("-").map(Number);
  return Date.UTC(year!, month! - 1, day!);
}

export function recoveryCalendarDayDifference(
  fromBusinessDate: string,
  toBusinessDate: string,
): number {
  return Math.round(
    (utcDateMilliseconds(toBusinessDate) - utcDateMilliseconds(fromBusinessDate))
      / DAY_MILLISECONDS,
  );
}

export function addRecoveryCalendarDays(businessDate: string, days: number): string {
  if (!Number.isSafeInteger(days)) throw new TypeError("Invalid recovery calendar offset.");
  return new Date(utcDateMilliseconds(businessDate) + days * DAY_MILLISECONDS)
    .toISOString()
    .slice(0, 10);
}

export function isRecoveryDurationDays(value: unknown): value is number {
  return Number.isSafeInteger(value)
    && Number(value) >= MIN_RECOVERY_DURATION_DAYS
    && Number(value) <= MAX_RECOVERY_DURATION_DAYS;
}

/**
 * Recovers the persisted duration from the existing start/end facts. For a
 * draft, `anchorOn` is the Shanghai date on which its expected end was saved.
 */
export function deriveRecoveryDurationDays(input: {
  readonly expectedEndOn: string | null;
  readonly actualStartedOn: string | null;
  readonly anchorOn: string | null;
}): number | null {
  if (!input.expectedEndOn) return null;
  const anchor = input.actualStartedOn ?? input.anchorOn;
  if (!anchor) return null;
  const duration = recoveryCalendarDayDifference(anchor, input.expectedEndOn) + 1;
  return isRecoveryDurationDays(duration) ? duration : null;
}

/**
 * Natural-day countdown semantics:
 * - On the start date, 0 full days have elapsed and all planned days remain.
 * - Entering each following calendar date decrements remaining days by one.
 * - Reaching zero never mutates/completes the cycle; it becomes `due` until
 *   the user explicitly records completion.
 */
export function calculateRecoveryCountdown(
  cycle: RecoveryCountdownInput,
  today: string,
): RecoveryCountdown | null {
  if (!isBusinessDate(today) || !cycle.actualStartedOn || !cycle.expectedEndOn) return null;
  const inferredDuration = recoveryCalendarDayDifference(
    cycle.actualStartedOn,
    cycle.expectedEndOn,
  ) + 1;
  const totalDays = isRecoveryDurationDays(cycle.durationDays)
    ? cycle.durationDays
    : isRecoveryDurationDays(inferredDuration)
      ? inferredDuration
      : null;
  if (totalDays === null) return null;

  const calendarDaysPassed = recoveryCalendarDayDifference(cycle.actualStartedOn, today);
  const elapsedDays = Math.min(totalDays, Math.max(0, calendarDaysPassed));
  const remainingDays = Math.max(0, totalDays - elapsedDays);
  const completed = cycle.status === "completed";
  const completedElapsedDays = completed && cycle.actualCompletedOn
    ? Math.min(totalDays, Math.max(
        1,
        recoveryCalendarDayDifference(cycle.actualStartedOn, cycle.actualCompletedOn) + 1,
      ))
    : elapsedDays;
  return {
    totalDays,
    elapsedDays: completedElapsedDays,
    remainingDays: completed ? 0 : remainingDays,
    currentDay: completed
      ? completedElapsedDays
      : Math.min(totalDays, Math.max(1, calendarDaysPassed + 1)),
    expectedEndOn: cycle.expectedEndOn,
    state: completed
      ? "completed"
      : calendarDaysPassed < 0
        ? "scheduled"
        : remainingDays === 0
          ? "due"
          : "active",
  };
}

export function millisecondsUntilNextShanghaiDate(date: Date): number {
  if (!Number.isFinite(date.getTime())) throw new TypeError("Invalid current time.");
  const shanghaiNow = new Date(date.getTime() + SHANGHAI_OFFSET_MILLISECONDS);
  const nextMidnightUtcClock = Date.UTC(
    shanghaiNow.getUTCFullYear(),
    shanghaiNow.getUTCMonth(),
    shanghaiNow.getUTCDate() + 1,
  );
  return Math.max(1, nextMidnightUtcClock - shanghaiNow.getTime());
}

export function currentRecoveryBusinessDate(date: Date): string {
  return toShanghaiBusinessDate(date);
}
