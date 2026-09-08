export const DEFAULT_WEEKLY_SET_TARGET = 10;

export const MUSCLE_DEFINITIONS = [
  { key: "shoulders", label: "肩部", view: "both" },
  { key: "chest", label: "胸部", view: "front" },
  { key: "back", label: "背部", view: "back" },
  { key: "biceps", label: "肱二头肌", view: "front" },
  { key: "triceps", label: "肱三头肌", view: "back" },
  { key: "forearms", label: "前臂", view: "both" },
  { key: "core", label: "核心", view: "front" },
  { key: "glutes", label: "臀部", view: "back" },
  { key: "quadriceps", label: "股四头肌", view: "front" },
  { key: "hamstrings", label: "腿后侧", view: "back" },
  { key: "calves", label: "小腿", view: "both" },
] as const;

export type MuscleKey = (typeof MUSCLE_DEFINITIONS)[number]["key"];

export interface TrainingMetricObservation {
  readonly businessDate: string;
  readonly dayLabel: string;
  readonly actionName: string;
  readonly sets: number;
  readonly repsText: string;
  readonly weightText: string;
}

export interface ExerciseMuscleProgress {
  readonly key: MuscleKey;
  readonly label: string;
  readonly view: "front" | "back" | "both";
  readonly recentSets: number;
  readonly previousSets: number;
  readonly recentSessions: number;
  readonly recentLoadVolumeKg: number | null;
  readonly bestE1rmKg: number | null;
  readonly bestE1rmAction: string | null;
  readonly strengthChangePercent: number | null;
  readonly loadChangePercent: number | null;
  readonly strengthScore: number | null;
  readonly hypertrophyScore: number;
  readonly overallScore: number;
  readonly frequencyScore: number;
  readonly confidence: "none" | "limited" | "good";
  readonly lastTrainedAt: string | null;
  readonly actions: readonly string[];
}

interface SetSummary {
  readonly totalReps: number;
  readonly averageWeightKg: number | null;
  readonly maxWeightKg: number | null;
  readonly loadVolumeKg: number | null;
  readonly bestE1rmKg: number | null;
}

type MuscleWeights = Partial<Record<MuscleKey, number>>;

interface WindowStats {
  sets: number;
  loadVolumeKg: number;
  dates: Set<string>;
  actions: Set<string>;
  e1rmByAction: Map<string, { value: number; muscleWeight: number }>;
  loadByAction: Map<string, { value: number; muscleWeight: number }>;
  lastTrainedAt: string | null;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function shiftDate(businessDate: string, days: number): string {
  const [year, month, day] = businessDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function numericValues(text: string, maximum: number): number[] {
  return (text.match(/\d+(?:\.\d+)?/gu) ?? [])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0 && value <= maximum);
}

function repeatOrPad(values: readonly number[], count: number): number[] {
  if (values.length === 0 || count <= 0) return [];
  if (values.length === 1) return Array.from({ length: count }, () => values[0]);
  return Array.from({ length: count }, (_, index) => values[index] ?? values.at(-1)!);
}

export function estimateE1rmKg(weightKg: number, repetitions: number): number | null {
  if (weightKg <= 0 || repetitions < 1 || repetitions > 10) return null;
  // Brzycki estimate. It is a same-exercise trend proxy, not a measured 1RM.
  return round(weightKg * 36 / (37 - repetitions));
}

export function summarizeTrainingSet(
  sets: number,
  repsText: string,
  weightText: string,
): SetSummary {
  const safeSets = Math.max(0, Math.min(sets, 100));
  const rawReps = numericValues(repsText, 100);
  const repsBySet = repeatOrPad(rawReps, safeSets);
  const totalReps = rawReps.length === 1 && safeSets > 1
    ? rawReps[0] * safeSets
    : repsBySet.reduce((total, value) => total + value, 0);
  const pounds = /(?:\blb\b|lbs|磅)/iu.test(weightText);
  const rawWeights = numericValues(weightText, 2_000)
    .map((value) => pounds ? value * 0.45359237 : value);
  const weightsBySet = repeatOrPad(rawWeights, safeSets);
  const averageWeightKg = weightsBySet.length > 0
    ? round(weightsBySet.reduce((total, value) => total + value, 0) / weightsBySet.length)
    : null;
  const maxWeightKg = weightsBySet.length > 0 ? round(Math.max(...weightsBySet)) : null;
  const loadVolumeKg = weightsBySet.length > 0 && repsBySet.length > 0
    ? round(weightsBySet.reduce((total, weight, index) => total + weight * (repsBySet[index] ?? 0), 0))
    : null;
  const estimates = weightsBySet
    .map((weight, index) => estimateE1rmKg(weight, repsBySet[index] ?? 0))
    .filter((value): value is number => value !== null);
  return {
    totalReps,
    averageWeightKg,
    maxWeightKg,
    loadVolumeKg,
    bestE1rmKg: estimates.length > 0 ? round(Math.max(...estimates)) : null,
  };
}

const ACTION_RULES: readonly { pattern: RegExp; weights: MuscleWeights }[] = [
  { pattern: /卧推|推胸|俯卧撑|飞鸟|夹胸|chest\s*press|bench\s*press/iu, weights: { chest: 1, triceps: 0.5, shoulders: 0.5 } },
  { pattern: /推举|肩推|侧平举|前平举|反向飞鸟|face\s*pull|overhead\s*press/iu, weights: { shoulders: 1, triceps: 0.5 } },
  { pattern: /引体|下拉|划船|高位下拉|pull.?up|row/iu, weights: { back: 1, biceps: 0.5, forearms: 0.5 } },
  { pattern: /硬拉|deadlift/iu, weights: { hamstrings: 1, glutes: 1, back: 0.5, forearms: 0.5 } },
  { pattern: /深蹲|腿举|腿屈伸|箭步|弓步|squat|leg\s*press|lunge/iu, weights: { quadriceps: 1, glutes: 0.5, hamstrings: 0.5 } },
  { pattern: /腿弯举|腘绳|腿后|leg\s*curl/iu, weights: { hamstrings: 1 } },
  { pattern: /臀推|臀桥|hip\s*thrust|glute\s*bridge/iu, weights: { glutes: 1, hamstrings: 0.5 } },
  { pattern: /弯举|二头|curl/iu, weights: { biceps: 1, forearms: 0.5 } },
  { pattern: /三头|下压|臂屈伸|skull\s*crusher|pushdown/iu, weights: { triceps: 1 } },
  { pattern: /腕弯举|小臂|前臂|握力|wrist|grip/iu, weights: { forearms: 1 } },
  { pattern: /卷腹|腹轮|平板|核心|侧桥|crunch|plank/iu, weights: { core: 1 } },
  { pattern: /提踵|小腿|calf/iu, weights: { calves: 1 } },
];

export function inferMuscleWeights(actionName: string, dayLabel: string): MuscleWeights {
  const actionRule = ACTION_RULES.find((rule) => rule.pattern.test(actionName));
  if (actionRule) return actionRule.weights;

  const label = `${dayLabel} ${actionName}`;
  const result: MuscleWeights = {};
  if (/肩|三角/u.test(label)) result.shoulders = 1;
  if (/胸/u.test(label)) result.chest = 1;
  if (/背|斜方|背阔/u.test(label)) result.back = 1;
  if (/二头/u.test(label)) result.biceps = result.biceps ?? 0.5;
  if (/三头/u.test(label)) result.triceps = result.triceps ?? 0.5;
  if (/小臂|前臂/u.test(label)) result.forearms = result.forearms ?? 0.5;
  if (/腹|核心/u.test(label)) result.core = 1;
  if (/臀/u.test(label)) result.glutes = 1;
  if (/股四/u.test(label)) result.quadriceps = 1;
  if (/腘绳|腿后/u.test(label)) result.hamstrings = 1;
  if (/小腿/u.test(label)) result.calves = 1;
  if (/腿/u.test(label) && !result.quadriceps && !result.hamstrings && !result.calves) {
    result.quadriceps = 1;
    result.hamstrings = 0.5;
    result.glutes = result.glutes ?? 0.5;
  }
  return result;
}

function createWindowStats(): WindowStats {
  return {
    sets: 0,
    loadVolumeKg: 0,
    dates: new Set(),
    actions: new Set(),
    e1rmByAction: new Map(),
    loadByAction: new Map(),
    lastTrainedAt: null,
  };
}

function recordBest(
  target: Map<string, { value: number; muscleWeight: number }>,
  action: string,
  value: number | null,
  muscleWeight: number,
): void {
  if (value === null) return;
  const existing = target.get(action);
  if (!existing || value > existing.value) target.set(action, { value, muscleWeight });
}

function weightedTrend(
  current: Map<string, { value: number; muscleWeight: number }>,
  previous: Map<string, { value: number; muscleWeight: number }>,
): number | null {
  let total = 0;
  let weights = 0;
  for (const [action, point] of current) {
    const baseline = previous.get(action);
    if (!baseline || baseline.value <= 0) continue;
    const weight = Math.min(point.muscleWeight, baseline.muscleWeight);
    total += clamp(point.value / baseline.value - 1, -0.5, 0.5) * weight;
    weights += weight;
  }
  return weights > 0 ? total / weights : null;
}

function trendScore(change: number | null, hasCurrent: boolean): number {
  if (change === null) return hasCurrent ? 50 : 0;
  return clamp(50 + change * 100);
}

export function buildMuscleProgress(
  observations: readonly TrainingMetricObservation[],
  asOfDate: string,
): ExerciseMuscleProgress[] {
  const recentStart = shiftDate(asOfDate, -27);
  const previousStart = shiftDate(asOfDate, -55);
  const previousEnd = shiftDate(asOfDate, -28);
  const windows = new Map<MuscleKey, { recent: WindowStats; previous: WindowStats }>(
    MUSCLE_DEFINITIONS.map((definition) => [definition.key, {
      recent: createWindowStats(),
      previous: createWindowStats(),
    }]),
  );

  for (const observation of observations) {
    const period = observation.businessDate >= recentStart && observation.businessDate <= asOfDate
      ? "recent"
      : observation.businessDate >= previousStart && observation.businessDate <= previousEnd
        ? "previous"
        : null;
    if (!period || observation.sets <= 0) continue;
    const summary = summarizeTrainingSet(observation.sets, observation.repsText, observation.weightText);
    const muscleWeights = inferMuscleWeights(observation.actionName, observation.dayLabel);
    for (const [key, muscleWeight] of Object.entries(muscleWeights) as [MuscleKey, number][]) {
      const stats = windows.get(key)![period];
      stats.sets += observation.sets * muscleWeight;
      stats.dates.add(observation.businessDate);
      stats.actions.add(observation.actionName);
      stats.loadVolumeKg += (summary.loadVolumeKg ?? 0) * muscleWeight;
      stats.lastTrainedAt = !stats.lastTrainedAt || observation.businessDate > stats.lastTrainedAt
        ? observation.businessDate
        : stats.lastTrainedAt;
      recordBest(stats.e1rmByAction, observation.actionName, summary.bestE1rmKg, muscleWeight);
      recordBest(stats.loadByAction, observation.actionName, summary.maxWeightKg, muscleWeight);
    }
  }

  return MUSCLE_DEFINITIONS.map((definition) => {
    const { recent, previous } = windows.get(definition.key)!;
    const e1rmChange = weightedTrend(recent.e1rmByAction, previous.e1rmByAction);
    const loadChange = weightedTrend(recent.loadByAction, previous.loadByAction);
    const weeklySets = recent.sets / 4;
    const setCompletion = clamp(weeklySets / DEFAULT_WEEKLY_SET_TARGET * 100);
    const frequencyScore = clamp(recent.dates.size / 8 * 100);
    const volumeChange = previous.loadVolumeKg > 0
      ? clamp(recent.loadVolumeKg / previous.loadVolumeKg - 1, -0.5, 0.5)
      : null;
    const volumeScore = trendScore(volumeChange, recent.loadVolumeKg > 0);
    const hypertrophyScore = recent.sets > 0
      ? round(0.6 * setCompletion + 0.25 * volumeScore + 0.15 * frequencyScore, 0)
      : 0;
    const hasStrengthData = recent.e1rmByAction.size > 0;
    const strengthScore = hasStrengthData
      ? round(
        0.7 * trendScore(e1rmChange, true)
          + 0.2 * trendScore(loadChange, recent.loadByAction.size > 0)
          + 0.1 * frequencyScore,
        0,
      )
      : null;
    const overallScore = strengthScore === null
      ? round(0.85 * hypertrophyScore + 0.15 * frequencyScore, 0)
      : round(0.45 * strengthScore + 0.45 * hypertrophyScore + 0.1 * frequencyScore, 0);
    const bestE1rm = [...recent.e1rmByAction.entries()]
      .sort((left, right) => right[1].value - left[1].value)[0] ?? null;
    const actions = [...new Set([...recent.actions, ...previous.actions])].sort((left, right) => left.localeCompare(right, "zh-CN"));
    const lastTrainedAt = [recent.lastTrainedAt, previous.lastTrainedAt]
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1) ?? null;
    const pairedActions = [...recent.e1rmByAction.keys()].filter((action) => previous.e1rmByAction.has(action)).length;
    const confidence = recent.sets <= 0
      ? "none"
      : recent.dates.size >= 4 && previous.dates.size >= 2 && pairedActions > 0
        ? "good"
        : "limited";

    return {
      ...definition,
      recentSets: round(recent.sets),
      previousSets: round(previous.sets),
      recentSessions: recent.dates.size,
      recentLoadVolumeKg: recent.loadVolumeKg > 0 ? round(recent.loadVolumeKg) : null,
      bestE1rmKg: bestE1rm?.[1].value ?? null,
      bestE1rmAction: bestE1rm?.[0] ?? null,
      strengthChangePercent: e1rmChange === null ? null : round(e1rmChange * 100),
      loadChangePercent: loadChange === null ? null : round(loadChange * 100),
      strengthScore,
      hypertrophyScore,
      overallScore,
      frequencyScore: round(frequencyScore, 0),
      confidence,
      lastTrainedAt,
      actions,
    };
  });
}
