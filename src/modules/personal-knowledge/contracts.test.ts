import { describe, expect, it } from "vitest";

import {
  parsePersonalKnowledgeCommand,
  personalKnowledgeResultSchema,
  PersonalKnowledgeValidationError,
  type PersonalKnowledgeAppliedMutation,
  type PersonalKnowledgeCommand,
  type PersonalKnowledgeResult,
  type PersonalKnowledgeSnapshot,
} from "./contracts";

const saveModule = {
  type: "save-module",
  moduleId: "module-0001",
  parentModuleId: null,
  name: " TypeScript ",
  goal: " Build reliable systems ",
  currentFocus: " Strict contracts ",
  description: " Notes for the module ",
  status: "learning",
  ordinal: 0,
  expectedModuleRevision: 0,
  expectedParentRevision: 0,
} as const;

const moveModule = {
  type: "move-module",
  moduleId: "module-0001",
  parentModuleId: "module-0002",
  ordinal: 1,
  expectedModuleRevision: 2,
  expectedOldParentRevision: 3,
  expectedNewParentRevision: 4,
} as const;

const archiveModule = {
  type: "archive-module",
  moduleId: "module-0001",
  expectedModuleRevision: 2,
  expectedParentRevision: 3,
} as const;

const saveNote = {
  type: "save-daily-learning-note",
  noteId: "daily-note-0001",
  businessDate: "2026-08-13",
  title: " Zod contracts ",
  moduleId: "module-0001",
  content: " Validate every command boundary. ",
  source: " Documentation ",
  personalUnderstanding: " Parse once at the edge. ",
  openQuestions: " How should conflicts surface? ",
  application: " Use the contract in the API. ",
  expectedNoteRevision: 0,
} as const;

const archiveNote = {
  type: "archive-daily-learning-note",
  noteId: "daily-note-0001",
  expectedNoteRevision: 1,
} as const;

const commands = [
  saveModule,
  moveModule,
  archiveModule,
  saveNote,
  archiveNote,
] as const;

function expectInvalid(value: unknown): void {
  expect(() => parsePersonalKnowledgeCommand(value)).toThrow(PersonalKnowledgeValidationError);
}

describe("personal knowledge contracts", () => {
  it("parses all six commands deterministically without conflating their semantics", () => {
    const first = commands.map((command) => parsePersonalKnowledgeCommand(command));
    const second = commands.map((command) => parsePersonalKnowledgeCommand(command));

    expect(first).toEqual(second);
    expect(first.map((command) => command.type)).toEqual(commands.map((command) => command.type));
    expect(first[0]).toMatchObject({
      name: "TypeScript",
      goal: "Build reliable systems",
      currentFocus: "Strict contracts",
      description: "Notes for the module",
    });
    expect(first[3]).toMatchObject({
      title: "Zod contracts",
      content: "Validate every command boundary.",
      source: "Documentation",
      personalUnderstanding: "Parse once at the edge.",
      openQuestions: "How should conflicts surface?",
      application: "Use the contract in the API.",
    });

    expectInvalid({ ...moveModule, type: "save-module" });
    expectInvalid({ ...archiveNote, type: "save-daily-learning-note" });
  });

  it("rejects unknown keys on every command branch", () => {
    for (const command of commands) {
      expectInvalid({ ...command, unexpected: true });
    }
  });

  it("requires real business dates and bounded trimmed identifiers and text", () => {
    expectInvalid({ ...saveNote, businessDate: "2026-02-30" });
    expectInvalid({ ...saveNote, businessDate: "2026-8-13" });
    expectInvalid({ ...saveNote, title: "   " });
    expectInvalid({ ...saveNote, content: "   " });
    expectInvalid({ ...saveModule, moduleId: "short" });
    expectInvalid({ ...saveModule, moduleId: `id-${"x".repeat(126)}` });
    expect(parsePersonalKnowledgeCommand({
      ...saveModule,
      name: "x".repeat(160),
      goal: "x".repeat(1_000),
      currentFocus: "x".repeat(1_000),
      description: "x".repeat(4_000),
    })).toMatchObject({ name: "x".repeat(160) });
    expect(parsePersonalKnowledgeCommand({
      ...saveNote,
      title: "x".repeat(160),
      content: "x".repeat(20_000),
      source: "x".repeat(4_000),
      personalUnderstanding: "x".repeat(4_000),
      openQuestions: "x".repeat(4_000),
      application: "x".repeat(4_000),
    })).toMatchObject({ title: "x".repeat(160) });
    expectInvalid({ ...saveModule, name: "x".repeat(161) });
    expectInvalid({ ...saveModule, goal: "x".repeat(1_001) });
    expectInvalid({ ...saveModule, currentFocus: "x".repeat(1_001) });
    expectInvalid({ ...saveModule, description: "x".repeat(4_001) });
    expectInvalid({ ...saveNote, title: "x".repeat(161) });
    expectInvalid({ ...saveNote, content: "x".repeat(20_001) });
    expectInvalid({ ...saveNote, source: "x".repeat(4_001) });
    expectInvalid({ ...saveNote, personalUnderstanding: "x".repeat(4_001) });
    expectInvalid({ ...saveNote, openQuestions: "x".repeat(4_001) });
    expectInvalid({ ...saveNote, application: "x".repeat(4_001) });
  });

  it("accepts only nonnegative safe integer ordinals and expected revisions", () => {
    const unsafeValues = [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.POSITIVE_INFINITY];
    const numericCases: ReadonlyArray<[Record<string, unknown>, string]> = [
      [saveModule, "ordinal"],
      [saveModule, "expectedModuleRevision"],
      [saveModule, "expectedParentRevision"],
      [moveModule, "ordinal"],
      [moveModule, "expectedModuleRevision"],
      [moveModule, "expectedOldParentRevision"],
      [moveModule, "expectedNewParentRevision"],
      [archiveModule, "expectedModuleRevision"],
      [archiveModule, "expectedParentRevision"],
      [saveNote, "expectedNoteRevision"],
      [archiveNote, "expectedNoteRevision"],
    ];

    for (const [command, field] of numericCases) {
      for (const value of unsafeValues) expectInvalid({ ...command, [field]: value });
    }

    expect(parsePersonalKnowledgeCommand({
      ...moveModule,
      ordinal: Number.MAX_SAFE_INTEGER,
      expectedModuleRevision: Number.MAX_SAFE_INTEGER,
      expectedOldParentRevision: Number.MAX_SAFE_INTEGER,
      expectedNewParentRevision: Number.MAX_SAFE_INTEGER,
    })).toMatchObject({ ordinal: Number.MAX_SAFE_INTEGER });
  });

  it("keeps module archive exclusive to the archive command and validates statuses", () => {
    for (const status of ["learning", "paused", "long-term"] as const) {
      expect(parsePersonalKnowledgeCommand({ ...saveModule, status })).toMatchObject({ status });
    }
    expectInvalid({ ...saveModule, status: "archived" });
    expectInvalid({ ...saveModule, status: "active" });
  });


  it("exports strict shared snapshot, applied mutation, and result DTO contracts", () => {
    const snapshot: PersonalKnowledgeSnapshot = {
      businessDate: "2026-08-13",
      modules: [{
        moduleId: "module-0001",
        parentModuleId: null,
        name: "TypeScript",
        goal: "Build reliable systems",
        currentFocus: "Strict contracts",
        description: "Notes",
        status: "learning",
        ordinal: 0,
        revision: 1,
        createdAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T00:00:00.000Z",
      }],
      dailyNotes: [{
        noteId: "daily-note-0001",
        businessDate: "2026-08-13",
        title: "Zod contracts",
        moduleId: "module-0001",
        content: "Validate boundaries.",
        source: "",
        personalUnderstanding: "",
        openQuestions: "",
        application: "",
        status: "active",
        revision: 1,
        createdAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T00:00:00.000Z",
      }],
    };
    const applied: PersonalKnowledgeAppliedMutation = {
      operation: "save-daily-learning-note",
      ownerId: "daily-note-0001",
      ownerRevision: 1,
      businessDate: "2026-08-13",
    };
    const result: PersonalKnowledgeResult = { snapshot, applied };

    expect(personalKnowledgeResultSchema.parse(result)).toEqual(result);
    expect(personalKnowledgeResultSchema.safeParse({ ...result, unexpected: true }).success).toBe(false);
    expect(personalKnowledgeResultSchema.safeParse({
      ...result,
      snapshot: {
        ...snapshot,
        modules: [{ ...snapshot.modules[0], unexpected: true }],
      },
    }).success).toBe(false);
    expect(personalKnowledgeResultSchema.safeParse({
      ...result,
      applied: { ...applied, unexpected: true },
    }).success).toBe(false);

    const typedCommands: readonly PersonalKnowledgeCommand[] = commands;
    expect(typedCommands).toHaveLength(5);
  });
});
