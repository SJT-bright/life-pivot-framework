import { describe, expect, it } from "vitest";

import {
  calculateSleepWellnessScore,
  circularMinuteDistance,
} from "./scoring";

const current = {
  recordDate: "2026-08-12",
  asleepTime: "23:30",
  wakeTime: "07:00",
  durationMinutes: 450,
  deepSleepMinutes: 90,
  lightSleepMinutes: 270,
  remSleepMinutes: 90,
  morningFeeling: 4,
} as const;

describe("calculateSleepWellnessScore", () => {
  it("stays in 60–100 and uses only the immediately previous natural day", () => {
    const adjacent = calculateSleepWellnessScore(current, {
      ...current,
      recordDate: "2026-08-11",
      asleepTime: "23:45",
      wakeTime: "07:20",
    });
    expect(adjacent.finalScore).toBeGreaterThanOrEqual(60);
    expect(adjacent.finalScore).toBeLessThanOrEqual(100);
    expect(adjacent).toMatchObject({
      bedVariabilityMinutes: 15,
      wakeVariabilityMinutes: 20,
      averageVariabilityMinutes: 18,
      usedPreviousNaturalDay: true,
    });

    const gapped = calculateSleepWellnessScore(current, {
      ...current,
      recordDate: "2026-08-10",
    });
    expect(gapped).toMatchObject({
      variabilityScore: 50,
      bedVariabilityMinutes: null,
      wakeVariabilityMinutes: null,
      averageVariabilityMinutes: null,
      usedPreviousNaturalDay: false,
    });
  });

  it("uses circular clock distance across midnight", () => {
    expect(circularMinuteDistance("23:55", "00:05")).toBe(10);
    expect(circularMinuteDistance("00:05", "23:55")).toBe(10);
  });

  it("treats missing stages as neutral and filled stages as interval consistency", () => {
    const missing = calculateSleepWellnessScore({
      ...current,
      deepSleepMinutes: null,
      lightSleepMinutes: null,
      remSleepMinutes: null,
      morningFeeling: null,
    });
    expect(missing.stageConsistencyScore).toBe(50);
    expect(missing.morningFeelingScore).toBe(50);

    const inconsistent = calculateSleepWellnessScore({
      ...current,
      deepSleepMinutes: 10,
      lightSleepMinutes: 10,
      remSleepMinutes: 10,
    });
    expect(inconsistent.stageConsistencyScore).toBeLessThan(missing.stageConsistencyScore);
  });

  it("preserves explicit zero-minute inputs without NaN", () => {
    const score = calculateSleepWellnessScore({
      ...current,
      durationMinutes: 0,
      deepSleepMinutes: 0,
      lightSleepMinutes: 0,
      remSleepMinutes: 0,
      morningFeeling: 1,
    });
    expect(score.durationScore).toBe(0);
    expect(score.stageConsistencyScore).toBe(0);
    expect(Number.isFinite(score.finalScore)).toBe(true);
    expect(score.finalScore).toBe(60);
  });
});
