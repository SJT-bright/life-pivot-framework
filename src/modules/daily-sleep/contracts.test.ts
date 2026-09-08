import { describe, expect, it } from "vitest";

import { DailySleepValidationError, parseDailySleepCommand } from "./contracts";

const validCommand = {
  type: "save-daily-sleep",
  recordId: "sleep-record-0001",
  recordDate: "2026-08-12",
  asleepTime: "23:30",
  wakeTime: "07:00",
  confirmedDurationMinutes: null,
  deepSleepMinutes: 90,
  lightSleepMinutes: 270,
  remSleepMinutes: 90,
  morningFeeling: 4,
  qualityScore: 91,
  qualityText: "手表显示正常，主观精神尚可",
  note: "",
  expectedRevision: 0,
} as const;

describe("daily sleep contracts", () => {
  it("parses the exact lightweight sleep command and preserves an explicit zero duration", () => {
    expect(parseDailySleepCommand({
      ...validCommand,
      confirmedDurationMinutes: 0,
    })).toEqual({
      ...validCommand,
      confirmedDurationMinutes: 0,
      awakeEpisodes: null,
      awakeMinutes: null,
    });
  });

  it("defaults newly optional fields for an older frozen submission", () => {
    const { deepSleepMinutes: _deep, lightSleepMinutes: _light, remSleepMinutes: _rem,
      morningFeeling: _feeling, qualityScore: _score, qualityText: _quality, ...legacy } = validCommand;
    expect(parseDailySleepCommand(legacy)).toMatchObject({
      ...legacy,
      deepSleepMinutes: null,
      lightSleepMinutes: null,
      remSleepMinutes: null,
      morningFeeling: null,
      qualityScore: null,
    });
    expect(parseDailySleepCommand(legacy)).not.toHaveProperty("qualityText");
  });

  it.each([
    { ...validCommand, recordDate: "2026-02-30" },
    { ...validCommand, asleepTime: "24:00" },
    { ...validCommand, wakeTime: "7:00" },
    { ...validCommand, lightSleepMinutes: null },
    { ...validCommand, morningFeeling: 6 },
    { ...validCommand, qualityScore: 59 },
    { ...validCommand, qualityScore: 101 },
    { ...validCommand, unexpected: true },
  ])("rejects invalid or non-exact input", (command) => {
    expect(() => parseDailySleepCommand(command)).toThrow(DailySleepValidationError);
  });

  it("rejects text over the approved limits", () => {
    expect(() => parseDailySleepCommand({
      ...validCommand,
      qualityText: "好".repeat(501),
    })).toThrow(DailySleepValidationError);
    expect(() => parseDailySleepCommand({
      ...validCommand,
      note: "记".repeat(4001),
    })).toThrow(DailySleepValidationError);
  });
});
