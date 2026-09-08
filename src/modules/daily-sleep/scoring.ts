import { isBusinessDate } from "@/core/time/business-date";

import type { DailySleepScore } from "./contracts";

export const SLEEP_SCORE_DISCLAIMER = "个人趋势分，非医疗诊断";

export interface SleepWellnessRaw {
  recordDate: string;
  asleepTime: string;
  wakeTime: string;
  durationMinutes: number;
  deepSleepMinutes: number | null;
  lightSleepMinutes: number | null;
  remSleepMinutes: number | null;
  morningFeeling: number | null;
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function minuteOfDay(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours! * 60 + minutes!;
}

export function circularMinuteDistance(left: string, right: string): number {
  const absolute = Math.abs(minuteOfDay(left) - minuteOfDay(right));
  return Math.min(absolute, 1440 - absolute);
}

export function previousCalendarDate(value: string): string | null {
  if (!isBusinessDate(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function durationScore(durationMinutes: number): number {
  if (durationMinutes >= 420 && durationMinutes <= 540) return 100;
  if (durationMinutes < 420) return Math.round(clamp((durationMinutes - 240) / 1.8));
  return Math.round(clamp((720 - durationMinutes) / 1.8));
}

function stageConsistencyScore(current: SleepWellnessRaw): number {
  const stages = [current.deepSleepMinutes, current.lightSleepMinutes, current.remSleepMinutes];
  if (stages.every((stage) => stage === null)) return 50;
  if (stages.some((stage) => stage === null)) return 0;

  const stageTotal = (stages as number[]).reduce((sum, value) => sum + value, 0);
  if (current.durationMinutes === 0) return 0;
  const differenceRatio = Math.abs(stageTotal - current.durationMinutes) / current.durationMinutes;
  return Math.round(clamp(100 - differenceRatio * 100));
}

function feelingScore(feeling: number | null): number {
  return feeling === null ? 50 : clamp((feeling - 1) * 25);
}

/**
 * Produces a deterministic personal-trend score, not a medical sleep assessment.
 * Stage data is judged only by coverage/consistency with the recorded sleep
 * interval; it deliberately does not enforce generic deep/REM target ratios.
 */
export function calculateSleepWellnessScore(
  current: SleepWellnessRaw,
  previous?: SleepWellnessRaw | null,
): DailySleepScore {
  const expectedPreviousDate = previousCalendarDate(current.recordDate);
  const adjacent = previous && expectedPreviousDate === previous.recordDate ? previous : null;
  const bedVariabilityMinutes = adjacent
    ? circularMinuteDistance(current.asleepTime, adjacent.asleepTime)
    : null;
  const wakeVariabilityMinutes = adjacent
    ? circularMinuteDistance(current.wakeTime, adjacent.wakeTime)
    : null;
  const averageVariabilityMinutes = bedVariabilityMinutes === null || wakeVariabilityMinutes === null
    ? null
    : Math.round((bedVariabilityMinutes + wakeVariabilityMinutes) / 2);
  const variabilityScore = averageVariabilityMinutes === null
    ? 50
    : Math.round(clamp(100 - averageVariabilityMinutes / 1.8));
  const duration = durationScore(current.durationMinutes);
  const stageConsistency = stageConsistencyScore(current);
  const morning = feelingScore(current.morningFeeling);
  const weightedParts: Array<{ score: number; weight: number }> = [
    { score: duration, weight: 0.35 },
  ];
  if (averageVariabilityMinutes !== null) {
    weightedParts.push({ score: variabilityScore, weight: 0.3 });
  }
  if (
    current.durationMinutes > 0 &&
    current.deepSleepMinutes !== null &&
    current.lightSleepMinutes !== null &&
    current.remSleepMinutes !== null
  ) {
    weightedParts.push({ score: stageConsistency, weight: 0.25 });
  }
  if (current.morningFeeling !== null) {
    weightedParts.push({ score: morning, weight: 0.1 });
  }
  const totalWeight = weightedParts.reduce((sum, part) => sum + part.weight, 0);
  const availableScore = weightedParts.reduce(
    (sum, part) => sum + part.score * part.weight,
    0,
  ) / totalWeight;
  const durationCeiling = 60 + duration * 0.4;
  const finalScore = Math.min(60 + availableScore * 0.4, durationCeiling);

  return {
    finalScore: Math.round(clamp(finalScore, 60, 100)),
    durationScore: duration,
    variabilityScore,
    stageConsistencyScore: stageConsistency,
    morningFeelingScore: morning,
    bedVariabilityMinutes,
    wakeVariabilityMinutes,
    averageVariabilityMinutes,
    usedPreviousNaturalDay: adjacent !== null,
    disclaimer: SLEEP_SCORE_DISCLAIMER,
  };
}

export function formatSleepScoreSummary(score: DailySleepScore): string {
  const variability = score.averageVariabilityMinutes === null
    ? "无前一自然日，波动按中性值"
    : `平均波动 ${score.averageVariabilityMinutes} 分钟`;
  return `自动质量分 ${score.finalScore}/100 · 时长 ${score.durationScore} · 波动 ${score.variabilityScore} · 阶段一致性 ${score.stageConsistencyScore} · 醒后感受 ${score.morningFeelingScore} · ${variability} · ${score.disclaimer}`;
}
