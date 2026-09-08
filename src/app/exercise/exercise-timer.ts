import type {
  ManualExerciseElapsed,
  ManualExerciseTimerState,
} from "../../modules/manual-exercise/contracts";

const MAX_ACCUMULATED_PAUSE_SECONDS = 31_536_000;
const MAX_CONFIRMED_DURATION_MINUTES = 525_600;
const CANONICAL_UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export class InvalidManualExerciseTimerStateError extends Error {
  constructor() {
    super("Invalid manual exercise timer state");
    this.name = "InvalidManualExerciseTimerStateError";
  }
}

function invalidTimerState(): never {
  throw new InvalidManualExerciseTimerStateError();
}

function parseInstant(value: string): number {
  if (!CANONICAL_UTC_INSTANT.test(value)) invalidTimerState();

  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    invalidTimerState();
  }
  return milliseconds;
}

function isBoundedInteger(value: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

export function deriveManualExerciseElapsed(
  now: Date,
  timerState: ManualExerciseTimerState,
): ManualExerciseElapsed {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) invalidTimerState();
  if (!isBoundedInteger(
    timerState.accumulatedPauseSeconds,
    MAX_ACCUMULATED_PAUSE_SECONDS,
  )) {
    invalidTimerState();
  }
  if (
    timerState.confirmedDurationMinutes !== null
    && !isBoundedInteger(
      timerState.confirmedDurationMinutes,
      MAX_CONFIRMED_DURATION_MINUTES,
    )
  ) {
    invalidTimerState();
  }

  if (timerState.startedAt === null) {
    if (
      timerState.pausedAt !== null
      || timerState.endedAt !== null
      || timerState.accumulatedPauseSeconds !== 0
    ) {
      invalidTimerState();
    }
    return {
      elapsedSeconds: 0,
      calculatedDurationMinutes: 0,
      confirmedDurationMinutes: timerState.confirmedDurationMinutes,
    };
  }

  const startedAtMs = parseInstant(timerState.startedAt);
  const pausedAtMs = timerState.pausedAt === null
    ? null
    : parseInstant(timerState.pausedAt);
  const endedAtMs = timerState.endedAt === null
    ? null
    : parseInstant(timerState.endedAt);

  if (pausedAtMs !== null && pausedAtMs < startedAtMs) invalidTimerState();
  if (endedAtMs !== null && endedAtMs < startedAtMs) invalidTimerState();
  if (endedAtMs !== null && pausedAtMs !== null) invalidTimerState();

  const effectiveEndMs = endedAtMs ?? nowMs;
  if (effectiveEndMs < startedAtMs) invalidTimerState();
  if (pausedAtMs !== null && pausedAtMs > effectiveEndMs) invalidTimerState();

  const grossElapsedSeconds = Math.floor((effectiveEndMs - startedAtMs) / 1_000);
  const currentOpenPauseSeconds = pausedAtMs === null
    ? 0
    : Math.floor((effectiveEndMs - pausedAtMs) / 1_000);
  const totalPauseSeconds = timerState.accumulatedPauseSeconds
    + currentOpenPauseSeconds;
  if (totalPauseSeconds > grossElapsedSeconds) invalidTimerState();

  const elapsedSeconds = grossElapsedSeconds - totalPauseSeconds;
  return {
    elapsedSeconds,
    calculatedDurationMinutes: Math.floor(elapsedSeconds / 60),
    confirmedDurationMinutes: timerState.confirmedDurationMinutes,
  };
}
