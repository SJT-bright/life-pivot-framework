import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { migrateDatabase } from "@/core/db/migrate";

import {
  computeVolume,
  getExerciseTrendsSnapshot,
  normalizeBodyPart,
  parseRepsText,
} from "./trends-query";

const databases: Database.Database[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

function createDatabase(): Database.Database {
  const sqlite = new Database(":memory:");
  databases.push(sqlite);
  migrateDatabase(sqlite);
  sqlite.prepare(`insert into manual_exercise_templates
    (id, name, current_revision, created_at, updated_at)
    values ('ex-template-demo', '演示计划', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`).run();
  sqlite.prepare(`insert into manual_exercise_template_versions
    (id, template_id, revision, effective_from, change_note, created_at)
    values ('ex-version-demo', 'ex-template-demo', 1, '2026-01-01', '', '2026-01-01T00:00:00.000Z')`).run();
  return sqlite;
}

function seedSession(sqlite: Database.Database, options: {
  date: string;
  bodyPart: string;
  dayName: string;
  actions: Array<{ name: string; sets: number; repsText: string; weightText?: string }>;
}): void {
  const dayId = `ex-day-${options.date}`;
  sqlite.prepare(`insert into manual_exercise_days
    (id, business_date, template_version_id, day_key, day_name, body_part, is_rest,
     status, revision, created_at, updated_at)
    values (?, ?, 'ex-version-demo', ?, ?, ?, 0, 'completed', 1, ?, ?)`)
    .run(dayId, options.date, `day-${options.date}`, options.dayName, options.bodyPart,
      `${options.date}T01:00:00.000Z`, `${options.date}T02:00:00.000Z`);
  const insert = sqlite.prepare(`insert into manual_exercise_day_actions
    (id, day_id, action_key, name, planned_sets, actual_sets, actual_reps_text,
     actual_weight_text, ordinal)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const [index, action] of options.actions.entries()) {
    insert.run(`${dayId}-action-${index}`, dayId, `action-${index}`, action.name,
      action.sets, action.sets, action.repsText, action.weightText ?? "", index);
  }
}

describe("parseRepsText", () => {
  it("sums per-set numbers listed in order", () => {
    expect(parseRepsText("12, 10, 8", 3)).toBe(30);
  });

  it("expands a single per-set number across the recorded sets", () => {
    expect(parseRepsText("10", 3)).toBe(30);
  });

  it("returns zero for free prose without usable numbers", () => {
    expect(parseRepsText("没数", 2)).toBe(0);
  });

  it("ignores absurd values and keeps the rest", () => {
    expect(parseRepsText("热身 8, 正式 8, 8, 收尾 6", 4)).toBe(30);
    expect(parseRepsText("负重 60", 1)).toBe(60);
  });
});

describe("computeVolume", () => {
  it("weights sets higher than reps", () => {
    expect(computeVolume(4, 40)).toBe(40);
    expect(computeVolume(0, 0)).toBe(0);
  });
});

describe("normalizeBodyPart", () => {
  it("maps labels onto stable buckets and keeps unknown labels", () => {
    expect(normalizeBodyPart("推胸日", "练胸")).toBe("胸");
    expect(normalizeBodyPart("肩+三头", "肩")).toBe("肩");
    expect(normalizeBodyPart("", "跑步机有氧")).toBe("有氧");
    expect(normalizeBodyPart("游泳", "游泳")).toBe("游泳");
    expect(normalizeBodyPart("", "")).toBe("未分类");
  });
});

describe("getExerciseTrendsSnapshot", () => {
  it("aggregates weekly volume per body part and recent sessions", () => {
    const sqlite = createDatabase();
    seedSession(sqlite, {
      date: "2026-08-03",
      bodyPart: "胸",
      dayName: "练胸",
      actions: [
        { name: "卧推", sets: 4, repsText: "10" },
        { name: "飞鸟", sets: 3, repsText: "12" },
      ],
    });
    seedSession(sqlite, {
      date: "2026-08-05",
      bodyPart: "腿",
      dayName: "练腿",
      actions: [{ name: "深蹲", sets: 5, repsText: "8, 8, 8, 6, 6" }],
    });
    seedSession(sqlite, {
      date: "2026-08-10",
      bodyPart: "胸",
      dayName: "练胸",
      actions: [{ name: "卧推", sets: 4, repsText: "10", weightText: "60 kg" }],
    });

    // 2026-08-12 是周一：最少 4 周窗口覆盖 8/3 与 8/10 两周
    const snapshot = getExerciseTrendsSnapshot(sqlite, { asOfDate: "2026-08-12", weeks: 4 });

    expect(snapshot.weeks).toEqual(["2026-07-20", "2026-07-27", "2026-08-03", "2026-08-10"]);
    const chest = snapshot.series.find((series) => series.bodyPart === "胸");
    const legs = snapshot.series.find((series) => series.bodyPart === "腿");
    expect(chest?.points.map((point) => point.sets)).toEqual([0, 0, 7, 4]);
    expect(chest?.points.map((point) => point.sessions)).toEqual([0, 0, 1, 1]);
    expect(legs?.points[2]?.reps).toBe(36);
    // 容量分 = 组数×5 + 次数×0.5
    expect(chest?.points.at(-1)?.volume).toBe(computeVolume(4, 40));
    expect(snapshot.currentStreakWeeks).toBe(2);
    expect(snapshot.recentSessions.at(0)?.businessDate).toBe("2026-08-10");
    expect(snapshot.recentSessions.at(0)?.actions).toEqual([
      {
        name: "卧推",
        sets: 4,
        reps: 40,
        weightKg: 60,
        loadVolumeKg: 2400,
        e1rmKg: 80,
      },
    ]);
    expect(snapshot.muscleProgress.find((item) => item.key === "chest")).toMatchObject({
      recentSets: 11,
      bestE1rmKg: 80,
    });
  });

  it("ignores rest days and sessions without actual records", () => {
    const sqlite = createDatabase();
    sqlite.prepare(`insert into manual_exercise_days
      (id, business_date, template_version_id, day_key, day_name, body_part, is_rest,
       status, revision, created_at, updated_at)
      values ('ex-rest-day', '2026-08-04', 'ex-version-demo', 'rest', '休息', '休息日', 1,
              'skipped', 1, '2026-08-04T01:00:00.000Z', '2026-08-04T01:00:00.000Z')`).run();
    seedSession(sqlite, {
      date: "2026-08-05",
      bodyPart: "肩",
      dayName: "练肩",
      actions: [],
    });

    const snapshot = getExerciseTrendsSnapshot(sqlite, { asOfDate: "2026-08-10", weeks: 2 });
    expect(snapshot.series).toEqual([]);
    expect(snapshot.recentSessions).toEqual([]);
    expect(snapshot.muscleProgress).toHaveLength(11);
    expect(snapshot.currentStreakWeeks).toBe(0);
  });
});
