"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toShanghaiBusinessDate } from "@/core/time/business-date";

import {
  clearConfirmedSimpleSubmission,
  freezeSimpleSubmission,
  markSimpleSubmissionUncertain,
  reconcileSimpleSubmissionStorageChange,
  recoverSimpleSubmissions,
  storeSimpleSubmission,
  type StoredSimpleSubmission,
} from "@/app/accumulation/frozen-submission";
import type {
  ManualExerciseActualActionDto,
  ManualExerciseCommand,
  ManualExerciseStatus,
  ManualExerciseTemplateDayDto,
} from "@/modules/manual-exercise/contracts";
import type { ManualExerciseProgressTransition } from "@/modules/manual-exercise/progress-contracts";
import type {
  ManualExerciseDaySnapshot,
  ManualExerciseSnapshot,
  ManualExerciseTemplateSnapshot,
} from "@/modules/manual-exercise/service";

import { deriveManualExerciseElapsed } from "./exercise-timer";
import { TrainingDateNav, shiftTrainingDate } from "./training-date-nav";
import styles from "./manual-exercise.module.css";

import {
  ProgressChangeCard,
  toProgressTransitionDisplay,
} from "./progress-change-card";
import { useManualExerciseProgress } from "./use-manual-exercise-progress";
export type ManualExerciseView = "today" | "template" | "history" | "updates";
type TriState = "unknown" | "yes" | "no";

export interface ManualExerciseHistoryPagination {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

interface ManualExerciseWorkspaceProps {
  readonly businessDate?: string;
  readonly today?: string;
  readonly initial: ManualExerciseSnapshot | null;
  readonly request?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readonly initialView?: ManualExerciseView;
  readonly showViewTabs?: boolean;
  readonly enableProgressPrompts?: boolean;
  readonly historyPagination?: ManualExerciseHistoryPagination;
  readonly storage?: Storage;
  readonly createId?: () => string;
  readonly now?: () => Date;
}

interface ActionDraft {
  actionKey: string;
  actualSets: string;
  actualRepsText: string;
  actualWeightText: string;
  actualText: string;
  completion: boolean;
  note: string;
}

interface TemplateActionDraft {
  actionKey: string;
  name: string;
  plannedSets: string;
  plannedRepsText: string;
  plannedWeightText: string;
  targetText: string;
  note: string;
}

interface TemplateDayDraft {
  dayKey: string;
  name: string;
  bodyPart: string;
  isRest: boolean;
  note: string;
  actions: TemplateActionDraft[];
}

const tabs: Array<{ id: ManualExerciseView; label: string }> = [
  { id: "today", label: "今日训练" },
  { id: "template", label: "训练日模板" },
  { id: "history", label: "训练历史" },
  { id: "updates", label: "模板更新记录" },
];

const statusLabels: Record<ManualExerciseStatus, string> = {
  "not-started": "未开始",
  "in-progress": "进行中",
  partial: "部分完成",
  completed: "已完成",
  skipped: "已跳过",
};

function recordStatus(entry: {status: ManualExerciseStatus; resolution?: {outcome: string} | null}) {
  if (entry.resolution?.outcome === "rest") return "休息";
  if (entry.resolution?.outcome === "unrecorded") return "练过 · 数据待补";
  return statusLabels[entry.status];
}

function defaultId(): string {
  return `manual-${crypto.randomUUID()}`;
}

function systemNow(): Date { return new Date(); }

function resolveStorage(provided: Storage | undefined): Storage | undefined {
  if (provided) return provided;
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function text(value: string | null): string {
  return value ?? "";
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function triState(value: boolean | null): TriState {
  return value === null ? "unknown" : value ? "yes" : "no";
}

function nullableBoolean(value: TriState): boolean | null {
  return value === "unknown" ? null : value === "yes";
}

// 动作的实际数字自动按「上次实际 → 计划」预填，打勾即完成；有提升只改一两个数字。
function prefillSets(action: ManualExerciseDaySnapshot["actions"][number]): string {
  if (action.actual.sets > 0) return String(action.actual.sets);
  const reference = action.previousActualReference;
  if (reference && reference.sets > 0) return String(reference.sets);
  return action.planned.sets > 0 ? String(action.planned.sets) : "";
}

function prefillText(actual: string, reference: string | null, planned: string | null): string {
  if (actual.trim().length > 0) return actual;
  return reference ?? planned ?? "";
}

// 重量单位统一为千克：输入只填数字，"kg" 由界面固定显示；保存时纯数字自动补 "kg"。
function displayWeight(weightText: string): string {
  return weightText.replace(/(\d+(?:\.\d+)?)\s*kg\b/giu, "$1").trim();
}

function normalizeWeightText(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return /^\d+(?:\.\d+)?$/.test(trimmed) ? `${trimmed}kg` : trimmed;
}

/** 计划里没写负重的动作是自重动作：重量一栏不该出现任何数字。 */
function isBodyweightAction(action: ManualExerciseDaySnapshot["actions"][number]): boolean {
  return (action.planned.weightText ?? "").trim().length === 0;
}

function prefillWeight(action: ManualExerciseDaySnapshot["actions"][number]): string {
  if (isBodyweightAction(action)) return "";
  return prefillText("", action.previousActualReference?.weightText ?? null, action.planned.weightText);
}

function actionDrafts(day: ManualExerciseDaySnapshot | null): ActionDraft[] {
  return (day?.actions ?? []).map((action) => ({
    actionKey: action.actionKey,
    actualSets: action.actual.sets > 0 || action.actual.completion ? String(action.actual.sets) : "",
    actualRepsText: text(action.actual.repsText),
    actualWeightText: isBodyweightAction(action) ? "" : displayWeight(text(action.actual.weightText)),
    actualText: text(action.actual.text),
    completion: action.actual.completion,
    note: text(action.actual.note),
  }));
}

function templateDrafts(template: ManualExerciseTemplateSnapshot | null): TemplateDayDraft[] {
  return (template?.days ?? []).map((day) => ({
    dayKey: day.dayKey,
    name: day.name,
    bodyPart: text(day.bodyPart),
    isRest: day.isRest,
    note: text(day.note),
    actions: day.actions.map((action) => ({
      actionKey: action.actionKey,
      name: action.name,
      plannedSets: String(action.plannedSets),
      plannedRepsText: text(action.plannedRepsText),
      plannedWeightText: displayWeight(text(action.plannedWeightText)),
      targetText: text(action.targetText),
      note: text(action.note),
    })),
  }));
}

function safeSets(value: string): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function formatElapsed(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return [hours, minutes, remaining].map((part) => String(part).padStart(2, "0")).join(":");
}

function isSnapshot(value: unknown): value is ManualExerciseSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.businessDate === "string"
    && Array.isArray(record.history)
    && Array.isArray(record.templateHistory)
    && (record.selectedDay === null || typeof record.selectedDay === "object")
    && (record.template === null || typeof record.template === "object")
    && (record.cycle === null || typeof record.cycle === "object");
}

function parseCommand(body: string): ManualExerciseCommand | null {
  try {
    return JSON.parse(body) as ManualExerciseCommand;
  } catch {
    return null;
  }
}

function exactActuals(
  day: ManualExerciseDaySnapshot,
  command: Extract<ManualExerciseCommand, { type: "save-training" }>,
): boolean {
  return command.actions.every((expected) => {
    const actual = day.actions.find((candidate) => candidate.actionKey === expected.actionKey)?.actual;
    return actual !== undefined
      && actual.sets === expected.actualSets
      && actual.repsText === expected.actualRepsText
      && actual.weightText === expected.actualWeightText
      && actual.text === expected.actualText
      && actual.completion === expected.completion
      && actual.note === expected.note;
  });
}

function strictlyConfirms(
  value: unknown,
  command: ManualExerciseCommand,
): value is ManualExerciseSnapshot {
  if (!isSnapshot(value)) return false;
  if (command.type === "replace-template") {
    return value.template?.id === command.templateId
      && value.template.revision > command.expectedTemplateRevision
      && value.template.name === command.name
      && value.template.days.length === command.days.length;
  }
  if (command.type === "select-cycle-day") {
    return value.businessDate === command.businessDate
      && value.cycle?.currentDayKey === command.dayKey
      && value.cycle.revision > command.expectedCycleRevision;
  }
  const day = value.selectedDay;
  if (value.businessDate !== command.businessDate || !day) return false;
  if (command.type === "start-training") {
    return day.revision > command.expectedDailyRevision && day.timer.startedAt !== null;
  }
  if (command.type === "pause-training") {
    return day.revision > command.expectedDailyRevision && day.timer.pausedAt !== null;
  }
  if (command.type === "resume-training") {
    return day.revision > command.expectedDailyRevision
      && day.timer.startedAt !== null
      && day.timer.pausedAt === null;
  }
  if (command.type === "save-training") {
    return day.revision > command.expectedDailyRevision
      && day.supplements.creatineTaken === command.creatineTaken
      && day.supplements.proteinPowderTaken === command.proteinPowderTaken
      && exactActuals(day, command);
  }
  if (command.type === "resolve-day") {
    return day.revision > command.expectedDailyRevision
      && day.resolution?.outcome === command.outcome
      && day.resolution.note === command.note;
  }
  if (command.type === "reopen-day") {
    return day.revision > command.expectedDailyRevision && !day.resolution
      && day.status !== "skipped";
  }
  if (command.type === "finish-and-advance") {
    return day.status === "completed"
      && day.revision > command.expectedDailyRevision;
  }
  return day.status === "skipped"
    && day.revision > command.expectedDailyRevision;
}

function toActualActions(drafts: ActionDraft[]): ManualExerciseActualActionDto[] {
  return drafts.map((draft) => ({
    actionKey: draft.actionKey,
    actualSets: safeSets(draft.actualSets),
    actualRepsText: nullable(draft.actualRepsText),
    actualWeightText: normalizeWeightText(draft.actualWeightText),
    actualText: nullable(draft.actualText),
    completion: draft.completion,
    note: nullable(draft.note),
  }));
}

function toTemplateDays(drafts: TemplateDayDraft[]): ManualExerciseTemplateDayDto[] {
  return drafts.map((day) => ({
    dayKey: day.dayKey,
    name: day.name.trim(),
    bodyPart: nullable(day.bodyPart),
    isRest: day.isRest,
    note: nullable(day.note),
    actions: day.actions.map((action) => ({
      actionKey: action.actionKey,
      name: action.name.trim(),
      plannedSets: safeSets(action.plannedSets),
      plannedRepsText: nullable(action.plannedRepsText),
      plannedWeightText: normalizeWeightText(action.plannedWeightText),
      targetText: nullable(action.targetText),
      note: nullable(action.note),
    })),
  }));
}

export function ManualExerciseWorkspace({
  businessDate,
  today: providedToday,
  initial,
  request = fetch,
  storage: providedStorage,
  createId = defaultId,
  initialView = "today",
  showViewTabs = true,
  enableProgressPrompts = false,
  historyPagination,
  now = systemNow,
}: ManualExerciseWorkspaceProps) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initial);
  const [tab, setTab] = useState<ManualExerciseView>(initialView);
  const [actions, setActions] = useState(() => actionDrafts(initial?.selectedDay ?? null));
  const [creatine, setCreatine] = useState<TriState>(() => triState(initial?.selectedDay?.supplements.creatineTaken ?? null));
  const [protein, setProtein] = useState<TriState>(() => triState(initial?.selectedDay?.supplements.proteinPowderTaken ?? null));
  const [confirmedMinutes, setConfirmedMinutes] = useState(() => initial?.selectedDay?.timer.confirmedDurationMinutes?.toString() ?? "");
  const [templateName, setTemplateName] = useState(initial?.template?.name ?? "");
  const [templateDays, setTemplateDays] = useState(() => templateDrafts(initial?.template ?? null));
  const [effectiveFrom, setEffectiveFrom] = useState(initial?.businessDate ?? "");
  const [changeNote, setChangeNote] = useState("");
  const [resolution, setResolution] = useState<"rest" | "skipped" | "unrecorded" | null>(null);
  const [skipNote, setSkipNote] = useState("");
  const [advancePlan, setAdvancePlan] = useState(false);
  const [dayNote, setDayNote] = useState(initial?.selectedDay?.note ?? "");
  const [draftScope, setDraftScope] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState("");
  const navigating = useRef(false);
  // 灵活切换：顺序只是默认值，受伤等情况可以主动把今天切到别的训练日。
  const [switchDayKey, setSwitchDayKey] = useState(snapshot?.cycle?.currentDayKey ?? "");
  const [switchNote, setSwitchNote] = useState("");
  const [switchOpen, setSwitchOpen] = useState(false);
  const [active, setActive] = useState<StoredSimpleSubmission | null>(null);
  const [lockedExternally, setLockedExternally] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deferredProgress, setDeferredProgress] = useState<ReadonlySet<string>>(() => new Set());
  const progressAsOfDate = businessDate ?? snapshot?.businessDate ?? "";
  const progress = useManualExerciseProgress({
    asOfDate: progressAsOfDate,
    request, storage: providedStorage, createId, now,
  });
  const [message, setMessage] = useState<string | null>(null);
  const [clock, setClock] = useState(now);
  const storage = resolveStorage(providedStorage);
  const [today, setToday] = useState(() => providedToday ?? toShanghaiBusinessDate(now()));
  const recordScope = snapshot?.selectedDay
    ? `life-pivot:training-draft:v1:${snapshot.businessDate}:${snapshot.selectedDay.dayKey}:${snapshot.selectedDay.revision}`
    : null;

  useEffect(() => {
    const updateToday = () => setToday(toShanghaiBusinessDate(now()));
    const interval = window.setInterval(updateToday, 60_000);
    window.addEventListener("focus", updateToday);
    return () => { window.clearInterval(interval); window.removeEventListener("focus", updateToday); };
  }, [now]);

  useEffect(() => {
    if (!initial) return;
    setSnapshot(initial);
    navigating.current = false;
    setResolution(null);
    setSkipNote("");
  }, [initial]);

  useEffect(() => {
    const day = snapshot?.selectedDay ?? null;
    setActions(actionDrafts(day));
    setCreatine(triState(day?.supplements.creatineTaken ?? null));
    setProtein(triState(day?.supplements.proteinPowderTaken ?? null));
    setConfirmedMinutes(day?.timer.confirmedDurationMinutes?.toString() ?? "");
    setDayNote(day?.note ?? "");
    setResolution(null);
    setSkipNote("");
    setDraftStatus("");
    if (recordScope && storage) {
      try {
        const draft = JSON.parse(storage.getItem(recordScope) ?? "null");
        if (draft && Array.isArray(draft.actions) && draft.actions.length === day?.actions.length
          && draft.actions.every((item: ActionDraft, index: number) => item.actionKey === day?.actions[index]?.actionKey
            && typeof item.actualSets === "string" && typeof item.actualRepsText === "string"
            && typeof item.actualWeightText === "string" && typeof item.actualText === "string"
            && typeof item.note === "string" && typeof item.completion === "boolean")) {
          setActions(draft.actions);
          if (["unknown", "yes", "no"].includes(draft.creatine)) setCreatine(draft.creatine);
          if (["unknown", "yes", "no"].includes(draft.protein)) setProtein(draft.protein);
          if (typeof draft.confirmedMinutes === "string") setConfirmedMinutes(draft.confirmedMinutes);
          if (typeof draft.dayNote === "string") setDayNote(draft.dayNote);
          if (day?.status !== "completed" && day?.status !== "skipped"
            && ["rest", "skipped", "unrecorded"].includes(draft.resolution)) setResolution(draft.resolution);
          if (typeof draft.skipNote === "string") setSkipNote(draft.skipNote);
          setAdvancePlan(draft.advancePlan === true);
          setDraftStatus("已恢复这一天的草稿");
        }
      } catch { setDraftStatus("草稿暂存不可用，请保存后再切换日期"); }
    }
    setDraftScope(recordScope);
  }, [recordScope, snapshot?.selectedDay, storage]);

  useEffect(() => {
    if (!recordScope || draftScope !== recordScope || !storage || navigating.current) return;
    try {
      storage.setItem(recordScope, JSON.stringify({ actions, creatine, protein, confirmedMinutes, dayNote, resolution, skipNote, advancePlan }));
    } catch { setDraftStatus("草稿暂存不可用，请保存后再切换日期"); }
  }, [recordScope, draftScope, storage, actions, creatine, protein, confirmedMinutes, dayNote, resolution, skipNote, advancePlan]);

  useEffect(() => {
    if (!snapshot?.template) return;
    setTemplateName(snapshot.template.name);
    setTemplateDays(templateDrafts(snapshot.template));
  }, [snapshot?.template]);

  useEffect(() => {
    setSwitchDayKey(snapshot?.cycle?.currentDayKey ?? "");
  }, [snapshot?.cycle?.currentDayKey]);

  useEffect(() => {
    const recovery = recoverSimpleSubmissions("manual-exercise", storage);
    if (recovery.kind === "recovered") {
      setActive(recovery);
      setMessage("存在结果不确定的运动提交；页面不会自动发送，请重试原提交。");
    } else if (recovery.kind === "locked") {
      setLockedExternally(true);
      setMessage("运动提交已在其他页面变化，请刷新后继续。");
    } else if (recovery.kind === "storage-unavailable") {
      setLockedExternally(true);
      setMessage("本机提交存储不可用，暂时不能保存运动记录。");
    }
  }, [storage]);

  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const onStorage = (event: StorageEvent) => {
      const reconciliation = reconcileSimpleSubmissionStorageChange(
        { purpose: "manual-exercise", outerKey: active.outerKey, outerRaw: active.outerRaw },
        event,
      );
      if (reconciliation.kind === "locked") {
        setLockedExternally(true);
        setMessage("运动提交已在其他页面变化，请刷新后继续。");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [active]);

  useEffect(() => {
    if (!snapshot?.selectedDay?.timer.startedAt
      || snapshot.selectedDay.timer.endedAt
      || snapshot.selectedDay.timer.pausedAt) return;
    const id = window.setInterval(() => setClock(now()), 1_000);
    return () => window.clearInterval(id);
  }, [now, snapshot?.selectedDay?.timer]);

  const day = snapshot?.selectedDay ?? null;
  const template = snapshot?.template ?? null;
  const cycleIndex = template && snapshot?.cycle
    ? template.days.findIndex((candidate) => candidate.dayKey === day?.dayKey)
    : -1;
  const elapsed = useMemo(() => {
    if (!day) return { elapsedSeconds: 0, calculatedDurationMinutes: 0, confirmedDurationMinutes: null };
    try {
      return deriveManualExerciseElapsed(clock, {
        startedAt: day.timer.startedAt,
        pausedAt: day.timer.pausedAt,
        accumulatedPauseSeconds: day.timer.accumulatedPauseSeconds,
        endedAt: day.timer.endedAt,
        confirmedDurationMinutes: day.timer.confirmedDurationMinutes,
      });
    } catch {
      return {
        elapsedSeconds: day.timer.elapsedSeconds,
        calculatedDurationMinutes: day.timer.calculatedDurationMinutes,
        confirmedDurationMinutes: day.timer.confirmedDurationMinutes,
      };
    }
  }, [clock, day]);
  const locked = busy || active !== null || lockedExternally;
  const dayFinalized = day?.status === "completed" || day?.status === "skipped";
  const isHistorical = Boolean(snapshot && snapshot.businessDate < today);
  const isFuture = Boolean(snapshot && snapshot.businessDate > today);
  const dayLocked = locked || day?.status === "skipped" || isFuture;
  const canComplete = Boolean(day && (day.isRest || (
    actions.some((action) => safeSets(action.actualSets) > 0)
  )));
  useEffect(() => {
    if (!enableProgressPrompts || tab !== "template" || !template?.id) return;
    void progress.refresh(template.id);
  }, [enableProgressPrompts, progress.refresh, tab, template?.id]);

  const pendingProgress = progress.snapshot?.pending.find((candidate) =>
    candidate.templateId === template?.id && !deferredProgress.has(candidate.toVersionId),
  ) ?? null;

  async function decideProgress(transition: ManualExerciseProgressTransition, decision: "tracked" | "excluded") {
    const result = await progress.decide(transition, decision);
    if (result) setMessage(decision === "tracked" ? "这次模板变化已记录为进步。" : "模板已保存，本次变化不计为进步。");
  }


  if (!snapshot) {
    return (
      <section className={styles.unavailable} role="status">
        <h2>运动记录暂时无法读取</h2>
        <p>请稍后刷新重试；其他页面仍可正常使用。</p>
      </section>
    );
  }

  async function refresh(): Promise<ManualExerciseSnapshot | null> {
    try {
      const response = await request(`/api/v1/manual-exercise?date=${encodeURIComponent(snapshot!.businessDate)}&historyLimit=20`);
      if (!response.ok) return null;
      const value = await response.json() as unknown;
      if (!isSnapshot(value) || value.businessDate !== snapshot!.businessDate) return null;
      setSnapshot(value);
      return value;
    } catch {
      return null;
    }
  }

  async function send(stored: StoredSimpleSubmission): Promise<ManualExerciseSnapshot | null> {
    const command = parseCommand(stored.submission.body);
    if (!command) {
      setMessage("原提交内容无法验证，编辑已冻结，请刷新页面。");
      setLockedExternally(true);
      return null;
    }
    setBusy(true);
    try {
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
        setActive(stored);
        setMessage("提交结果不确定，原提交已冻结；请使用原内容重试。");
        return null;
      }
      if (!response.ok) {
        if ([400, 403, 422].includes(response.status) && storage
          && clearConfirmedSimpleSubmission(storage, stored).kind === "cleared") {
          setActive(null);
          setMessage("这次记录未保存，请检查填写内容后重试。你的草稿仍保留在当前日期。");
          return null;
        }
        setActive(stored);
        setMessage(`提交失败，原提交已冻结（HTTP ${response.status}），请重试或刷新核对。`);
        return null;
      }
      let value: unknown;
      try {
        value = await response.json();
      } catch {
        setActive(stored);
        setMessage("成功响应无法严格确认，原提交仍冻结，请使用原内容重试。");
        return null;
      }
      if (!strictlyConfirms(value, command)) {
        setActive(stored);
        setMessage("成功响应与原提交不一致，原提交仍冻结，请使用原内容重试。");
        return null;
      }
      if (!storage || clearConfirmedSimpleSubmission(storage, stored).kind !== "cleared") {
        setActive(stored);
        setLockedExternally(true);
        setMessage("服务器已确认，但本机冻结记录未能安全清理，请刷新核对。");
        return null;
      }
      setActive(null);
      if (recordScope) {
        const prefix = recordScope.slice(0, recordScope.lastIndexOf(":")) + ":";
        const keys = Array.from({length: storage.length}, (_, index) => storage.key(index));
        for (const key of keys) if (key?.startsWith(prefix)) storage.removeItem(key);
      }
      if (command.type === "resolve-day" || command.type === "reopen-day") {
        setResolution(null);
        setSkipNote("");
      }
      setSnapshot(value);
      const refreshed = await refresh();
      return refreshed ?? value;
    } finally {
      setBusy(false);
    }
  }

  async function submit(command: ManualExerciseCommand): Promise<ManualExerciseSnapshot | null> {
    if (!storage || locked) return null;
    const ownerId = command.type === "replace-template" || command.type === "select-cycle-day"
      ? command.templateId
      : command.businessDate;
    const localRevision = command.type === "replace-template"
      ? command.expectedTemplateRevision + 1
      : "expectedDailyRevision" in command
        ? command.expectedDailyRevision + 1
        : command.expectedCycleRevision + 1;
    const frozen = freezeSimpleSubmission({
      purpose: "manual-exercise",
      endpoint: "/api/v1/manual-exercise",
      operation: command.type,
      ownerId,
      localRevision: Math.max(1, localRevision),
      idempotencyKey: createId(),
      body: JSON.stringify(command),
      expected: { businessDate: snapshot!.businessDate, operation: command.type },
      createdAt: now().toISOString(),
    });
    const stored = storeSimpleSubmission(storage, frozen);
    if (stored.kind !== "stored") {
      setMessage("无法在本机冻结提交，因此没有发送网络请求。");
      return null;
    }
    const uncertain = markSimpleSubmissionUncertain(storage, stored);
    if (uncertain.kind !== "recovered") {
      setLockedExternally(true);
      setMessage("无法确认本机冻结状态，因此没有发送网络请求。");
      return null;
    }
    setActive(uncertain);
    return send(uncertain);
  }

  function saveCommand(current: ManualExerciseSnapshot, status?: "in-progress" | "partial"):
    Extract<ManualExerciseCommand, { type: "save-training" }> | null {
    const currentDay = current.selectedDay;
    if (!currentDay) return null;
    const actualActions = toActualActions(actions);
    const inferred = actualActions.some((action) => action.completion)
      && !actualActions.every((action) => action.completion)
      ? "partial"
      : "in-progress";
    return {
      type: "save-training",
      businessDate: current.businessDate,
      status: status ?? inferred,
      actions: actualActions,
      creatineTaken: nullableBoolean(creatine),
      proteinPowderTaken: nullableBoolean(protein),
      supplementNote: currentDay.supplements.note,
      note: nullable(dayNote),
      completionText: currentDay.completionText,
      confirmedDurationMinutes: confirmedMinutes.trim() === "" ? null : safeSets(confirmedMinutes),
      expectedDailyRevision: currentDay.revision,
    };
  }

  async function save(status?: "in-progress" | "partial"): Promise<ManualExerciseSnapshot | null> {
    if (actions.some((action) => action.actualSets.trim() !== ""
      && (!Number.isSafeInteger(Number(action.actualSets)) || Number(action.actualSets) < 0 || Number(action.actualSets) > 10000))) {
      setMessage("组数请填写 0 到 10000 的整数。");
      return null;
    }
    if (confirmedMinutes.trim() !== "" && (!Number.isSafeInteger(Number(confirmedMinutes))
      || Number(confirmedMinutes) < 0 || Number(confirmedMinutes) > 525600)) {
      setMessage("训练时长请填写非负整数分钟。");
      return null;
    }
    const command = saveCommand(snapshot!, status);
    if (!command) return null;
    const result = await submit(command);
    if (result) setMessage(`${result.businessDate} 的训练记录已保存。`);
    return result;
  }

  async function completeAndAdvance(): Promise<void> {
    if (!day || !snapshot!.cycle || !canComplete) return;
    const saved = await save("in-progress");
    if (!saved?.selectedDay || !saved.cycle) return;
    const completed = await submit({
      type: "finish-and-advance",
      businessDate: saved.businessDate,
      expectedDailyRevision: saved.selectedDay.revision,
      expectedCycleRevision: saved.cycle.revision,
    });
    if (!completed) return;
    advanceDate(completed.businessDate, "训练已保存");
  }

  function changeDate(date: string) {
    if (locked || date === snapshot?.businessDate || date > today) return;
    navigating.current = true;
    router.push(`/exercise?date=${encodeURIComponent(date)}`, { scroll: false });
  }

  function advanceDate(date: string, label: string) {
    setResolution(null);
    setSkipNote("");
    const next = shiftTrainingDate(date, 1);
    if (next <= today) {
      navigating.current = true;
      router.push(`/exercise?date=${next}`, { scroll: false });
      setMessage(`${date} ${label}，正在打开 ${next}。`);
    } else {
      setMessage(`${date} ${label}。已到今天。`);
    }
  }

  function chooseResolution(outcome: "rest" | "skipped" | "unrecorded") {
    setResolution(outcome);
    setSkipNote(outcome === "unrecorded" ? "练过，但组数或重量记不清" : "");
    setAdvancePlan(false);
  }

  async function resolveDay() {
    if (!day || !resolution || !skipNote.trim()) return;
    const hasRecordedActions = actions.some((action) => safeSets(action.actualSets) > 0 || action.completion
      || action.actualRepsText.trim() || action.actualWeightText.trim() || action.actualText.trim());
    if (hasRecordedActions && resolution !== "unrecorded") {
      setMessage("这一天已有训练内容，可以保存训练，或选择“练过，记不清”保留已知部分。");
      return;
    }
    const current = resolution === "unrecorded" && hasRecordedActions ? await save("partial") : snapshot;
    if (!current?.selectedDay) return;
    const result = await submit({
      type: "resolve-day",
      businessDate: current.businessDate,
      outcome: resolution,
      note: skipNote.trim(),
      advanceCycle: resolution !== "rest" && advancePlan && !isHistorical,
      expectedDailyRevision: current.selectedDay.revision,
      expectedCycleRevision: current.cycle?.revision ?? 0,
    });
    if (result) advanceDate(result.businessDate, resolution === "rest" ? "已记为休息" : resolution === "skipped" ? "已跳过" : "已记录，数据待补");
  }

  async function reopenDay() {
    if (!day) return;
    const result = await submit({ type: "reopen-day", businessDate: snapshot!.businessDate, expectedDailyRevision: day.revision });
    if (result) setMessage("可以补充或修改这一天；当前训练计划保持原位。");
  }

  async function switchTodayDay(): Promise<void> {
    if (!snapshot?.cycle || !template || switchDayKey === snapshot.cycle.currentDayKey) return;
    const target = template.days.find((candidate) => candidate.dayKey === switchDayKey);
    if (!target) return;
    const result = await submit({
      type: "select-cycle-day",
      templateId: template.id,
      businessDate: snapshot.businessDate,
      dayKey: switchDayKey,
      note: nullable(switchNote),
      expectedCycleRevision: snapshot.cycle.revision,
    });
    if (!result) return;
    setSwitchNote("");
    setSwitchOpen(false);
    setMessage(`已切换到「${target.name}」，按新部位记录训练。`);
  }

  async function timerCommand(type: "start-training" | "pause-training" | "resume-training") {
    if (!day) return;
    const saved = await save();
    if (saved?.selectedDay) await submit({ type, businessDate: saved.businessDate, expectedDailyRevision: saved.selectedDay.revision });
  }

  function useReference(index: number) {
    const action = day?.actions[index];
    if (!action) return;
    updateAction(index, {
      actualSets: prefillSets(action),
      actualRepsText: prefillText("", action.previousActualReference?.repsText ?? null, action.planned.repsText),
      actualWeightText: displayWeight(prefillWeight(action)),
    });
  }

  function updateAction(index: number, patch: Partial<ActionDraft>) {
    setActions((current) => current.map((action, actionIndex) => actionIndex === index ? { ...action, ...patch } : action));
  }

  function updateTemplateDay(index: number, patch: Partial<TemplateDayDraft>) {
    setTemplateDays((current) => current.map((dayDraft, dayIndex) => dayIndex === index ? { ...dayDraft, ...patch } : dayDraft));
  }

  function updateTemplateAction(dayIndex: number, actionIndex: number, patch: Partial<TemplateActionDraft>) {
    setTemplateDays((current) => current.map((dayDraft, candidateDay) => candidateDay !== dayIndex
      ? dayDraft
      : {
          ...dayDraft,
          actions: dayDraft.actions.map((action, candidateAction) => candidateAction === actionIndex
            ? { ...action, ...patch }
            : action),
        }));
  }

  function startTemplateCreation() {
    setTemplateName("我的训练循环");
    setTemplateDays([{
      dayKey: "day-" + createId(),
      name: "训练日 1",
      bodyPart: "",
      isRest: false,
      note: "",
      actions: [],
    }]);
    setEffectiveFrom(snapshot!.businessDate);
    setChangeNote("首次创建训练日模板");
    setMessage("先填写训练日，再为每个训练日添加动作。");
  }

  async function replaceTemplate() {
    if (templateDays.length === 0 || templateName.trim() === "" || changeNote.trim() === "") return;
    const days = toTemplateDays(templateDays);
    const nextRevision = (template?.revision ?? 0) + 1;
    if (days.some((candidate) => candidate.name.length === 0
      || candidate.actions.some((action) => action.name.length === 0))) return;
    const creating = template === null;
    const templateId = template?.id ?? "template-" + createId();
    const currentExists = Boolean(template
      && days.some((candidate) => candidate.dayKey === snapshot!.cycle?.currentDayKey));
    const result = await submit({
      type: "replace-template",
      templateId,
      name: templateName.trim(),
      effectiveFrom,
      changeNote: changeNote.trim(),
      expectedTemplateRevision: template?.revision ?? 0,
      ...(currentExists ? {} : { replacementCurrentDayKey: days[0]!.dayKey }),
      days,
    });
    if (result) {
      setChangeNote("");
      let progressPrompted = false;
      if (enableProgressPrompts && !creating) {
        const progressSnapshot = await progress.refresh(templateId);
        const justSaved = progressSnapshot?.pending.find((candidate) => candidate.toRevision === nextRevision);
        if (justSaved) {
          setDeferredProgress((current) => {
            const next = new Set(current); next.delete(justSaved.toVersionId); return next;
          });
          setMessage(justSaved.effectiveState === "scheduled"
            ? `未来模板已保存，将于 ${justSaved.effectiveFrom} 生效。你可以现在决定是否记录为计划进步。`
            : "模板新版本已保存。请确认这次重量、次数或组数变化是否要记为进步。");
          progressPrompted = true;
        }
      }
      if (!progressPrompted) {
        setMessage(creating
          ? "训练日模板已创建；现在可以在“今日训练”填写动作完成情况。"
          : "模板新版本已保存；历史记录及其动作快照未修改。");
      }
    }
  }

  async function retryActive() {
    if (!active) return;
    const command = parseCommand(active.submission.body);
    const result = await send(active);
    if (result && command && ["resolve-day", "finish-and-advance", "skip-and-advance"].includes(command.type)) {
      advanceDate(result.businessDate, "记录已保存");
    }
  }

  const selectedTab = tabs.find((candidate) => candidate.id === tab)!;

  return (
    <section className={styles.workspace} data-draft-ignore={tab === "today" ? "true" : undefined}>
      {tab === "today" ? <TrainingDateNav date={snapshot.businessDate} today={today} records={snapshot.calendarRecords ?? snapshot.history} disabled={locked} onDateChange={changeDate} /> : null}
      {showViewTabs ? (
        <div aria-label="运动记录视图" className={styles.tabs} role="tablist">
          {tabs.map((candidate) => (
            <button
              aria-controls={`exercise-panel-${candidate.id}`}
              aria-selected={tab === candidate.id}
              className={tab === candidate.id ? styles.activeTab : undefined}
              id={`exercise-tab-${candidate.id}`}
              key={candidate.id}
              onClick={() => setTab(candidate.id)}
              role="tab"
              type="button"
            >
              {candidate.label}
            </button>
          ))}
        </div>
      ) : null}

      {message ? <p className={styles.message} role="status">{message}</p> : null}
      {active ? (
        <div className={styles.frozen}>
          <p>原提交已持久化；只会按原字节与原幂等键重试。</p>
          <button disabled={busy || lockedExternally} onClick={() => void retryActive()} type="button">重试原提交</button>
        </div>
      ) : null}
      {progress.message ? (
        <div className={styles.frozen} role="status">
          <p>{progress.message}</p>
          {progress.status === "uncertain" ? (
            <button onClick={() => void progress.retry()} type="button">重试原进步决定</button>
          ) : null}
          {progress.status === "reload-required" ? (
            <button onClick={() => window.location.reload()} type="button">刷新页面核对</button>
          ) : null}
        </div>
      ) : null}
      {enableProgressPrompts && tab === "template" && pendingProgress ? (
        <section className={styles.progressPrompt} aria-labelledby="exercise-progress-prompt-heading">
          <header>
            <div>
              <p className={styles.kicker}>{pendingProgress.effectiveState === "scheduled" ? "未来计划已保存，等待你的判断" : "模板已保存，等待你的判断"}</p>
              <h2 id="exercise-progress-prompt-heading">{pendingProgress.effectiveState === "scheduled" ? "这次未来计划变化要记录吗？" : "这次变化要记为进步吗？"}</h2>
            </div>
            <Link href={`/exercise/progress?date=${encodeURIComponent(snapshot.businessDate)}`}>打开进步可视化</Link>
          </header>
          <p className={styles.hint}>
            {pendingProgress.effectiveState === "scheduled"
              ? `该变化将在 ${pendingProgress.effectiveFrom} 生效；现在确认不会把它计入当前进步汇总。`
              : "“记录为进步”会进入计划变化时间线；“仅保存模板”不会反复询问；“稍后处理”不会提交决定。"}
          </p>
          <ProgressChangeCard
            busy={!progress.canWrite}
            onExclude={() => void decideProgress(pendingProgress, "excluded")}
            onLater={() => {
              setDeferredProgress((current) => new Set(current).add(pendingProgress.toVersionId));
              setMessage("已稍后处理；这条变化仍保留在进步可视化的待确认区。");
            }}
            onTrack={() => void decideProgress(pendingProgress, "tracked")}
            transition={toProgressTransitionDisplay(pendingProgress)}
          />
        </section>
      ) : null}


      <div
        aria-labelledby={showViewTabs ? `exercise-tab-${tab}` : `exercise-panel-title-${tab}`}
        className={styles.panel}
        id={`exercise-panel-${tab}`}
        role={showViewTabs ? "tabpanel" : "region"}
      >
        <h2 className={styles.panelTitle} id={`exercise-panel-title-${tab}`}>{selectedTab.label}</h2>
        {tab === "today" ? (
          day ? (
            <div className={styles.stack}>
              <header className={styles.summary}>
                <div>
                  <p className={styles.kicker}>{isHistorical ? "补记训练部位" : "训练部位"}：{day.bodyPart ?? (day.isRest ? "休息" : "未填写")}</p>
                  <h3>{day.name}</h3>
                  <p>计划第 {cycleIndex >= 0 ? cycleIndex + 1 : "?"} / {template?.days.length ?? 0} 练</p>
                </div>
                <span className={styles.status}>{recordStatus(day)}</span>
              </header>
              {draftStatus ? <small className={styles.hint} role="status">{draftStatus}</small> : null}
              {day.status === "completed" ? <p className={styles.hint}>可直接修改并保存这一天的记录。</p> : null}
              {day.status === "skipped" ? (
                <section className={styles.resolutionBox} aria-label="当天记录结果">
                  <strong>{recordStatus(day)}</strong>
                  <p>{day.resolution?.note ?? day.note ?? "未填写原因"}</p>
                  <div className={styles.buttonRow}>
                    <button disabled={locked || isFuture} onClick={() => void reopenDay()} type="button">重新补记这一天</button>
                    {isHistorical ? <button disabled={locked} onClick={() => advanceDate(snapshot.businessDate, "已记录")} type="button">继续下一天</button> : null}
                  </div>
                </section>
              ) : null}
              {!dayFinalized && !isFuture ? (
                <div className={styles.dayChoices} role="group" aria-label="这一天的训练情况">
                  <button aria-pressed={resolution === null} disabled={locked} onClick={() => setResolution(null)} type="button">记录训练</button>
                  <button aria-pressed={resolution === "rest"} disabled={locked} onClick={() => chooseResolution("rest")} type="button">休息一天</button>
                  <button aria-pressed={resolution === "skipped"} disabled={locked} onClick={() => chooseResolution("skipped")} type="button">跳过这一天</button>
                  <button aria-pressed={resolution === "unrecorded"} disabled={locked} onClick={() => chooseResolution("unrecorded")} type="button">练过，记不清</button>
                </div>
              ) : null}
              {resolution ? (
                <section className={styles.resolutionBox} aria-label="结束这一天">
                  <label>
                    {resolution === "rest" ? "休息原因" : resolution === "skipped" ? "跳过原因" : "补记说明"}
                    <textarea disabled={locked} maxLength={4000} onChange={(event) => setSkipNote(event.target.value)} value={skipNote} />
                  </label>
                  <div className={styles.reasonChips} aria-label="常用原因">
                    {(resolution === "rest" ? ["计划休息", "身体疲劳", "身体不适"] : resolution === "skipped" ? ["今天没时间", "临时有事", "忘记训练"] : ["练过，但组数或重量记不清", "只记得部分动作", "稍后补齐数据"]).map((reason) => (
                      <button key={reason} type="button" disabled={locked} onClick={() => setSkipNote(reason)}>{reason}</button>
                    ))}
                  </div>
                  {resolution !== "rest" && !isHistorical ? (
                    <label className={styles.checkLabel}>
                      <input type="checkbox" checked={advancePlan} disabled={locked} onChange={(event) => setAdvancePlan(event.target.checked)} />
                      这次训练不补，计划继续下一练
                    </label>
                  ) : <p className={styles.hint}>{isHistorical ? "补记保存在所选日期，当前训练计划不变。" : "本次训练顺延，下一次继续。"}</p>}
                  <div className={styles.buttonRow}>
                    <button disabled={locked || !skipNote.trim()} onClick={() => void resolveDay()} type="button">{isHistorical ? "保存并到下一天" : "保存今天的状态"}</button>
                    <button disabled={locked} onClick={() => setResolution(null)} type="button">继续填写训练</button>
                  </div>
                </section>
              ) : null}

              {!dayFinalized && !isHistorical && !isFuture && !resolution && template && snapshot.cycle ? (
                <details
                  className={styles.daySwitch}
                  onToggle={(event) => setSwitchOpen(event.currentTarget.open)}
                  open={switchOpen || undefined}
                >
                  <summary>改练其他部位</summary>
                  <div className={styles.daySwitchBody}>
                    <label>
                      改练哪个训练日
                      <select
                        disabled={locked}
                        onChange={(event) => setSwitchDayKey(event.target.value)}
                        value={switchDayKey}
                      >
                        {template.days.map((candidate, index) => (
                          <option key={candidate.dayKey} value={candidate.dayKey}>
                            训练日 {index + 1} · {candidate.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      原因备注（可选，例如：肩部受伤，改练胸）
                      <input
                        disabled={locked}
                        maxLength={1000}
                        onChange={(event) => setSwitchNote(event.target.value)}
                        value={switchNote}
                      />
                    </label>
                    <button
                      disabled={locked || switchDayKey === snapshot.cycle.currentDayKey}
                      onClick={() => void switchTodayDay()}
                      type="button"
                    >
                      切换到这个训练日
                    </button>
                  </div>
                </details>
              ) : null}

              {!resolution && day.status !== "skipped" ? <>
              {!isHistorical ? <details className={styles.optionalTimer}>
                <summary>训练计时{day.timer.startedAt ? ` · ${formatElapsed(elapsed.elapsedSeconds)}` : "（可选）"}</summary>
              <section className={styles.timer} aria-label="总训练计时">
                <div>
                  <p>总训练计时</p>
                  <output aria-label="训练计时">{formatElapsed(elapsed.elapsedSeconds)}</output>
                  <small>计算时长：{elapsed.calculatedDurationMinutes} 分钟</small>
                </div>
                <div className={styles.buttonRow}>
                  {!day.timer.startedAt ? (
                    <button disabled={dayLocked || dayFinalized} onClick={() => void timerCommand("start-training")} type="button">开始计时</button>
                  ) : day.timer.pausedAt ? (
                    <button disabled={dayLocked || dayFinalized} onClick={() => void timerCommand("resume-training")} type="button">继续计时</button>
                  ) : day.timer.endedAt ? null : (
                    <button disabled={dayLocked || dayFinalized} onClick={() => void timerCommand("pause-training")} type="button">暂停计时</button>
                  )}
                </div>
              </section>
              </details> : null}

              <section className={styles.stack} aria-labelledby="exercise-actions-heading">
                <div className={styles.sectionHeading}>
                  <h3 id="exercise-actions-heading">动作实际记录</h3>
                  <small>{actions.filter((action) => action.completion).length} / {actions.length} 个已完成</small>
                </div>
                {day.actions.length === 0 ? <p>{day.isRest ? "今天是休息日，无需填写动作。" : "这个训练日还没有动作。"}</p> : null}
                {day.actions.map((action, index) => {
                  const draft = actions[index];
                  if (!draft) return null;
                  const actionState = draft.completion
                    ? `已完成 · ${safeSets(draft.actualSets)} 组`
                    : safeSets(draft.actualSets) > 0 ? `已填 ${safeSets(draft.actualSets)} 组` : "未记录";
                  return (
                    <details className={`${styles.card} ${styles.actionCard}`} key={action.actionKey}>
                      <summary className={styles.actionSummary}>
                        <span className={styles.actionSummaryPrimary}>
                          <strong>{action.name}</strong>
                          <small>
                            {action.previousActualReference
                              ? `上次 ${action.previousActualReference.sets} 组 · 每组 ${action.previousActualReference.repsText ?? "—"}${isBodyweightAction(action) ? " · 自重" : ` · ${action.previousActualReference.weightText ?? "自重"}`}`
                              : `计划 ${action.planned.sets} 组 · 每组 ${action.planned.repsText ?? "—"}${isBodyweightAction(action) ? " · 自重" : ` · ${action.planned.weightText ?? "自重"}`}`}
                          </small>
                        </span>
                        <span className={styles.actionState} data-complete={draft.completion ? "true" : "false"}>{actionState}</span>
                        <label className={styles.quickCompletion} onClick={(event) => event.stopPropagation()}>
                          <input aria-label={`${action.name}完成情况`} checked={draft.completion} disabled={dayLocked} type="checkbox" onChange={(event) => {
                            if (event.target.checked && draft.actualSets === "") useReference(index);
                            updateAction(index, {completion: event.target.checked});
                          }} />
                          <span className={styles.srOnly}>完成</span>
                        </label>
                        <span aria-hidden="true" className={styles.actionChevron}>⌄</span>
                      </summary>
                      <fieldset className={styles.actionFields} disabled={dayLocked}>
                        {action.planned.targetText ? (
                          <div className={styles.actionContext}>
                            <span>目标：{action.planned.targetText}</span>
                          </div>
                        ) : null}
                        <div className={styles.actionInputRow}>
                          <label>
                            组数
                            <input aria-label={`${action.name}实际组数`} min="0" max="10000" inputMode="numeric" placeholder={prefillSets(action)} onChange={(event) => updateAction(index, { actualSets: event.target.value })} type="number" value={draft.actualSets} />
                          </label>
                          <label>
                            次数
                            <input aria-label={`${action.name}实际次数（每组）`} placeholder={action.previousActualReference?.repsText ?? action.planned.repsText ?? "每组次数"} onChange={(event) => updateAction(index, { actualRepsText: event.target.value })} type="text" value={draft.actualRepsText} />
                          </label>
                          {isBodyweightAction(action) ? (
                            <span className={styles.bodyweightChip}>自重</span>
                          ) : (
                            <label>
                              重量（kg）
                              <span className={styles.weightInput}>
                                <input aria-label={`${action.name}实际重量`} inputMode="decimal" placeholder={displayWeight(action.previousActualReference?.weightText ?? action.planned.weightText ?? "")} onChange={(event) => updateAction(index, { actualWeightText: event.target.value })} type="text" value={draft.actualWeightText} />
                                <span aria-hidden="true">kg</span>
                              </span>
                            </label>
                          )}
                          <button type="button" className={styles.referenceButton} onClick={() => useReference(index)}>{action.previousActualReference ? "沿用上次" : "带入计划"}</button>
                        </div>
                        <label className={styles.actionNote}>动作备注<input value={draft.note} onChange={(event) => updateAction(index, { note: event.target.value })} maxLength={4000} /></label>
                      </fieldset>
                    </details>
                  );
                })}
              </section>

              <section className={`${styles.card} ${styles.sessionExtras}`}>
                <label>训练时长（分钟）<input disabled={dayLocked || Boolean(day.timer.startedAt && !day.timer.endedAt)} inputMode="numeric" min="0" max="525600" type="number" placeholder="选填" value={confirmedMinutes} onChange={(event) => setConfirmedMinutes(event.target.value)} /></label>
                <label>当天备注<input disabled={dayLocked} maxLength={4000} value={dayNote} onChange={(event) => setDayNote(event.target.value)} placeholder="选填" /></label>
                <div className={styles.fieldGrid}>
                  <label className={styles.supplementCheck}>
                    <input
                      aria-label="肌酸"
                      checked={creatine === "yes"}
                      disabled={dayLocked}
                      onChange={(event) => setCreatine(event.target.checked ? "yes" : "no")}
                      type="checkbox"
                    />
                    肌酸
                  </label>
                  <label className={styles.supplementCheck}>
                    <input
                      aria-label="蛋白粉"
                      checked={protein === "yes"}
                      disabled={dayLocked}
                      onChange={(event) => setProtein(event.target.checked ? "yes" : "no")}
                      type="checkbox"
                    />
                    蛋白粉
                  </label>
                </div>
              </section>

              <div className={styles.actions}>
                <button disabled={dayLocked} onClick={() => void save()} type="button">保存训练记录</button>
                {!dayFinalized ? <button disabled={dayLocked || !canComplete} onClick={() => void completeAndAdvance()} type="button">{isHistorical ? "完成并到下一天" : "完成今天训练"}</button> : isHistorical ? <button disabled={dayLocked} onClick={() => void save().then((result) => { if (result) advanceDate(result.businessDate, "修改已保存"); })} type="button">保存并到下一天</button> : null}
              </div>
              </> : null}
            </div>
          ) : <p>当前没有可记录的训练日，请先建立训练日模板。</p>
        ) : null}

        {tab === "template" ? (
          template || templateDays.length > 0 ? (
            <form className={styles.stack} onSubmit={(event) => { event.preventDefault(); void replaceTemplate(); }}>
              <p className={styles.hint}>{template
                ? "保存会创建不可变的新版本；历史训练及其计划快照不会被改写。"
                : "先定义第一天练什么，再添加动作；以后可以继续增加训练日。"}</p>
              <div className={styles.fieldGrid}>
                <label>
                  模板名称
                  <input disabled={locked} onChange={(event) => setTemplateName(event.target.value)} required type="text" value={templateName} />
                </label>
                <label>
                  生效日期
                  <input disabled={locked} onChange={(event) => setEffectiveFrom(event.target.value)} required type="date" value={effectiveFrom} />
                </label>
              </div>
              {templateDays.map((dayDraft, dayIndex) => (
                <fieldset className={styles.dayFieldset} disabled={locked} key={dayDraft.dayKey}>
                  <details className={styles.dayDetails} open={templateDays.length === 1 || undefined}>
                    <summary>
                      <span className={styles.daySummaryName}>
                        训练日 {dayIndex + 1}：{dayDraft.name.trim() || "未命名训练日"}
                      </span>
                      <span className={styles.daySummaryMeta}>
                        {dayDraft.bodyPart.trim() || "部位未填"}
                        {" · "}
                        {dayDraft.isRest ? "休息日" : `${dayDraft.actions.length} 个动作`}
                      </span>
                    </summary>
                    <div className={styles.dayBody}>
                      <div className={styles.fieldGrid}>
                        <label>
                          训练日名称
                          <input onChange={(event) => updateTemplateDay(dayIndex, { name: event.target.value })} required value={dayDraft.name} />
                        </label>
                        <label>
                          训练部位
                          <input onChange={(event) => updateTemplateDay(dayIndex, { bodyPart: event.target.value })} value={dayDraft.bodyPart} />
                        </label>
                      </div>
                      <label className={styles.checkLabel}>
                        <input checked={dayDraft.isRest} onChange={(event) => updateTemplateDay(dayIndex, { isRest: event.target.checked })} type="checkbox" />
                        这是休息日
                      </label>
                      <label>
                        训练日备注
                        <textarea onChange={(event) => updateTemplateDay(dayIndex, { note: event.target.value })} rows={2} value={dayDraft.note} />
                      </label>
                      {dayDraft.actions.map((action, actionIndex) => (
                        <div className={styles.templateActionEditor} key={action.actionKey}>
                          <div className={styles.templateActionRow}>
                            <span aria-hidden="true" className={styles.actionOrdinal}>{actionIndex + 1}</span>
                            <input
                              aria-label={`${dayDraft.name}动作 ${actionIndex + 1} 名称`}
                              className={styles.actionNameInput}
                              onChange={(event) => updateTemplateAction(dayIndex, actionIndex, { name: event.target.value })}
                              placeholder="动作名称"
                              required
                              value={action.name}
                            />
                            <input
                              aria-label="计划组数"
                              className={styles.actionNumberInput}
                              min="0"
                              onChange={(event) => updateTemplateAction(dayIndex, actionIndex, { plannedSets: event.target.value })}
                              placeholder="组数"
                              title="计划组数"
                              type="number"
                              value={action.plannedSets}
                            />
                            <input
                              aria-label="计划次数"
                              className={styles.actionShortInput}
                              onChange={(event) => updateTemplateAction(dayIndex, actionIndex, { plannedRepsText: event.target.value })}
                              placeholder="次数"
                              title="计划次数"
                              value={action.plannedRepsText}
                            />
                            <input
                              aria-label="计划重量"
                              className={styles.actionShortInput}
                              onChange={(event) => updateTemplateAction(dayIndex, actionIndex, { plannedWeightText: event.target.value })}
                              placeholder="重量"
                              title="计划重量"
                              value={action.plannedWeightText}
                            />
                            <button
                              aria-label={`删除动作 ${actionIndex + 1}`}
                              onClick={() => updateTemplateDay(dayIndex, { actions: dayDraft.actions.filter((_, index) => index !== actionIndex) })}
                              type="button"
                            >
                              删
                            </button>
                          </div>
                          <details className={styles.actionExtras}>
                            <summary>目标与备注</summary>
                            <label>
                              动作目标
                              <input onChange={(event) => updateTemplateAction(dayIndex, actionIndex, { targetText: event.target.value })} value={action.targetText} />
                            </label>
                            <label>
                              动作备注
                              <textarea onChange={(event) => updateTemplateAction(dayIndex, actionIndex, { note: event.target.value })} rows={2} value={action.note} />
                            </label>
                          </details>
                        </div>
                      ))}
                      <div className={styles.buttonRow}>
                        <button onClick={() => updateTemplateDay(dayIndex, { actions: [...dayDraft.actions, {
                          actionKey: `action-${createId()}`,
                          name: "新动作",
                          plannedSets: "0",
                          plannedRepsText: "",
                          plannedWeightText: "",
                          targetText: "",
                          note: "",
                        }] })} type="button">添加动作</button>
                        <button disabled={templateDays.length <= 1} onClick={() => setTemplateDays((current) => current.filter((_, index) => index !== dayIndex))} type="button">删除这个训练日</button>
                      </div>
                    </div>
                  </details>
                </fieldset>
              ))}
              <button disabled={locked} onClick={() => setTemplateDays((current) => [...current, {
                dayKey: `day-${createId()}`,
                name: "新训练日",
                bodyPart: "",
                isRest: false,
                note: "",
                actions: [],
              }])} type="button">添加训练日</button>
              <label>
                模板更新说明
                <textarea disabled={locked} onChange={(event) => setChangeNote(event.target.value)} required value={changeNote} />
              </label>
              <button disabled={locked || templateDays.length === 0 || templateName.trim() === "" || changeNote.trim() === ""} type="submit">
                {template ? "保存模板新版本" : "创建训练日模板"}
              </button>
            </form>
          ) : (
            <div className={styles.stack}>
              <p>还没有训练日模板。</p>
              <p className={styles.hint}>先创建训练日，例如“肩日”或“腿日”，再向训练日里添加动作。</p>
              <button disabled={locked} onClick={startTemplateCreation} type="button">创建第一份训练日模板</button>
            </div>
          )
        ) : null}

        {tab === "history" ? (
          snapshot.history.length > 0 ? (
            <div className={styles.tableWrap}>
              <table>
                <caption>训练历史 · 可补记和修改</caption>
                <thead><tr><th>日期</th><th>训练日</th><th>状态</th><th>原因 / 备注</th><th>计算时长</th><th>确认时长</th><th>操作</th></tr></thead>
                <tbody>
                  {snapshot.history.map((entry) => (
                    <tr key={`${entry.businessDate}-${entry.dayKey}`}>
                      <td>{entry.businessDate}</td>
                      <td>{entry.name}</td>
                      <td>{recordStatus(entry)}</td>
                      <td>{entry.resolution?.note ?? "—"}</td>
                      <td>{entry.calculatedDurationMinutes ?? "—"} 分钟</td>
                      <td>{entry.confirmedDurationMinutes ?? "—"} 分钟</td>
                      <td>
                        <Link
                          aria-label={"打开 " + entry.businessDate + " 的训练记录"}
                          className={styles.inlineAction}
                          href={"/exercise?date=" + entry.businessDate}
                          scroll={false}
                        >
                          打开记录
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {historyPagination ? (
                <nav aria-label="训练历史分页" className={styles.historyPager}>
                  {historyPagination.page > 1 ? (
                    <Link href={`/exercise/history?page=${historyPagination.page - 1}`}>上一页</Link>
                  ) : <span />}
                  <span>
                    第 {historyPagination.page} / {Math.ceil(historyPagination.total / historyPagination.pageSize)} 页
                    （共 {historyPagination.total} 条）
                  </span>
                  {historyPagination.page * historyPagination.pageSize < historyPagination.total ? (
                    <Link href={`/exercise/history?page=${historyPagination.page + 1}`}>下一页</Link>
                  ) : <span />}
                </nav>
              ) : null}
            </div>
          ) : <p>还没有训练历史。</p>
        ) : null}

        {tab === "updates" ? (
          snapshot.templateHistory.length > 0 ? (
            <ol className={styles.updateList}>
              {snapshot.templateHistory.map((entry) => (
                <li key={`${entry.templateId}-${entry.revision}`}>
                  <strong>{entry.name} · 版本 {entry.revision}</strong>
                  <span>从 {entry.effectiveFrom} 生效</span>
                  <p>{entry.changeNote}</p>
                  <small>{entry.createdAt}</small>
                </li>
              ))}
            </ol>
          ) : <p>还没有模板更新记录。</p>
        ) : null}
      </div>
    </section>
  );
}
