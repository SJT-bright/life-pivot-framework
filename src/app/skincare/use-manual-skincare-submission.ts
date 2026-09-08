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
import type {
  ManualSkincareAppliedMutation,
  ManualSkincareCommand,
  ManualSkincareMutationResult,
  ManualSkincareSnapshot,
} from "@/modules/manual-skincare/contracts";

export type ManualSkincareSubmissionStatus =
  | "idle"
  | "saving"
  | "uncertain"
  | "reload-required"
  | "unavailable";

export interface ManualSkincareSubmitOptions {
  /** Required only when a today-and-future routine command predicts a new activation. */
  readonly activationSequence?: number | null;
}

export interface UseManualSkincareSubmissionOptions {
  readonly request?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readonly storage?: Storage | null;
  readonly createId?: () => string;
  readonly now?: () => Date;
}

export interface ManualSkincareSubmissionController {
  readonly status: ManualSkincareSubmissionStatus;
  readonly canWrite: boolean;
  readonly submit: (
    command: ManualSkincareCommand,
    options?: ManualSkincareSubmitOptions,
  ) => Promise<ManualSkincareMutationResult | null>;
  readonly retry: () => Promise<ManualSkincareMutationResult | null>;
  readonly abandon: () => boolean;
}

interface ExpectedApplied {
  readonly operation: ManualSkincareCommand["type"];
  readonly ownerId: string;
  readonly ownerRevision: number;
  readonly businessDate: string | null;
  readonly activationSequence: number | null;
}

const SAME_PURPOSE_PREFIX = "life-pivot:accumulation:submission:v1:manual-skincare:";

function defaultId(): string {
  return `manual-skincare-${crypto.randomUUID()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isSnapshot(value: unknown): value is ManualSkincareSnapshot {
  if (!isRecord(value)) return false;
  const baseKeys = [
    "businessDate",
    "products",
    "latestRoutineRevision",
    "activationSequence",
    "selectedDay",
    "recoveryPlans",
    "history",
  ] as const;
  if (!hasExactKeys(value, baseKeys) && !hasExactKeys(value, [...baseKeys, "insights"])) {
    return false;
  }
  return typeof value.businessDate === "string"
    && Array.isArray(value.products)
    && Number.isSafeInteger(value.latestRoutineRevision)
    && Number.isSafeInteger(value.activationSequence)
    && (value.selectedDay === null || isRecord(value.selectedDay))
    && Array.isArray(value.recoveryPlans)
    && Array.isArray(value.history)
    && (!Object.hasOwn(value, "insights") || Array.isArray(value.insights));
}

function expectedApplied(
  command: ManualSkincareCommand,
  options: ManualSkincareSubmitOptions | undefined,
): ExpectedApplied {
  switch (command.type) {
    case "save-product":
      return {
        operation: command.type,
        ownerId: command.productId,
        ownerRevision: command.expectedProductRevision + 1,
        businessDate: null,
        activationSequence: null,
      };
    case "replace-routine": {
      const activationSequence = command.scope === "today-and-future"
        ? options?.activationSequence
        : null;
      if (command.scope === "today-and-future" && !Number.isSafeInteger(activationSequence)) {
        throw new TypeError("A predicted activation sequence is required.");
      }
      return {
        operation: command.type,
        ownerId: command.businessDate,
        ownerRevision: command.expectedDayRevision + 1,
        businessDate: command.businessDate,
        activationSequence: activationSequence ?? null,
      };
    }
    case "set-day-items-used":
    case "save-day-note":
      return {
        operation: command.type,
        ownerId: command.businessDate,
        ownerRevision: command.expectedDayRevision + 1,
        businessDate: command.businessDate,
        activationSequence: null,
      };
    case "save-recovery-plan":
      return {
        operation: command.type,
        ownerId: command.planId,
        ownerRevision: command.expectedPlanRevision + 1,
        businessDate: null,
        activationSequence: null,
      };
    case "save-recovery-cycle":
      return {
        operation: command.type,
        ownerId: command.cycleId,
        ownerRevision: command.expectedCycleRevision + 1,
        businessDate: null,
        activationSequence: null,
      };
    case "start-recovery-cycle":
      return {
        operation: command.type,
        ownerId: command.cycleId,
        ownerRevision: command.expectedCycleRevision + 1,
        businessDate: command.effectiveFrom,
        activationSequence: command.expectedActivationSequence + 1,
      };
    case "complete-recovery-cycle":
      return {
        operation: command.type,
        ownerId: command.cycleId,
        ownerRevision: command.expectedCycleRevision + 1,
        businessDate: command.completedOn,
        activationSequence: null,
      };
  }
}

function matchesApplied(value: unknown, expected: ExpectedApplied): value is ManualSkincareAppliedMutation {
  return isRecord(value)
    && hasExactKeys(value, [
      "operation",
      "ownerId",
      "ownerRevision",
      "businessDate",
      "activationSequence",
    ])
    && value.operation === expected.operation
    && value.ownerId === expected.ownerId
    && value.ownerRevision === expected.ownerRevision
    && value.businessDate === expected.businessDate
    && value.activationSequence === expected.activationSequence;
}

function parseExactResult(value: unknown, expected: ExpectedApplied): ManualSkincareMutationResult | null {
  if (!isRecord(value) || !hasExactKeys(value, ["result"])) return null;
  const result = value.result;
  if (!isRecord(result) || !hasExactKeys(result, ["snapshot", "applied"])) return null;
  if (!isSnapshot(result.snapshot) || !matchesApplied(result.applied, expected)) return null;
  return { snapshot: result.snapshot, applied: result.applied };
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
    || (expected.activationSequence !== null && !Number.isSafeInteger(expected.activationSequence))
  ) return null;
  return {
    operation: expected.operation as ManualSkincareCommand["type"],
    ownerId: expected.ownerId,
    ownerRevision: Number(expected.ownerRevision),
    businessDate: expected.businessDate as string | null,
    activationSequence: expected.activationSequence as number | null,
  };
}

export function useManualSkincareSubmission({
  request = fetch,
  storage: providedStorage,
  createId = defaultId,
  now = () => new Date(),
}: UseManualSkincareSubmissionOptions = {}): ManualSkincareSubmissionController {
  const { ready: storageReady, storage } = useResolvedSubmissionStorage(providedStorage);
  const activeRef = useRef<StoredSimpleSubmission | null>(null);
  const lockedRef = useRef(false);
  const [status, setStatus] = useState<ManualSkincareSubmissionStatus>("idle");
  const [recoveryReady, setRecoveryReady] = useState(false);

  const setLocked = useCallback((next: "reload-required" | "unavailable") => {
    lockedRef.current = true;
    setStatus(next);
  }, []);

  useEffect(() => {
    if (!storageReady) {
      setRecoveryReady(false);
      return;
    }
    const recovery = recoverSimpleSubmissions("manual-skincare", storage);
    if (recovery.kind === "recovered") {
      activeRef.current = recovery;
      setStatus("uncertain");
      setRecoveryReady(true);
      return;
    }
    if (recovery.kind === "none") {
      activeRef.current = null;
      lockedRef.current = false;
      setStatus("idle");
      setRecoveryReady(true);
      return;
    }
    setLocked(recovery.kind === "storage-unavailable" ? "unavailable" : "reload-required");
    setRecoveryReady(true);
  }, [setLocked, storage, storageReady]);

  useEffect(() => {
    if (typeof window === "undefined" || !storageReady) return;
    const onStorage = (event: StorageEvent) => {
      const active = activeRef.current;
      if (active) {
        const result = reconcileSimpleSubmissionStorageChange(
          { purpose: "manual-skincare", outerKey: active.outerKey, outerRaw: active.outerRaw },
          event,
        );
        if (result.kind === "locked") setLocked("reload-required");
        return;
      }
      if (event.key === null || event.key.startsWith(SAME_PURPOSE_PREFIX)) {
        setLocked("reload-required");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [setLocked, storageReady]);

  const send = useCallback(async (
    stored: StoredSimpleSubmission,
  ): Promise<ManualSkincareMutationResult | null> => {
    if (lockedRef.current || activeRef.current?.outerRaw !== stored.outerRaw) return null;
    const expected = expectedFromStored(stored);
    if (!expected) {
      setLocked("reload-required");
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
      setLocked("reload-required");
      return null;
    }
    if (!response.ok) {
      setStatus("uncertain");
      return null;
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      setStatus("uncertain");
      return null;
    }
    const confirmed = parseExactResult(value, expected);
    if (!confirmed) {
      setStatus("uncertain");
      return null;
    }
    if (!storage) {
      setLocked("unavailable");
      return null;
    }
    const cleared = clearConfirmedSimpleSubmission(storage, stored);
    if (cleared.kind !== "cleared") {
      setLocked(cleared.kind === "storage-unavailable" ? "unavailable" : "reload-required");
      return null;
    }
    activeRef.current = null;
    lockedRef.current = false;
    setStatus("idle");
    return confirmed;
  }, [request, setLocked, storage]);

  const submit = useCallback(async (
    command: ManualSkincareCommand,
    options?: ManualSkincareSubmitOptions,
  ): Promise<ManualSkincareMutationResult | null> => {
    if (!storage || lockedRef.current || activeRef.current !== null || status !== "idle") return null;
    let expected: ExpectedApplied;
    try {
      expected = expectedApplied(command, options);
    } catch {
      return null;
    }
    const expectedRecord: Readonly<Record<string, SimpleExpectedValue>> = {
      operation: expected.operation,
      ownerId: expected.ownerId,
      ownerRevision: expected.ownerRevision,
      businessDate: expected.businessDate,
      activationSequence: expected.activationSequence,
    };
    let frozen;
    try {
      frozen = freezeSimpleSubmission({
        purpose: "manual-skincare",
        endpoint: "/api/v1/manual-skincare",
        operation: command.type,
        ownerId: expected.ownerId,
        localRevision: expected.ownerRevision,
        idempotencyKey: createId(),
        body: JSON.stringify(command),
        expected: expectedRecord,
        createdAt: now().toISOString(),
      });
    } catch {
      setLocked("reload-required");
      return null;
    }
    const stored = storeSimpleSubmission(storage, frozen);
    if (stored.kind === "storage-unavailable") {
      setLocked("unavailable");
      return null;
    }
    if (stored.kind !== "stored") {
      setLocked("reload-required");
      return null;
    }
    const uncertain = markSimpleSubmissionUncertain(storage, stored);
    if (uncertain.kind === "storage-unavailable") {
      setLocked("unavailable");
      return null;
    }
    if (uncertain.kind !== "recovered") {
      setLocked("reload-required");
      return null;
    }
    activeRef.current = uncertain;
    return send(uncertain);
  }, [createId, now, send, setLocked, status, storage]);

  const retry = useCallback(async (): Promise<ManualSkincareMutationResult | null> => {
    const active = activeRef.current;
    if (!active || status === "saving" || status === "unavailable") return null;
    lockedRef.current = false;
    return send(active);
  }, [send, status]);

  const abandon = useCallback((): boolean => {
    const active = activeRef.current;
    if (!active || !storage) return false;
    const cleared = clearConfirmedSimpleSubmission(storage, active);
    if (cleared.kind !== "cleared") {
      setLocked(cleared.kind === "storage-unavailable" ? "unavailable" : "reload-required");
      return false;
    }
    activeRef.current = null;
    lockedRef.current = false;
    setStatus("idle");
    return true;
  }, [setLocked, storage]);

  return {
    status,
    canWrite: recoveryReady
      && status === "idle"
      && !lockedRef.current
      && activeRef.current === null
      && storage !== null,
    submit,
    retry,
    abandon,
  };
}
