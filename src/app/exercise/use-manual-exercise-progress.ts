"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  clearConfirmedSimpleSubmission,
  freezeSimpleSubmission,
  markSimpleSubmissionUncertain,
  reconcileSimpleSubmissionStorageChange,
  recoverSimpleSubmissions,
  storeSimpleSubmission,
  type StoredSimpleSubmission,
} from "@/app/accumulation/frozen-submission";
import {
  manualExerciseProgressDecisionSchema,
  type ManualExerciseProgressDecision,
  type ManualExerciseProgressDecisionCommand,
  type ManualExerciseProgressSnapshot,
  type ManualExerciseProgressTransition,
} from "@/modules/manual-exercise/progress-contracts";

export type ManualExerciseProgressStatus =
  | "idle"
  | "loading"
  | "saving"
  | "uncertain"
  | "reload-required"
  | "unavailable";

interface UseManualExerciseProgressOptions {
  readonly asOfDate: string;
  readonly initial?: ManualExerciseProgressSnapshot | null;
  readonly request?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readonly storage?: Storage | null;
  readonly createId?: () => string;
  readonly now?: () => Date;
}

export interface ManualExerciseProgressController {
  readonly snapshot: ManualExerciseProgressSnapshot | null;
  readonly status: ManualExerciseProgressStatus;
  readonly canWrite: boolean;
  readonly message: string | null;
  readonly decide: (
    transition: ManualExerciseProgressTransition,
    decision: ManualExerciseProgressDecision,
  ) => Promise<ManualExerciseProgressSnapshot | null>;
  readonly refresh: (templateId?: string) => Promise<ManualExerciseProgressSnapshot | null>;
  readonly retry: () => Promise<ManualExerciseProgressSnapshot | null>;
}

const ENDPOINT = "/api/v1/manual-exercise-progress" as const;
const PURPOSE_PREFIX = "life-pivot:accumulation:submission:v1:manual-exercise-progress:";

function defaultId(): string {
  return `progress-${crypto.randomUUID()}`;
}

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isChange(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.dayKey === "string"
    && typeof value.dayName === "string"
    && typeof value.actionKey === "string"
    && typeof value.actionName === "string"
    && ["sets", "reps", "weight"].includes(String(value.metric))
    && (value.before === null || typeof value.before === "string" || typeof value.before === "number")
    && (value.after === null || typeof value.after === "string" || typeof value.after === "number")
    && ["increase", "decrease", "changed", "incomparable"].includes(String(value.changeKind))
    && (value.delta === null || typeof value.delta === "number")
    && isNullableString(value.unit);
}

function isTransition(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.templateId === "string"
    && typeof value.fromVersionId === "string"
    && typeof value.toVersionId === "string"
    && Number.isSafeInteger(value.fromRevision)
    && Number.isSafeInteger(value.toRevision)
    && typeof value.effectiveFrom === "string"
    && ["scheduled", "effective"].includes(String(value.effectiveState))
    && typeof value.changeNote === "string"
    && typeof value.createdAt === "string"
    && ["pending", "tracked", "excluded"].includes(String(value.status))
    && (value.decision === null || value.decision === "tracked" || value.decision === "excluded")
    && (value.decisionRevision === null || Number.isSafeInteger(value.decisionRevision))
    && isNullableString(value.decisionUpdatedAt)
    && Array.isArray(value.changes)
    && value.changes.every(isChange);
}

function isActualFact(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.businessDate === "string"
    && typeof value.templateVersionId === "string"
    && typeof value.dayKey === "string"
    && typeof value.dayName === "string"
    && typeof value.actionKey === "string"
    && typeof value.actionName === "string"
    && Number.isSafeInteger(value.actualSets)
    && isNullableString(value.actualRepsText)
    && isNullableString(value.actualWeightText)
    && typeof value.completion === "boolean";
}

export function isManualExerciseProgressSnapshot(
  value: unknown,
): value is ManualExerciseProgressSnapshot {
  if (!isRecord(value)) return false;
  return typeof value.asOfDate === "string"
    && isNullableString(value.templateId)
    && Array.isArray(value.pending)
    && value.pending.every(isTransition)
    && Array.isArray(value.tracked)
    && value.tracked.every(isTransition)
    && Array.isArray(value.excluded)
    && value.excluded.every(isTransition)
    && Array.isArray(value.actualFacts)
    && value.actualFacts.every(isActualFact);
}

function parseStoredCommand(stored: StoredSimpleSubmission): ManualExerciseProgressDecisionCommand | null {
  try {
    const parsed = manualExerciseProgressDecisionSchema.safeParse(JSON.parse(stored.submission.body));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function strictlyConfirms(
  snapshot: ManualExerciseProgressSnapshot,
  command: ManualExerciseProgressDecisionCommand,
): boolean {
  const collection = command.decision === "tracked" ? snapshot.tracked : snapshot.excluded;
  return collection.some((transition) =>
    transition.templateId === command.templateId
      && transition.toVersionId === command.templateVersionId
      && transition.decision === command.decision
      && transition.decisionRevision === command.expectedDecisionRevision + 1,
  );
}

export function useManualExerciseProgress({
  asOfDate,
  initial = null,
  request = fetch,
  storage: providedStorage,
  createId = defaultId,
  now = () => new Date(),
}: UseManualExerciseProgressOptions): ManualExerciseProgressController {
  const [snapshot, setSnapshot] = useState<ManualExerciseProgressSnapshot | null>(() => (
    initial?.asOfDate === asOfDate ? initial : null
  ));
  const [status, setStatus] = useState<ManualExerciseProgressStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;
  const [storageState, setStorageState] = useState<{ ready: boolean; value: Storage | null }>(() => ({
    ready: providedStorage !== undefined,
    value: providedStorage ?? null,
  }));
  const activeRef = useRef<StoredSimpleSubmission | null>(null);
  const lockedRef = useRef(false);
  const refreshEpochRef = useRef(0);
  const storage = storageState.value;

  useEffect(() => {
    if (providedStorage !== undefined) {
      setStorageState({ ready: true, value: providedStorage });
      return;
    }
    setStorageState({ ready: true, value: browserStorage() });
  }, [providedStorage]);

  const lock = useCallback((next: "reload-required" | "unavailable", text: string) => {
    refreshEpochRef.current += 1;
    lockedRef.current = true;
    setStatus(next);
    setMessage(text);
  }, []);

  useEffect(() => {
    refreshEpochRef.current += 1;
    setSnapshot(initial?.asOfDate === asOfDate ? initial : null);
    if (!activeRef.current && !lockedRef.current) {
      setStatus("idle");
      setMessage(null);
    }
  }, [asOfDate, initial]);

  useEffect(() => {
    if (!storageState.ready) return;
    const recovery = recoverSimpleSubmissions("manual-exercise-progress", storage);
    if (recovery.kind === "recovered") {
      activeRef.current = recovery;
      setStatus("uncertain");
      setMessage("有一条进步决定的结果尚未确认，只能重试原提交。");
    } else if (recovery.kind === "none") {
      activeRef.current = null;
      lockedRef.current = false;
      setStatus("idle");
    } else {
      lock(
        recovery.kind === "storage-unavailable" ? "unavailable" : "reload-required",
        recovery.kind === "storage-unavailable"
          ? "本机安全提交存储不可用，暂时不能确认进步。"
          : "进步决定已在其他页面变化，请刷新后继续。",
      );
    }
  }, [lock, storage, storageState.ready]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (event: StorageEvent) => {
      const active = activeRef.current;
      if (active) {
        const result = reconcileSimpleSubmissionStorageChange(
          { purpose: "manual-exercise-progress", outerKey: active.outerKey, outerRaw: active.outerRaw },
          event,
        );
        if (result.kind === "locked") lock("reload-required", "进步决定已在其他页面变化，请刷新后继续。");
      } else if (event.key === null || event.key.startsWith(PURPOSE_PREFIX)) {
        lock("reload-required", "另一个页面修改了进步决定，请刷新后继续。");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [lock]);

  const refresh = useCallback(async (templateId?: string) => {
    if (statusRef.current === "saving" || activeRef.current || lockedRef.current) return null;
    const requestEpoch = ++refreshEpochRef.current;
    setStatus("loading");
    try {
      const searchParams = new URLSearchParams({ asOfDate });
      if (templateId) searchParams.set("templateId", templateId);
      const response = await request(`${ENDPOINT}?${searchParams.toString()}`);
      if (requestEpoch !== refreshEpochRef.current) return null;
      if (!response.ok) {
        setMessage(`进步数据读取失败（HTTP ${response.status}）。`);
        return null;
      }
      const decoded: unknown = await response.json();
      if (requestEpoch !== refreshEpochRef.current) return null;
      if (
        !isManualExerciseProgressSnapshot(decoded)
        || decoded.asOfDate !== asOfDate
        || decoded.templateId !== (templateId ?? null)
      ) {
        setMessage("进步数据响应无法验证，请刷新重试。");
        return null;
      }
      setSnapshot(decoded);
      setMessage(null);
      return decoded;
    } catch {
      if (requestEpoch === refreshEpochRef.current) {
        setMessage("进步数据暂时无法读取，模板和训练记录不受影响。");
      }
      return null;
    } finally {
      if (requestEpoch === refreshEpochRef.current && !lockedRef.current && !activeRef.current) {
        setStatus("idle");
      }
    }
  }, [asOfDate, request]);

  const send = useCallback(async (stored: StoredSimpleSubmission) => {
    if (lockedRef.current || activeRef.current?.outerRaw !== stored.outerRaw) return null;
    const command = parseStoredCommand(stored);
    if (!command) {
      lock("reload-required", "原进步决定无法验证，请刷新页面。");
      return null;
    }
    refreshEpochRef.current += 1;
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
      setMessage("进步决定的结果不确定，请重试原提交。");
      return null;
    }
    if (response.status === 409) {
      lock("reload-required", "这条进步决定已在其他页面更新，请刷新核对。");
      return null;
    }
    if (!response.ok) {
      setStatus("uncertain");
      setMessage(`进步决定提交失败（HTTP ${response.status}），请重试原提交。`);
      return null;
    }
    let decoded: unknown;
    try {
      decoded = await response.json();
    } catch {
      setStatus("uncertain");
      setMessage("成功响应无法验证，请重试原提交或刷新核对。");
      return null;
    }
    if (
      !isManualExerciseProgressSnapshot(decoded)
      || decoded.asOfDate !== command.asOfDate
      || !strictlyConfirms(decoded, command)
    ) {
      setStatus("uncertain");
      setMessage("成功响应与原进步决定不一致，请重试原提交或刷新核对。");
      return null;
    }
    if (!storage || clearConfirmedSimpleSubmission(storage, stored).kind !== "cleared") {
      lock("reload-required", "服务器已确认，但本机冻结记录未能安全清理，请刷新核对。");
      return null;
    }
    activeRef.current = null;
    setStatus("idle");
    if (command.asOfDate === asOfDate) {
      setSnapshot(decoded);
      setMessage(command.decision === "tracked" ? "已记录到进步可视化。" : "模板已保留，本次不计为进步。");
    } else {
      setMessage(`已确认 ${command.asOfDate} 的原进步决定；当前日期数据未被替换，请重新读取。`);
    }
    return decoded;
  }, [asOfDate, lock, request, storage]);

  const decide = useCallback(async (
    transition: ManualExerciseProgressTransition,
    decision: ManualExerciseProgressDecision,
  ) => {
    if (!storage || lockedRef.current || activeRef.current || status !== "idle") return null;
    const command: ManualExerciseProgressDecisionCommand = {
      type: "record-progress-decision",
      templateId: transition.templateId,
      templateVersionId: transition.toVersionId,
      asOfDate,
      decision,
      expectedDecisionRevision: transition.decisionRevision ?? 0,
    };
    const frozen = freezeSimpleSubmission({
      purpose: "manual-exercise-progress",
      endpoint: ENDPOINT,
      operation: command.type,
      ownerId: command.templateVersionId,
      localRevision: command.expectedDecisionRevision + 1,
      idempotencyKey: createId(),
      body: JSON.stringify(command),
      expected: {
        operation: command.type,
        templateId: command.templateId,
        templateVersionId: command.templateVersionId,
        asOfDate: command.asOfDate,
        decision: command.decision,
        decisionRevision: command.expectedDecisionRevision + 1,
      },
      createdAt: now().toISOString(),
    });
    const stored = storeSimpleSubmission(storage, frozen);
    if (stored.kind !== "stored") {
      lock(
        stored.kind === "storage-unavailable" ? "unavailable" : "reload-required",
        "无法在本机安全冻结进步决定，因此没有发送网络请求。",
      );
      return null;
    }
    const uncertain = markSimpleSubmissionUncertain(storage, stored);
    if (uncertain.kind !== "recovered") {
      lock("reload-required", "无法确认本机冻结状态，因此没有发送网络请求。");
      return null;
    }
    activeRef.current = uncertain;
    return send(uncertain);
  }, [asOfDate, createId, lock, now, send, status, storage]);

  const retry = useCallback(() => {
    const active = activeRef.current;
    if (!active || status === "saving" || status === "unavailable") return Promise.resolve(null);
    lockedRef.current = false;
    return send(active);
  }, [send, status]);

  return useMemo(() => ({
    snapshot,
    status,
    canWrite: storageState.ready && storage !== null && status === "idle" && !lockedRef.current && !activeRef.current,
    message,
    decide,
    refresh,
    retry,
  }), [decide, message, refresh, retry, snapshot, status, storage, storageState.ready]);
}
