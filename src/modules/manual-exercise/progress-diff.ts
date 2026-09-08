import type {
  ManualExerciseProgressChange,
  ManualExerciseProgressMetric,
} from "./progress-contracts";

export interface ManualExerciseProgressActionInput {
  dayKey: string;
  dayName: string;
  actionKey: string;
  actionName: string;
  plannedSets: number;
  plannedRepsText: string | null;
  plannedWeightText: string | null;
}

export interface ManualExerciseProgressDiff {
  changes: ManualExerciseProgressChange[];
  hasComparableDelta: boolean;
}

interface ParsedNumericText {
  value: number;
  unit: string;
}

const REPS_PATTERN = /^([0-9]+(?:\.[0-9]+)?)\s*(次|rep|reps)?$/iu;
const WEIGHT_PATTERN = /^([0-9]+(?:\.[0-9]+)?)\s*(kg|公斤|千克|lb|lbs|磅)?$/iu;

function normalizeUnit(value: string | undefined): string {
  const unit = value?.toLocaleLowerCase() ?? "";
  if (unit === "公斤" || unit === "千克") return "kg";
  if (unit === "磅" || unit === "lbs") return "lb";
  if (unit === "次" || unit === "rep" || unit === "reps") return "rep";
  return unit;
}

export function parseManualExerciseNumericText(
  value: string | null,
  metric: "reps" | "weight",
): ParsedNumericText | null {
  const text = value?.trim() ?? "";
  if (text === "") return null;
  const match = (metric === "reps" ? REPS_PATTERN : WEIGHT_PATTERN).exec(text);
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000) return null;
  return { value: number, unit: normalizeUnit(match[2]) };
}

function numericChange(
  day: ManualExerciseProgressActionInput,
  metric: "reps" | "weight",
  before: string | null,
  after: string | null,
): { change: ManualExerciseProgressChange; comparable: boolean } | null {
  if (before === after) return null;
  const beforeParsed = parseManualExerciseNumericText(before, metric);
  const afterParsed = parseManualExerciseNumericText(after, metric);
  const comparable = beforeParsed !== null
    && afterParsed !== null
    && beforeParsed.unit === afterParsed.unit;
  const delta = comparable ? afterParsed.value - beforeParsed.value : null;
  const comparableDelta = delta ?? 0;
  const changeKind = !comparable
    ? "incomparable"
    : comparableDelta === 0
      ? "changed"
      : comparableDelta > 0
        ? "increase"
        : "decrease";
  return {
    comparable: comparable && delta !== 0,
    change: {
      dayKey: day.dayKey,
      dayName: day.dayName,
      actionKey: day.actionKey,
      actionName: day.actionName,
      metric,
      before,
      after,
      changeKind,
      delta,
      unit: comparable ? beforeParsed.unit || null : null,
    },
  };
}

function setsChange(
  day: ManualExerciseProgressActionInput,
  before: number,
  after: number,
): { change: ManualExerciseProgressChange; comparable: boolean } | null {
  if (before === after) return null;
  const delta = after - before;
  return {
    comparable: delta !== 0,
    change: {
      dayKey: day.dayKey,
      dayName: day.dayName,
      actionKey: day.actionKey,
      actionName: day.actionName,
      metric: "sets",
      before,
      after,
      changeKind: delta > 0 ? "increase" : "decrease",
      delta,
      unit: "组",
    },
  };
}

function actionKey(dayKey: string, actionKeyValue: string): string {
  return dayKey + "\u0000" + actionKeyValue;
}

export function deriveManualExerciseProgressDiff(
  fromActions: readonly ManualExerciseProgressActionInput[],
  toActions: readonly ManualExerciseProgressActionInput[],
): ManualExerciseProgressDiff {
  const fromByKey = new Map(fromActions.map((action) => [actionKey(action.dayKey, action.actionKey), action]));
  const changes: ManualExerciseProgressChange[] = [];
  let hasComparableDelta = false;

  for (const after of toActions) {
    const before = fromByKey.get(actionKey(after.dayKey, after.actionKey));
    if (!before) continue;
    const sets = setsChange(after, before.plannedSets, after.plannedSets);
    if (sets) {
      changes.push(sets.change);
      hasComparableDelta ||= sets.comparable;
    }
    for (const metric of ["reps", "weight"] as const) {
      const result = numericChange(
        after,
        metric,
        metric === "reps" ? before.plannedRepsText : before.plannedWeightText,
        metric === "reps" ? after.plannedRepsText : after.plannedWeightText,
      );
      if (result) {
        changes.push(result.change);
        hasComparableDelta ||= result.comparable;
      }
    }
  }

  return { changes, hasComparableDelta };
}

export function progressMetricLabel(metric: ManualExerciseProgressMetric): string {
  return metric === "sets" ? "组数" : metric === "reps" ? "次数" : "重量";
}
