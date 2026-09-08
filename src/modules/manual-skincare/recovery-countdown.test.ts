import { describe, expect, it } from "vitest";

import {
  addRecoveryCalendarDays,
  calculateRecoveryCountdown,
  deriveRecoveryDurationDays,
  millisecondsUntilNextShanghaiDate,
  recoveryCalendarDayDifference,
} from "./recovery-countdown";

describe("manual skincare recovery countdown", () => {
  it("uses inclusive planned dates while decrementing once per natural day", () => {
    const cycle = {
      status: "active" as const,
      durationDays: 14,
      actualStartedOn: "2026-08-13",
      actualCompletedOn: null,
      expectedEndOn: "2026-08-26",
    };

    expect(calculateRecoveryCountdown(cycle, "2026-08-13")).toMatchObject({
      totalDays: 14,
      elapsedDays: 0,
      remainingDays: 14,
      currentDay: 1,
      state: "active",
    });
    expect(calculateRecoveryCountdown(cycle, "2026-08-14")).toMatchObject({
      elapsedDays: 1,
      remainingDays: 13,
      currentDay: 2,
    });
    expect(calculateRecoveryCountdown(cycle, "2026-08-26")).toMatchObject({
      elapsedDays: 13,
      remainingDays: 1,
      currentDay: 14,
    });
    expect(calculateRecoveryCountdown(cycle, "2026-08-27")).toMatchObject({
      elapsedDays: 14,
      remainingDays: 0,
      currentDay: 14,
      state: "due",
    });
  });

  it("handles month, year, and leap-day boundaries without timezone drift", () => {
    expect(addRecoveryCalendarDays("2027-12-30", 3)).toBe("2028-01-02");
    expect(addRecoveryCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(recoveryCalendarDayDifference("2028-02-28", "2028-03-01")).toBe(2);
    expect(deriveRecoveryDurationDays({
      actualStartedOn: "2028-02-28",
      expectedEndOn: "2028-03-01",
      anchorOn: null,
    })).toBe(3);
  });

  it("keeps a completed cycle as history and never auto-completes an overdue cycle", () => {
    const overdue = calculateRecoveryCountdown({
      status: "active",
      durationDays: 2,
      actualStartedOn: "2026-08-01",
      actualCompletedOn: null,
      expectedEndOn: "2026-08-02",
    }, "2026-08-10");
    expect(overdue).toMatchObject({ state: "due", remainingDays: 0 });

    const completed = calculateRecoveryCountdown({
      status: "completed",
      durationDays: 17,
      actualStartedOn: "2026-08-01",
      actualCompletedOn: "2026-08-08",
      expectedEndOn: "2026-08-17",
    }, "2026-08-30");
    expect(completed).toMatchObject({
      state: "completed",
      elapsedDays: 8,
      remainingDays: 0,
      currentDay: 8,
    });
  });

  it("schedules the next refresh at Shanghai midnight", () => {
    expect(millisecondsUntilNextShanghaiDate(new Date("2026-08-13T15:59:59.000Z")))
      .toBe(1_000);
    expect(millisecondsUntilNextShanghaiDate(new Date("2026-08-13T16:00:00.000Z")))
      .toBe(24 * 60 * 60 * 1_000);
  });
});
