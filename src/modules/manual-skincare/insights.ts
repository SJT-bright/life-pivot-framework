import type {
  ManualSkincareDayInsight,
  ManualSkincareDaySnapshot,
} from "./contracts";

export interface SkincareLinkedSleep {
  qualityScore: number | null;
  sleepVariabilityMinutes: number | null;
  asleepTime: string;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function lateSleepMinutes(asleepTime: string): number {
  const [hours, minutes] = asleepTime.split(":").map(Number);
  const minuteOfDay = hours! * 60 + minutes!;
  const comparable = minuteOfDay < 12 * 60 ? minuteOfDay + 1440 : minuteOfDay;
  return Math.max(0, comparable - (24 * 60 + 30));
}

export function calculateSkincareDayInsight(
  day: ManualSkincareDaySnapshot,
  sleep: SkincareLinkedSleep | null,
): ManualSkincareDayInsight {
  const items = [...day.morningItems, ...day.eveningItems];
  const completedItems = items.filter((item) => item.used).length;
  const completionPercent = items.length === 0
    ? null
    : Math.round((completedItems / items.length) * 100);

  const latenessPenalty = sleep
    ? Math.min(8, Math.round(lateSleepMinutes(sleep.asleepTime) / 30) * 2)
    : 0;
  const variabilityPenalty = sleep?.sleepVariabilityMinutes !== null &&
      sleep?.sleepVariabilityMinutes !== undefined &&
      sleep.sleepVariabilityMinutes > 60
    ? Math.min(7, Math.ceil((sleep.sleepVariabilityMinutes - 60) / 30) * 2)
    : 0;
  const qualityPenalty = sleep && sleep.qualityScore !== null && sleep.qualityScore < 75
    ? Math.min(5, Math.ceil((75 - sleep.qualityScore) / 3))
    : 0;
  const sleepPenalty = clamp(latenessPenalty + variabilityPenalty + qualityPenalty, 0, 15);

  return {
    businessDate: day.businessDate,
    completedItems,
    totalItems: items.length,
    completionPercent,
    sleepQualityScore: sleep?.qualityScore ?? null,
    sleepVariabilityMinutes: sleep?.sleepVariabilityMinutes ?? null,
    sleepPenalty,
    stabilityScore: completionPercent === null
      ? null
      : clamp(completionPercent - sleepPenalty, 0, 100),
  };
}
