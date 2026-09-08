"use client";

import { useEffect, useRef, useState } from "react";

import { isBusinessDate } from "@/core/time/business-date";
import type {
  PlanningAction,
  PlanningCommand,
  PlanningSnapshot,
} from "@/modules/planning/contracts";

export const PLANNING_DRAFT_STORAGE_KEY = "life-pivot:planning-drafts:v1";

type DraftKey = "longTerm" | "stage" | "weekly" | "today";
type SaveState = "idle" | "saving" | "saved" | "retry" | "conflict" | "error";

interface LongTermDraft {
  lifeAreaId: string;
  title: string;
  description: string;
  startDate: string;
  targetDate: string;
}

interface StageDraft {
  parentGoalId: string;
  title: string;
  description: string;
  startDate: string;
  targetDate: string;
}

interface ActionDraft {
  goalId: string;
  title: string;
  priority: PlanningAction["priority"];
  estimatedMinutes: string;
  notes: string;
}

interface PlanningDrafts {
  longTerm: LongTermDraft;
  stage: StageDraft;
  weekly: ActionDraft;
  today: ActionDraft;
}

interface FrozenSubmission {
  version: 1;
  draftKey: DraftKey | null;
  command: PlanningCommand;
  body: string;
  idempotencyKey: string;
}

interface PlanningDraftEnvelope {
  version: 1;
  drafts: PlanningDrafts;
  pending?: FrozenSubmission;
}

interface PlanningWorkspaceProps {
  businessDate: string;
  initialSnapshot: PlanningSnapshot;
  initialTomorrowActions?: ReadonlyArray<PlanningAction>;
  tomorrowBusinessDate?: string;
  request?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  createId?: () => string;
  storage?: Storage;
}

interface LoadedEnvelope {
  drafts: PlanningDrafts;
  pending?: FrozenSubmission;
  writable: boolean;
  message?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: Record<string, unknown>, key: string, fallback: string): string {
  return typeof value[key] === "string" ? value[key] : fallback;
}

function actionPriority(value: unknown, fallback: PlanningAction["priority"]): PlanningAction["priority"] {
  return value === "low" || value === "normal" || value === "high" ? value : fallback;
}

function blankActionDraft(goalId = ""): ActionDraft {
  return {
    goalId,
    title: "",
    priority: "normal",
    estimatedMinutes: "",
    notes: "",
  };
}

function emptyDrafts(snapshot: PlanningSnapshot): PlanningDrafts {
  const firstLifeAreaId = snapshot.lifeAreas[0]?.id ?? "";
  const firstLongTermGoalId = snapshot.goals.find((goal) => goal.goalType === "long-term")?.id ?? "";
  const firstGoalId = snapshot.goals[0]?.id ?? "";
  return {
    longTerm: {
      lifeAreaId: firstLifeAreaId,
      title: "",
      description: "",
      startDate: "",
      targetDate: "",
    },
    stage: {
      parentGoalId: firstLongTermGoalId,
      title: "",
      description: "",
      startDate: "",
      targetDate: "",
    },
    weekly: blankActionDraft(firstGoalId),
    today: blankActionDraft(firstGoalId),
  };
}

function loadLongTermDraft(value: unknown, fallback: LongTermDraft): LongTermDraft {
  if (!isRecord(value)) return fallback;
  return {
    lifeAreaId: stringValue(value, "lifeAreaId", fallback.lifeAreaId),
    title: stringValue(value, "title", fallback.title),
    description: stringValue(value, "description", fallback.description),
    startDate: stringValue(value, "startDate", fallback.startDate),
    targetDate: stringValue(value, "targetDate", fallback.targetDate),
  };
}

function loadStageDraft(value: unknown, fallback: StageDraft): StageDraft {
  if (!isRecord(value)) return fallback;
  return {
    parentGoalId: stringValue(value, "parentGoalId", fallback.parentGoalId),
    title: stringValue(value, "title", fallback.title),
    description: stringValue(value, "description", fallback.description),
    startDate: stringValue(value, "startDate", fallback.startDate),
    targetDate: stringValue(value, "targetDate", fallback.targetDate),
  };
}

function loadActionDraft(value: unknown, fallback: ActionDraft): ActionDraft {
  if (!isRecord(value)) return fallback;
  return {
    goalId: stringValue(value, "goalId", fallback.goalId),
    title: stringValue(value, "title", fallback.title),
    priority: actionPriority(value.priority, fallback.priority),
    estimatedMinutes: stringValue(value, "estimatedMinutes", fallback.estimatedMinutes),
    notes: stringValue(value, "notes", fallback.notes),
  };
}

function loadDrafts(value: unknown, fallback: PlanningDrafts): PlanningDrafts {
  if (!isRecord(value)) return fallback;
  return {
    longTerm: loadLongTermDraft(value.longTerm, fallback.longTerm),
    stage: loadStageDraft(value.stage, fallback.stage),
    weekly: loadActionDraft(value.weekly, fallback.weekly),
    today: loadActionDraft(value.today, fallback.today),
  };
}

function isPlanningCommand(value: unknown): value is PlanningCommand {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  return [
    "create-goal",
    "update-goal",
    "create-action",
    "set-action-status",
    "reschedule-action",
  ].includes(value.type);
}

function draftKeyFor(command: PlanningCommand): DraftKey | null {
  if (command.type === "create-goal") return command.goalType === "long-term" ? "longTerm" : "stage";
  if (command.type === "create-action") return command.actionType;
  return null;
}

function loadPending(value: unknown): FrozenSubmission | undefined {
  if (!isRecord(value) || !isPlanningCommand(value.command) || typeof value.idempotencyKey !== "string") {
    return undefined;
  }
  const draftKey = value.draftKey === "longTerm" || value.draftKey === "stage" ||
    value.draftKey === "weekly" || value.draftKey === "today"
    ? value.draftKey
    : draftKeyFor(value.command);
  return {
    version: 1,
    draftKey,
    command: value.command,
    body: typeof value.body === "string" ? value.body : JSON.stringify(value.command),
    idempotencyKey: value.idempotencyKey,
  };
}

function loadEnvelope(storage: Storage, fallback: PlanningDrafts): LoadedEnvelope {
  let raw: string | null;
  try {
    raw = storage.getItem(PLANNING_DRAFT_STORAGE_KEY);
  } catch {
    return {
      drafts: fallback,
      writable: false,
      message: "浏览器草稿存储不可用；仍可直接保存到本地数据库。",
    };
  }
  if (raw === null) return { drafts: fallback, writable: true };

  try {
    const decoded: unknown = JSON.parse(raw);
    if (!isRecord(decoded) || decoded.version !== 1) throw new Error("unsupported draft envelope");
    return {
      drafts: loadDrafts(decoded.drafts, fallback),
      pending: loadPending(decoded.pending),
      writable: true,
    };
  } catch {
    return {
      drafts: fallback,
      writable: false,
      message: "发现无法读取或不兼容的目标草稿，已原样保留；本次仍可直接保存。",
    };
  }
}

function persistEnvelope(storage: Storage, envelope: PlanningDraftEnvelope): boolean {
  try {
    storage.setItem(PLANNING_DRAFT_STORAGE_KEY, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

function looksLikeSnapshot(value: unknown): value is PlanningSnapshot {
  if (!isRecord(value) || typeof value.businessDate !== "string" || !isBusinessDate(value.businessDate)) {
    return false;
  }
  if (!Array.isArray(value.lifeAreas) || !value.lifeAreas.every(isLifeArea)) return false;
  if (!Array.isArray(value.goals) || !value.goals.every(isGoal)) return false;
  if (!Array.isArray(value.weeklyActions) || !value.weeklyActions.every((item) =>
    isAction(item) && item.actionType === "weekly")) return false;
  return ["todayActions", "overdueActions", "unassignedActions"].every((key) =>
    Array.isArray(value[key]) && value[key].every((item) =>
      isAction(item) && item.actionType === "today"));
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNullableIdentifier(value: unknown): value is string | null {
  return value === null || isIdentifier(value);
}

function isLifeArea(value: unknown): value is PlanningSnapshot["lifeAreas"][number] {
  return isRecord(value) && isIdentifier(value.id) && typeof value.name === "string";
}

function isGoal(value: unknown): value is PlanningSnapshot["goals"][number] {
  return isRecord(value) &&
    isIdentifier(value.id) &&
    isIdentifier(value.lifeAreaId) &&
    isNullableIdentifier(value.parentGoalId) &&
    (value.goalType === "long-term" || value.goalType === "stage") &&
    typeof value.title === "string" &&
    typeof value.description === "string" &&
    (value.status === "active" || value.status === "completed" ||
      value.status === "paused" || value.status === "archived") &&
    Number.isInteger(value.progressPercent) &&
    Number(value.progressPercent) >= 0 &&
    Number(value.progressPercent) <= 100 &&
    Number.isInteger(value.revision) &&
    Number(value.revision) > 0;
}

function isNullableBusinessDate(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && isBusinessDate(value));
}

function isAction(value: unknown): value is PlanningAction {
  return isRecord(value) &&
    isIdentifier(value.id) &&
    isNullableIdentifier(value.goalId) &&
    isNullableIdentifier(value.parentActionId) &&
    (value.actionType === "weekly" || value.actionType === "today") &&
    isNullableBusinessDate(value.businessDate) &&
    typeof value.title === "string" &&
    (value.status === "pending" || value.status === "completed" ||
      value.status === "skipped" || value.status === "archived") &&
    (value.priority === "low" || value.priority === "normal" || value.priority === "high") &&
    (value.estimatedMinutes === null || (
      Number.isInteger(value.estimatedMinutes) &&
      Number(value.estimatedMinutes) >= 1 &&
      Number(value.estimatedMinutes) <= 1440
    )) &&
    typeof value.notes === "string" &&
    Number.isInteger(value.revision) &&
    Number(value.revision) > 0;
}

function allSnapshotActions(snapshot: PlanningSnapshot): ReadonlyArray<PlanningAction> {
  return [
    ...snapshot.weeklyActions,
    ...snapshot.todayActions,
    ...snapshot.overdueActions,
    ...snapshot.unassignedActions,
  ];
}

function confirmsSubmission(snapshot: PlanningSnapshot, command: PlanningCommand): boolean {
  if (command.type === "create-goal") {
    const goal = snapshot.goals.find((item) => item.id === command.id);
    return goal !== undefined &&
      goal.lifeAreaId === command.lifeAreaId &&
      goal.parentGoalId === (command.parentGoalId ?? null) &&
      goal.goalType === command.goalType &&
      goal.title === command.title &&
      goal.description === command.description &&
      goal.status === "active" &&
      goal.progressPercent === 0 &&
      goal.revision === 1;
  }
  if (command.type === "update-goal") {
    const goal = snapshot.goals.find((item) => item.id === command.id);
    return goal !== undefined &&
      goal.title === command.title &&
      goal.description === command.description &&
      goal.status === command.status &&
      goal.progressPercent === command.progressPercent &&
      goal.revision === command.revision + 1;
  }
  const actions = allSnapshotActions(snapshot);
  if (command.type === "create-action") {
    const action = actions.find((item) => item.id === command.id);
    return action !== undefined &&
      action.goalId === (command.goalId ?? null) &&
      action.parentActionId === (command.parentActionId ?? null) &&
      action.actionType === command.actionType &&
      action.businessDate === (command.businessDate ?? null) &&
      action.title === command.title &&
      action.status === "pending" &&
      action.priority === command.priority &&
      action.estimatedMinutes === (command.estimatedMinutes ?? null) &&
      action.notes === command.notes &&
      action.revision === 1;
  }
  const action = actions.find((item) => item.id === command.actionId);
  if (command.type === "set-action-status") {
    if (action === undefined) {
      return (command.status === "completed" || command.status === "skipped") &&
        command.businessDate < snapshot.businessDate;
    }
    return action.status === command.status &&
      action.businessDate === command.businessDate &&
      (action.revision === command.revision || action.revision === command.revision + 1);
  }
  return action !== undefined &&
    action.businessDate === command.toBusinessDate &&
    action.revision === command.revision + (command.fromBusinessDate === command.toBusinessDate ? 0 : 1);
}

function nullableDate(value: string): string | null {
  return value || null;
}

function nullableMinutes(value: string): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 1440 ? parsed : null;
}

function statusText(state: SaveState, hydrated: boolean): string {
  if (!hydrated) return "正在恢复本地草稿";
  switch (state) {
    case "saving":
      return "正在保存；其他行动会按顺序等待";
    case "saved":
      return "已保存";
    case "retry":
      return "提交结果未知，请使用原提交重试";
    case "conflict":
      return "发生冲突，草稿已保留；请根据最新状态调整后重新保存";
    case "error":
      return "提交未被接受，草稿已保留";
    default:
      return "";
  }
}

function actionStatusLabel(status: PlanningAction["status"]): string {
  if (status === "completed") return "已完成";
  if (status === "skipped") return "已跳过";
  if (status === "archived") return "已归档";
  return "待完成";
}

export function PlanningWorkspace({
  businessDate,
  initialSnapshot,
  initialTomorrowActions = [],
  tomorrowBusinessDate = "",
  request = fetch,
  createId = () => crypto.randomUUID(),
  storage,
}: PlanningWorkspaceProps) {
  const initialDrafts = useRef(emptyDrafts(initialSnapshot));
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [drafts, setDrafts] = useState<PlanningDrafts>(initialDrafts.current);
  const [pending, setPending] = useState<FrozenSubmission>();
  const [state, setState] = useState<SaveState>("idle");
  const [hydrated, setHydrated] = useState(false);
  const [storageWritable, setStorageWritable] = useState(true);
  const [storageMessage, setStorageMessage] = useState<string>();
  const [advanced, setAdvanced] = useState<Record<DraftKey, boolean>>({
    longTerm: false,
    stage: false,
    weekly: false,
    today: false,
  });
  const queue = useRef<Promise<void>>(Promise.resolve());
  const browserStorage = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
  const mutationsLocked = !hydrated || state === "saving" || Boolean(pending);

  useEffect(() => {
    if (!browserStorage) {
      setStorageWritable(false);
      setStorageMessage("浏览器草稿存储不可用；仍可直接保存到本地数据库。");
      setHydrated(true);
      return;
    }
    const loaded = loadEnvelope(browserStorage, initialDrafts.current);
    setDrafts(loaded.drafts);
    setPending(loaded.pending);
    setState(loaded.pending ? "retry" : "idle");
    setStorageWritable(loaded.writable);
    setStorageMessage(loaded.message);
    setHydrated(true);
  }, [browserStorage]);

  useEffect(() => {
    if (!hydrated || !storageWritable || !browserStorage) return;
    const envelope: PlanningDraftEnvelope = { version: 1, drafts, pending };
    if (!persistEnvelope(browserStorage, envelope)) {
      setStorageWritable(false);
      setStorageMessage("浏览器无法持久化草稿；当前提交不会受阻，但请尽快确认结果。");
    }
  }, [browserStorage, drafts, hydrated, pending, storageWritable]);

  function updateLongTerm(update: Partial<LongTermDraft>) {
    setDrafts((current) => ({ ...current, longTerm: { ...current.longTerm, ...update } }));
  }

  function updateStage(update: Partial<StageDraft>) {
    setDrafts((current) => ({ ...current, stage: { ...current.stage, ...update } }));
  }

  function updateAction(key: "weekly" | "today", update: Partial<ActionDraft>) {
    setDrafts((current) => ({ ...current, [key]: { ...current[key], ...update } }));
  }

  function clearDraft(key: DraftKey | null) {
    if (key === null) return;
    setDrafts((current) => {
      if (key === "longTerm") {
        return { ...current, longTerm: { ...current.longTerm, title: "", description: "", startDate: "", targetDate: "" } };
      }
      if (key === "stage") {
        return { ...current, stage: { ...current.stage, title: "", description: "", startDate: "", targetDate: "" } };
      }
      return { ...current, [key]: blankActionDraft(current[key].goalId) };
    });
  }

  async function performSubmission(submission: FrozenSubmission) {
    setState("saving");
    try {
      const response = await request("/api/v1/planning", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": submission.idempotencyKey,
        },
        body: submission.body,
      });
      const result: unknown = await response.json().catch(() => undefined);
      if (response.ok && looksLikeSnapshot(result) && confirmsSubmission(result, submission.command)) {
        setSnapshot(result);
        setPending(undefined);
        clearDraft(submission.draftKey);
        setState("saved");
        return;
      }
      if (response.status === 409) {
        setPending(undefined);
        setState("conflict");
        return;
      }
      if (response.ok || response.status >= 500) {
        setPending(submission);
        setState("retry");
        return;
      }
      setPending(undefined);
      setState("error");
    } catch {
      setPending(submission);
      setState("retry");
    }
  }

  function enqueueSubmission(submission: FrozenSubmission) {
    const queued = queue.current.then(() => performSubmission(submission));
    queue.current = queued.catch(() => undefined);
    return queued;
  }

  function beginSubmission(draftKey: DraftKey | null, command: PlanningCommand) {
    if (mutationsLocked) return;
    const submission: FrozenSubmission = {
      version: 1,
      draftKey,
      command,
      body: JSON.stringify(command),
      idempotencyKey: createId(),
    };
    setPending(submission);
    setState("saving");
    void enqueueSubmission(submission);
  }

  function retrySubmission() {
    if (!pending || state === "saving") return;
    void enqueueSubmission(pending);
  }

  function submitLongTerm() {
    const draft = drafts.longTerm;
    beginSubmission("longTerm", {
      type: "create-goal",
      id: createId(),
      lifeAreaId: draft.lifeAreaId,
      parentGoalId: null,
      goalType: "long-term",
      title: draft.title.trim(),
      description: draft.description,
      startDate: nullableDate(draft.startDate),
      targetDate: nullableDate(draft.targetDate),
    });
  }

  function submitStage() {
    const draft = drafts.stage;
    const parent = snapshot.goals.find((goal) => goal.id === draft.parentGoalId);
    if (!parent) return;
    beginSubmission("stage", {
      type: "create-goal",
      id: createId(),
      lifeAreaId: parent.lifeAreaId,
      parentGoalId: parent.id,
      goalType: "stage",
      title: draft.title.trim(),
      description: draft.description,
      startDate: nullableDate(draft.startDate),
      targetDate: nullableDate(draft.targetDate),
    });
  }

  function submitAction(key: "weekly" | "today") {
    const draft = drafts[key];
    beginSubmission(key, {
      type: "create-action",
      id: createId(),
      goalId: draft.goalId || null,
      parentActionId: null,
      actionType: key,
      businessDate: key === "today" ? businessDate : null,
      title: draft.title.trim(),
      priority: draft.priority,
      estimatedMinutes: nullableMinutes(draft.estimatedMinutes),
      notes: draft.notes,
    });
  }

  function scheduleWeeklyAction(weekly: PlanningAction) {
    beginSubmission(null, {
      type: "create-action",
      id: createId(),
      goalId: weekly.goalId,
      parentActionId: weekly.id,
      actionType: "today",
      businessDate,
      title: weekly.title,
      priority: weekly.priority,
      estimatedMinutes: weekly.estimatedMinutes,
      notes: weekly.notes,
    });
  }

  function completeAction(item: PlanningAction) {
    if (!item.businessDate) return;
    beginSubmission(null, {
      type: "set-action-status",
      actionId: item.id,
      revision: item.revision,
      businessDate: item.businessDate,
      status: "completed",
    });
  }

  function skipAction(item: PlanningAction) {
    if (!item.businessDate) return;
    beginSubmission(null, {
      type: "set-action-status",
      actionId: item.id,
      revision: item.revision,
      businessDate: item.businessDate,
      status: "skipped",
    });
  }

  function reopenAction(item: PlanningAction) {
    if (!item.businessDate) return;
    beginSubmission(null, {
      type: "set-action-status",
      actionId: item.id,
      revision: item.revision,
      businessDate: item.businessDate,
      status: "pending",
    });
  }

  function rescheduleAction(item: PlanningAction, toBusinessDate: string) {
    if (!item.businessDate || !isBusinessDate(toBusinessDate) || toBusinessDate === item.businessDate) return;
    beginSubmission(null, {
      type: "reschedule-action",
      actionId: item.id,
      revision: item.revision,
      fromBusinessDate: item.businessDate,
      toBusinessDate,
    });
  }

  function updateGoalProgress(goal: PlanningSnapshot["goals"][number], percent: number) {
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) return;
    beginSubmission(null, {
      type: "update-goal",
      id: goal.id,
      revision: goal.revision,
      title: goal.title,
      description: goal.description,
      status: goal.status,
      progressPercent: percent,
    });
  }

  function setGoalStatus(goal: PlanningSnapshot["goals"][number], status: "completed" | "paused" | "archived" | "active") {
    beginSubmission(null, {
      type: "update-goal",
      id: goal.id,
      revision: goal.revision,
      title: goal.title,
      description: goal.description,
      status,
      progressPercent: status === "completed" ? 100 : goal.progressPercent,
    });
  }

  const longTermGoals = snapshot.goals.filter((goal) => goal.goalType === "long-term");
  const stageGoals = snapshot.goals.filter((goal) => goal.goalType === "stage");
  const currentStatus = statusText(state, hydrated);

  const focusOverview = (
    <section className="planning-focus-overview" aria-label="明日目标与长期目标">
      <article className="planning-focus-card planning-focus-tomorrow">
        <header>
          <h2>明日目标</h2>
          {tomorrowBusinessDate ? <time dateTime={tomorrowBusinessDate}>{tomorrowBusinessDate}</time> : null}
        </header>
        {initialTomorrowActions.length > 0 ? (
          <ul>
            {initialTomorrowActions.map((action) => (
              <li key={action.id}>
                <strong>{action.title}</strong>
                <span>{actionStatusLabel(action.status)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="planning-focus-empty">暂无明日目标。</p>}
      </article>

      <article className="planning-focus-card planning-focus-long-term">
        <header>
          <h2>长期目标</h2>
          <span>{longTermGoals.length} 项</span>
        </header>
        {longTermGoals.length > 0 ? (
          <ul>
            {longTermGoals.map((goal) => (
              <li key={goal.id}>
                <strong>{goal.title}</strong>
                <span>{goal.progressPercent}%</span>
              </li>
            ))}
          </ul>
        ) : <p className="planning-focus-empty">暂无长期目标。</p>}
      </article>
    </section>
  );

  const board = (
    <section className="planning-board" aria-label="目标与行动看板">
      <section className="planning-list" aria-labelledby="goals-heading">
        <h2 id="goals-heading">目标树</h2>
        {snapshot.goals.length === 0 ? <p className="planning-empty">暂无目标。</p> : null}
        {longTermGoals.map((goal) => (
          <article className="planning-item" key={goal.id}>
            <p className="planning-kicker">长期目标 · {snapshot.lifeAreas.find((area) => area.id === goal.lifeAreaId)?.name ?? "历史人生支点"} · {goal.progressPercent}%</p>
            <h3>{goal.title}</h3>
            {goal.description ? <p>{goal.description}</p> : null}
            {stageGoals.filter((stage) => stage.parentGoalId === goal.id).map((stage) => (
              <p className="planning-child" key={stage.id}>阶段 · <span>{stage.title}</span> · {stage.progressPercent}%</p>
            ))}
            <GoalProgressControls
              disabled={mutationsLocked}
              goal={goal}
              onSetStatus={setGoalStatus}
              onUpdateProgress={updateGoalProgress}
            />
          </article>
        ))}
        {stageGoals.filter((stage) => !longTermGoals.some((goal) => goal.id === stage.parentGoalId)).map((stage) => (
          <article className="planning-item" key={stage.id}>
            <p className="planning-kicker">关联的历史长期目标 · {stage.progressPercent}%</p><h3>{stage.title}</h3>
            <GoalProgressControls
              disabled={mutationsLocked}
              goal={stage}
              onSetStatus={setGoalStatus}
              onUpdateProgress={updateGoalProgress}
            />
          </article>
        ))}
      </section>

      <ActionList
        actions={snapshot.weeklyActions}
        businessDate={businessDate}
        disabled={mutationsLocked}
        emptyText="暂无本周行动。"
        heading="本周行动"
        onComplete={completeAction}
        onReopen={reopenAction}
        onReschedule={rescheduleAction}
        onSchedule={scheduleWeeklyAction}
        onSkip={skipAction}
        snapshot={snapshot}
      />
      <ActionList
        actions={snapshot.todayActions}
        businessDate={businessDate}
        disabled={mutationsLocked}
        emptyText="暂无今日行动。"
        heading="今日行动"
        onComplete={completeAction}
        onReopen={reopenAction}
        onReschedule={rescheduleAction}
        onSchedule={scheduleWeeklyAction}
        onSkip={skipAction}
        snapshot={snapshot}
      />
      {snapshot.overdueActions.length > 0 ? <ActionList actions={snapshot.overdueActions} businessDate={businessDate} disabled={mutationsLocked} emptyText="" heading="逾期行动" onComplete={completeAction} onReopen={reopenAction} onReschedule={rescheduleAction} onSchedule={scheduleWeeklyAction} onSkip={skipAction} snapshot={snapshot} /> : null}
      {snapshot.unassignedActions.length > 0 ? (
        <section aria-label="历史未分配行动" className="planning-list planning-legacy">
          <h2>历史未分配行动</h2>
          <p>这些旧记录没有日期；当前协议不支持在此直接修改，已原样保留。</p>
          {snapshot.unassignedActions.map((item) => <article className="planning-item" key={item.id}><h3>{item.title}</h3><p>{actionStatusLabel(item.status)}</p></article>)}
        </section>
      ) : null}
    </section>
  );

  return (
    <section className="planning-workspace" aria-label="目标与行动工作区">
      {focusOverview}
      {board}
      {currentStatus ? <div className="planning-status" aria-live="polite" role="status">{currentStatus}</div> : null}
      {storageMessage ? <p className="form-error" role="alert">{storageMessage}</p> : null}

      {pending ? (
        <aside className="planning-retry" aria-label="待确认提交">
          <p>这条提交尚未确认。重试会复用完全相同的内容与幂等键。</p>
          <button disabled={state === "saving"} onClick={retrySubmission} type="button">使用原提交重试</button>
        </aside>
      ) : null}

      <section className="planning-forms" aria-label="创建目标与行动">
        <form className="planning-form" onSubmit={(event) => { event.preventDefault(); submitLongTerm(); }}>
          <div className="section-heading">
            <div>
              <h2>长期目标</h2>
            </div>
          </div>
          <label htmlFor="long-term-title">长期目标名称</label>
          <input
            id="long-term-title"
            maxLength={500}
            onChange={(event) => updateLongTerm({ title: event.currentTarget.value })}
            required
            value={drafts.longTerm.title}
          />
          <label htmlFor="long-term-life-area">人生支点</label>
          <select
            id="long-term-life-area"
            onChange={(event) => updateLongTerm({ lifeAreaId: event.currentTarget.value })}
            value={drafts.longTerm.lifeAreaId}
          >
            {snapshot.lifeAreas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
          </select>
          <button
            aria-expanded={advanced.longTerm}
            className="planning-advanced-toggle"
            onClick={() => setAdvanced((current) => ({ ...current, longTerm: !current.longTerm }))}
            type="button"
          >
            {advanced.longTerm ? "收起高级字段" : "显示高级字段"}
          </button>
          {advanced.longTerm ? (
            <div className="planning-advanced-fields">
              <label htmlFor="long-term-description">目标描述</label>
              <textarea id="long-term-description" maxLength={20_000} onChange={(event) => updateLongTerm({ description: event.currentTarget.value })} value={drafts.longTerm.description} />
              <label htmlFor="long-term-start">开始日期</label>
              <input id="long-term-start" onChange={(event) => updateLongTerm({ startDate: event.currentTarget.value })} type="date" value={drafts.longTerm.startDate} />
              <label htmlFor="long-term-target">目标日期</label>
              <input id="long-term-target" onChange={(event) => updateLongTerm({ targetDate: event.currentTarget.value })} type="date" value={drafts.longTerm.targetDate} />
            </div>
          ) : null}
          <button disabled={mutationsLocked || !drafts.longTerm.lifeAreaId} type="submit">创建长期目标</button>
        </form>

        <form className="planning-form" onSubmit={(event) => { event.preventDefault(); submitStage(); }}>
          <div className="section-heading">
            <div>
              <h2>阶段目标</h2>
            </div>
          </div>
          <label htmlFor="stage-title">阶段目标名称</label>
          <input id="stage-title" maxLength={500} onChange={(event) => updateStage({ title: event.currentTarget.value })} required value={drafts.stage.title} />
          <label htmlFor="stage-parent">父级长期目标</label>
          <select id="stage-parent" onChange={(event) => updateStage({ parentGoalId: event.currentTarget.value })} value={drafts.stage.parentGoalId}>
            <option value="">选择长期目标</option>
            {longTermGoals.map((goal) => <option key={goal.id} value={goal.id}>长期目标 · {goal.title}</option>)}
          </select>
          <button
            aria-expanded={advanced.stage}
            className="planning-advanced-toggle"
            onClick={() => setAdvanced((current) => ({ ...current, stage: !current.stage }))}
            type="button"
          >
            {advanced.stage ? "收起高级字段" : "显示高级字段"}
          </button>
          {advanced.stage ? (
            <div className="planning-advanced-fields">
              <label htmlFor="stage-description">阶段描述</label>
              <textarea id="stage-description" maxLength={20_000} onChange={(event) => updateStage({ description: event.currentTarget.value })} value={drafts.stage.description} />
              <label htmlFor="stage-start">开始日期</label>
              <input id="stage-start" onChange={(event) => updateStage({ startDate: event.currentTarget.value })} type="date" value={drafts.stage.startDate} />
              <label htmlFor="stage-target">目标日期</label>
              <input id="stage-target" onChange={(event) => updateStage({ targetDate: event.currentTarget.value })} type="date" value={drafts.stage.targetDate} />
            </div>
          ) : null}
          <button disabled={mutationsLocked || !drafts.stage.parentGoalId} type="submit">创建阶段目标</button>
        </form>

        <form className="planning-form" onSubmit={(event) => { event.preventDefault(); submitAction("weekly"); }}>
          <div className="section-heading">
            <div>
              <h2>本周行动</h2>
            </div>
          </div>
          <label htmlFor="weekly-title">本周行动名称</label>
          <input id="weekly-title" maxLength={500} onChange={(event) => updateAction("weekly", { title: event.currentTarget.value })} required value={drafts.weekly.title} />
          <label htmlFor="weekly-goal">关联目标（可选）</label>
          <select id="weekly-goal" onChange={(event) => updateAction("weekly", { goalId: event.currentTarget.value })} value={drafts.weekly.goalId}>
            <option value="">暂不关联目标</option>
            {snapshot.goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.goalType === "long-term" ? "长期目标" : "阶段目标"} · {goal.title}</option>)}
          </select>
          <label htmlFor="weekly-priority">优先级</label>
          <select id="weekly-priority" onChange={(event) => updateAction("weekly", { priority: actionPriority(event.currentTarget.value, "normal") })} value={drafts.weekly.priority}>
            <option value="high">高</option>
            <option value="normal">普通</option>
            <option value="low">低</option>
          </select>
          <button aria-expanded={advanced.weekly} className="planning-advanced-toggle" onClick={() => setAdvanced((current) => ({ ...current, weekly: !current.weekly }))} type="button">
            {advanced.weekly ? "收起高级字段" : "显示高级字段"}
          </button>
          {advanced.weekly ? <ActionAdvancedFields draft={drafts.weekly} idPrefix="weekly" onChange={(update) => updateAction("weekly", update)} /> : null}
          <button disabled={mutationsLocked} type="submit">创建本周行动</button>
        </form>

        <form className="planning-form" onSubmit={(event) => { event.preventDefault(); submitAction("today"); }}>
          <div className="section-heading">
            <div>
              <h2>今日行动</h2>
            </div>
          </div>
          <label htmlFor="today-title">今日行动名称</label>
          <input id="today-title" maxLength={500} onChange={(event) => updateAction("today", { title: event.currentTarget.value })} required value={drafts.today.title} />
          <label htmlFor="today-goal">今日关联目标（可选）</label>
          <select id="today-goal" onChange={(event) => updateAction("today", { goalId: event.currentTarget.value })} value={drafts.today.goalId}>
            <option value="">暂不关联目标</option>
            {snapshot.goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.goalType === "long-term" ? "长期目标" : "阶段目标"} · {goal.title}</option>)}
          </select>
          <label htmlFor="today-priority">优先级</label>
          <select id="today-priority" onChange={(event) => updateAction("today", { priority: actionPriority(event.currentTarget.value, "normal") })} value={drafts.today.priority}>
            <option value="high">高</option>
            <option value="normal">普通</option>
            <option value="low">低</option>
          </select>
          <button aria-expanded={advanced.today} className="planning-advanced-toggle" onClick={() => setAdvanced((current) => ({ ...current, today: !current.today }))} type="button">
            {advanced.today ? "收起高级字段" : "显示高级字段"}
          </button>
          {advanced.today ? <ActionAdvancedFields draft={drafts.today} idPrefix="today" onChange={(update) => updateAction("today", update)} /> : null}
          <button disabled={mutationsLocked} type="submit">创建今日行动</button>
        </form>
      </section>

    </section>
  );
}

function ActionAdvancedFields({
  draft,
  idPrefix,
  onChange,
}: {
  draft: ActionDraft;
  idPrefix: string;
  onChange: (update: Partial<ActionDraft>) => void;
}) {
  return (
    <div className="planning-advanced-fields">
      <label htmlFor={`${idPrefix}-estimate`}>预计分钟</label>
      <input id={`${idPrefix}-estimate`} max="1440" min="1" onChange={(event) => onChange({ estimatedMinutes: event.currentTarget.value })} type="number" value={draft.estimatedMinutes} />
      <label htmlFor={`${idPrefix}-notes`}>备注</label>
      <textarea id={`${idPrefix}-notes`} maxLength={20_000} onChange={(event) => onChange({ notes: event.currentTarget.value })} value={draft.notes} />
    </div>
  );
}

function GoalProgressControls({
  goal,
  disabled,
  onSetStatus,
  onUpdateProgress,
}: {
  goal: PlanningSnapshot["goals"][number];
  disabled: boolean;
  onSetStatus: (goal: PlanningSnapshot["goals"][number], status: "completed" | "paused" | "archived" | "active") => void;
  onUpdateProgress: (goal: PlanningSnapshot["goals"][number], percent: number) => void;
}) {
  const [progressDraft, setProgressDraft] = useState(String(goal.progressPercent));
  const parsed = Number(progressDraft);
  const valid = Number.isInteger(parsed) && parsed >= 0 && parsed <= 100;
  return (
    <details className="planning-goal-edit">
      <summary>更新进展 · 完成 · 归档</summary>
      <div className="planning-goal-edit-row">
        <label>
          手动进度（%）
          <input
            aria-label={`目标进度：${goal.title}`}
            disabled={disabled}
            max={100}
            min={0}
            onChange={(event) => setProgressDraft(event.target.value)}
            step={1}
            type="number"
            value={progressDraft}
          />
        </label>
        <button
          disabled={disabled || !valid || parsed === goal.progressPercent}
          onClick={() => onUpdateProgress(goal, parsed)}
          type="button"
        >
          保存进度
        </button>
        {goal.status === "active" ? (
          <>
            <button disabled={disabled} onClick={() => onSetStatus(goal, "completed")} type="button">标记完成</button>
            <button disabled={disabled} onClick={() => onSetStatus(goal, "paused")} type="button">暂停</button>
            <button
              className="planning-goal-archive"
              disabled={disabled}
              onClick={() => {
                if (!window.confirm(`确认归档「${goal.title}」？归档后不再出现在看板。`)) return;
                onSetStatus(goal, "archived");
              }}
              type="button"
            >
              归档
            </button>
          </>
        ) : null}
      </div>
      <p className="planning-meta">完成后目标会从看板消失；进度只做手动陈述，不自动推断。</p>
    </details>
  );
}

function nextDayOf(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function ActionRescheduleControl({
  action,
  disabled,
  onReschedule,
}: {
  action: PlanningAction;
  disabled: boolean;
  onReschedule: (action: PlanningAction, toBusinessDate: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const fromDate = action.businessDate ?? "";
  const [targetDate, setTargetDate] = useState(() => fromDate ? nextDayOf(fromDate) : "");
  return (
    <span className="planning-reschedule">
      <button disabled={disabled} onClick={() => setOpen((current) => !current)} type="button">
        {open ? "取消改期" : "改期"}
      </button>
      {open ? (
        <>
          <input
            aria-label={`改期到：${action.title}`}
            onChange={(event) => setTargetDate(event.target.value)}
            type="date"
            value={targetDate}
          />
          <button
            disabled={disabled || !isBusinessDate(targetDate) || targetDate === action.businessDate}
            onClick={() => {
              onReschedule(action, targetDate);
              setOpen(false);
            }}
            type="button"
          >
            确认改期
          </button>
        </>
      ) : null}
    </span>
  );
}

function ActionList({
  actions,
  businessDate,
  disabled,
  emptyText,
  heading,
  onComplete,
  onReopen,
  onReschedule,
  onSchedule,
  onSkip,
  snapshot,
}: {
  actions: ReadonlyArray<PlanningAction>;
  businessDate: string;
  disabled: boolean;
  emptyText: string;
  heading: string;
  onComplete: (action: PlanningAction) => void;
  onReopen: (action: PlanningAction) => void;
  onReschedule: (action: PlanningAction, toBusinessDate: string) => void;
  onSchedule: (action: PlanningAction) => void;
  onSkip: (action: PlanningAction) => void;
  snapshot: PlanningSnapshot;
}) {
  return (
    <section className="planning-list" aria-labelledby={`${heading}-heading`}>
      <h2 id={`${heading}-heading`}>{heading}</h2>
      {actions.length === 0 ? <p className="planning-empty">{emptyText}</p> : null}
      {actions.map((item) => {
        const goal = item.goalId ? snapshot.goals.find((candidate) => candidate.id === item.goalId) : undefined;
        const alreadyScheduled = item.actionType === "weekly" && snapshot.todayActions.some((today) =>
          today.parentActionId === item.id && today.businessDate === businessDate);
        const dated = item.actionType === "today" && item.businessDate !== null;
        return (
          <article className="planning-item" key={item.id}>
            <div className="planning-item-heading">
              <div>
                <h3>{item.title}</h3>
                <p>{goal ? `关联目标：${goal.title}` : item.goalId ? "关联的历史目标" : "未关联目标"}</p>
              </div>
              <span data-status={item.status}>{actionStatusLabel(item.status)}</span>
            </div>
            <p className="planning-meta">{item.priority === "high" ? "高优先级" : item.priority === "low" ? "低优先级" : "普通优先级"}{item.estimatedMinutes ? ` · ${item.estimatedMinutes} 分钟` : ""}</p>
            {item.businessDate && item.actionType === "weekly" ? <p className="planning-meta">历史日期：{item.businessDate}</p> : null}
            {item.notes ? <p>{item.notes}</p> : null}
            <div className="planning-item-actions">
              {item.actionType === "weekly" && item.status === "pending" && item.businessDate === null ? (
                <button
                  aria-label={`${alreadyScheduled ? "已安排到今天" : "安排到今天"}：${item.title}`}
                  data-action="schedule"
                  disabled={disabled || alreadyScheduled}
                  onClick={() => onSchedule(item)}
                  type="button"
                >
                  {alreadyScheduled ? "已安排到今天" : "安排到今天"}
                </button>
              ) : null}
              {dated && item.status === "pending" ? (
                <button
                  aria-label={`完成：${item.title}`}
                  data-action="complete"
                  disabled={disabled}
                  onClick={() => onComplete(item)}
                  type="button"
                >
                  完成
                </button>
              ) : null}
              {dated && item.status === "pending" ? (
                <button
                  aria-label={`跳过：${item.title}`}
                  data-action="skip"
                  disabled={disabled}
                  onClick={() => onSkip(item)}
                  type="button"
                >
                  跳过
                </button>
              ) : null}
              {dated && item.status === "pending" ? (
                <ActionRescheduleControl action={item} disabled={disabled} onReschedule={onReschedule} />
              ) : null}
              {dated && (item.status === "completed" || item.status === "skipped") ? (
                <button
                  aria-label={`重新打开：${item.title}`}
                  data-action="reopen"
                  disabled={disabled}
                  onClick={() => onReopen(item)}
                  type="button"
                >
                  重新打开
                </button>
              ) : null}
            </div>
          </article>
        );
      })}
    </section>
  );
}
