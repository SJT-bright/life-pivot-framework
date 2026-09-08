import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import {
  type IdempotentCommandOptions,
  runIdempotentCommand,
} from "@/core/db/idempotent-command";
import { toShanghaiBusinessDate } from "@/core/time/business-date";

import {
  type PersonalKnowledgeAppliedMutation,
  type PersonalKnowledgeCommand,
  type PersonalKnowledgeResult,
  parsePersonalKnowledgeCommand,
} from "./contracts";
import { getPersonalKnowledgeSnapshot } from "./query";

interface ModuleRow {
  module_id: string;
  parent_module_id: string | null;
  name: string;
  status: "learning" | "paused" | "long-term" | "archived";
  ordinal: number;
  revision: number;
}

interface NoteRow {
  note_id: string;
  business_date: string;
  module_id: string;
  status: "active" | "archived";
  revision: number;
}

export class PersonalKnowledgeConflictError extends Error {
  constructor(message = "The personal knowledge command no longer matches current state.") {
    super(message);
    this.name = "PersonalKnowledgeConflictError";
  }
}

export interface PersonalKnowledgeServiceDependencies {
  sqlite: Database.Database;
  now?: () => Date;
  createId?: () => string;
  writeBarrier?: IdempotentCommandOptions["writeBarrier"];
}

export interface PersonalKnowledgeService {
  execute(command: PersonalKnowledgeCommand, idempotencyKey: string): Promise<PersonalKnowledgeResult>;
}

function conflict(message: string): never {
  throw new PersonalKnowledgeConflictError(message);
}

function increment(revision: number, resource: string): number {
  if (!Number.isSafeInteger(revision) || revision < 1 || revision >= Number.MAX_SAFE_INTEGER) {
    conflict(`${resource} revision cannot be incremented safely.`);
  }
  return revision + 1;
}

function getModule(sqlite: Database.Database, moduleId: string): ModuleRow | undefined {
  return sqlite.prepare(`select module_id, parent_module_id, name, status, ordinal, revision
    from knowledge_modules where module_id = ?`).get(moduleId) as ModuleRow | undefined;
}

function getNote(sqlite: Database.Database, noteId: string): NoteRow | undefined {
  return sqlite.prepare(`select note_id, business_date, module_id, status, revision
    from daily_learning_notes where note_id = ?`).get(noteId) as NoteRow | undefined;
}

function assertExpectedParent(
  sqlite: Database.Database,
  parentModuleId: string | null,
  expectedRevision: number,
): ModuleRow | null {
  if (parentModuleId === null) {
    if (expectedRevision !== 0) conflict("Root parent revision must be zero.");
    return null;
  }
  const parent = getModule(sqlite, parentModuleId);
  if (!parent || parent.status === "archived" || parent.revision !== expectedRevision) {
    conflict("The parent module revision is stale or unavailable.");
  }
  return parent;
}

function bumpParent(
  sqlite: Database.Database,
  parent: ModuleRow | null,
  timestamp: string,
): void {
  if (!parent) return;
  const revision = increment(parent.revision, "Parent module");
  const updated = sqlite.prepare(`update knowledge_modules
    set revision = ?, updated_at = ?
    where module_id = ? and revision = ?`).run(
      revision,
      timestamp,
      parent.module_id,
      parent.revision,
    );
  if (updated.changes !== 1) conflict("The parent module revision is stale.");
}

function moduleDepth(sqlite: Database.Database, moduleId: string): number {
  let currentId: string | null = moduleId;
  let depth = 0;
  const seen = new Set<string>();
  while (currentId !== null) {
    if (seen.has(currentId)) conflict("The module hierarchy contains a cycle.");
    seen.add(currentId);
    const current = getModule(sqlite, currentId);
    if (!current) conflict("The parent module does not exist.");
    depth += 1;
    if (depth > 5) conflict("The module hierarchy exceeds five levels.");
    currentId = current.parent_module_id;
  }
  return depth;
}

function subtreeHeight(sqlite: Database.Database, moduleId: string): number {
  const value = sqlite.prepare(`with recursive descendants(module_id, depth) as (
      select module_id, 1 from knowledge_modules where module_id = ?
      union all
      select child.module_id, parent.depth + 1
      from knowledge_modules child
      join descendants parent on child.parent_module_id = parent.module_id
      where parent.depth < 6
    )
    select max(depth) from descendants`).pluck().get(moduleId);
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    conflict("The module subtree is invalid.");
  }
  return value;
}

function assertNotDescendant(
  sqlite: Database.Database,
  moduleId: string,
  parentModuleId: string | null,
): void {
  let currentId = parentModuleId;
  const seen = new Set<string>();
  while (currentId !== null) {
    if (currentId === moduleId) conflict("A module cannot be moved under itself or a descendant.");
    if (seen.has(currentId)) conflict("The module hierarchy contains a cycle.");
    seen.add(currentId);
    const current = getModule(sqlite, currentId);
    if (!current) conflict("The parent module does not exist.");
    currentId = current.parent_module_id;
  }
}

function assertUniqueSiblingName(
  sqlite: Database.Database,
  parentModuleId: string | null,
  name: string,
  excludedModuleId: string,
): void {
  const duplicate = sqlite.prepare(`select 1 from knowledge_modules
    where parent_module_id is ?
      and lower(trim(name)) = lower(trim(?))
      and status <> 'archived'
      and module_id <> ?`).get(parentModuleId, name, excludedModuleId);
  if (duplicate) conflict("An active sibling module already uses this name.");
}

function assertActiveModule(sqlite: Database.Database, moduleId: string): ModuleRow {
  const module = getModule(sqlite, moduleId);
  if (!module || module.status === "archived") conflict("The module is unavailable or archived.");
  return module;
}

function applySaveModule(
  sqlite: Database.Database,
  command: Extract<PersonalKnowledgeCommand, { type: "save-module" }>,
  timestamp: string,
): PersonalKnowledgeAppliedMutation {
  const current = getModule(sqlite, command.moduleId);
  const parent = assertExpectedParent(sqlite, command.parentModuleId, command.expectedParentRevision);
  assertUniqueSiblingName(sqlite, command.parentModuleId, command.name, command.moduleId);

  if (!current) {
    if (command.expectedModuleRevision !== 0) conflict("A new module requires revision zero.");
    if (parent && moduleDepth(sqlite, parent.module_id) + 1 > 5) {
      conflict("The module hierarchy cannot exceed five levels.");
    }
    sqlite.prepare(`insert into knowledge_modules
      (module_id, parent_module_id, name, goal, current_focus, description, status,
       ordinal, revision, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(
        command.moduleId,
        command.parentModuleId,
        command.name,
        command.goal,
        command.currentFocus,
        command.description,
        command.status,
        command.ordinal,
        timestamp,
        timestamp,
      );
    bumpParent(sqlite, parent, timestamp);
    return { operation: command.type, ownerId: command.moduleId, ownerRevision: 1, businessDate: null };
  }

  if (
    current.status === "archived" ||
    current.revision !== command.expectedModuleRevision ||
    current.parent_module_id !== command.parentModuleId
  ) {
    conflict("The module revision or parent is stale.");
  }
  if (current.ordinal !== command.ordinal) {
    conflict("Module ordering changes require move-module.");
  }
  const revision = increment(current.revision, "Module");
  const updated = sqlite.prepare(`update knowledge_modules
    set name = ?, goal = ?, current_focus = ?, description = ?, status = ?, ordinal = ?,
        revision = ?, updated_at = ?
    where module_id = ? and revision = ? and status <> 'archived'`).run(
      command.name,
      command.goal,
      command.currentFocus,
      command.description,
      command.status,
      command.ordinal,
      revision,
      timestamp,
      command.moduleId,
      current.revision,
    );
  if (updated.changes !== 1) conflict("The module revision is stale.");
  return { operation: command.type, ownerId: command.moduleId, ownerRevision: revision, businessDate: null };
}

function applyMoveModule(
  sqlite: Database.Database,
  command: Extract<PersonalKnowledgeCommand, { type: "move-module" }>,
  timestamp: string,
): PersonalKnowledgeAppliedMutation {
  const current = getModule(sqlite, command.moduleId);
  if (!current || current.status === "archived" || current.revision !== command.expectedModuleRevision) {
    conflict("The module revision is stale or archived.");
  }
  assertNotDescendant(sqlite, command.moduleId, command.parentModuleId);
  const sameParent = current.parent_module_id === command.parentModuleId;
  let oldParent: ModuleRow | null;
  let newParent: ModuleRow | null;
  if (sameParent) {
    if (command.expectedOldParentRevision !== command.expectedNewParentRevision) {
      conflict("A same-parent move requires one identical parent revision fence.");
    }
    oldParent = assertExpectedParent(sqlite, current.parent_module_id, command.expectedOldParentRevision);
    newParent = oldParent;
  } else {
    oldParent = assertExpectedParent(sqlite, current.parent_module_id, command.expectedOldParentRevision);
    newParent = assertExpectedParent(sqlite, command.parentModuleId, command.expectedNewParentRevision);
  }
  const newDepth = newParent ? moduleDepth(sqlite, newParent.module_id) + 1 : 1;
  if (newDepth + subtreeHeight(sqlite, command.moduleId) - 1 > 5) {
    conflict("The module hierarchy cannot exceed five levels.");
  }
  assertUniqueSiblingName(sqlite, command.parentModuleId, current.name, command.moduleId);
  const revision = increment(current.revision, "Module");
  const updated = sqlite.prepare(`update knowledge_modules
    set parent_module_id = ?, ordinal = ?, revision = ?, updated_at = ?
    where module_id = ? and revision = ? and status <> 'archived'`).run(
      command.parentModuleId,
      command.ordinal,
      revision,
      timestamp,
      command.moduleId,
      current.revision,
    );
  if (updated.changes !== 1) conflict("The module revision is stale.");
  bumpParent(sqlite, oldParent, timestamp);
  if (!sameParent) bumpParent(sqlite, newParent, timestamp);
  return { operation: command.type, ownerId: command.moduleId, ownerRevision: revision, businessDate: null };
}

function applyArchiveModule(
  sqlite: Database.Database,
  command: Extract<PersonalKnowledgeCommand, { type: "archive-module" }>,
  timestamp: string,
): PersonalKnowledgeAppliedMutation {
  const current = getModule(sqlite, command.moduleId);
  if (!current || current.status === "archived" || current.revision !== command.expectedModuleRevision) {
    conflict("The module revision is stale or archived.");
  }
  const parent = assertExpectedParent(sqlite, current.parent_module_id, command.expectedParentRevision);
  if (sqlite.prepare(`select 1 from knowledge_modules
      where parent_module_id = ? and status <> 'archived' limit 1`).get(command.moduleId)) {
    conflict("A module with a non-archived child cannot be archived.");
  }
  const revision = increment(current.revision, "Module");
  const updated = sqlite.prepare(`update knowledge_modules
    set status = 'archived', revision = ?, updated_at = ?
    where module_id = ? and revision = ? and status <> 'archived'`).run(
      revision,
      timestamp,
      command.moduleId,
      current.revision,
    );
  if (updated.changes !== 1) conflict("The module revision is stale.");
  bumpParent(sqlite, parent, timestamp);
  return { operation: command.type, ownerId: command.moduleId, ownerRevision: revision, businessDate: null };
}

function applySaveNote(
  sqlite: Database.Database,
  command: Extract<PersonalKnowledgeCommand, { type: "save-daily-learning-note" }>,
  timestamp: string,
): PersonalKnowledgeAppliedMutation {
  assertActiveModule(sqlite, command.moduleId);
  const current = getNote(sqlite, command.noteId);
  if (!current) {
    if (command.expectedNoteRevision !== 0) conflict("A new daily note requires revision zero.");
    sqlite.prepare(`insert into daily_learning_notes
      (note_id, business_date, title, module_id, content, source, personal_understanding,
       open_questions, application, status, revision, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)`).run(
        command.noteId,
        command.businessDate,
        command.title,
        command.moduleId,
        command.content,
        command.source,
        command.personalUnderstanding,
        command.openQuestions,
        command.application,
        timestamp,
        timestamp,
      );
    return {
      operation: command.type,
      ownerId: command.noteId,
      ownerRevision: 1,
      businessDate: command.businessDate,
    };
  }
  if (current.status === "archived" || current.revision !== command.expectedNoteRevision) {
    conflict("The daily note revision is stale or archived.");
  }
  const revision = increment(current.revision, "Daily note");
  const updated = sqlite.prepare(`update daily_learning_notes
    set business_date = ?, title = ?, module_id = ?, content = ?, source = ?,
        personal_understanding = ?, open_questions = ?, application = ?, revision = ?, updated_at = ?
    where note_id = ? and revision = ? and status = 'active'`).run(
      command.businessDate,
      command.title,
      command.moduleId,
      command.content,
      command.source,
      command.personalUnderstanding,
      command.openQuestions,
      command.application,
      revision,
      timestamp,
      command.noteId,
      current.revision,
    );
  if (updated.changes !== 1) conflict("The daily note revision is stale.");
  return {
    operation: command.type,
    ownerId: command.noteId,
    ownerRevision: revision,
    businessDate: command.businessDate,
  };
}

function applyArchiveNote(
  sqlite: Database.Database,
  command: Extract<PersonalKnowledgeCommand, { type: "archive-daily-learning-note" }>,
  timestamp: string,
): PersonalKnowledgeAppliedMutation {
  const current = getNote(sqlite, command.noteId);
  if (!current || current.status === "archived" || current.revision !== command.expectedNoteRevision) {
    conflict("The daily note revision is stale or archived.");
  }
  const revision = increment(current.revision, "Daily note");
  const updated = sqlite.prepare(`update daily_learning_notes
    set status = 'archived', revision = ?, updated_at = ?
    where note_id = ? and revision = ? and status = 'active'`).run(
      revision,
      timestamp,
      command.noteId,
      current.revision,
    );
  if (updated.changes !== 1) conflict("The daily note revision is stale.");
  return {
    operation: command.type,
    ownerId: command.noteId,
    ownerRevision: revision,
    businessDate: current.business_date,
  };
}

function applyCommand(
  sqlite: Database.Database,
  command: PersonalKnowledgeCommand,
  timestamp: string,
): PersonalKnowledgeAppliedMutation {
  switch (command.type) {
    case "save-module":
      return applySaveModule(sqlite, command, timestamp);
    case "move-module":
      return applyMoveModule(sqlite, command, timestamp);
    case "archive-module":
      return applyArchiveModule(sqlite, command, timestamp);
    case "save-daily-learning-note":
      return applySaveNote(sqlite, command, timestamp);
    case "archive-daily-learning-note":
      return applyArchiveNote(sqlite, command, timestamp);
  }
}

export function createPersonalKnowledgeService(
  dependencies: PersonalKnowledgeServiceDependencies,
): PersonalKnowledgeService {
  const now = dependencies.now ?? (() => new Date());
  const createId = dependencies.createId ?? randomUUID;
  void createId;
  return {
    async execute(command, idempotencyKey) {
      const parsed = parsePersonalKnowledgeCommand(command);
      let transactionNow: Date | undefined;
      const stableNow = () => {
        transactionNow ??= now();
        return transactionNow;
      };
      return runIdempotentCommand(
        dependencies.sqlite,
        {
          operation: "personal-knowledge.command",
          idempotencyKey,
          now: stableNow,
          writeBarrier: dependencies.writeBarrier,
        },
        parsed,
        () => {
          const applied = applyCommand(dependencies.sqlite, parsed, stableNow().toISOString());
          const businessDate = applied.businessDate ?? toShanghaiBusinessDate(stableNow());
          return {
            snapshot: getPersonalKnowledgeSnapshot(dependencies.sqlite, { businessDate }),
            applied,
          };
        },
      );
    },
  };
}
