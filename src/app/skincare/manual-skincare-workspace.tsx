"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";

import {
  isManualSkincarePhotoDataUrl,
  MANUAL_SKINCARE_PHOTO_ACCEPT,
  MANUAL_SKINCARE_PHOTO_MAX_BYTES,
  MANUAL_SKINCARE_PHOTO_TYPES,
  type ManualSkincareCommand,
  type ManualSkincareDayInsight,
  type ManualSkincareDayItemSnapshot,
  type ManualSkincareDaySnapshot,
  type ManualSkincareNoteSection,
  type ManualSkincareProductSnapshot,
  type ManualSkincareProductStatus,
  type ManualSkincareRecoveryCycleSnapshot,
  type ManualSkincareRecoveryPlanSnapshot,
  type ManualSkincareRoutineItemInput,
  type ManualSkincareScope,
  type ManualSkincareSlot,
  type ManualSkincareSnapshot,
} from "@/modules/manual-skincare/contracts";
import { calculateSkincareDayInsight } from "@/modules/manual-skincare/insights";
import {
  addRecoveryCalendarDays,
  calculateRecoveryCountdown,
  currentRecoveryBusinessDate,
  DEFAULT_RECOVERY_DURATION_DAYS,
  deriveRecoveryDurationDays,
  isRecoveryDurationDays,
  MAX_RECOVERY_DURATION_DAYS,
  millisecondsUntilNextShanghaiDate,
  MIN_RECOVERY_DURATION_DAYS,
} from "@/modules/manual-skincare/recovery-countdown";

import {
  useManualSkincareSubmission,
  type ManualSkincareSubmissionStatus,
} from "./use-manual-skincare-submission";
import recoveryStyles from "./recovery-countdown.module.css";

type TabId = "today" | "products" | "recovery" | "history";

export interface ManualSkincareWorkspaceProps {
  readonly initial: ManualSkincareSnapshot;
  readonly today: string;
  readonly request?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readonly storage?: Storage | null;
  readonly createId?: (prefix?: string) => string;
  readonly now?: () => Date;
}

interface ProductDraft {
  readonly productId: string | null;
  readonly name: string;
  readonly brand: string;
  readonly currentPurpose: string;
  readonly status: ManualSkincareProductStatus;
  readonly addedOn: string;
  readonly note: string;
  readonly photoPreviewUrl: string | null;
  /** Undefined preserves the stored photo; null removes it; a data URL replaces it. */
  readonly photoMutation: string | null | undefined;
  readonly revision: number;
}

interface ProductPhotoFeedback {
  readonly kind: "error" | "status";
  readonly text: string;
}

interface CycleDraft {
  readonly name: string;
  readonly goal: string;
  readonly durationDays: string;
  readonly note: string;
  readonly items: ManualSkincareRoutineItemInput[];
}

const tabs: ReadonlyArray<{ readonly id: TabId; readonly label: string }> = [
  { id: "today", label: "今日护肤" },
  { id: "products", label: "护肤品库" },
  { id: "recovery", label: "恢复计划" },
  { id: "history", label: "历史记录" },
];

const slotLabels: Record<ManualSkincareSlot, "AM" | "PM"> = {
  morning: "AM",
  evening: "PM",
};

const productStatusLabels: Record<ManualSkincareProductStatus, string> = {
  active: "使用中",
  paused: "已暂停",
  finished: "已用完",
};

const submissionMessages: Partial<Record<ManualSkincareSubmissionStatus, string>> = {
  saving: "正在保存，原提交内容已冻结。",
  uncertain: "提交结果不确定；页面不会自动重发，请重试原提交或放弃冻结证据。",
  "reload-required": "版本冲突或本机证据发生变化，请重新加载页面后继续。",
  unavailable: "本机提交存储不可用；资料仍可阅读，但所有写入已停用。",
};

function defaultId(prefix = "manual-skincare"): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function tomorrowOf(businessDate: string): string {
  const [year, month, day] = businessDate.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + 1));
  return date.toISOString().slice(0, 10);
}

function allDayItems(day: ManualSkincareDaySnapshot | null): ManualSkincareDayItemSnapshot[] {
  return day ? [...day.morningItems, ...day.eveningItems] : [];
}

function routineFromDay(day: ManualSkincareDaySnapshot | null): ManualSkincareRoutineItemInput[] {
  return allDayItems(day).map(({ itemKey, slot, productId, ordinal }) => ({
    itemKey,
    slot,
    productId,
    ordinal,
  }));
}

function normalizeRoutine(items: readonly ManualSkincareRoutineItemInput[]): ManualSkincareRoutineItemInput[] {
  return (["morning", "evening"] as const).flatMap((slot) => items
    .filter((item) => item.slot === slot)
    .sort((left, right) => left.ordinal - right.ordinal || left.itemKey.localeCompare(right.itemKey))
    .map((item, ordinal) => ({ ...item, ordinal })));
}

function productDraft(product: ManualSkincareProductSnapshot | null, today: string): ProductDraft {
  return product ? {
    productId: product.productId,
    name: product.name,
    brand: product.brand,
    currentPurpose: product.currentPurpose,
    status: product.status,
    addedOn: product.addedOn,
    note: product.note,
    photoPreviewUrl: product.photoUrl ?? null,
    photoMutation: undefined,
    revision: product.revision,
  } : {
    productId: null,
    name: "",
    brand: "",
    currentPurpose: "",
    status: "active",
    addedOn: today,
    note: "",
    photoPreviewUrl: null,
    photoMutation: undefined,
    revision: 0,
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Photo did not produce a data URL."));
    }, { once: true });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Photo read failed.")), { once: true });
    reader.addEventListener("abort", () => reject(new Error("Photo read was cancelled.")), { once: true });
    reader.readAsDataURL(file);
  });
}

function cycleDurationDays(
  cycle: ManualSkincareRecoveryCycleSnapshot,
  anchorOn: string,
): number {
  return isRecoveryDurationDays(cycle.durationDays)
    ? cycle.durationDays
    : deriveRecoveryDurationDays({
        expectedEndOn: cycle.expectedEndOn,
        actualStartedOn: cycle.actualStartedOn,
        anchorOn,
      }) ?? DEFAULT_RECOVERY_DURATION_DAYS;
}

function cycleDraft(
  cycle: ManualSkincareRecoveryCycleSnapshot,
  anchorOn: string,
): CycleDraft {
  return {
    name: cycle.name,
    goal: cycle.goal,
    durationDays: String(cycleDurationDays(cycle, anchorOn)),
    note: cycle.note,
    items: cycle.items.map(({ itemKey, slot, productId, ordinal }) => ({
      itemKey,
      slot,
      productId,
      ordinal,
    })),
  };
}

function cycleDraftMap(
  snapshot: ManualSkincareSnapshot,
  anchorOn: string,
): Record<string, CycleDraft> {
  return Object.fromEntries(snapshot.recoveryPlans.flatMap((plan) =>
    plan.cycles.map((cycle) => [cycle.cycleId, cycleDraft(cycle, anchorOn)])));
}

function emptyCycleDraft(): CycleDraft {
  return {
    name: "恢复周期",
    goal: "稳定恢复",
    durationDays: String(DEFAULT_RECOVERY_DURATION_DAYS),
    note: "",
    items: [],
  };
}

function productName(products: readonly ManualSkincareProductSnapshot[], productId: string): string {
  return products.find((product) => product.productId === productId)?.name ?? "未知产品";
}

function uniqueProductNames(items: readonly ManualSkincareDayItemSnapshot[]): string[] {
  return [...new Set(items.map((item) => item.productName))];
}

function currentCycle(snapshot: ManualSkincareSnapshot): ManualSkincareRecoveryCycleSnapshot | null {
  const selectedId = snapshot.selectedDay?.recoveryCycle?.cycleId;
  const all = snapshot.recoveryPlans.flatMap((plan) => plan.cycles);
  return all.find((cycle) => cycle.cycleId === selectedId)
    ?? all.find((cycle) => cycle.status === "active")
    ?? null;
}

function nextCycle(
  plans: readonly ManualSkincareRecoveryPlanSnapshot[],
  current: ManualSkincareRecoveryCycleSnapshot | null,
): { plan: ManualSkincareRecoveryPlanSnapshot; cycle: ManualSkincareRecoveryCycleSnapshot } | null {
  if (current) {
    const plan = plans.find((candidate) => candidate.planId === current.planId);
    const cycle = plan?.cycles
      .filter((candidate) => candidate.ordinal > current.ordinal && candidate.status !== "completed")
      .sort((left, right) => left.ordinal - right.ordinal)[0];
    return plan && cycle ? { plan, cycle } : null;
  }
  for (const plan of plans) {
    const cycle = [...plan.cycles]
      .filter((candidate) => candidate.status !== "completed")
      .sort((left, right) => left.ordinal - right.ordinal)[0];
    if (cycle) return { plan, cycle };
  }
  return null;
}

function itemSummary(
  items: readonly { slot: ManualSkincareSlot; productName: string; ordinal: number }[],
): string {
  const summary = [...items]
    .sort((left, right) => left.slot.localeCompare(right.slot) || left.ordinal - right.ordinal)
    .map((item) => `${slotLabels[item.slot]} ${item.productName}`)
    .join("、");
  return summary || "未配置产品";
}

function historyProductSummary(day: ManualSkincareDaySnapshot): string {
  const summary = allDayItems(day).map((item) => (
    `${slotLabels[item.slot]} ${item.productName}（${item.currentPurpose || "未注明作用"}）`
  ));
  return summary.length ? summary.join("、") : "—";
}

function historyNoteSummary(day: ManualSkincareDaySnapshot): string {
  return [
    day.morningNote ? `晨：${day.morningNote}` : "",
    day.eveningNote ? `晚：${day.eveningNote}` : "",
    day.overallNote ? `整体：${day.overallNote}` : "",
  ].filter(Boolean).join("；") || "—";
}

function percent(value: number | null): string {
  return value === null ? "—" : `${value}分`;
}

function SkincareTrendChart({ insights }: { readonly insights: readonly ManualSkincareDayInsight[] }) {
  const ordered = [...insights].sort((left, right) => left.businessDate.localeCompare(right.businessDate));
  if (ordered.every((item) => item.stabilityScore === null)) {
    return <p className="manual-skincare-history-empty">暂无稳定度记录。</p>;
  }
  const width = 720;
  const height = 240;
  const left = 42;
  const right = 18;
  const top = 18;
  const bottom = 38;
  const x = (index: number) => ordered.length === 1
    ? width / 2
    : left + (index / (ordered.length - 1)) * (width - left - right);
  const y = (value: number) => top + ((100 - value) / 100) * (height - top - bottom);
  const paths = (value: (item: ManualSkincareDayInsight) => number | null) => {
    const result: string[] = [];
    let current = "";
    ordered.forEach((item, index) => {
      const point = value(item);
      if (point === null) {
        if (current) result.push(current);
        current = "";
        return;
      }
      current += `${current ? " L" : "M"} ${x(index).toFixed(2)} ${y(point).toFixed(2)}`;
    });
    if (current) result.push(current);
    return result;
  };
  const labelIndexes = new Set([0, Math.floor((ordered.length - 1) / 2), ordered.length - 1]);

  return (
    <figure className="manual-skincare-trend">
      <figcaption>
        <strong>护肤周期稳定度</strong>
        <span><i className="trend-key skincare" />执行稳定度 <i className="trend-key sleep" />睡眠趋势分</span>
      </figcaption>
      <svg aria-label="护肤执行稳定度与同日睡眠趋势折线图" role="img" viewBox={`0 0 ${width} ${height}`}>
        {[0, 50, 100].map((tick) => <g key={tick}>
          <line className="trend-grid-line" x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} />
          <text className="trend-axis-label" x={left - 10} y={y(tick) + 4} textAnchor="end">{tick}</text>
        </g>)}
        {paths((item) => item.stabilityScore).map((path, index) => <path className="skincare-stability-line" d={path} fill="none" key={`stability-${index}`} />)}
        {paths((item) => item.sleepQualityScore).map((path, index) => <path className="skincare-sleep-line" d={path} fill="none" key={`sleep-${index}`} />)}
        {ordered.map((item, index) => <g key={item.businessDate}>
          {item.stabilityScore !== null ? <circle className="skincare-stability-point" cx={x(index)} cy={y(item.stabilityScore)} r="5"><title>{item.businessDate} 执行稳定度 {item.stabilityScore} 分</title></circle> : null}
          {item.sleepQualityScore !== null ? <circle className="skincare-sleep-point" cx={x(index)} cy={y(item.sleepQualityScore)} r="4"><title>{item.businessDate} 睡眠趋势 {item.sleepQualityScore} 分</title></circle> : null}
          {labelIndexes.has(index) ? <text className="trend-date-label" x={x(index)} y={height - 12} textAnchor="middle">{item.businessDate.slice(5)}</text> : null}
        </g>)}
      </svg>
    </figure>
  );
}

function HistoryTable({
  days,
  insights,
}: {
  readonly days: readonly ManualSkincareDaySnapshot[];
  readonly insights: readonly ManualSkincareDayInsight[];
}) {
  const byDate = new Map(insights.map((item) => [item.businessDate, item]));
  return (
    <div className="manual-skincare-history-table-wrap">
      <table className="manual-skincare-history-table">
        <thead><tr><th>日期</th><th>周期</th><th>AM</th><th>PM</th><th>当日清单</th><th>完成率</th><th>睡眠趋势</th><th>作息波动</th><th>睡眠扣权</th><th>稳定度</th><th>备注</th></tr></thead>
        <tbody>{days.map((day) => {
          const insight = byDate.get(day.businessDate) ?? calculateSkincareDayInsight(day, null);
          const morningUsed = day.morningItems.filter((item) => item.used).length;
          const eveningUsed = day.eveningItems.filter((item) => item.used).length;
          return <tr key={day.businessDate}>
            <th scope="row">{day.businessDate}</th>
            <td>{day.recoveryCycle?.name ?? "未绑定"}</td>
            <td>{morningUsed}/{day.morningItems.length}</td>
            <td>{eveningUsed}/{day.eveningItems.length}</td>
            <td className="manual-skincare-history-products">{historyProductSummary(day)}</td>
            <td>{percent(insight.completionPercent)}</td>
            <td>{percent(insight.sleepQualityScore)}</td>
            <td>{insight.sleepVariabilityMinutes === null ? "—" : `${insight.sleepVariabilityMinutes}分钟`}</td>
            <td>{insight.sleepQualityScore === null ? "未关联" : insight.sleepPenalty === 0 ? "0" : `−${insight.sleepPenalty}`}</td>
            <td><strong>{percent(insight.stabilityScore)}</strong></td>
            <td className="manual-skincare-history-notes">{historyNoteSummary(day)}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  );
}

function RecoveryCountdownView({
  cycle,
  today,
}: {
  readonly cycle: ManualSkincareRecoveryCycleSnapshot;
  readonly today: string;
}) {
  const durationDays = cycleDurationDays(cycle, today);
  const countdown = calculateRecoveryCountdown({
    ...cycle,
    durationDays,
  }, today);
  const stateLabel = cycle.status === "draft"
    ? "等待开始"
    : countdown?.state === "completed"
      ? "已完成"
      : countdown?.state === "due"
        ? "已到期"
        : countdown?.state === "scheduled"
          ? "等待生效"
          : `第 ${countdown?.currentDay ?? 1} 天`;

  return (
    <section className={recoveryStyles.countdown} aria-label={`${cycle.name}倒计时`}>
      <dl className={recoveryStyles.metrics}>
        <div className={recoveryStyles.metric}><dt>总周期</dt><dd>{durationDays} 天</dd></div>
        <div className={recoveryStyles.metric}><dt>已进行</dt><dd>{countdown ? `${countdown.elapsedDays} 天` : "—"}</dd></div>
        <div className={recoveryStyles.metric}><dt>剩余</dt><dd>{countdown ? `${countdown.remainingDays} 天` : "—"}</dd></div>
        <div className={recoveryStyles.metric}><dt>状态</dt><dd>{stateLabel}</dd></div>
      </dl>
      <p className={recoveryStyles.caption}>
        预计完成日：{cycle.status === "draft" ? "开始时根据生效日确定" : cycle.expectedEndOn ?? "未设置"}
        {cycle.actualStartedOn ? ` · 开始日：${cycle.actualStartedOn}` : ""}
        {cycle.actualCompletedOn ? ` · 完成日：${cycle.actualCompletedOn}` : ""}
      </p>
      {countdown?.state === "due" ? (
        <p className={recoveryStyles.due}>计划已经到期，历史数据仍完整保留。请确认实际完成后再结束周期。</p>
      ) : null}
    </section>
  );
}

export function ManualSkincareWorkspace({
  initial,
  today,
  request,
  storage,
  createId = defaultId,
  now,
}: ManualSkincareWorkspaceProps) {
  const [snapshot, setSnapshot] = useState(initial);
  const [tab, setTab] = useState<TabId>("today");
  const [message, setMessage] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState(() => ({
    morning: initial.selectedDay?.morningNote ?? "",
    evening: initial.selectedDay?.eveningNote ?? "",
    overall: initial.selectedDay?.overallNote ?? "",
  }));
  const [routineEditing, setRoutineEditing] = useState(false);
  const [routineScope, setRoutineScope] = useState<ManualSkincareScope>("today-only");
  const [routineItems, setRoutineItems] = useState(() => routineFromDay(initial.selectedDay));
  const [routineChangeNote, setRoutineChangeNote] = useState("");
  const [selectedProductId, setSelectedProductId] = useState<string | null>(initial.products[0]?.productId ?? null);
  const [product, setProduct] = useState(() => productDraft(initial.products[0] ?? null, today));
  const photoDragDepth = useRef(0);
  const [photoDragActive, setPhotoDragActive] = useState(false);
  const [photoFeedback, setPhotoFeedback] = useState<ProductPhotoFeedback | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(initial.recoveryPlans[0]?.planId ?? null);
  const selectedPlan = snapshot.recoveryPlans.find((plan) => plan.planId === selectedPlanId) ?? null;
  const [planName, setPlanName] = useState(initial.recoveryPlans[0]?.name ?? "");
  const [planNote, setPlanNote] = useState(initial.recoveryPlans[0]?.note ?? "");
  const [cycleDrafts, setCycleDrafts] = useState(() => cycleDraftMap(initial, today));
  const [newCycleDraft, setNewCycleDraft] = useState<CycleDraft>(emptyCycleDraft);
  const [countdownToday, setCountdownToday] = useState(today);
  const [startConfirming, setStartConfirming] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState<"" | "today" | "tomorrow">("");
  const [completing, setCompleting] = useState(false);
  const submission = useManualSkincareSubmission({
    request,
    storage,
    createId: () => createId("submission"),
    now,
  });

  useEffect(() => {
    setSnapshot(initial);
  }, [initial]);

  useEffect(() => {
    setNoteDrafts({
      morning: snapshot.selectedDay?.morningNote ?? "",
      evening: snapshot.selectedDay?.eveningNote ?? "",
      overall: snapshot.selectedDay?.overallNote ?? "",
    });
    setRoutineItems(routineFromDay(snapshot.selectedDay));
  }, [snapshot.selectedDay]);

  useEffect(() => {
    const current = snapshot.products.find((candidate) => candidate.productId === selectedProductId) ?? null;
    if (current) setProduct(productDraft(current, today));
    photoDragDepth.current = 0;
    setPhotoDragActive(false);
    setPhotoFeedback(null);
  }, [selectedProductId, snapshot.products, today]);

  useEffect(() => {
    const plan = snapshot.recoveryPlans.find((candidate) => candidate.planId === selectedPlanId) ?? null;
    if (plan) {
      setPlanName(plan.name);
      setPlanNote(plan.note);
    }
    setCycleDrafts(cycleDraftMap(snapshot, today));
  }, [selectedPlanId, snapshot.recoveryPlans, today]);

  useEffect(() => {
    setCountdownToday(today);
    let timer = 0;
    const schedule = () => {
      const current = now?.() ?? new Date();
      timer = window.setTimeout(() => {
        const next = now?.() ?? new Date();
        setCountdownToday(currentRecoveryBusinessDate(next));
        schedule();
      }, millisecondsUntilNextShanghaiDate(current) + 50);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [now, today]);

  const day = snapshot.selectedDay;
  const usedRemovedFromRoutine = useMemo(() => {
    const kept = new Set(routineItems.map((item) => item.itemKey));
    return allDayItems(day).filter((item) => item.used && !kept.has(item.itemKey));
  }, [day, routineItems]);
  const activeCycle = currentCycle(snapshot);
  const upcoming = nextCycle(snapshot.recoveryPlans, activeCycle);
  const currentNames = activeCycle
    ? [...new Set(activeCycle.items.map((item) => item.productName))]
    : uniqueProductNames(allDayItems(day));
  const tomorrow = tomorrowOf(today);
  const writesDisabled = !submission.canWrite;

  async function apply(command: ManualSkincareCommand): Promise<boolean> {
    const options = command.type === "replace-routine" && command.scope === "today-and-future"
      ? { activationSequence: snapshot.activationSequence + 1 }
      : undefined;
    const result = await submission.submit(command, options);
    if (!result) return false;
    setSnapshot(result.snapshot);
    setMessage("已保存。只更新服务器确认返回的轻量护肤快照。");
    return true;
  }

  async function retry(): Promise<void> {
    const result = await submission.retry();
    if (!result) return;
    setSnapshot(result.snapshot);
    setMessage("原提交已得到精确确认。");
  }

  function abandon(): void {
    if (submission.abandon()) {
      setMessage("已放弃匹配的冻结证据；当前可见草稿仍保留。下一步请先核对服务器事实。");
    }
  }

  async function toggleUsed(item: ManualSkincareDayItemSnapshot, used: boolean): Promise<void> {
    if (!day || snapshot.businessDate > today) return;
    await apply({
      type: "set-day-items-used",
      businessDate: snapshot.businessDate,
      itemKeys: [item.itemKey],
      used,
      expectedDayRevision: day.revision,
    });
  }

  async function saveNote(section: ManualSkincareNoteSection): Promise<void> {
    if (!day) return;
    await apply({
      type: "save-day-note",
      businessDate: snapshot.businessDate,
      section,
      note: noteDrafts[section],
      expectedDayRevision: day.revision,
    });
  }

  function toggleRoutineProduct(slot: ManualSkincareSlot, productId: string, checked: boolean): void {
    setRoutineItems((current) => {
      if (!checked) return normalizeRoutine(current.filter((item) => !(item.slot === slot && item.productId === productId)));
      if (current.some((item) => item.slot === slot && item.productId === productId)) return current;
      return normalizeRoutine([...current, {
        itemKey: `routine-${slot}-${productId}`.slice(0, 128),
        slot,
        productId,
        ordinal: current.filter((item) => item.slot === slot).length,
      }]);
    });
  }

  function moveRoutineItem(itemKey: string, delta: -1 | 1): void {
    setRoutineItems((current) => {
      const selected = current.find((item) => item.itemKey === itemKey);
      if (!selected) return current;
      const inSlot = current.filter((item) => item.slot === selected.slot).sort((a, b) => a.ordinal - b.ordinal);
      const index = inSlot.findIndex((item) => item.itemKey === itemKey);
      const target = index + delta;
      if (target < 0 || target >= inSlot.length) return current;
      [inSlot[index], inSlot[target]] = [inSlot[target]!, inSlot[index]!];
      const ordinals = new Map(inSlot.map((item, ordinal) => [item.itemKey, ordinal]));
      return normalizeRoutine(current.map((item) => item.slot === selected.slot
        ? { ...item, ordinal: ordinals.get(item.itemKey)! }
        : item));
    });
  }

  async function saveRoutine(): Promise<void> {
    if (!day) return;
    const saved = await apply({
      type: "replace-routine",
      businessDate: snapshot.businessDate,
      scope: routineScope,
      items: normalizeRoutine(routineItems),
      changeNote: routineChangeNote,
      expectedRoutineRevision: snapshot.latestRoutineRevision,
      expectedDayRevision: day.revision,
      confirmedRemovedUsedItemKeys: usedRemovedFromRoutine.map((item) => item.itemKey).sort(),
    });
    if (saved) {
      setRoutineEditing(false);
      setRoutineChangeNote("");
    }
  }

  async function chooseProductPhoto(file: File | undefined): Promise<void> {
    setPhotoFeedback(null);
    if (!file) return;
    if (!MANUAL_SKINCARE_PHOTO_TYPES.some((mediaType) => mediaType === file.type)) {
      setPhotoFeedback({ kind: "error", text: "只能使用 JPEG、PNG 或 WebP 图片。" });
      return;
    }
    if (file.size < 1 || file.size > MANUAL_SKINCARE_PHOTO_MAX_BYTES) {
      setPhotoFeedback({ kind: "error", text: "照片必须小于或等于 2 MB，且不能为空文件。" });
      return;
    }
    try {
      const photoDataUrl = await readFileAsDataUrl(file);
      if (!isManualSkincarePhotoDataUrl(photoDataUrl)) {
        setPhotoFeedback({ kind: "error", text: "文件内容不是有效的 JPEG、PNG 或 WebP 图片。" });
        return;
      }
      setProduct((current) => ({
        ...current,
        photoPreviewUrl: photoDataUrl,
        photoMutation: photoDataUrl,
      }));
      setPhotoFeedback({ kind: "status", text: "照片已载入预览；保存护肤品后会写入本地数据库。" });
    } catch {
      setPhotoFeedback({ kind: "error", text: "无法读取这张照片，请重新选择。" });
    }
  }

  function productPhotoDragEnter(event: DragEvent<HTMLDivElement>): void {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    photoDragDepth.current += 1;
    setPhotoDragActive(true);
  }

  function productPhotoDragOver(event: DragEvent<HTMLDivElement>): void {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function productPhotoDragLeave(event: DragEvent<HTMLDivElement>): void {
    if (photoDragDepth.current === 0) return;
    event.preventDefault();
    photoDragDepth.current = Math.max(0, photoDragDepth.current - 1);
    if (photoDragDepth.current === 0) setPhotoDragActive(false);
  }

  function productPhotoDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    photoDragDepth.current = 0;
    setPhotoDragActive(false);
    void chooseProductPhoto(event.dataTransfer.files[0]);
  }

  function productPhotoInputChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    void chooseProductPhoto(file);
  }

  function removeProductPhoto(): void {
    setProduct((current) => ({ ...current, photoPreviewUrl: null, photoMutation: null }));
    setPhotoFeedback({ kind: "status", text: "照片已从预览移除；保存护肤品后会从本地数据库删除。" });
  }

  async function saveProduct(): Promise<void> {
    const productId = product.productId ?? createId("product");
    const saved = await apply({
      type: "save-product",
      productId,
      name: product.name.trim(),
      brand: product.brand.trim(),
      currentPurpose: product.currentPurpose.trim(),
      status: product.status,
      addedOn: product.addedOn,
      note: product.note,
      ...(product.photoMutation !== undefined ? { photoDataUrl: product.photoMutation } : {}),
      expectedProductRevision: product.revision,
    });
    if (saved) {
      setSelectedProductId(productId);
      setPhotoFeedback({ kind: "status", text: "护肤品与照片已保存到本地数据库。" });
    }
  }

  async function savePlan(): Promise<void> {
    const planId = selectedPlan?.planId ?? createId("recovery-plan");
    const saved = await apply({
      type: "save-recovery-plan",
      planId,
      name: planName.trim(),
      note: planNote,
      expectedPlanRevision: selectedPlan?.revision ?? 0,
    });
    if (saved) setSelectedPlanId(planId);
  }

  function updateCycleDraft(cycleId: string, patch: Partial<CycleDraft>): void {
    setCycleDrafts((current) => ({
      ...current,
      [cycleId]: { ...current[cycleId]!, ...patch },
    }));
  }

  function toggleCycleProduct(
    cycle: ManualSkincareRecoveryCycleSnapshot,
    slot: ManualSkincareSlot,
    productId: string,
    checked: boolean,
  ): void {
    const draft = cycleDrafts[cycle.cycleId] ?? cycleDraft(cycle, countdownToday);
    const next = !checked
      ? draft.items.filter((item) => !(item.slot === slot && item.productId === productId))
      : draft.items.some((item) => item.slot === slot && item.productId === productId)
        ? draft.items
        : [...draft.items, {
          itemKey: `cycle-${slot}-${productId}`.slice(0, 128),
          slot,
          productId,
          ordinal: draft.items.filter((item) => item.slot === slot).length,
        }];
    updateCycleDraft(cycle.cycleId, { items: normalizeRoutine(next) });
  }

  function toggleNewCycleProduct(
    slot: ManualSkincareSlot,
    productId: string,
    checked: boolean,
  ): void {
    setNewCycleDraft((current) => {
      const items = !checked
        ? current.items.filter((item) => !(item.slot === slot && item.productId === productId))
        : current.items.some((item) => item.slot === slot && item.productId === productId)
          ? current.items
          : [...current.items, {
              itemKey: `cycle-${slot}-${productId}`.slice(0, 128),
              slot,
              productId,
              ordinal: current.items.filter((item) => item.slot === slot).length,
            }];
      return { ...current, items: normalizeRoutine(items) };
    });
  }

  async function saveCycle(plan: ManualSkincareRecoveryPlanSnapshot, cycle: ManualSkincareRecoveryCycleSnapshot): Promise<void> {
    const draft = cycleDrafts[cycle.cycleId] ?? cycleDraft(cycle, countdownToday);
    const durationDays = Number(draft.durationDays);
    if (!isRecoveryDurationDays(durationDays)) return;
    await apply({
      type: "save-recovery-cycle",
      planId: plan.planId,
      cycleId: cycle.cycleId,
      ordinal: cycle.ordinal,
      name: draft.name.trim(),
      goal: draft.goal.trim(),
      durationDays,
      expectedEndOn: null,
      note: draft.note,
      items: normalizeRoutine(draft.items),
      expectedPlanRevision: plan.revision,
      expectedCycleRevision: cycle.revision,
      expectedRoutineRevision: snapshot.latestRoutineRevision,
    });
  }

  async function createCycle(): Promise<void> {
    if (!selectedPlan) return;
    const durationDays = Number(newCycleDraft.durationDays);
    if (!isRecoveryDurationDays(durationDays)) return;
    const saved = await apply({
      type: "save-recovery-cycle",
      planId: selectedPlan.planId,
      cycleId: createId("recovery-cycle"),
      ordinal: selectedPlan.cycles.reduce((maximum, cycle) => Math.max(maximum, cycle.ordinal), -1) + 1,
      name: newCycleDraft.name.trim(),
      goal: newCycleDraft.goal.trim(),
      durationDays,
      expectedEndOn: null,
      note: newCycleDraft.note,
      items: normalizeRoutine(newCycleDraft.items),
      expectedPlanRevision: selectedPlan.revision,
      expectedCycleRevision: 0,
      expectedRoutineRevision: snapshot.latestRoutineRevision,
    });
    if (saved) setNewCycleDraft(emptyCycleDraft());
  }

  async function completeCurrentCycle(): Promise<void> {
    if (!activeCycle || completing) return;
    setCompleting(true);
    try {
      const saved = await apply({
        type: "complete-recovery-cycle",
        cycleId: activeCycle.cycleId,
        completedOn: today,
        expectedCycleRevision: activeCycle.revision,
      });
      if (saved) setMessage("当前周期已完成；下一周期没有自动开始。请另行明确确认。 ");
    } finally {
      setCompleting(false);
    }
  }

  async function startUpcomingCycle(): Promise<void> {
    if (!upcoming || !effectiveFrom || snapshot.businessDate !== today) return;
    const date = effectiveFrom === "today" ? today : tomorrow;
    const usedRemoved = date === snapshot.businessDate
      ? allDayItems(day).filter((item) => item.used && !upcoming.cycle.items.some((candidate) => candidate.itemKey === item.itemKey))
      : [];
    const saved = await apply({
      type: "start-recovery-cycle",
      planId: upcoming.plan.planId,
      cycleId: upcoming.cycle.cycleId,
      effectiveFrom: date,
      expectedPlanRevision: upcoming.plan.revision,
      expectedCycleRevision: upcoming.cycle.revision,
      expectedCurrentCycleId: activeCycle?.cycleId ?? null,
      expectedCurrentCycleRevision: activeCycle?.revision ?? 0,
      expectedActivationSequence: snapshot.activationSequence,
      expectedDayRevision: date === snapshot.businessDate ? day?.revision ?? 0 : 0,
      confirmedRemovedUsedItemKeys: usedRemoved.map((item) => item.itemKey).sort(),
    });
    if (saved) {
      setStartConfirming(false);
      setEffectiveFrom("");
    }
  }

  function submissionNotice() {
    const automatic = submissionMessages[submission.status];
    if (!automatic && !message) return null;
    return (
      <div className="manual-skincare-notice" role="status">
        <p>{automatic ?? message}</p>
        {submission.status === "uncertain" ? (
          <div className="manual-skincare-actions">
            <button type="button" onClick={() => { void retry(); }}>重试原提交</button>
            <button type="button" onClick={abandon}>放弃冻结证据</button>
          </div>
        ) : null}
        {submission.status === "reload-required" ? (
          <button type="button" onClick={abandon}>仅清理匹配的冻结证据</button>
        ) : null}
      </div>
    );
  }

  function renderToday() {
    if (!day) return <p role="status">所选日期尚无可显示的日快照。</p>;
    return (
      <div className="manual-skincare-today">
        <header className="manual-skincare-section-heading">
          <div>
            <p className="eyebrow">{snapshot.businessDate}</p>
            <h2>今日护肤</h2>
            <p>当前周期：{day.recoveryCycle?.name ?? "未绑定"}</p>
          </div>
          <button type="button" disabled={writesDisabled} onClick={() => setRoutineEditing((value) => !value)}>
            {routineEditing ? "收起清单编辑" : "编辑今日清单"}
          </button>
        </header>

        <div className="manual-skincare-routine-grid">
          {(["morning", "evening"] as const).map((slot) => {
            const items = slot === "morning" ? day.morningItems : day.eveningItems;
            return (
              <section key={slot} aria-labelledby={`manual-${slot}-title`}>
                <h3 id={`manual-${slot}-title`}>{slotLabels[slot]}</h3>
                {items.length === 0 ? <p>暂无产品。</p> : (
                  <ol className="manual-skincare-checklist">
                    {items.map((item) => (
                      <li key={item.itemKey}>
                        <label>
                          <input
                            aria-label={`${slotLabels[slot]} ${item.productName}已使用`}
                            checked={item.used}
                            disabled={writesDisabled || snapshot.businessDate > today}
                            onChange={(event) => { void toggleUsed(item, event.currentTarget.checked); }}
                            type="checkbox"
                          />
                          <span><strong>{item.productName}</strong><small>{item.brand} · {item.currentPurpose}</small></span>
                        </label>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            );
          })}
        </div>

        <details className="manual-skincare-details">
          <summary>三段备注</summary>
          <div className="manual-skincare-notes">
            {(["morning", "evening", "overall"] as const).map((section) => {
              const label = section === "morning" ? "晨间备注" : section === "evening" ? "晚间备注" : "整体备注";
              return (
                <div key={section}>
                  <label htmlFor={`manual-note-${section}`}>{label}</label>
                  <textarea id={`manual-note-${section}`} onChange={(event) => {
                    const value = event.currentTarget.value;
                    setNoteDrafts((current) => ({ ...current, [section]: value }));
                  }} value={noteDrafts[section]} />
                  <button disabled={writesDisabled} type="button" onClick={() => { void saveNote(section); }}>保存{label}</button>
                </div>
              );
            })}
          </div>
        </details>

        {routineEditing ? (
          <section className="manual-skincare-editor" aria-labelledby="routine-editor-title">
            <h3 id="routine-editor-title">清单范围与顺序</h3>
            <fieldset>
              <legend>本次调整范围</legend>
              <label><input checked={routineScope === "today-only"} name="routine-scope" onChange={() => setRoutineScope("today-only")} type="radio" />仅今天</label>
              <label><input checked={routineScope === "today-and-future"} disabled={snapshot.businessDate < today} name="routine-scope" onChange={() => setRoutineScope("today-and-future")} type="radio" />今天及以后</label>
            </fieldset>
            <div className="manual-skincare-routine-grid">
              {(["morning", "evening"] as const).map((slot) => (
                <fieldset key={slot}>
                  <legend>{slotLabels[slot]} 产品顺序</legend>
                  {snapshot.products.map((candidate) => {
                    const item = routineItems.find((entry) => entry.slot === slot && entry.productId === candidate.productId);
                    return (
                      <div className="manual-skincare-order-row" key={candidate.productId}>
                        <label>
                          <input aria-label={`${slotLabels[slot]} ${candidate.name}保留在清单`} checked={Boolean(item)} onChange={(event) => toggleRoutineProduct(slot, candidate.productId, event.currentTarget.checked)} type="checkbox" />
                          {candidate.name}
                        </label>
                        {item ? <span>
                          <button aria-label={`${slotLabels[slot]} ${candidate.name}上移`} type="button" onClick={() => moveRoutineItem(item.itemKey, -1)}>↑</button>
                          <button aria-label={`${slotLabels[slot]} ${candidate.name}下移`} type="button" onClick={() => moveRoutineItem(item.itemKey, 1)}>↓</button>
                        </span> : null}
                      </div>
                    );
                  })}
                </fieldset>
              ))}
            </div>
            <label htmlFor="manual-routine-change-note">调整说明</label>
            <textarea id="manual-routine-change-note" onChange={(event) => setRoutineChangeNote(event.currentTarget.value)} value={routineChangeNote} />
            {usedRemovedFromRoutine.length ? (
              <div className="manual-skincare-warning" role="alert">
                <p>将移除 {usedRemovedFromRoutine.length} 个已使用项：</p>
                <ul>{usedRemovedFromRoutine.map((item) => <li key={item.itemKey}>{slotLabels[item.slot]} {item.productName}</li>)}</ul>
              </div>
            ) : null}
            <button disabled={writesDisabled} type="button" onClick={() => { void saveRoutine(); }}>
              {usedRemovedFromRoutine.length ? "确认移除并保存清单" : "保存清单"}
            </button>
          </section>
        ) : null}
      </div>
    );
  }

  function renderProducts() {
    return (
      <div className="manual-skincare-products">
        <header className="manual-skincare-section-heading">
          <h2>护肤品库</h2>
          <button disabled={writesDisabled} type="button" onClick={() => {
            setSelectedProductId(null);
            setProduct(productDraft(null, today));
            photoDragDepth.current = 0;
            setPhotoDragActive(false);
            setPhotoFeedback(null);
          }}>新增护肤品</button>
        </header>
        <div className="manual-skincare-product-layout">
          <nav aria-label="护肤品选择">
            {snapshot.products.length === 0 ? <p>暂无护肤品。</p> : snapshot.products.map((candidate) => (
              <button aria-current={candidate.productId === selectedProductId ? "true" : undefined} key={candidate.productId} type="button" onClick={() => setSelectedProductId(candidate.productId)}>
                <strong>{candidate.name}</strong><span>{productStatusLabels[candidate.status]}</span>
              </button>
            ))}
          </nav>
          <section className="manual-skincare-editor" aria-label={product.productId ? `编辑${product.name}` : "新增护肤品"}>
            <div
              aria-labelledby="manual-product-photo-title"
              className={`manual-skincare-photo-dropzone${photoDragActive ? " is-drag-active" : ""}`}
              data-drag-active={photoDragActive ? "true" : "false"}
              onDragEnter={productPhotoDragEnter}
              onDragLeave={productPhotoDragLeave}
              onDragOver={productPhotoDragOver}
              onDrop={productPhotoDrop}
              role="group"
            >
              <div className="manual-skincare-photo-copy">
                <h3 id="manual-product-photo-title">产品照片</h3>
                <p id="manual-product-photo-help">
                  {photoDragActive ? "松开鼠标即可载入照片" : "把本地照片拖到这里，或使用下方文件选择器。"}
                </p>
                <p>支持 JPEG、PNG、WebP，最多 2 MB。照片保存在本地数据库中并随备份保留。</p>
              </div>
              {product.photoPreviewUrl ? (
                <figure className="manual-skincare-photo-preview">
                  {/* A plain img can preview both a freshly selected data URL and the versioned local endpoint. */}
                  <img alt={`${product.name.trim() || "护肤品"}照片预览`} src={product.photoPreviewUrl} />
                  <figcaption>当前照片预览</figcaption>
                </figure>
              ) : <p className="manual-skincare-photo-empty">尚未添加照片</p>}
              <div className="manual-skincare-photo-actions">
                <label htmlFor="manual-product-photo">{product.photoPreviewUrl ? "选择替换照片" : "选择本地照片"}</label>
                <input
                  accept={MANUAL_SKINCARE_PHOTO_ACCEPT}
                  aria-describedby="manual-product-photo-help"
                  aria-label={product.photoPreviewUrl ? "选择本地照片替换当前照片" : "选择本地护肤品照片"}
                  disabled={writesDisabled}
                  id="manual-product-photo"
                  onChange={productPhotoInputChange}
                  type="file"
                />
                {product.photoPreviewUrl ? <button disabled={writesDisabled} onClick={removeProductPhoto} type="button">移除照片</button> : null}
              </div>
              {photoFeedback ? (
                <p
                  aria-live={photoFeedback.kind === "error" ? "assertive" : "polite"}
                  className={`manual-skincare-photo-feedback is-${photoFeedback.kind}`}
                  role={photoFeedback.kind === "error" ? "alert" : "status"}
                >{photoFeedback.text}</p>
              ) : null}
            </div>
            <label htmlFor="manual-product-name">名称</label>
            <input id="manual-product-name" maxLength={160} onChange={(event) => {
              const value = event.currentTarget.value;
              setProduct((current) => ({ ...current, name: value }));
            }} value={product.name} />
            <label htmlFor="manual-product-brand">品牌</label>
            <input id="manual-product-brand" maxLength={160} onChange={(event) => {
              const value = event.currentTarget.value;
              setProduct((current) => ({ ...current, brand: value }));
            }} value={product.brand} />
            <label htmlFor="manual-product-purpose">当前作用</label>
            <textarea id="manual-product-purpose" maxLength={500} onChange={(event) => {
              const value = event.currentTarget.value;
              setProduct((current) => ({ ...current, currentPurpose: value }));
            }} value={product.currentPurpose} />
            <label htmlFor="manual-product-status">状态</label>
            <select id="manual-product-status" onChange={(event) => {
              const value = event.currentTarget.value as ManualSkincareProductStatus;
              setProduct((current) => ({ ...current, status: value }));
            }} value={product.status}>
              <option value="active">使用中</option><option value="paused">已暂停</option><option value="finished">已用完</option>
            </select>
            <label htmlFor="manual-product-added-on">添加日期</label>
            <input id="manual-product-added-on" onChange={(event) => {
              const value = event.currentTarget.value;
              setProduct((current) => ({ ...current, addedOn: value }));
            }} type="date" value={product.addedOn} />
            <label htmlFor="manual-product-note">备注</label>
            <textarea id="manual-product-note" maxLength={4000} onChange={(event) => {
              const value = event.currentTarget.value;
              setProduct((current) => ({ ...current, note: value }));
            }} value={product.note} />
            <button disabled={writesDisabled || !product.name.trim() || !product.brand.trim() || !product.currentPurpose.trim()} type="button" onClick={() => { void saveProduct(); }}>保存护肤品</button>
          </section>
        </div>
      </div>
    );
  }

  function renderRecovery() {
    return (
      <div className="manual-skincare-recovery">
        <header className="manual-skincare-section-heading">
          <div>
            <h2>恢复计划</h2>
            <p>当前周期：{activeCycle?.name ?? "尚未开始"}</p>
            <p>当前使用：{currentNames.length ? currentNames.join("、") : "无产品"}</p>
          </div>
          <div className="manual-skincare-actions">
            {activeCycle ? <button disabled={writesDisabled || completing} type="button" onClick={() => { void completeCurrentCycle(); }}>完成当前周期</button> : null}
            {upcoming ? <button disabled={writesDisabled || snapshot.businessDate !== today} type="button" onClick={() => { setStartConfirming(true); setEffectiveFrom(""); }}>开始下一周期</button> : null}
          </div>
        </header>

        {startConfirming && upcoming ? (
          <section className="manual-skincare-confirmation" aria-labelledby="start-cycle-title">
            <h3 id="start-cycle-title">确认开始{upcoming.cycle.name}</h3>
            <p>本周期产品：{itemSummary(upcoming.cycle.items)}</p>
            <p>计划周期：{cycleDurationDays(upcoming.cycle, countdownToday)} 天。请选择明确生效日。</p>
            <fieldset>
              <legend>生效日期</legend>
              <label><input checked={effectiveFrom === "today"} name="cycle-effective" onChange={() => setEffectiveFrom("today")} type="radio" />今天（{today}）</label>
              <label><input checked={effectiveFrom === "tomorrow"} name="cycle-effective" onChange={() => setEffectiveFrom("tomorrow")} type="radio" />明天（{tomorrow}）</label>
            </fieldset>
            {effectiveFrom === "today" ? <p>选择今天会合并今日快照；已使用事实不会被静默替换。</p> : null}
            {effectiveFrom === "tomorrow" ? <p>选择明天不会改变今天已经物化的事实。</p> : null}
            {effectiveFrom ? <p>
              确认后开始按自然日倒数，预计完成日为 {
                addRecoveryCalendarDays(
                  effectiveFrom === "today" ? today : tomorrow,
                  cycleDurationDays(upcoming.cycle, countdownToday) - 1,
                )
              }。
            </p> : null}
            <div className="manual-skincare-actions">
              <button disabled={!effectiveFrom || writesDisabled} type="button" onClick={() => { void startUpcomingCycle(); }}>确认开始所选周期</button>
              <button type="button" onClick={() => { setStartConfirming(false); setEffectiveFrom(""); }}>取消</button>
            </div>
          </section>
        ) : null}

        <section className="manual-skincare-plan-editor" aria-label="恢复计划基本资料">
          <label htmlFor="manual-plan-select">计划</label>
          <select id="manual-plan-select" onChange={(event) => setSelectedPlanId(event.currentTarget.value || null)} value={selectedPlanId ?? ""}>
            <option value="">新计划</option>
            {snapshot.recoveryPlans.map((plan) => <option key={plan.planId} value={plan.planId}>{plan.name}</option>)}
          </select>
          <label htmlFor="manual-plan-name">计划名称</label>
          <input id="manual-plan-name" onChange={(event) => setPlanName(event.currentTarget.value)} value={planName} />
          <label htmlFor="manual-plan-note">计划备注</label>
          <textarea id="manual-plan-note" onChange={(event) => setPlanNote(event.currentTarget.value)} value={planNote} />
          <button disabled={writesDisabled || !planName.trim()} type="button" onClick={() => { void savePlan(); }}>保存恢复计划</button>
        </section>

        {selectedPlan ? (
          <details className="manual-skincare-cycle manual-skincare-new-cycle" open={selectedPlan.cycles.length === 0}>
            <summary>添加计划周期</summary>
            <div className="manual-skincare-editor">
              <label htmlFor="new-cycle-name">周期名称</label>
              <input id="new-cycle-name" maxLength={160} onChange={(event) => {
                const name = event.currentTarget.value;
                setNewCycleDraft((current) => ({ ...current, name }));
              }} value={newCycleDraft.name} />
              <label htmlFor="new-cycle-goal">周期目标</label>
              <textarea id="new-cycle-goal" maxLength={500} onChange={(event) => {
                const goal = event.currentTarget.value;
                setNewCycleDraft((current) => ({ ...current, goal }));
              }} value={newCycleDraft.goal} />
              <label htmlFor="new-cycle-duration">计划周期（天）</label>
              <input
                id="new-cycle-duration"
                inputMode="numeric"
                max={MAX_RECOVERY_DURATION_DAYS}
                min={MIN_RECOVERY_DURATION_DAYS}
                onChange={(event) => {
                  const durationDays = event.currentTarget.value;
                  setNewCycleDraft((current) => ({ ...current, durationDays }));
                }}
                step="1"
                type="number"
                value={newCycleDraft.durationDays}
              />
              <p>可设置 {MIN_RECOVERY_DURATION_DAYS}–{MAX_RECOVERY_DURATION_DAYS} 天；开始后按自然日倒数。</p>
              <label htmlFor="new-cycle-note">周期备注</label>
              <textarea id="new-cycle-note" maxLength={4000} onChange={(event) => {
                const note = event.currentTarget.value;
                setNewCycleDraft((current) => ({ ...current, note }));
              }} value={newCycleDraft.note} />
              <div className="manual-skincare-routine-grid">
                {(["morning", "evening"] as const).map((slot) => (
                  <fieldset key={slot}>
                    <legend>{slotLabels[slot]} 周期产品</legend>
                    {snapshot.products.map((candidate) => (
                      <label key={candidate.productId}>
                        <input
                          checked={newCycleDraft.items.some((item) => item.slot === slot && item.productId === candidate.productId)}
                          onChange={(event) => toggleNewCycleProduct(slot, candidate.productId, event.currentTarget.checked)}
                          type="checkbox"
                        />
                        {candidate.name}
                      </label>
                    ))}
                  </fieldset>
                ))}
              </div>
              <button
                disabled={writesDisabled
                  || !newCycleDraft.name.trim()
                  || !newCycleDraft.goal.trim()
                  || !isRecoveryDurationDays(Number(newCycleDraft.durationDays))}
                type="button"
                onClick={() => { void createCycle(); }}
              >保存新周期</button>
            </div>
          </details>
        ) : <p>先保存恢复计划，再添加 14 天、17 天或其他自定义周期。</p>}

        <div className="manual-skincare-cycle-list">
          {snapshot.recoveryPlans.map((plan) => plan.cycles
            .slice()
            .sort((left, right) => left.ordinal - right.ordinal)
            .map((cycle) => {
              const draft = cycleDrafts[cycle.cycleId] ?? cycleDraft(cycle, countdownToday);
              return (
                <article className="manual-skincare-cycle" key={cycle.cycleId}>
                  <header><h3>{cycle.name}</h3><span>{cycle.status === "active" ? "进行中" : cycle.status === "completed" ? "已完成" : "未开始"}</span></header>
                  <p>{cycle.goal}</p>
                  <RecoveryCountdownView cycle={cycle} today={countdownToday} />
                  <p>周期产品：{itemSummary(cycle.items)}</p>
                  <details hidden={cycle.status !== "draft"}>
                    <summary>编辑周期内容</summary>
                    <div className="manual-skincare-editor">
                      <label htmlFor={`cycle-${cycle.cycleId}-name`}>周期名称</label>
                      <input id={`cycle-${cycle.cycleId}-name`} onChange={(event) => updateCycleDraft(cycle.cycleId, { name: event.currentTarget.value })} value={draft.name} />
                      <label htmlFor={`cycle-${cycle.cycleId}-goal`}>周期目标</label>
                      <textarea id={`cycle-${cycle.cycleId}-goal`} onChange={(event) => updateCycleDraft(cycle.cycleId, { goal: event.currentTarget.value })} value={draft.goal} />
                      <label htmlFor={`cycle-${cycle.cycleId}-duration`}>计划周期（天）</label>
                      <input
                        id={`cycle-${cycle.cycleId}-duration`}
                        inputMode="numeric"
                        max={MAX_RECOVERY_DURATION_DAYS}
                        min={MIN_RECOVERY_DURATION_DAYS}
                        onChange={(event) => updateCycleDraft(cycle.cycleId, { durationDays: event.currentTarget.value })}
                        step="1"
                        type="number"
                        value={draft.durationDays}
                      />
                      <p>开始后会依据实际生效日锁定预计完成日；到期只提示，不会擅自删除或切换数据。</p>
                      <label htmlFor={`cycle-${cycle.cycleId}-note`}>周期备注</label>
                      <textarea id={`cycle-${cycle.cycleId}-note`} onChange={(event) => updateCycleDraft(cycle.cycleId, { note: event.currentTarget.value })} value={draft.note} />
                      <div className="manual-skincare-routine-grid">
                        {(["morning", "evening"] as const).map((slot) => (
                          <fieldset key={slot}>
                            <legend>{slotLabels[slot]} 周期产品</legend>
                            {snapshot.products.map((candidate) => (
                              <label key={candidate.productId}>
                                <input checked={draft.items.some((item) => item.slot === slot && item.productId === candidate.productId)} onChange={(event) => toggleCycleProduct(cycle, slot, candidate.productId, event.currentTarget.checked)} type="checkbox" />
                                {candidate.name}
                              </label>
                            ))}
                          </fieldset>
                        ))}
                      </div>
                      <button disabled={writesDisabled || !draft.name.trim() || !draft.goal.trim() || !isRecoveryDurationDays(Number(draft.durationDays))} type="button" onClick={() => { void saveCycle(plan, cycle); }}>保存周期内容</button>
                    </div>
                  </details>
                </article>
              );
            }))}
        </div>
      </div>
    );
  }

  function renderHistory() {
    const insights = snapshot.history.map((historyDay) => (
      snapshot.insights?.find((item) => item.businessDate === historyDay.businessDate)
        ?? calculateSkincareDayInsight(historyDay, null)
    ));
    return (
      <div className="manual-skincare-history">
        <header><h2>历史记录</h2></header>
        {snapshot.history.length === 0 ? <p>暂无历史快照。</p> : <>
          <SkincareTrendChart insights={insights} />
          <HistoryTable days={snapshot.history} insights={insights} />
        </>}
      </div>
    );
  }

  return (
    <section className="manual-skincare-workspace" data-testid="manual-skincare-workspace" style={{ maxWidth: "100%" }}>
      <div className="manual-skincare-workspace-bar">
        <form className="manual-skincare-date-control" method="get">
          <label htmlFor="manual-skincare-date">记录日期</label>
          <input defaultValue={snapshot.businessDate} id="manual-skincare-date" key={snapshot.businessDate} max={today} name="date" type="date" />
          <button type="submit">切换日期</button>
        </form>
      </div>
      {submissionNotice()}
      <div aria-label="手动护肤视图" className="manual-skincare-tabs" role="tablist">
        {tabs.map((candidate) => (
          <button
            aria-controls={`manual-skincare-panel-${candidate.id}`}
            aria-selected={candidate.id === tab}
            id={`manual-skincare-tab-${candidate.id}`}
            key={candidate.id}
            onClick={() => setTab(candidate.id)}
            role="tab"
            type="button"
          >
            {candidate.label}
          </button>
        ))}
      </div>
      <section aria-labelledby={`manual-skincare-tab-${tab}`} id={`manual-skincare-panel-${tab}`} role="tabpanel">
        {tab === "today" ? renderToday() : null}
        {tab === "products" ? renderProducts() : null}
        {tab === "recovery" ? renderRecovery() : null}
        {tab === "history" ? renderHistory() : null}
      </section>
    </section>
  );
}
