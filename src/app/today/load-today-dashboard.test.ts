import type Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const manualExercise = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
}));

vi.mock("@/modules/manual-exercise/queries", () => ({
  getManualExerciseSnapshot: manualExercise.getSnapshot,
}));

import { loadTodayDashboard } from "./load-today-dashboard";

function exerciseDay(overrides: Record<string, unknown> = {}) {
  return {
    id: "manual-day-1",
    businessDate: "2026-08-12",
    materialized: true,
    templateVersionId: "manual-version-1",
    dayKey: "shoulder",
    name: "肩部训练",
    bodyPart: "肩",
    isRest: false,
    status: "in-progress",
    revision: 2,
    actions: [
      { actual: { completion: true } },
      { actual: { completion: false } },
      { actual: { completion: true } },
    ],
    timer: {
      startedAt: "2026-08-12T10:00:00.000Z",
      pausedAt: "2026-08-12T10:18:00.000Z",
      endedAt: null,
      calculatedDurationMinutes: 18,
      confirmedDurationMinutes: 20,
    },
    supplements: {
      creatineTaken: true,
      proteinPowderTaken: false,
    },
    ...overrides,
  };
}

function testDatabase(sqlite: object = {}) {
  return { sqlite: sqlite as Database.Database };
}

describe("loadTodayDashboard", () => {
  beforeEach(() => {
    manualExercise.getSnapshot.mockReset().mockReturnValue({ selectedDay: null });
  });

  it("maps the manual exercise snapshot into the Today card state", async () => {
    manualExercise.getSnapshot.mockReturnValue({ selectedDay: exerciseDay() });
    const database = testDatabase({ id: "sqlite" });

    const result = await loadTodayDashboard({
      openDatabase: () => database,
      readers: { sleep: () => null },
    }, "2026-08-12");

    expect(manualExercise.getSnapshot).toHaveBeenCalledWith(database.sqlite, {
      businessDate: "2026-08-12",
      historyLimit: 1,
    });
    expect(result.exercise).toEqual({
      status: "ready",
      data: {
        businessDate: "2026-08-12",
        currentDayName: "肩部训练",
        bodyPart: "肩",
        isRest: false,
        trainingStatus: "in-progress",
        completedActions: 2,
        totalActions: 3,
        timerStatus: "paused",
        calculatedMinutes: 18,
        confirmedMinutes: 20,
        creatineTaken: true,
        proteinPowderTaken: false,
      },
    });
  });

  it("shows an unmaterialized plan as ready and an empty plan as unavailable", async () => {
    manualExercise.getSnapshot.mockReturnValueOnce({
      selectedDay: exerciseDay({
        id: null,
        materialized: false,
        status: "not-started",
        actions: [],
        timer: {
          startedAt: null,
          pausedAt: null,
          endedAt: null,
          calculatedDurationMinutes: 0,
          confirmedDurationMinutes: null,
        },
        supplements: { creatineTaken: null, proteinPowderTaken: null },
      }),
    }).mockReturnValueOnce({ selectedDay: null });

    const planned = await loadTodayDashboard({
      openDatabase: () => testDatabase(),
      readers: { health: () => ({ completed: 2 }) },
    }, "2026-08-12");
    const empty = await loadTodayDashboard({
      openDatabase: () => testDatabase(),
      readers: { health: () => ({ completed: 2 }) },
    }, "2026-08-12");

    expect(planned.exercise).toMatchObject({
      status: "ready",
      data: {
        trainingStatus: "not-started",
        completedActions: 0,
        totalActions: 0,
        timerStatus: "idle",
      },
    });
    expect(empty.exercise).toEqual({ status: "unavailable" });
    expect(empty.health.status).toBe("ready");
  });

  it("contains a manual exercise reader failure without erasing ready siblings", async () => {
    manualExercise.getSnapshot.mockImplementation(() => {
      throw new Error("manual exercise private failure");
    });

    const result = await loadTodayDashboard({
      openDatabase: () => testDatabase(),
      readers: {
        sleep: () => null,
        health: () => ({ completed: 2 }),
      },
    }, "2026-08-12");

    expect(result.exercise).toEqual({ status: "unavailable" });
    expect(result.sleep.status).toBe("ready");
    expect(result.health.status).toBe("ready");
  });

  it.each(["captures", "unorganizedCount", "sleep", "health", "dailyNote", "personalKnowledge", "reading", "skincare"] as const)(
    "contains a %s reader failure without erasing ready siblings",
    async (failedKey) => {
      const readers = {
        captures: vi.fn(() => {
          if (failedKey === "captures") throw new Error("captures private failure");
          return ["capture"];
        }),
        unorganizedCount: vi.fn(() => {
          if (failedKey === "unorganizedCount") throw new Error("count private failure");
          return 3;
        }),
        sleep: vi.fn(() => {
          if (failedKey === "sleep") throw new Error("sleep private failure");
          return null as null | { hours: number };
        }),
        health: vi.fn(async () => {
          if (failedKey === "health") throw new Error("health private failure");
          return { completed: 2 };
        }),
        dailyNote: vi.fn(() => {
          if (failedKey === "dailyNote") throw new Error("note private failure");
          return null as null | { content: string };
        }),
        personalKnowledge: vi.fn(() => {
          if (failedKey === "personalKnowledge") throw new Error("knowledge private failure");
          return { businessDate: "2026-08-12", modules: [], dailyNotes: [], items: [] };
        }),
        reading: vi.fn(() => {
          if (failedKey === "reading") throw new Error("reading private failure");
          return { businessDate: "2026-08-12", books: [], sessions: [], totalPagesRead: 0, totalMinutes: 0 };
        }),
        skincare: vi.fn(async () => {
          if (failedKey === "skincare") throw new Error("skincare private failure");
          return { businessDate: "2026-08-12" };
        }),
      };

      const result = await loadTodayDashboard({
        openDatabase: () => testDatabase({ id: "database" }),
        readers,
      }, "2026-08-12");

      expect(result[failedKey]).toEqual({ status: "unavailable" });
      for (const key of ["captures", "unorganizedCount", "sleep", "health", "dailyNote", "personalKnowledge", "reading", "skincare"] as const) {
        if (key !== failedKey) expect(result[key].status).toBe("ready");
      }
    },
  );

  it("returns all registered cards unavailable when database opening fails", async () => {
    const readers = {
      captures: vi.fn(() => ["capture"]),
      note: vi.fn(() => null),
    };

    const result = await loadTodayDashboard({
      openDatabase: () => { throw new Error("database path is private"); },
      readers,
    }, "2026-08-12");

    expect(result).toEqual({
      captures: { status: "unavailable" },
      note: { status: "unavailable" },
      exercise: { status: "unavailable" },
    });
    expect(readers.captures).not.toHaveBeenCalled();
    expect(readers.note).not.toHaveBeenCalled();
  });

  it("keeps an intentional null as ready data instead of an unavailable state", async () => {
    const result = await loadTodayDashboard({
      openDatabase: () => testDatabase({ id: "database" }),
      readers: { sleep: () => null },
    }, "2026-08-12");

    expect(result.sleep).toEqual({ status: "ready", data: null });
  });
});
