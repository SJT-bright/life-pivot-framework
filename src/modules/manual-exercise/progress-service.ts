import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import {
  type IdempotentCommandOptions,
  runIdempotentCommand,
} from "@/core/db/idempotent-command";
import { assertExpectedRevision } from "@/core/mutations/revision";

import {
  manualExerciseProgressDecisionSchema,
  type ManualExerciseProgressDecisionCommand,
  type ManualExerciseProgressSnapshot,
} from "./progress-contracts";
import { getManualExerciseProgressSnapshot } from "./progress-query";

export class ManualExerciseProgressConflictError extends Error {
  constructor(message = "Manual exercise progress state changed.") {
    super(message);
    this.name = "ManualExerciseProgressConflictError";
  }
}

export class ManualExerciseProgressValidationError extends Error {
  constructor(message = "Invalid manual exercise progress decision.") {
    super(message);
    this.name = "ManualExerciseProgressValidationError";
  }
}

export interface ManualExerciseProgressServiceDependencies {
  now?: () => Date;
  createId?: () => string;
  writeBarrier?: IdempotentCommandOptions["writeBarrier"];
}

export interface ManualExerciseProgressService {
  getSnapshot(input: { asOfDate: string; templateId?: string }): ManualExerciseProgressSnapshot;
  execute(
    command: ManualExerciseProgressDecisionCommand,
    idempotencyKey: string,
  ): Promise<ManualExerciseProgressSnapshot>;
  recordProgressDecision(
    command: ManualExerciseProgressDecisionCommand,
    idempotencyKey: string,
  ): Promise<ManualExerciseProgressSnapshot>;
}

function parseCommand(
  command: ManualExerciseProgressDecisionCommand,
): ManualExerciseProgressDecisionCommand {
  const parsed = manualExerciseProgressDecisionSchema.safeParse(command);
  if (!parsed.success) {
    throw new ManualExerciseProgressValidationError();
  }
  return parsed.data;
}

function recordDecision(
  sqlite: Database.Database,
  command: ManualExerciseProgressDecisionCommand,
  timestamp: string,
  createId: () => string,
): void {
  const snapshot = getManualExerciseProgressSnapshot(sqlite, {
    asOfDate: command.asOfDate,
    templateId: command.templateId,
  });
  const transition = [
    ...snapshot.pending,
    ...snapshot.tracked,
    ...snapshot.excluded,
  ].find((candidate) => candidate.toVersionId === command.templateVersionId);
  if (!transition) {
    throw new ManualExerciseProgressValidationError(
      "The template version has no recordable progress change.",
    );
  }

  const expectedRevision = transition.decisionRevision ?? 0;
  try {
    assertExpectedRevision(command.expectedDecisionRevision, expectedRevision);
  } catch {
    throw new ManualExerciseProgressConflictError();
  }

  if (transition.decisionRevision === null) {
    sqlite.prepare(
      `insert into manual_exercise_progress_decisions
        (id, template_id, from_version_id, to_version_id, decision,
         revision, created_at, updated_at)
       values (?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(
      createId(),
      transition.templateId,
      transition.fromVersionId,
      transition.toVersionId,
      command.decision,
      timestamp,
      timestamp,
    );
    return;
  }

  const result = sqlite.prepare(
    `update manual_exercise_progress_decisions
     set decision = ?, revision = ?, updated_at = ?
     where template_id = ? and from_version_id = ? and to_version_id = ?
       and revision = ?`,
  ).run(
    command.decision,
    transition.decisionRevision + 1,
    timestamp,
    transition.templateId,
    transition.fromVersionId,
    transition.toVersionId,
    transition.decisionRevision,
  );
  if (result.changes !== 1) throw new ManualExerciseProgressConflictError();
}

function buildService(
  sqlite: Database.Database,
  dependencies: ManualExerciseProgressServiceDependencies,
): ManualExerciseProgressService {
  const now = dependencies.now ?? (() => new Date());
  const createId = dependencies.createId ?? randomUUID;
  const getSnapshot = (input: { asOfDate: string; templateId?: string }) =>
    getManualExerciseProgressSnapshot(sqlite, input);
  const execute = (
    command: ManualExerciseProgressDecisionCommand,
    idempotencyKey: string,
  ) => {
    let transactionNow: Date | undefined;
    const stableNow = () => {
      transactionNow ??= now();
      return transactionNow;
    };
    return runIdempotentCommand(
      sqlite,
      {
        operation: "manual-exercise.progress-decision",
        idempotencyKey,
        now: stableNow,
        writeBarrier: dependencies.writeBarrier,
      },
      command,
      () => {
        const parsed = parseCommand(command);
        recordDecision(sqlite, parsed, stableNow().toISOString(), createId);
        return getSnapshot({ asOfDate: parsed.asOfDate, templateId: parsed.templateId });
      },
    );
  };
  return {
    getSnapshot,
    execute,
    recordProgressDecision: execute,
  };
}

export function createManualExerciseProgressService(
  sqlite: Database.Database,
  dependencies?: ManualExerciseProgressServiceDependencies,
): ManualExerciseProgressService;
export function createManualExerciseProgressService(
  dependencies: ManualExerciseProgressServiceDependencies & { sqlite: Database.Database },
): ManualExerciseProgressService;
export function createManualExerciseProgressService(
  sqliteOrDependencies:
    | Database.Database
    | (ManualExerciseProgressServiceDependencies & { sqlite: Database.Database }),
  dependencies: ManualExerciseProgressServiceDependencies = {},
): ManualExerciseProgressService {
  if ("sqlite" in sqliteOrDependencies) {
    const { sqlite, ...options } = sqliteOrDependencies;
    return buildService(sqlite, options);
  }
  return buildService(sqliteOrDependencies, dependencies);
}
