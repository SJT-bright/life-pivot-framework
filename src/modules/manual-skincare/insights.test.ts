import { describe, expect, it } from "vitest";

import type { ManualSkincareDaySnapshot } from "./contracts";
import { calculateSkincareDayInsight } from "./insights";

const day: ManualSkincareDaySnapshot = {
  dayId: "skincare-day-1",
  businessDate: "2026-08-30",
  materialized: true,
  routineRevision: 1,
  activationSequence: 1,
  recoveryCycle: null,
  morningNote: "",
  eveningNote: "",
  overallNote: "",
  revision: 1,
  morningItems: [{
    itemKey: "skincare-item-1",
    slot: "morning",
    productId: "skincare-product-1",
    ordinal: 0,
    productName: "洁面",
    brand: "品牌",
    currentPurpose: "清洁",
    used: true,
    usedAt: "2026-08-30T00:00:00.000Z",
  }],
  eveningItems: [{
    itemKey: "skincare-item-2",
    slot: "evening",
    productId: "skincare-product-2",
    ordinal: 0,
    productName: "面霜",
    brand: "品牌",
    currentPurpose: "修护",
    used: false,
    usedAt: null,
  }],
};

describe("calculateSkincareDayInsight", () => {
  it("links completion to late and unstable sleep without rewriting either record", () => {
    expect(calculateSkincareDayInsight(day, {
      qualityScore: 72,
      sleepVariabilityMinutes: 125,
      asleepTime: "02:00",
    })).toEqual({
      businessDate: "2026-08-30",
      completedItems: 1,
      totalItems: 2,
      completionPercent: 50,
      sleepQualityScore: 72,
      sleepVariabilityMinutes: 125,
      sleepPenalty: 13,
      stabilityScore: 37,
    });
  });

  it("does not invent a sleep penalty or a score for an empty routine", () => {
    expect(calculateSkincareDayInsight({
      ...day,
      morningItems: [],
      eveningItems: [],
    }, null)).toMatchObject({
      completionPercent: null,
      sleepPenalty: 0,
      stabilityScore: null,
    });
  });
});
