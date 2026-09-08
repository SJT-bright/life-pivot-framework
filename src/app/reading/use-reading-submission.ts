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
import { useResolvedSubmissionStorage } from "@/app/accumulation/use-resolved-submission-storage";
import {
  readingMutationResponseSchema,
  readingSnapshotResponseSchema,
  type ReadingAppliedMutation,
  type ReadingCommand,
  type ReadingSnapshot,
} from "@/modules/reading/contracts";

export type ReadingSubmissionStatus =
  | "idle"
  | "saving"
  | "uncertain"
  | "reload-required"
  | "unavailable";

export interface UseReadingSubmissionOptions {
  readonly request?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readonly storage?: Storage | null;
  readonly createId?: () => string;
  readonly now?: () => Date;
}

export interface ReadingSubmissionController {
  readonly status: ReadingSubmissionStatus;
  readonly canWrite: boolean;
  readonly submit: (
    command: ReadingCommand,
  ) => Promise<ReadingSnapshot | null>;
  readonly retry: () => Promise<ReadingSnapshot | null>;
  readonly abandon: () => boolean;
}

interface ExpectedApplied {
  readonly operation: ReadingCommand["type"];
  readonly ownerId: string;
  readonly ownerRevision: number;
}

const SAME_PURPOSE_PREFIX = "life-pivot:accumulation:submission:v1:reading:";

function defaultId(): string {
  return `reading-${crypto.randomUUID()}`;
}

function expectedApplied(command: ReadingCommand): ExpectedApplied | null {
  let ownerId: string;
  let previousRevision: number;
  switch (command.type) {
    case "save-book":
    case "archive-book":
      ownerId = command.bookId;
      previousRevision = command.expectedRevision;
      break;
    case "save-reading-note":
    case "archive-reading-note":
      ownerId = command.noteId;
      previousRevision = command.expectedRevision;
      break;
  }
  if (!Number.isSafeInteger(previousRevision) || previousRevision < 0 || previousRevision === Number.MAX_SAFE_INTEGER) {
    return null;
  }
  return {
    operation: command.type,
    ownerId,
    ownerRevision: previousRevision + 1,
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
  ) return null;
  return expected as unknown as ExpectedApplied;
}

function matchesApplied(
  applied: ReadingAppliedMutation,
  expected: ExpectedApplied,
): boolean {
  return applied.operation === expected.operation
    && applied.ownerId === expected.ownerId
    && applied.ownerRevision === expected.ownerRevision;
}

export function useReadingSubmission({
  request = fetch,
  storage: providedStorage,
  createId = defaultId,
  now = () => new Date(),
}: UseReadingSubmissionOptions = {}): ReadingSubmissionController {
  const { ready: storageReady, storage } = useResolvedSubmissionStorage(providedStorage);
  const activeRef = useRef<StoredSimpleSubmission | null>(null);
  const lockedRef = useRef(false);
  const [status, setStatus] = useState<ReadingSubmissionStatus>("idle");
  const [recoveryReady, setRecoveryReady] = useState(false);

  const lock = useCallback((next: "reload-required" | "unavailable") => {
    lockedRef.current = true;
    setStatus(next);
  }, []);

  useEffect(() => {
    if (!storageReady) {
      setRecoveryReady(false);
      return;
    }
    const recovery = recoverSimpleSubmissions("reading", storage);
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
    setRecoveryReady(true);
  }, [lock, storage, storageReady]);

  useEffect(() => {
    if (typeof window === "undefined" || !storageReady) return;
    const onStorage = (event: StorageEvent) => {
      const active = activeRef.current;
      if (active) {
        const reconciled = reconcileSimpleSubmissionStorageChange(
          { purpose: "reading", outerKey: active.outerKey, outerRaw: active.outerRaw },
          event,
        );
        if (reconciled.kind === "locked") lock("reload-required");
      } else if (event.key === null || event.key.startsWith(SAME_PURPOSE_PREFIX)) {
        lock("reload-required");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [lock, storageReady]);

  const send = useCallback(async (
    stored: StoredSimpleSubmission,
  ): Promise<ReadingSnapshot | null> => {
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
    const parsed = readingMutationResponseSchema.safeParse(decoded);
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
    setStatus("idle");
    return parsed.data.result.snapshot;
  }, [lock, request, storage]);

  const submit = useCallback(async (
    command: ReadingCommand,
  ): Promise<ReadingSnapshot | null> => {
    if (!storage || lockedRef.current || activeRef.current || status !== "idle") return null;
    const expected = expectedApplied(command);
    if (!expected) return null;
    const expectedRecord: Readonly<Record<string, SimpleExpectedValue>> = { ...expected };
    let frozen;
    try {
      frozen = freezeSimpleSubmission({
        purpose: "reading",
        endpoint: "/api/v1/reading",
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
    canWrite: recoveryReady
      && status === "idle"
      && !lockedRef.current
      && !activeRef.current
      && storage !== null,
    submit,
    retry,
    abandon,
  };
}
