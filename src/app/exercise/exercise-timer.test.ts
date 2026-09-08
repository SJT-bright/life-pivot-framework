import { describe, expect, it } from "vitest";

import {
  InvalidManualExerciseTimerStateError,
  deriveManualExerciseElapsed,
} from "./exercise-timer";

describe("deriveManualExerciseElapsed", () => {
  it("returns zero for a never-started timer", () => {
    expect(deriveManualExerciseElapsed(new Date("2026-08-13T12:00:00.000Z"), {
      startedAt: null,
      pausedAt: null,
      accumulatedPauseSeconds: 0,
      endedAt: null,
      confirmedDurationMinutes: null,
    })).toEqual({
      elapsedSeconds: 0,
      calculatedDurationMinutes: 0,
      confirmedDurationMinutes: null,
    });
  });

  it("reconstructs active elapsed time after refresh or device sleep", () => {
    expect(deriveManualExerciseElapsed(new Date("2026-08-13T10:31:45.999Z"), {
      startedAt: "2026-08-13T10:00:00.000Z",
      pausedAt: null,
      accumulatedPauseSeconds: 105,
      endedAt: null,
      confirmedDurationMinutes: null,
    })).toEqual({
      elapsedSeconds: 1_800,
      calculatedDurationMinutes: 30,
      confirmedDurationMinutes: null,
    });
  });

  it("freezes at an open pause and includes earlier accumulated pauses", () => {
    expect(deriveManualExerciseElapsed(new Date("2026-08-13T11:00:00.000Z"), {
      startedAt: "2026-08-13T10:00:00.000Z",
      pausedAt: "2026-08-13T10:20:30.000Z",
      accumulatedPauseSeconds: 30,
      endedAt: null,
      confirmedDurationMinutes: null,
    })).toEqual({
      elapsedSeconds: 1_200,
      calculatedDurationMinutes: 20,
      confirmedDurationMinutes: null,
    });
  });

  it("keeps manually entered duration without inventing timer instants", () => {
    expect(deriveManualExerciseElapsed(new Date("2026-08-13T12:00:00.000Z"), {
      startedAt: null, pausedAt: null, endedAt: null,
      accumulatedPauseSeconds: 0, confirmedDurationMinutes: 35,
    })).toEqual({ elapsedSeconds: 0, calculatedDurationMinutes: 0, confirmedDurationMinutes: 35 });
  });

  it("uses endedAt instead of now and preserves a confirmed duration separately", () => {
    expect(deriveManualExerciseElapsed(new Date("2026-08-14T10:00:00.000Z"), {
      startedAt: "2026-08-13T10:00:00.000Z",
      pausedAt: null,
      accumulatedPauseSeconds: 120,
      endedAt: "2026-08-13T10:42:59.999Z",
      confirmedDurationMinutes: 37,
    })).toEqual({
      elapsedSeconds: 2_459,
      calculatedDurationMinutes: 40,
      confirmedDurationMinutes: 37,
    });
  });

  it("floors sub-second and partial-minute elapsed values", () => {
    expect(deriveManualExerciseElapsed(new Date("2026-08-13T10:00:59.999Z"), {
      startedAt: "2026-08-13T10:00:00.000Z",
      pausedAt: null,
      accumulatedPauseSeconds: 0,
      endedAt: null,
      confirmedDurationMinutes: 0,
    })).toEqual({
      elapsedSeconds: 59,
      calculatedDurationMinutes: 0,
      confirmedDurationMinutes: 0,
    });
  });

  it.each([
    {
      startedAt: null,
      pausedAt: "2026-08-13T10:00:00.000Z",
      accumulatedPauseSeconds: 0,
      endedAt: null,
      confirmedDurationMinutes: null,
    },
    {
      startedAt: "2026-08-13T10:00:00.000Z",
      pausedAt: null,
      accumulatedPauseSeconds: 0,
      endedAt: "2026-08-13T09:59:59.000Z",
      confirmedDurationMinutes: null,
    },
    {
      startedAt: "2026-08-13T10:00:00.000Z",
      pausedAt: "2026-08-13T10:05:00.000Z",
      accumulatedPauseSeconds: 0,
      endedAt: "2026-08-13T10:10:00.000Z",
      confirmedDurationMinutes: null,
    },
    {
      startedAt: "2026-08-13T10:00:00.000Z",
      pausedAt: null,
      accumulatedPauseSeconds: 61,
      endedAt: "2026-08-13T10:01:00.000Z",
      confirmedDurationMinutes: null,
    },
    {
      startedAt: "not-an-instant",
      pausedAt: null,
      accumulatedPauseSeconds: 0,
      endedAt: null,
      confirmedDurationMinutes: null,
    },
    {
      startedAt: "2026-08-13T10:00:00.000Z",
      pausedAt: null,
      accumulatedPauseSeconds: -1,
      endedAt: null,
      confirmedDurationMinutes: null,
    },
  ])("rejects impossible or malformed persisted state %#", (state) => {
    expect(() => deriveManualExerciseElapsed(
      new Date("2026-08-13T10:10:00.000Z"),
      state,
    )).toThrow(InvalidManualExerciseTimerStateError);
  });

  it("rejects an invalid now and active timers whose clock precedes start or pause", () => {
    const active = {
      startedAt: "2026-08-13T10:00:00.000Z",
      pausedAt: null,
      accumulatedPauseSeconds: 0,
      endedAt: null,
      confirmedDurationMinutes: null,
    };
    expect(() => deriveManualExerciseElapsed(new Date(Number.NaN), active))
      .toThrow(InvalidManualExerciseTimerStateError);
    expect(() => deriveManualExerciseElapsed(new Date("2026-08-13T09:59:59.000Z"), active))
      .toThrow(InvalidManualExerciseTimerStateError);
    expect(() => deriveManualExerciseElapsed(new Date("2026-08-13T10:05:00.000Z"), {
      ...active,
      pausedAt: "2026-08-13T10:06:00.000Z",
    })).toThrow(InvalidManualExerciseTimerStateError);
  });
});
