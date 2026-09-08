import type { MutationPolicy, RecordKind } from "./types";

const MUTATION_POLICIES = {
  "fact-event": "append-correction",
  "descriptive-content": "editable-with-revision",
  definition: "versioned-definition",
  "activated-history": "immutable-history",
} as const satisfies Record<RecordKind, MutationPolicy>;

export class RevisionConflictError extends Error {
  readonly expectedRevision: number;
  readonly actualRevision: number;

  constructor(expectedRevision: number, actualRevision: number) {
    super("记录已在其他页面更新");
    this.name = "RevisionConflictError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export function classifyMutation(recordKind: RecordKind): MutationPolicy {
  return MUTATION_POLICIES[recordKind];
}

function isRevision(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function assertExpectedRevision(expected: number, actual: number): void {
  if (!isRevision(expected) || !isRevision(actual)) {
    throw new RangeError("修订号无效");
  }

  if (expected !== actual) {
    throw new RevisionConflictError(expected, actual);
  }
}
