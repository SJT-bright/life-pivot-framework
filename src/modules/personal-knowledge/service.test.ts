import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { migrateDatabase } from "@/core/db/migrate";
import { IdempotentCommandConflictError } from "@/core/db/idempotent-command";

import type { PersonalKnowledgeCommand } from "./contracts";
import { createPersonalKnowledgeService, PersonalKnowledgeConflictError } from "./service";

const databases: Database.Database[] = [];
const fixedNow = new Date("2026-08-13T08:09:10.000Z");

function setup() {
  const sqlite = new Database(":memory:");
  databases.push(sqlite);
  migrateDatabase(sqlite);
  let generated = 0;
  const service = createPersonalKnowledgeService({
    sqlite,
    now: () => fixedNow,
    createId: () => `personal-knowledge-generated-${++generated}`,
    writeBarrier: { runWrite: async <T>(action: () => T | Promise<T>) => action() },
  });
  return { sqlite, service };
}

function insertModule(
  sqlite: Database.Database,
  input: {
    id: string;
    parentId?: string | null;
    status?: "learning" | "paused" | "long-term" | "archived";
    ordinal?: number;
    revision?: number;
    name?: string;
  },
): void {
  sqlite.prepare(`insert into knowledge_modules
    (module_id, parent_module_id, name, goal, current_focus, description, status,
     ordinal, revision, created_at, updated_at)
    values (?, ?, ?, '', '', '', ?, ?, ?, ?, ?)`)
    .run(
      input.id,
      input.parentId ?? null,
      input.name ?? input.id,
      input.status ?? "learning",
      input.ordinal ?? 0,
      input.revision ?? 1,
      "2026-08-01T00:00:00.000Z",
      "2026-08-01T00:00:00.000Z",
    );
}

function insertNote(
  sqlite: Database.Database,
  input: { id: string; moduleId: string; status?: "active" | "archived"; revision?: number },
): void {
  sqlite.prepare(`insert into daily_learning_notes
    (note_id, business_date, title, module_id, content, source, personal_understanding,
     open_questions, application, status, revision, created_at, updated_at)
    values (?, '2026-08-13', ?, ?, 'Content', '', '', '', '', ?, ?, ?, ?)`)
    .run(
      input.id,
      input.id,
      input.moduleId,
      input.status ?? "active",
      input.revision ?? 1,
      "2026-08-01T00:00:00.000Z",
      "2026-08-01T00:00:00.000Z",
    );
}

function saveModule(
  moduleId: string,
  overrides: Partial<Extract<PersonalKnowledgeCommand, { type: "save-module" }>> = {},
): Extract<PersonalKnowledgeCommand, { type: "save-module" }> {
  return {
    type: "save-module",
    moduleId,
    parentModuleId: null,
    name: `Module ${moduleId}`,
    goal: "Goal",
    currentFocus: "Focus",
    description: "Description",
    status: "learning",
    ordinal: 0,
    expectedModuleRevision: 0,
    expectedParentRevision: 0,
    ...overrides,
  };
}

function moveModule(
  moduleId: string,
  parentModuleId: string | null,
  overrides: Partial<Extract<PersonalKnowledgeCommand, { type: "move-module" }>> = {},
): Extract<PersonalKnowledgeCommand, { type: "move-module" }> {
  return {
    type: "move-module",
    moduleId,
    parentModuleId,
    ordinal: 0,
    expectedModuleRevision: 1,
    expectedOldParentRevision: 0,
    expectedNewParentRevision: 0,
    ...overrides,
  };
}

function state(sqlite: Database.Database): unknown {
  return {
    modules: sqlite.prepare("select * from knowledge_modules order by module_id").all(),
    notes: sqlite.prepare("select * from daily_learning_notes order by note_id").all(),
    idempotency: sqlite.prepare("select * from idempotency_keys where operation = 'personal-knowledge.command' order by key").all(),
  };
}

async function expectConflict(
  service: ReturnType<typeof createPersonalKnowledgeService>,
  command: PersonalKnowledgeCommand,
  key: string,
): Promise<void> {
  await expect(service.execute(command, key)).rejects.toBeInstanceOf(PersonalKnowledgeConflictError);
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe("personal knowledge service", () => {
  it("creates and updates modules with root revision zero and idempotent replay", async () => {
    const { sqlite, service } = setup();
    const command = saveModule("module-root-0001");
    const created = await service.execute(command, "personal-knowledge-create-root");
    const replay = await service.execute(command, "personal-knowledge-create-root");
    const updated = await service.execute(saveModule("module-root-0001", {
      name: "Updated root",
      expectedModuleRevision: 1,
    }), "personal-knowledge-update-root");

    expect(replay).toEqual(created);
    expect(created.applied).toEqual({
      operation: "save-module",
      ownerId: "module-root-0001",
      ownerRevision: 1,
      businessDate: null,
    });
    expect(updated.applied.ownerRevision).toBe(2);
    expect(sqlite.prepare("select name, revision from knowledge_modules where module_id = ?").get("module-root-0001"))
      .toEqual({ name: "Updated root", revision: 2 });
    expect(sqlite.prepare("select count(*) from idempotency_keys where key = ?").pluck().get("personal-knowledge-create-root"))
      .toBe(1);
    await expect(service.execute({ ...command, name: "Different" }, "personal-knowledge-create-root"))
      .rejects.toBeInstanceOf(IdempotentCommandConflictError);
  });

  it("requires move-module for ordinal changes while allowing same-ordinal content edits", async () => {
    const { sqlite, service } = setup();
    insertModule(sqlite, {
      id: "module-ordered-0001",
      ordinal: 4,
      revision: 2,
      name: "Ordered module",
    });
    const before = state(sqlite);

    await expect(service.execute(saveModule("module-ordered-0001", {
      name: "Forbidden reorder",
      ordinal: 5,
      expectedModuleRevision: 2,
    }), "personal-knowledge-save-reorder")).rejects.toBeInstanceOf(PersonalKnowledgeConflictError);
    expect(state(sqlite)).toEqual(before);

    const edited = await service.execute(saveModule("module-ordered-0001", {
      name: "Allowed content edit",
      ordinal: 4,
      expectedModuleRevision: 2,
    }), "personal-knowledge-save-same-order");
    expect(edited.applied.ownerRevision).toBe(3);
    expect(sqlite.prepare("select name, ordinal, revision from knowledge_modules where module_id = ?")
      .get("module-ordered-0001"))
      .toEqual({ name: "Allowed content edit", ordinal: 4, revision: 3 });
  });


  it("bumps a non-root parent for child creation and rejects stale parent CAS atomically", async () => {
    const { sqlite, service } = setup();
    insertModule(sqlite, { id: "module-parent-0001", revision: 4 });
    const created = await service.execute(saveModule("module-child-0001", {
      parentModuleId: "module-parent-0001",
      expectedParentRevision: 4,
    }), "personal-knowledge-create-child");
    expect(created.applied.ownerRevision).toBe(1);
    expect(sqlite.prepare("select revision from knowledge_modules where module_id = ?").pluck().get("module-parent-0001"))
      .toBe(5);

    const before = state(sqlite);
    await expectConflict(service, saveModule("module-stale-child", {
      parentModuleId: "module-parent-0001",
      expectedParentRevision: 4,
    }), "personal-knowledge-stale-parent");
    expect(state(sqlite)).toEqual(before);
  });

  it("moves within one parent with equal fences and increments that parent exactly once", async () => {
    const { sqlite, service } = setup();
    insertModule(sqlite, { id: "module-parent-0001", revision: 5 });
    insertModule(sqlite, { id: "module-child-0001", parentId: "module-parent-0001", revision: 2 });
    const result = await service.execute(moveModule("module-child-0001", "module-parent-0001", {
      ordinal: 9,
      expectedModuleRevision: 2,
      expectedOldParentRevision: 5,
      expectedNewParentRevision: 5,
    }), "personal-knowledge-move-same-parent");

    expect(result.applied.ownerRevision).toBe(3);
    expect(sqlite.prepare("select ordinal, revision from knowledge_modules where module_id = ?").get("module-child-0001"))
      .toEqual({ ordinal: 9, revision: 3 });
    expect(sqlite.prepare("select revision from knowledge_modules where module_id = ?").pluck().get("module-parent-0001"))
      .toBe(6);
  });

  it("moves across parents atomically and rejects stale old or new parent revisions", async () => {
    const { sqlite, service } = setup();
    insertModule(sqlite, { id: "module-old-parent", revision: 3 });
    insertModule(sqlite, { id: "module-new-parent", revision: 7 });
    insertModule(sqlite, { id: "module-moving-0001", parentId: "module-old-parent", revision: 2 });
    const stale = moveModule("module-moving-0001", "module-new-parent", {
      expectedModuleRevision: 2,
      expectedOldParentRevision: 3,
      expectedNewParentRevision: 6,
    });
    const before = state(sqlite);
    await expectConflict(service, stale, "personal-knowledge-move-stale");
    expect(state(sqlite)).toEqual(before);

    await service.execute({ ...stale, expectedNewParentRevision: 7 }, "personal-knowledge-move-valid");
    expect(sqlite.prepare("select parent_module_id, revision from knowledge_modules where module_id = ?").get("module-moving-0001"))
      .toEqual({ parent_module_id: "module-new-parent", revision: 3 });
    expect(sqlite.prepare("select module_id, revision from knowledge_modules where module_id in (?, ?) order by module_id").all("module-old-parent", "module-new-parent"))
      .toEqual([
        { module_id: "module-new-parent", revision: 8 },
        { module_id: "module-old-parent", revision: 4 },
      ]);
  });

  it("rejects self-parenting, descendants, level six, archived parents, duplicates, and archived revival with zero writes", async () => {
    const { sqlite, service } = setup();
    insertModule(sqlite, { id: "module-root-0001", revision: 6, name: "Duplicate" });
    insertModule(sqlite, { id: "module-level-0002", parentId: "module-root-0001" });
    insertModule(sqlite, { id: "module-level-0003", parentId: "module-level-0002" });
    insertModule(sqlite, { id: "module-level-0004", parentId: "module-level-0003" });
    insertModule(sqlite, { id: "module-level-0005", parentId: "module-level-0004" });
    insertModule(sqlite, { id: "module-archived-1", status: "archived" });
    const cases: PersonalKnowledgeCommand[] = [
      moveModule("module-root-0001", "module-root-0001", { expectedModuleRevision: 6 }),
      moveModule("module-root-0001", "module-level-0003", { expectedModuleRevision: 6 }),
      saveModule("module-level-0006", { parentModuleId: "module-level-0005", expectedParentRevision: 1 }),
      saveModule("module-under-archive", { parentModuleId: "module-archived-1", expectedParentRevision: 1 }),
      saveModule("module-duplicate-1", { name: " duplicate " }),
      saveModule("module-archived-1", { expectedModuleRevision: 1 }),
    ];
    for (const [index, command] of cases.entries()) {
      const before = state(sqlite);
      await expectConflict(service, command, `personal-knowledge-invalid-tree-${index}`);
      expect(state(sqlite), command.type).toEqual(before);
    }
  });

  it("archives only leaf modules, retains the row, and bumps its non-root parent", async () => {
    const { sqlite, service } = setup();
    insertModule(sqlite, { id: "module-grandparent", revision: 4 });
    insertModule(sqlite, { id: "module-parent-0001", parentId: "module-grandparent", revision: 3 });
    insertModule(sqlite, { id: "module-active-child", parentId: "module-parent-0001" });
    const command: PersonalKnowledgeCommand = {
      type: "archive-module",
      moduleId: "module-parent-0001",
      expectedModuleRevision: 3,
      expectedParentRevision: 4,
    };
    const before = state(sqlite);
    await expectConflict(service, command, "personal-knowledge-archive-blocked");
    expect(state(sqlite)).toEqual(before);

    sqlite.prepare("update knowledge_modules set status = 'archived' where module_id = ?").run("module-active-child");
    const result = await service.execute(command, "personal-knowledge-archive-leaf");
    expect(result.applied.ownerRevision).toBe(4);
    expect(sqlite.prepare("select status, revision from knowledge_modules where module_id = ?").get("module-parent-0001"))
      .toEqual({ status: "archived", revision: 4 });
    expect(sqlite.prepare("select revision from knowledge_modules where module_id = ?").pluck().get("module-grandparent"))
      .toBe(5);
  });

  it("saves and archives notes under revision CAS without deleting or reviving them", async () => {
    const { sqlite, service } = setup();
    insertModule(sqlite, { id: "module-notes-0001" });
    const save: Extract<PersonalKnowledgeCommand, { type: "save-daily-learning-note" }> = {
      type: "save-daily-learning-note",
      noteId: "daily-note-0001",
      businessDate: "2026-08-13",
      title: "Daily learning",
      moduleId: "module-notes-0001",
      content: "Strict services",
      source: "Docs",
      personalUnderstanding: "Transactions are boundaries",
      openQuestions: "",
      application: "Use CAS",
      expectedNoteRevision: 0,
    };
    const created = await service.execute(save, "personal-knowledge-note-create");
    expect(created.applied).toEqual({
      operation: "save-daily-learning-note",
      ownerId: "daily-note-0001",
      ownerRevision: 1,
      businessDate: "2026-08-13",
    });
    const archived = await service.execute({
      type: "archive-daily-learning-note",
      noteId: "daily-note-0001",
      expectedNoteRevision: 1,
    }, "personal-knowledge-note-archive");
    expect(archived.applied.ownerRevision).toBe(2);
    expect(sqlite.prepare("select status, revision from daily_learning_notes where note_id = ?").get("daily-note-0001"))
      .toEqual({ status: "archived", revision: 2 });
    await expectConflict(service, { ...save, expectedNoteRevision: 2 }, "personal-knowledge-note-revive");
    expect(sqlite.prepare("select count(*) from daily_learning_notes where note_id = ?").pluck().get("daily-note-0001"))
      .toBe(1);

    insertModule(sqlite, { id: "module-notes-archived", status: "archived" });
    await expectConflict(service, { ...save, noteId: "daily-note-0002", moduleId: "module-notes-archived" }, "personal-knowledge-note-archived-module");
  });

});
