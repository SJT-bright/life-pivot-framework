import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearConfirmedSimpleSubmission,
  freezeSimpleSubmission,
  markSimpleSubmissionUncertain,
  reconcileSimpleSubmissionStorageChange,
  recoverSimpleSubmissions,
  storeSimpleSubmission,
  type FreezeSimpleSubmissionInput,
  type SimpleFrozenSubmission,
} from "./frozen-submission";

class MemoryStorage implements Storage {
  protected readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class ThrowingStorage extends MemoryStorage {
  throwFrom: "getItem" | "setItem" | "removeItem" | null = null;

  override getItem(key: string): string | null {
    if (this.throwFrom === "getItem") throw new Error("getItem unavailable");
    return super.getItem(key);
  }

  override setItem(key: string, value: string): void {
    if (this.throwFrom === "setItem") throw new Error("setItem unavailable");
    super.setItem(key, value);
  }

  override removeItem(key: string): void {
    if (this.throwFrom === "removeItem") throw new Error("removeItem unavailable");
    super.removeItem(key);
  }
}

const dailyBody = '{\n  "type": "save-daily-sleep",\n  "recordId": "sleep-record-0001",\n  "recordDate": "2026-08-12",\n  "expectedRevision": 0\n}';

const manualOperationOwners = [
  ["replace-template", "templateId", "template-0001"],
  ["select-cycle-day", "templateId", "template-0001"],
  ["start-training", "businessDate", "2026-08-13"],
  ["pause-training", "businessDate", "2026-08-13"],
  ["resume-training", "businessDate", "2026-08-13"],
  ["save-training", "businessDate", "2026-08-13"],
  ["finish-and-advance", "businessDate", "2026-08-13"],
  ["skip-and-advance", "businessDate", "2026-08-13"],
] as const;

const manualSkincareOperationOwners = [
  ["save-product", "productId", "product-0001"],
  ["replace-routine", "businessDate", "2026-08-13"],
  ["set-day-items-used", "businessDate", "2026-08-13"],
  ["save-day-note", "businessDate", "2026-08-13"],
  ["save-recovery-plan", "planId", "plan-0001"],
  ["save-recovery-cycle", "cycleId", "cycle-0001"],
  ["start-recovery-cycle", "cycleId", "cycle-0001"],
  ["complete-recovery-cycle", "cycleId", "cycle-0001"],
] as const;

const personalKnowledgeOperationOwners = [
  ["save-module", "moduleId", "module-0001"],
  ["move-module", "moduleId", "module-0001"],
  ["archive-module", "moduleId", "module-0001"],
  ["save-daily-learning-note", "noteId", "daily-note-0001"],
  ["archive-daily-learning-note", "noteId", "daily-note-0001"],
  ["organize-knowledge-item", "knowledgeItemId", "knowledge-item-0001"],
] as const;

function dailyInput(
  overrides: Partial<FreezeSimpleSubmissionInput> = {},
): FreezeSimpleSubmissionInput {
  return {
    purpose: "daily-sleep",
    endpoint: "/api/v1/daily-sleep",
    operation: "save-daily-sleep",
    ownerId: "sleep-record-0001",
    localRevision: 1,
    idempotencyKey: "daily-sleep-key-0001",
    body: dailyBody,
    expected: {
      recordId: "sleep-record-0001",
      recordDate: "2026-08-12",
      revision: 1,
    },
    createdAt: "2026-08-12T00:00:00.000Z",
    ...overrides,
  };
}

function manualProgressInput(
  ownerId = "template-version-0002",
  overrides: Partial<FreezeSimpleSubmissionInput> = {},
): FreezeSimpleSubmissionInput {
  return {
    purpose: "manual-exercise-progress",
    endpoint: "/api/v1/manual-exercise-progress",
    operation: "record-progress-decision",
    ownerId,
    localRevision: 1,
    idempotencyKey: "manual-progress-key-0001",
    body: JSON.stringify({
      type: "record-progress-decision",
      templateVersionId: ownerId,
      decision: "tracked",
      expectedDecisionRevision: 0,
    }),
    expected: { ownerId, revision: 1 },
    createdAt: "2026-08-13T00:00:00.000Z",
    ...overrides,
  };
}

function freezeDaily(
  overrides: Partial<FreezeSimpleSubmissionInput> = {},
): SimpleFrozenSubmission {
  return freezeSimpleSubmission(dailyInput(overrides));
}

function manualInput(
  operation: string = "replace-template",
  ownerField: "templateId" | "businessDate" = "templateId",
  ownerId = "template-0001",
  overrides: Partial<FreezeSimpleSubmissionInput> = {},
): FreezeSimpleSubmissionInput {
  return {
    purpose: "manual-exercise",
    endpoint: "/api/v1/manual-exercise",
    operation,
    ownerId,
    localRevision: 1,
    idempotencyKey: "manual-exercise-key-0001",
    body: `{\n  "type": ${JSON.stringify(operation)},\n  ${JSON.stringify(ownerField)}: ${JSON.stringify(ownerId)}\n}`,
    expected: { ownerId, revision: 1 },
    createdAt: "2026-08-13T00:00:00.000Z",
    ...overrides,
  };
}

function manualSkincareInput(
  operation: string = "save-product",
  ownerField: "productId" | "businessDate" | "planId" | "cycleId" = "productId",
  ownerId = "product-0001",
  overrides: Partial<FreezeSimpleSubmissionInput> = {},
): FreezeSimpleSubmissionInput {
  return {
    purpose: "manual-skincare",
    endpoint: "/api/v1/manual-skincare",
    operation,
    ownerId,
    localRevision: 1,
    idempotencyKey: "manual-skincare-key-0001",
    body: ` {\n  "type": ${JSON.stringify(operation)},\n  ${JSON.stringify(ownerField)}: ${JSON.stringify(ownerId)}\n} `,
    expected: { ownerId, revision: 1 },
    createdAt: "2026-08-13T00:00:00.000Z",
    ...overrides,
  };
}

function personalKnowledgeInput(
  operation: string = "save-module",
  ownerField: "moduleId" | "noteId" | "knowledgeItemId" = "moduleId",
  ownerId = "module-0001",
  overrides: Partial<FreezeSimpleSubmissionInput> = {},
): FreezeSimpleSubmissionInput {
  return {
    purpose: "personal-knowledge",
    endpoint: "/api/v1/personal-knowledge",
    operation,
    ownerId,
    localRevision: 1,
    idempotencyKey: "personal-knowledge-key-0001",
    body: ` {\n  "type": ${JSON.stringify(operation)},\n  ${JSON.stringify(ownerField)}: ${JSON.stringify(ownerId)}\n} `,
    expected: { ownerId, revision: 1 },
    createdAt: "2026-08-13T00:00:00.000Z",
    ...overrides,
  } as FreezeSimpleSubmissionInput;
}

function expectStored(
  result: ReturnType<typeof storeSimpleSubmission>,
): asserts result is Extract<typeof result, { kind: "stored" }> {
  expect(result.kind).toBe("stored");
  if (result.kind !== "stored") throw new Error("Expected stored submission.");
}

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

afterEach(() => {
  vi.restoreAllMocks();
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, "window", originalWindowDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

describe("simple frozen submissions", () => {
  it("freezes the six personal-knowledge operations with exact endpoint and owners", () => {
    for (const [operation, ownerField, ownerId] of personalKnowledgeOperationOwners) {
      const input = personalKnowledgeInput(operation, ownerField, ownerId);
      const submission = freezeSimpleSubmission(input);

      expect(submission).toMatchObject({
        purpose: "personal-knowledge",
        endpoint: "/api/v1/personal-knowledge",
        operation,
        ownerId,
        body: input.body,
      });
    }
  });

  it("fails closed for personal-knowledge purpose, endpoint, type, and owner mismatches", () => {
    const invalidInputs: FreezeSimpleSubmissionInput[] = [
      personalKnowledgeInput("delete-module", "moduleId", "module-0001"),
      personalKnowledgeInput("save-module", "moduleId", "module-0001", {
        purpose: "personal-note",
      }),
      personalKnowledgeInput("save-module", "moduleId", "module-0001", {
        endpoint: "/api/v1/personal-notes",
      }),
      personalKnowledgeInput("save-module", "moduleId", "module-0001", {
        body: JSON.stringify({ type: "move-module", moduleId: "module-0001" }),
      }),
    ];

    for (const [operation, ownerField, ownerId] of personalKnowledgeOperationOwners) {
      const wrongOwnerField = ownerField === "moduleId" ? "noteId" : "moduleId";
      invalidInputs.push(personalKnowledgeInput(operation, ownerField, ownerId, {
        body: JSON.stringify({
          type: operation,
          [ownerField]: "wrong-owner",
          [wrongOwnerField]: ownerId,
        }),
      }));
    }

    for (const input of invalidInputs) {
      expect(() => freezeSimpleSubmission(input)).toThrow(TypeError);
    }
  });

  it("recovers personal-knowledge without sending and preserves exact raw evidence and locks", () => {
    const storage = new MemoryStorage();
    const input = personalKnowledgeInput(
      "organize-knowledge-item",
      "knowledgeItemId",
      "knowledge-item-0001",
    );
    const stored = storeSimpleSubmission(storage, freezeSimpleSubmission(input));
    expectStored(stored);
    expect(stored.outerKey).toContain(":personal-knowledge:personal-knowledge-key-0001");
    expect(stored.submission.body).toBe(input.body);
    expect(storage.getItem(stored.outerKey)).toBe(stored.outerRaw);

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const recovery = recoverSimpleSubmissions("personal-knowledge", storage);
    expect(recovery.kind).toBe("recovered");
    if (recovery.kind !== "recovered") throw new Error("Expected recovery.");
    expect(recovery.submission.status).toBe("uncertain");
    expect(recovery.submission.body).toBe(input.body);
    expect(fetchSpy).not.toHaveBeenCalled();

    expect(reconcileSimpleSubmissionStorageChange({
      purpose: recovery.submission.purpose,
      outerKey: recovery.outerKey,
      outerRaw: recovery.outerRaw,
    }, { key: null, newValue: null } as StorageEvent)).toEqual({
      kind: "locked",
      reason: "storage-cleared",
    });

    const changedRaw = `${recovery.outerRaw} `;
    storage.setItem(recovery.outerKey, changedRaw);
    expect(clearConfirmedSimpleSubmission(storage, recovery)).toEqual({
      kind: "locked",
      reason: "same-purpose-external-change",
    });
    expect(storage.getItem(recovery.outerKey)).toBe(changedRaw);
  });

  it("freezes the eight manual-skincare operations with exact bytes and canonical owners", () => {
    for (const [operation, ownerField, ownerId] of manualSkincareOperationOwners) {
      const input = manualSkincareInput(operation, ownerField, ownerId);
      const submission = freezeSimpleSubmission(input);

      expect(submission).toMatchObject({
        purpose: "manual-skincare",
        endpoint: "/api/v1/manual-skincare",
        operation,
        ownerId,
        body: input.body,
      });
    }
  });

  it("rejects invalid manual-skincare metadata and non-canonical owner bindings", () => {
    const invalidInputs: Array<FreezeSimpleSubmissionInput | Record<string, unknown>> = [
      manualSkincareInput("delete-product", "productId", "product-0001"),
      manualSkincareInput("save-product", "productId", "product-0001", {
        endpoint: "/api/v1/skincare/catalog" as FreezeSimpleSubmissionInput["endpoint"],
      }),
      manualSkincareInput("save-product", "productId", "product-0001", {
        body: JSON.stringify({ type: "save-day-note", productId: "product-0001" }),
      }),
      manualSkincareInput("save-product", "productId", "product-0001", {
        idempotencyKey: "short",
      }),
      manualSkincareInput("save-product", "productId", "product-0001", {
        createdAt: "2026-08-13T08:00:00+08:00",
      }),
      { ...manualSkincareInput(), unexpected: true },
    ];

    for (const [operation, ownerField, ownerId] of manualSkincareOperationOwners) {
      invalidInputs.push(manualSkincareInput(operation, ownerField, ownerId, {
        body: JSON.stringify({ type: operation, [ownerField]: "wrong-owner" }),
      }));
    }

    for (const input of invalidInputs) {
      expect(() => freezeSimpleSubmission(input as FreezeSimpleSubmissionInput)).toThrow(TypeError);
    }
  });

  it("recovers only one manual-skincare submission conservatively and locks changed evidence", () => {
    const storage = new MemoryStorage();
    const input = manualSkincareInput();
    const stored = storeSimpleSubmission(storage, freezeSimpleSubmission(input));
    expectStored(stored);

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const recovery = recoverSimpleSubmissions("manual-skincare", storage);
    expect(recovery.kind).toBe("recovered");
    if (recovery.kind !== "recovered") throw new Error("Expected recovery.");
    expect(recovery.submission.status).toBe("uncertain");
    expect(recovery.submission.body).toBe(input.body);
    expect(fetchSpy).not.toHaveBeenCalled();

    storage.setItem(recovery.outerKey, `${recovery.outerRaw} `);
    expect(clearConfirmedSimpleSubmission(storage, recovery)).toEqual({
      kind: "locked",
      reason: "same-purpose-external-change",
    });

    const second = storeSimpleSubmission(
      storage,
      freezeSimpleSubmission(manualSkincareInput(
        "save-recovery-plan",
        "planId",
        "plan-0002",
        { idempotencyKey: "manual-skincare-key-0002" },
      )),
    );
    expectStored(second);
    expect(recoverSimpleSubmissions("manual-skincare", storage)).toEqual({
      kind: "locked",
      reason: "same-purpose-external-change",
    });
  });

  it("freezes only the eight manual-exercise operations with their canonical owner fields", () => {
    for (const [operation, ownerField, ownerId] of manualOperationOwners) {
      const submission = freezeSimpleSubmission(manualInput(operation, ownerField, ownerId));

      expect(submission).toMatchObject({
        purpose: "manual-exercise",
        endpoint: "/api/v1/manual-exercise",
        operation,
        ownerId,
        body: expect.stringContaining(`"${ownerField}"`),
      });
    }
  });

  it("freezes the progress decision against the exact template version", () => {
    const ownerId = "template-version-0002";
    const submission = freezeSimpleSubmission(manualProgressInput(ownerId));

    expect(submission).toMatchObject({
      purpose: "manual-exercise-progress",
      endpoint: "/api/v1/manual-exercise-progress",
      operation: "record-progress-decision",
      ownerId,
      body: expect.stringContaining(`"templateVersionId":"${ownerId}"`),
    });

    expect(() => freezeSimpleSubmission(manualProgressInput(ownerId, {
      endpoint: "/api/v1/manual-exercise",
    }))).toThrow(TypeError);
    expect(() => freezeSimpleSubmission(manualProgressInput(ownerId, {
      body: JSON.stringify({ type: "record-progress-decision", templateId: ownerId }),
    }))).toThrow(TypeError);
  });

  it("rejects manual-exercise metadata, operations, types, and non-canonical owner bindings", () => {
    const invalidInputs: FreezeSimpleSubmissionInput[] = [
      manualInput("delete-training", "businessDate", "2026-08-13"),
      manualInput("replace-template", "templateId", "template-0001", {
        endpoint: "/api/v1/daily-sleep",
      }),
      manualInput("replace-template", "templateId", "template-0001", {
        purpose: "daily-sleep",
      }),
      manualInput("replace-template", "templateId", "template-0001", {
        body: JSON.stringify({
          type: "start-training",
          templateId: "template-0001",
        }),
      }),
    ];

    for (const [operation, ownerField, ownerId] of manualOperationOwners) {
      const alternateField = ownerField === "templateId" ? "businessDate" : "templateId";
      invalidInputs.push(manualInput(operation, ownerField, ownerId, {
        body: JSON.stringify({
          type: operation,
          [ownerField]: "wrong-owner",
          [alternateField]: ownerId,
        }),
      }));
    }

    for (const input of invalidInputs) {
      expect(() => freezeSimpleSubmission(input)).toThrow(TypeError);
    }
  });

  it("preserves exact manual-exercise bytes through store and reload while retaining CAS isolation", () => {
    const storage = new MemoryStorage();
    const input = manualInput();
    const frozen = freezeSimpleSubmission(input);
    const stored = storeSimpleSubmission(storage, frozen);
    expectStored(stored);
    expect(stored.outerKey).toContain(":manual-exercise:manual-exercise-key-0001");
    expect(storage.getItem(stored.outerKey)).toBe(stored.outerRaw);

    const sameKeyDifferentRaw = storeSimpleSubmission(storage, freezeSimpleSubmission(manualInput(
      "replace-template",
      "templateId",
      "template-0001",
      { createdAt: "2026-08-13T00:00:01.000Z" },
    )));
    expect(sameKeyDifferentRaw).toEqual({ kind: "conflict" });
    expect(storage.getItem(stored.outerKey)).toBe(stored.outerRaw);

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const recovery = recoverSimpleSubmissions("manual-exercise", storage);
    expect(recovery.kind).toBe("recovered");
    if (recovery.kind !== "recovered") throw new Error("Expected recovery.");
    expect(recovery.submission.status).toBe("uncertain");
    expect(recovery.submission.body).toBe(input.body);
    expect(fetchSpy).not.toHaveBeenCalled();

    const externallyChangedRaw = `${recovery.outerRaw} `;
    storage.setItem(recovery.outerKey, externallyChangedRaw);
    expect(clearConfirmedSimpleSubmission(storage, recovery)).toEqual({
      kind: "locked",
      reason: "same-purpose-external-change",
    });
    expect(storage.getItem(recovery.outerKey)).toBe(externallyChangedRaw);

    const active = {
      purpose: recovery.submission.purpose,
      outerKey: recovery.outerKey,
      outerRaw: recovery.outerRaw,
    };
    expect(reconcileSimpleSubmissionStorageChange(active, {
      key: null,
      newValue: null,
    } as StorageEvent)).toEqual({ kind: "locked", reason: "storage-cleared" });
    expect(reconcileSimpleSubmissionStorageChange(active, {
      key: "life-pivot:accumulation:submission:v1:manual-exercise:another-key-0001",
      newValue: "external bytes",
    } as StorageEvent)).toEqual({
      kind: "locked",
      reason: "same-purpose-external-change",
    });
    expect(reconcileSimpleSubmissionStorageChange(active, {
      key: "life-pivot:accumulation:submission:v1:daily-sleep:another-key-0001",
      newValue: "external bytes",
    } as StorageEvent)).toEqual({ kind: "ignored" });
  });

  it("freezes exact request evidence for the three allowed purpose/owner bindings", () => {
    const expected = {
      recordId: "sleep-record-0001",
      nested: { revision: 1 },
    };
    const daily = freezeDaily({ expected });
    expected.nested.revision = 99;

    const health = freezeSimpleSubmission({
      purpose: "health-checklist",
      endpoint: "/api/v1/health-checklist",
      operation: "set-health-checklist-items",
      ownerId: "2026-08-12",
      localRevision: 2,
      idempotencyKey: "health-check-key-0001",
      body: JSON.stringify({
        type: "set-health-checklist-items",
        businessDate: "2026-08-12",
        itemKeys: ["health-item-0001"],
        completed: true,
        expectedDayRevision: 1,
      }),
      expected: { businessDate: "2026-08-12", revision: 2 },
      createdAt: "2026-08-12T00:01:00.000Z",
    });
    const note = freezeSimpleSubmission({
      purpose: "personal-note",
      endpoint: "/api/v1/personal-notes",
      operation: "save-personal-daily-note",
      ownerId: "personal-note-0001",
      localRevision: 3,
      idempotencyKey: "personal-note-key-0001",
      body: JSON.stringify({
        type: "save-personal-daily-note",
        noteId: "personal-note-0001",
        businessDate: "2026-08-12",
        content: "今天的整体备注",
        expectedRevision: 0,
      }),
      expected: { noteId: "personal-note-0001", revision: 1 },
      createdAt: "2026-08-12T00:02:00.000Z",
    });

    expect(daily).toMatchObject({
      version: 1,
      status: "saving",
      body: dailyBody,
      idempotencyKey: "daily-sleep-key-0001",
      localRevision: 1,
      expected: { nested: { revision: 1 } },
    });
    expect(Object.isFrozen(daily)).toBe(true);
    expect(Object.isFrozen(daily.expected)).toBe(true);
    expect(health.ownerId).toBe("2026-08-12");
    expect(note.ownerId).toBe("personal-note-0001");
  });

  it("rejects mismatched allowlist records, malformed bodies, and non-exact frozen metadata", () => {
    const invalidInputs: FreezeSimpleSubmissionInput[] = [
      dailyInput({ endpoint: "/api/v1/personal-notes" }),
      dailyInput({ operation: "save-personal-daily-note" }),
      dailyInput({ ownerId: "another-sleep-record" }),
      dailyInput({ body: "not json" }),
      dailyInput({ body: "[]" }),
      dailyInput({ body: JSON.stringify({ type: "save-daily-sleep", recordId: "wrong" }) }),
      dailyInput({ body: JSON.stringify({ type: "another-operation", recordId: "sleep-record-0001" }) }),
      dailyInput({ localRevision: 0 }),
      dailyInput({ idempotencyKey: "short" }),
      dailyInput({ expected: { revision: Number.NaN } }),
    ];

    for (const input of invalidInputs) {
      expect(() => freezeSimpleSubmission(input)).toThrow(TypeError);
    }
  });

  it("uses purpose plus idempotency key and refuses different exact bytes at that key", () => {
    const storage = new MemoryStorage();
    const first = storeSimpleSubmission(storage, freezeDaily());
    expectStored(first);

    expect(first.outerKey).toContain(":daily-sleep:");
    expect(first.outerKey).toContain("daily-sleep-key-0001");
    expect(storage.getItem(first.outerKey)).toBe(first.outerRaw);
    expect(storeSimpleSubmission(storage, freezeDaily())).toEqual(first);

    const collision = storeSimpleSubmission(storage, freezeDaily({
      createdAt: "2026-08-12T00:00:01.000Z",
    }));
    expect(collision).toEqual({ kind: "conflict" });
    expect(storage.getItem(first.outerKey)).toBe(first.outerRaw);
  });

  it("recovers saving as uncertain without sending and clears only exact recovered bytes", () => {
    const storage = new MemoryStorage();
    const stored = storeSimpleSubmission(storage, freezeDaily());
    expectStored(stored);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const recovery = recoverSimpleSubmissions("daily-sleep", storage);
    expect(recovery.kind).toBe("recovered");
    if (recovery.kind !== "recovered") throw new Error("Expected recovery.");
    expect(recovery.submission.status).toBe("uncertain");
    expect(recovery.outerRaw).not.toBe(stored.outerRaw);
    expect(storage.getItem(recovery.outerKey)).toBe(recovery.outerRaw);
    expect(fetchSpy).not.toHaveBeenCalled();

    const changedRaw = recovery.outerRaw.replace(
      "2026-08-12T00:00:00.000Z",
      "2026-08-12T00:00:01.000Z",
    );
    storage.setItem(recovery.outerKey, changedRaw);
    expect(clearConfirmedSimpleSubmission(storage, recovery)).toEqual({
      kind: "locked",
      reason: "same-purpose-external-change",
    });
    expect(storage.getItem(recovery.outerKey)).toBe(changedRaw);

    storage.setItem(recovery.outerKey, recovery.outerRaw);
    expect(clearConfirmedSimpleSubmission(storage, recovery)).toEqual({ kind: "cleared" });
    expect(storage.getItem(recovery.outerKey)).toBeNull();
  });

  it("fails closed for corrupt, future-version, and foreign-purpose records", () => {
    const cases = [
      "not json",
      JSON.stringify({ ...freezeDaily(), version: 2 }),
      JSON.stringify({
        ...freezeDaily(),
        purpose: "personal-note",
        endpoint: "/api/v1/personal-notes",
        operation: "save-personal-daily-note",
      }),
    ];

    for (const raw of cases) {
      const storage = new MemoryStorage();
      const stored = storeSimpleSubmission(storage, freezeDaily());
      expectStored(stored);
      storage.setItem(stored.outerKey, raw);
      expect(recoverSimpleSubmissions("daily-sleep", storage)).toEqual({
        kind: "locked",
        reason: "same-purpose-external-change",
      });
    }

    const unrelated = new MemoryStorage();
    const note = freezeSimpleSubmission({
      purpose: "personal-note",
      endpoint: "/api/v1/personal-notes",
      operation: "save-personal-daily-note",
      ownerId: "personal-note-0001",
      localRevision: 1,
      idempotencyKey: "personal-note-key-0001",
      body: JSON.stringify({
        type: "save-personal-daily-note",
        noteId: "personal-note-0001",
      }),
      expected: { noteId: "personal-note-0001" },
      createdAt: "2026-08-12T00:00:00.000Z",
    });
    expectStored(storeSimpleSubmission(unrelated, note));
    expect(recoverSimpleSubmissions("daily-sleep", unrelated)).toEqual({ kind: "none" });
  });

  it("returns storage-unavailable for getter and Storage method exceptions", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: Object.create(null),
    });
    Object.defineProperty(globalThis.window, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("localStorage denied");
      },
    });
    expect(recoverSimpleSubmissions("daily-sleep")).toEqual({
      kind: "storage-unavailable",
    });

    const getFailure = new ThrowingStorage();
    getFailure.throwFrom = "getItem";
    expect(storeSimpleSubmission(getFailure, freezeDaily())).toEqual({
      kind: "storage-unavailable",
    });

    const setFailure = new ThrowingStorage();
    setFailure.throwFrom = "setItem";
    expect(storeSimpleSubmission(setFailure, freezeDaily())).toEqual({
      kind: "storage-unavailable",
    });

    const markFailure = new ThrowingStorage();
    const storedForMark = storeSimpleSubmission(markFailure, freezeDaily());
    expectStored(storedForMark);
    markFailure.throwFrom = "setItem";
    expect(markSimpleSubmissionUncertain(markFailure, storedForMark)).toEqual({
      kind: "storage-unavailable",
    });

    const removeFailure = new ThrowingStorage();
    const storedForRemove = storeSimpleSubmission(removeFailure, freezeDaily());
    expectStored(storedForRemove);
    const recovered = recoverSimpleSubmissions("daily-sleep", removeFailure);
    expect(recovered.kind).toBe("recovered");
    if (recovered.kind !== "recovered") throw new Error("Expected recovery.");
    removeFailure.throwFrom = "removeItem";
    expect(clearConfirmedSimpleSubmission(removeFailure, recovered)).toEqual({
      kind: "storage-unavailable",
    });
  });

  it("locks on storage clear or any external same-purpose change", () => {
    const active = {
      purpose: "daily-sleep" as const,
      outerKey: "life-pivot:accumulation:submission:v1:daily-sleep:daily-sleep-key-0001",
      outerRaw: "known exact bytes",
    };

    expect(reconcileSimpleSubmissionStorageChange(active, {
      key: null,
      newValue: null,
    } as StorageEvent)).toEqual({ kind: "locked", reason: "storage-cleared" });
    expect(reconcileSimpleSubmissionStorageChange(active, {
      key: "life-pivot:accumulation:submission:v1:daily-sleep:another-key-0001",
      newValue: "external bytes",
    } as StorageEvent)).toEqual({
      kind: "locked",
      reason: "same-purpose-external-change",
    });
    expect(reconcileSimpleSubmissionStorageChange(active, {
      key: active.outerKey,
      newValue: active.outerRaw,
    } as StorageEvent)).toEqual({ kind: "unchanged" });
    expect(reconcileSimpleSubmissionStorageChange(active, {
      key: "life-pivot:accumulation:submission:v1:personal-note:another-key-0001",
      newValue: "external bytes",
    } as StorageEvent)).toEqual({ kind: "ignored" });
  });
});
