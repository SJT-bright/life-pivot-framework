import { describe, expect, it } from "vitest";

import { parseMovePersonalDailyNoteCommand, parsePersonalDailyNoteCommand } from "./contracts";

const validCommand = {
  type: "save-personal-daily-note",
  noteId: "note-20260812",
  businessDate: "2026-08-12",
  content: "今天的整体备注",
  expectedRevision: 0,
};
const validMoveCommand = {
  type: "move-personal-daily-note",
  noteId: "note-20260812",
  fromBusinessDate: "2026-08-12",
  toBusinessDate: "2026-08-11",
  expectedRevision: 1,
};

describe("parsePersonalDailyNoteCommand", () => {
  it("accepts a strict command and allows empty content to clear a note", () => {
    expect(parsePersonalDailyNoteCommand(validCommand)).toEqual(validCommand);
    expect(parsePersonalDailyNoteCommand({ ...validCommand, content: "" }).content).toBe("");
  });

  it("rejects nonexistent dates, unknown keys, invalid revisions, and oversized content", () => {
    for (const command of [
      { ...validCommand, businessDate: "2026-02-30" },
      { ...validCommand, legacy: true },
      { ...validCommand, expectedRevision: -1 },
      { ...validCommand, content: "字".repeat(20_001) },
    ]) {
      expect(() => parsePersonalDailyNoteCommand(command)).toThrow();
    }
  });
});

describe("parseMovePersonalDailyNoteCommand", () => {
  it("accepts a strict move command", () => {
    expect(parseMovePersonalDailyNoteCommand(validMoveCommand)).toEqual(validMoveCommand);
  });

  it("rejects nonexistent dates, zero revisions, unknown keys, and short identifiers", () => {
    for (const command of [
      { ...validMoveCommand, fromBusinessDate: "2026-02-30" },
      { ...validMoveCommand, toBusinessDate: "not-a-date" },
      { ...validMoveCommand, expectedRevision: 0 },
      { ...validMoveCommand, legacy: true },
      { ...validMoveCommand, noteId: "short" },
    ]) {
      expect(() => parseMovePersonalDailyNoteCommand(command)).toThrow();
    }
  });
});
