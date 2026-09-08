import { describe, expect, it } from "vitest";

import {
  deriveManualExerciseProgressDiff,
  parseManualExerciseNumericText,
} from "./progress-diff";

const action = (overrides: Partial<{
  plannedSets: number;
  plannedRepsText: string | null;
  plannedWeightText: string | null;
}>) => ({
  dayKey: "shoulder",
  dayName: "肩",
  actionKey: "press",
  actionName: "推举",
  plannedSets: 3,
  plannedRepsText: "8",
  plannedWeightText: "20kg",
  ...overrides,
});

describe("manual exercise progress diff", () => {
  it("derives only numeric sets/reps/weight changes from matching keys", () => {
    const result = deriveManualExerciseProgressDiff(
      [action({})],
      [action({ plannedSets: 4, plannedRepsText: "10", plannedWeightText: "22.5kg" })],
    );
    expect(result.hasComparableDelta).toBe(true);
    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: "sets", before: 3, after: 4, delta: 1, changeKind: "increase" }),
      expect.objectContaining({ metric: "reps", before: "8", after: "10", delta: 2, unit: null }),
      expect.objectContaining({ metric: "weight", before: "20kg", after: "22.5kg", delta: 2.5, unit: "kg" }),
    ]));
  });

  it("does not produce a pending-worthy diff for notes or incompatible units", () => {
    const noteOnly = deriveManualExerciseProgressDiff(
      [action({})],
      [{ ...action({}), actionName: "推举（备注调整）" }],
    );
    expect(noteOnly.changes).toEqual([]);
    const incompatible = deriveManualExerciseProgressDiff(
      [action({ plannedWeightText: "20kg" })],
      [action({ plannedWeightText: "44lb" })],
    );
    expect(incompatible.hasComparableDelta).toBe(false);
    expect(incompatible.changes[0]).toMatchObject({
      metric: "weight",
      changeKind: "incomparable",
      delta: null,
    });
  });

  it("parses only bounded single-value numeric text", () => {
    expect(parseManualExerciseNumericText("20 kg", "weight")).toEqual({ value: 20, unit: "kg" });
    expect(parseManualExerciseNumericText("8 次", "reps")).toEqual({ value: 8, unit: "rep" });
    expect(parseManualExerciseNumericText("8-10", "reps")).toBeNull();
    expect(parseManualExerciseNumericText("heavy", "weight")).toBeNull();
  });
});
