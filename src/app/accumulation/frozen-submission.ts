export type SimpleSubmissionPurpose =
  | "daily-sleep"
  | "health-checklist"
  | "personal-note"
  | "personal-knowledge"
  | "manual-exercise"
  | "manual-exercise-progress"
  | "manual-skincare"
  | "reading"
  | "daily-reading";
export type SimpleSubmissionEndpoint =
  | "/api/v1/daily-sleep"
  | "/api/v1/health-checklist"
  | "/api/v1/personal-notes"
  | "/api/v1/personal-knowledge"
  | "/api/v1/manual-exercise"
  | "/api/v1/manual-exercise-progress"
  | "/api/v1/manual-skincare"
  | "/api/v1/reading"
  | "/api/v1/daily-reading";
export type SimpleExpectedValue =
  | null | boolean | number | string | readonly SimpleExpectedValue[]
  | { readonly [key: string]: SimpleExpectedValue };
export interface SimpleFrozenSubmission {
  readonly version: 1; readonly purpose: SimpleSubmissionPurpose;
  readonly endpoint: SimpleSubmissionEndpoint; readonly operation: string;
  readonly ownerId: string; readonly localRevision: number;
  readonly idempotencyKey: string; readonly body: string;
  readonly expected: Readonly<Record<string, SimpleExpectedValue>>;
  readonly status: "saving" | "uncertain"; readonly createdAt: string;
}
export type FreezeSimpleSubmissionInput = Omit<SimpleFrozenSubmission, "version" | "status">;
export interface StoredSimpleSubmission {
  readonly submission: SimpleFrozenSubmission; readonly outerKey: string; readonly outerRaw: string;
}
export type SimpleStoreResult =
  | ({ kind: "stored" } & StoredSimpleSubmission) | { kind: "conflict" } | { kind: "storage-unavailable" };
export type SimpleRecovery =
  | { kind: "none" } | ({ kind: "recovered" } & StoredSimpleSubmission)
  | { kind: "locked"; reason: "same-purpose-external-change" | "storage-cleared" }
  | { kind: "storage-unavailable" };
export type SimpleStorageChange =
  | Extract<SimpleRecovery, { kind: "locked" }> | { kind: "ignored" } | { kind: "unchanged" };
const STORAGE_PREFIX = "life-pivot:accumulation:submission:v1:";
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/u;
const INPUT_FIELDS = ["purpose", "endpoint", "operation", "ownerId", "localRevision",
  "idempotencyKey", "body", "expected", "createdAt"] as const;
const STORED_FIELDS = ["version", "purpose", "endpoint", "operation", "ownerId",
  "localRevision", "idempotencyKey", "body", "expected", "status", "createdAt"] as const;
type OperationRule = { purpose: SimpleSubmissionPurpose; endpoint: SimpleSubmissionEndpoint;
  ownerField: "recordId" | "businessDate" | "noteId" | "templateId"
    | "productId" | "planId" | "cycleId" | "moduleId" | "knowledgeItemId"
    | "bookId" | "sessionId" | "templateVersionId" };
const OPERATION_RULES: Readonly<Record<string, OperationRule>> = {
  "save-daily-sleep": { purpose: "daily-sleep", endpoint: "/api/v1/daily-sleep", ownerField: "recordId" },
  "replace-health-checklist": { purpose: "health-checklist", endpoint: "/api/v1/health-checklist", ownerField: "businessDate" },
  "set-health-checklist-items": { purpose: "health-checklist", endpoint: "/api/v1/health-checklist", ownerField: "businessDate" },
  "save-health-checklist-note": { purpose: "health-checklist", endpoint: "/api/v1/health-checklist", ownerField: "businessDate" },
  "save-personal-daily-note": { purpose: "personal-note", endpoint: "/api/v1/personal-notes", ownerField: "noteId" },
  "save-module": { purpose: "personal-knowledge", endpoint: "/api/v1/personal-knowledge", ownerField: "moduleId" },
  "move-module": { purpose: "personal-knowledge", endpoint: "/api/v1/personal-knowledge", ownerField: "moduleId" },
  "archive-module": { purpose: "personal-knowledge", endpoint: "/api/v1/personal-knowledge", ownerField: "moduleId" },
  "save-daily-learning-note": { purpose: "personal-knowledge", endpoint: "/api/v1/personal-knowledge", ownerField: "noteId" },
  "archive-daily-learning-note": { purpose: "personal-knowledge", endpoint: "/api/v1/personal-knowledge", ownerField: "noteId" },
  "organize-knowledge-item": { purpose: "personal-knowledge", endpoint: "/api/v1/personal-knowledge", ownerField: "knowledgeItemId" },
  "replace-template": { purpose: "manual-exercise", endpoint: "/api/v1/manual-exercise", ownerField: "templateId" },
  "select-cycle-day": { purpose: "manual-exercise", endpoint: "/api/v1/manual-exercise", ownerField: "templateId" },
  "start-training": { purpose: "manual-exercise", endpoint: "/api/v1/manual-exercise", ownerField: "businessDate" },
  "pause-training": { purpose: "manual-exercise", endpoint: "/api/v1/manual-exercise", ownerField: "businessDate" },
  "resume-training": { purpose: "manual-exercise", endpoint: "/api/v1/manual-exercise", ownerField: "businessDate" },
  "save-training": { purpose: "manual-exercise", endpoint: "/api/v1/manual-exercise", ownerField: "businessDate" },
  "finish-and-advance": { purpose: "manual-exercise", endpoint: "/api/v1/manual-exercise", ownerField: "businessDate" },
  "skip-and-advance": { purpose: "manual-exercise", endpoint: "/api/v1/manual-exercise", ownerField: "businessDate" },
  "resolve-day": { purpose: "manual-exercise", endpoint: "/api/v1/manual-exercise", ownerField: "businessDate" },
  "reopen-day": { purpose: "manual-exercise", endpoint: "/api/v1/manual-exercise", ownerField: "businessDate" },
  "save-product": { purpose: "manual-skincare", endpoint: "/api/v1/manual-skincare", ownerField: "productId" },
  "replace-routine": { purpose: "manual-skincare", endpoint: "/api/v1/manual-skincare", ownerField: "businessDate" },
  "set-day-items-used": { purpose: "manual-skincare", endpoint: "/api/v1/manual-skincare", ownerField: "businessDate" },
  "save-day-note": { purpose: "manual-skincare", endpoint: "/api/v1/manual-skincare", ownerField: "businessDate" },
  "save-recovery-plan": { purpose: "manual-skincare", endpoint: "/api/v1/manual-skincare", ownerField: "planId" },
  "save-recovery-cycle": { purpose: "manual-skincare", endpoint: "/api/v1/manual-skincare", ownerField: "cycleId" },
  "start-recovery-cycle": { purpose: "manual-skincare", endpoint: "/api/v1/manual-skincare", ownerField: "cycleId" },
  "complete-recovery-cycle": { purpose: "manual-skincare", endpoint: "/api/v1/manual-skincare", ownerField: "cycleId" },
  "record-progress-decision": {
    purpose: "manual-exercise-progress",
    endpoint: "/api/v1/manual-exercise-progress",
    ownerField: "templateVersionId",
  },
  "save-book": { purpose: "reading", endpoint: "/api/v1/reading", ownerField: "bookId" },
  "archive-book": { purpose: "reading", endpoint: "/api/v1/reading", ownerField: "bookId" },
  "save-reading-note": { purpose: "reading", endpoint: "/api/v1/reading", ownerField: "noteId" },
  "archive-reading-note": { purpose: "reading", endpoint: "/api/v1/reading", ownerField: "noteId" },
  "save-reading-session": { purpose: "daily-reading", endpoint: "/api/v1/daily-reading", ownerField: "sessionId" },
  "archive-reading-session": { purpose: "daily-reading", endpoint: "/api/v1/daily-reading", ownerField: "sessionId" },
};
function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
function hasExactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => Object.hasOwn(value, field));
}
function isJsonValue(value: unknown, ancestors = new Set<object>()): value is SimpleExpectedValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? Object.keys(value).length === value.length && value.every((item) => isJsonValue(item, ancestors))
    : isRecord(value) && Reflect.ownKeys(value).length === Object.keys(value).length &&
      Object.values(value).every((item) => isJsonValue(item, ancestors));
  ancestors.delete(value);
  return valid;
}
function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
function cloneExpected(value: unknown): Readonly<Record<string, SimpleExpectedValue>> | null {
  if (!isRecord(value) || !isJsonValue(value)) return null;
  return deepFreeze(JSON.parse(JSON.stringify(value)) as Record<string, SimpleExpectedValue>);
}
function parseBody(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function isCanonicalTimestamp(value: string): boolean {
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}
function validateSubmission(value: unknown): SimpleFrozenSubmission | null {
  if (!isRecord(value) || !hasExactFields(value, STORED_FIELDS)) return null;
  const expected = cloneExpected(value.expected);
  const body = typeof value.body === "string" ? parseBody(value.body) : null;
  const rule = typeof value.operation === "string" ? OPERATION_RULES[value.operation] : undefined;
  if (
    value.version !== 1 || !rule || value.purpose !== rule.purpose || value.endpoint !== rule.endpoint ||
    typeof value.ownerId !== "string" || value.ownerId.length === 0 || value.ownerId.length > 128 ||
    !Number.isSafeInteger(value.localRevision) || Number(value.localRevision) < 1 ||
    typeof value.idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(value.idempotencyKey) ||
    !body || body.type !== value.operation || body[rule.ownerField] !== value.ownerId || !expected ||
    (value.status !== "saving" && value.status !== "uncertain") ||
    typeof value.createdAt !== "string" || !isCanonicalTimestamp(value.createdAt)
  ) return null;
  return deepFreeze({ ...value, expected } as unknown as SimpleFrozenSubmission);
}
function storageKey(submission: SimpleFrozenSubmission): string {
  return `${STORAGE_PREFIX}${submission.purpose}:${submission.idempotencyKey}`;
}
function parseRaw(raw: string): SimpleFrozenSubmission | null {
  try {
    return validateSubmission(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}
type ReadResult = { ok: true; value: string | null } | { ok: false };
function read(storage: Storage, key: string): ReadResult {
  try {
    return { ok: true, value: storage.getItem(key) };
  } catch {
    return { ok: false };
  }
}
function locked(): Extract<SimpleRecovery, { kind: "locked" }> {
  return { kind: "locked", reason: "same-purpose-external-change" };
}
function sameStoredEvidence(stored: StoredSimpleSubmission): SimpleFrozenSubmission | null {
  const parsed = parseRaw(stored.outerRaw);
  return parsed && storageKey(parsed) === stored.outerKey &&
    JSON.stringify(parsed) === JSON.stringify(stored.submission) ? parsed : null;
}
export function freezeSimpleSubmission(input: FreezeSimpleSubmissionInput): SimpleFrozenSubmission {
  if (!isRecord(input) || !hasExactFields(input, INPUT_FIELDS)) {
    throw new TypeError("Invalid simple frozen submission.");
  }
  const submission = validateSubmission({ ...input, version: 1, status: "saving" });
  if (!submission) throw new TypeError("Invalid simple frozen submission.");
  return submission;
}
export function storeSimpleSubmission(
  storage: Storage,
  submission: SimpleFrozenSubmission,
): SimpleStoreResult {
  const valid = validateSubmission(submission);
  if (!valid || valid.status !== "saving") return { kind: "conflict" };
  const outerKey = storageKey(valid);
  const outerRaw = JSON.stringify(valid);
  const current = read(storage, outerKey);
  if (!current.ok) return { kind: "storage-unavailable" };
  if (current.value !== null && current.value !== outerRaw) return { kind: "conflict" };
  try {
    storage.setItem(outerKey, outerRaw);
  } catch {
    return { kind: "storage-unavailable" };
  }
  const stored = read(storage, outerKey);
  if (!stored.ok) return { kind: "storage-unavailable" };
  if (stored.value !== outerRaw) return { kind: "conflict" };
  return { kind: "stored", submission: valid, outerKey, outerRaw };
}
export function markSimpleSubmissionUncertain(
  storage: Storage,
  stored: StoredSimpleSubmission,
): SimpleRecovery {
  const parsed = sameStoredEvidence(stored);
  if (!parsed) return locked();
  const current = read(storage, stored.outerKey);
  if (!current.ok) return { kind: "storage-unavailable" };
  if (current.value !== stored.outerRaw) return locked();
  if (parsed.status === "uncertain") return { kind: "recovered", ...stored };
  const submission = validateSubmission({ ...parsed, status: "uncertain" });
  if (!submission) return locked();
  const outerRaw = JSON.stringify(submission);
  const beforeWrite = read(storage, stored.outerKey);
  if (!beforeWrite.ok) return { kind: "storage-unavailable" };
  if (beforeWrite.value !== stored.outerRaw) return locked();
  try {
    storage.setItem(stored.outerKey, outerRaw);
  } catch {
    return { kind: "storage-unavailable" };
  }
  const updated = read(storage, stored.outerKey);
  if (!updated.ok) return { kind: "storage-unavailable" };
  return updated.value === outerRaw
    ? { kind: "recovered", submission, outerKey: stored.outerKey, outerRaw }
    : locked();
}
export function recoverSimpleSubmissions(
  purpose: SimpleSubmissionPurpose,
  providedStorage?: Storage | null,
): SimpleRecovery {
  let storage = providedStorage;
  if (storage === undefined) {
    try {
      storage = typeof window === "undefined" ? null : window.localStorage;
    } catch {
      return { kind: "storage-unavailable" };
    }
  }
  if (!storage) return { kind: "storage-unavailable" };
  const prefix = `${STORAGE_PREFIX}${purpose}:`;
  const keys: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
  } catch {
    return { kind: "storage-unavailable" };
  }
  if (keys.length === 0) return { kind: "none" };
  if (keys.length !== 1) return locked();
  const outerKey = keys[0]!;
  const current = read(storage, outerKey);
  if (!current.ok) return { kind: "storage-unavailable" };
  if (current.value === null) return locked();
  const submission = parseRaw(current.value);
  if (!submission || submission.purpose !== purpose || storageKey(submission) !== outerKey) return locked();
  return markSimpleSubmissionUncertain(storage, { submission, outerKey, outerRaw: current.value });
}
export function clearConfirmedSimpleSubmission(
  storage: Storage,
  confirmed: StoredSimpleSubmission,
): Extract<SimpleRecovery, { kind: "locked" | "storage-unavailable" }> | { kind: "cleared" } {
  const parsed = sameStoredEvidence(confirmed);
  if (!parsed || parsed.status !== "uncertain") return locked();
  const first = read(storage, confirmed.outerKey);
  if (!first.ok) return { kind: "storage-unavailable" };
  if (first.value !== confirmed.outerRaw) return locked();
  const second = read(storage, confirmed.outerKey);
  if (!second.ok) return { kind: "storage-unavailable" };
  if (second.value !== confirmed.outerRaw) return locked();
  try {
    storage.removeItem(confirmed.outerKey);
  } catch {
    return { kind: "storage-unavailable" };
  }
  const remaining = read(storage, confirmed.outerKey);
  if (!remaining.ok) return { kind: "storage-unavailable" };
  return remaining.value === null ? { kind: "cleared" } : locked();
}
export function reconcileSimpleSubmissionStorageChange(
  active: Pick<StoredSimpleSubmission, "outerKey" | "outerRaw"> & { purpose: SimpleSubmissionPurpose },
  change: Pick<StorageEvent, "key" | "newValue">,
): SimpleStorageChange {
  if (change.key === null) return { kind: "locked", reason: "storage-cleared" };
  if (!change.key.startsWith(`${STORAGE_PREFIX}${active.purpose}:`)) return { kind: "ignored" };
  if (change.key === active.outerKey && change.newValue === active.outerRaw) return { kind: "unchanged" };
  return locked();
}
