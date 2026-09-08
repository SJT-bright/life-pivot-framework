import { describe, expect, it } from "vitest";

import {
  RevisionConflictError,
  assertExpectedRevision,
  classifyMutation,
} from "./revision";

describe("classifyMutation", () => {
  it.each([
    ["fact-event", "append-correction"],
    ["descriptive-content", "editable-with-revision"],
    ["definition", "versioned-definition"],
    ["activated-history", "immutable-history"],
  ] as const)("maps %s to %s", (recordKind, expectedPolicy) => {
    expect(classifyMutation(recordKind)).toBe(expectedPolicy);
  });
});

describe("assertExpectedRevision", () => {
  it("accepts an unchanged revision", () => {
    expect(() => assertExpectedRevision(3, 3)).not.toThrow();
  });

  it("rejects a stale browser revision instead of overwriting", () => {
    expect(() => assertExpectedRevision(2, 3)).toThrowError(
      new RevisionConflictError(2, 3),
    );
  });

  it.each([-1, 1.5, Number.NaN])("rejects invalid revision %s", (revision) => {
    expect(() => assertExpectedRevision(revision, 1)).toThrow("修订号无效");
  });
});
