import { describe, expect, it } from "vitest";

import {
  buildMuscleProgress,
  estimateE1rmKg,
  inferMuscleWeights,
  summarizeTrainingSet,
} from "./training-metrics";

describe("training metrics", () => {
  it("estimates same-exercise strength only for useful 1-10 rep sets", () => {
    expect(estimateE1rmKg(80, 5)).toBe(90);
    expect(estimateE1rmKg(80, 12)).toBeNull();
  });

  it("computes load volume and converts pounds", () => {
    expect(summarizeTrainingSet(3, "10, 9, 8", "20 kg")).toMatchObject({
      totalReps: 27,
      averageWeightKg: 20,
      loadVolumeKg: 540,
    });
    expect(summarizeTrainingSet(1, "5", "100 lb").averageWeightKg).toBe(45.4);
  });

  it("uses direct and fractional muscle participation", () => {
    expect(inferMuscleWeights("卧推", "胸日")).toEqual({ chest: 1, triceps: 0.5, shoulders: 0.5 });
    expect(inferMuscleWeights("普通动作", "背+二头+小臂")).toEqual({ back: 1, biceps: 0.5, forearms: 0.5 });
  });

  it("gives set growth more hypertrophy weight and same-action e1RM more strength weight", () => {
    const observations = [
      { businessDate: "2026-07-12", dayLabel: "胸", actionName: "卧推", sets: 4, repsText: "5", weightText: "80 kg" },
      { businessDate: "2026-07-19", dayLabel: "胸", actionName: "卧推", sets: 4, repsText: "5", weightText: "80 kg" },
      { businessDate: "2026-08-09", dayLabel: "胸", actionName: "卧推", sets: 6, repsText: "5", weightText: "88 kg" },
      { businessDate: "2026-08-16", dayLabel: "胸", actionName: "卧推", sets: 6, repsText: "5", weightText: "88 kg" },
    ];
    const chest = buildMuscleProgress(observations, "2026-08-20").find((item) => item.key === "chest")!;
    expect(chest.recentSets).toBe(12);
    expect(chest.previousSets).toBe(8);
    expect(chest.strengthChangePercent).toBe(10);
    expect(chest.strengthScore).toBeGreaterThan(50);
    expect(chest.hypertrophyScore).toBeGreaterThan(0);
    expect(chest.bestE1rmAction).toBe("卧推");
  });
});
