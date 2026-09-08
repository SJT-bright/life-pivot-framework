"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  clearConfirmedSimpleSubmission,
  freezeSimpleSubmission,
  markSimpleSubmissionUncertain,
  reconcileSimpleSubmissionStorageChange,
  recoverSimpleSubmissions,
  storeSimpleSubmission,
  type SimpleExpectedValue,
  type StoredSimpleSubmission,
} from "@/app/accumulation/frozen-submission";
import {
  personalKnowledgeMutationResponseSchema,
  personalKnowledgeSnapshotResponseSchema,
  type PersonalKnowledgeAppliedMutation,
  type PersonalKnowledgeCommand,
  type PersonalKnowledgeSnapshot,
} from "@/modules/personal-knowledge/contracts";

export type PersonalKnowledgeSubmissionStatus =
  | "idle"
  | "saving"
  | "uncertain"
  | "reload-required"
  | "unavailable";

export interface UsePersonalKnowledgeSubmissionOptions {
  readonly request?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readonly storage?: Storage | null;
  readonly createId?: () => string;
  readonly now?: () => Date;
}

export interface PersonalKnowledgeSubmissionController {
  readonly status: PersonalKnowledgeSubmissionStatus;
  readonly canWrite: boolean;
  readonly submit: (
    command: PersonalKnowledgeCommand,
    businessDate: string,
  ) => Promise<PersonalKnowledgeSnapshot | null>;
  readonly retry: () => Promise<PersonalKnowledgeSnapshot | null>;
  readonly abandon: () => boolean;
}

interface ExpectedApplied {
  readonly operation: PersonalKnowledgeCommand["type"];
  readonly ownerId: string;
  readonly ownerRevision: number;
  readonly businessDate: string | null;
}

const SAME_PURPOSE_PREFIX = "life-pivot:accumulation:submission:v1:personal-knowledge:";

function defaultId(): string {
  return `personal-knowledge-${crypto.randomUUID()}`;
}

function resolveStorage(provided: Storage | null | undefined): Storage | null {
  if (provided !== undefined) return provided;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function expectedApplied(
  command: PersonalKnowledgeCommand,
  selectedBusinessDate: string,
): ExpectedApplied | null {
  let ownerId: string;
  let previousRevision: number;
  switch (command.type) {
    case "save-module":
    case "move-module":
    case "archive-module":
      ownerId = command.moduleId;
      previousRevision = command.expectedModuleRevision;
      break;
    case "save-daily-learning-note":
    case "archive-daily-learning-note":
      ownerId = command.noteId;
      previousRevision = command.expectedNoteRevision;
      break;
  }
  if (!Number.isSafeInteger(previousRevision) || previousRevision < 0 || previousRevision === Number.MAX_SAFE_INTEGER) {
    return null;
  }
  return {
    operation: command.type,
    ownerId,
    ownerRevision: previousRevision + 1,
    businessDate: command.type === "save-daily-learning-note"
      ? command.businessDate
      : command.type === "archive-daily-learning-note"
        ? selectedBusinessDate
        : null,
  };
}

function expectedFromStored(stored: StoredSimpleSubmission): ExpectedApplied | null {
  const expected = stored.submission.expected;
  if (
    expected.operation !== stored.submission.operation
    || typeof expected.operation !== "string"
    || expected.ownerId !== stored.submission.ownerId
    || typeof expected.ownerId !== "string"
    || expected.ownerRevision !== stored.submission.localRevision
    || !Number.isSafeInteger(expected.ownerRevision)
    || (expected.businessDate !== null && typeof expected.businessDate !== "string")
  ) return null;
  return expected as unknown as ExpectedApplied;
}

function matchesApplied(
  applied: PersonalKnowledgeAppliedMutation,
  expected: ExpectedApplied,
): boolean {
  return applied.operation === expected.operation
    && applied.ownerId === expected.ownerId
    && applied.ownerRevision === expected.ownerRevision
    && applied.businessDate === expected.businessDate;
}

export function usePersonalKnowledgeSubmission({
  request = fetch,
  storage: providedStorage,
  createId = defaultId,
  now = () => new Date(),
}: UsePersonalKnowledgeSubmissionOptions = {}): PersonalKnowledgeSubmissionController {
  const [storage, setStorage] = useState<Storage | null>(() => providedStorage ?? null);
  const [storageReady, setStorageReady] = useState(providedStorage !== undefined);
  useEffect(() => {
    if (providedStorage !== undefined) {
      setStorage(providedStorage);
      setStorageReady(true);
      return;
    }
    setStorage(resolveStorage(undefined));
    setStorageReady(true);
  }, [providedStorage]);
  const activeRef = useRef<StoredSimpleSubmission | null>(null);
  const lockedRef = useRef(false);
  const selectedDateRef = useRef<string | null>(null);
  const [status, setStatus] = useState<PersonalKnowledgeSubmissionStatus>("idle");

  const lock = useCallback((next: "reload-required" | "unavailable") => {
    lockedRef.current = true;
    setStatus(next);
  }, []);

  useEffect(() => {
    const recovery = recoverSimpleSubmissions("personal-knowledge", storage);
    if (!storageReady) return;
    if (recovery.kind === "recovered") {
      activeRef.current = recovery;
      setStatus("uncertain");
    } else if (recovery.kind === "none") {
      activeRef.current = null;
      lockedRef.current = false;
      setStatus("idle");
    } else {
      lock(recovery.kind === "storage-unavailable" ? "unavailable" : "reload-required");
    }
  }, [lock, storage, storageReady]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (event: StorageEvent) => {
      const active = activeRef.current;
      if (active) {
        const reconciled = reconcileSimpleSubmissionStorageChange(
          { purpose: "personal-knowledge", outerKey: active.outerKey, outerRaw: active.outerRaw },
          event,
        );
        if (reconciled.kind === "locked") lock("reload-required");
      } else if (event.key === null || event.key.startsWith(SAME_PURPOSE_PREFIX)) {
        lock("reload-required");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [lock]);

  const send = useCallback(async (
    stored: StoredSimpleSubmission,
  ): Promise<PersonalKnowledgeSnapshot | null> => {
    if (lockedRef.current || activeRef.current?.outerRaw !== stored.outerRaw) return null;
    const expected = expectedFromStored(stored);
    if (!expected) {
      lock("reload-required");
      return null;
    }
    setStatus("saving");
    let response: Response;
    try {
      response = await request(stored.submission.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": stored.submission.idempotencyKey,
        },
        body: stored.submission.body,
      });
    } catch {
      setStatus("uncertain");
      return null;
    }
    if (response.status === 409) {
      lock("reload-required");
      return null;
    }
    if (!response.ok) {
      setStatus("uncertain");
      return null;
    }
    let decoded: unknown;
    try {
      decoded = await response.json();
    } catch {
      setStatus("uncertain");
      return null;
    }
    const parsed = personalKnowledgeMutationResponseSchema.safeParse(decoded);
    if (!parsed.success || !matchesApplied(parsed.data.result.applied, expected)) {
      setStatus("uncertain");
      return null;
    }
    if (!storage) {
      lock("unavailable");
      return null;
    }
    const cleared = clearConfirmedSimpleSubmission(storage, stored);
    if (cleared.kind !== "cleared") {
      lock(cleared.kind === "storage-unavailable" ? "unavailable" : "reload-required");
      return null;
    }
    activeRef.current = null;
    lockedRef.current = false;
    const selectedDate = selectedDateRef.current ?? parsed.data.result.snapshot.businessDate;
    try {
      const refreshed = await request(`/api/v1/personal-knowledge?date=${encodeURIComponent(selectedDate)}`, {
        method: "GET",
        headers: { accept: "application/json" },
      });
      if (!refreshed.ok) throw new Error("refresh failed");
      const value = personalKnowledgeSnapshotResponseSchema.safeParse(await refreshed.json());
      if (!value.success) throw new Error("refresh malformed");
      setStatus("idle");
      return value.data.snapshot;
    } catch {
      lock("unavailable");
      return null;
    }
  }, [lock, request, storage]);

  const submit = useCallback(async (
    command: PersonalKnowledgeCommand,
    businessDate: string,
  ): Promise<PersonalKnowledgeSnapshot | null> => {
    if (!storage || lockedRef.current || activeRef.current || status !== "idle") return null;
    const expected = expectedApplied(command, businessDate);
    if (!expected) return null;
    selectedDateRef.current = businessDate;
    const expectedRecord: Readonly<Record<string, SimpleExpectedValue>> = { ...expected };
    let frozen;
    try {
      frozen = freezeSimpleSubmission({
        purpose: "personal-knowledge",
        endpoint: "/api/v1/personal-knowledge",
        operation: command.type,
        ownerId: expected.ownerId,
        localRevision: expected.ownerRevision,
        idempotencyKey: createId(),
        body: JSON.stringify(command),
        expected: expectedRecord,
        createdAt: now().toISOString(),
      });
    } catch {
      lock("reload-required");
      return null;
    }
    const stored = storeSimpleSubmission(storage, frozen);
    if (stored.kind === "storage-unavailable") {
      lock("unavailable");
      return null;
    }
    if (stored.kind !== "stored") {
      lock("reload-required");
      return null;
    }
    const uncertain = markSimpleSubmissionUncertain(storage, stored);
    if (uncertain.kind === "storage-unavailable") {
      lock("unavailable");
      return null;
    }
    if (uncertain.kind !== "recovered") {
      lock("reload-required");
      return null;
    }
    activeRef.current = uncertain;
    return send(uncertain);
  }, [createId, lock, now, send, status, storage]);

  const retry = useCallback(() => {
    const active = activeRef.current;
    if (!active || status === "saving" || status === "unavailable") return Promise.resolve(null);
    lockedRef.current = false;
    return send(active);
  }, [send, status]);

  const abandon = useCallback((): boolean => {
    const active = activeRef.current;
    if (!active || !storage) return false;
    const cleared = clearConfirmedSimpleSubmission(storage, active);
    if (cleared.kind !== "cleared") {
      lock(cleared.kind === "storage-unavailable" ? "unavailable" : "reload-required");
      return false;
    }
    activeRef.current = null;
    lockedRef.current = false;
    setStatus("idle");
    return true;
  }, [lock, storage]);

  return {
    status,
    canWrite: storageReady && status === "idle" && !lockedRef.current && !activeRef.current && storage !== null,
    submit,
    retry,
    abandon,
  };
}
