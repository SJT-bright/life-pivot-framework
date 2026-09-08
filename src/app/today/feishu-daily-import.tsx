"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import {
  FEISHU_DAILY_IMPORT_BOT_PROMPT,
  getFeishuImportItemSourceKey,
  parseFeishuDailyImport,
  type FeishuDailyImport,
  type FeishuDailyImportItem,
  type FeishuDailyImportReceipt,
  type FeishuDailyImportReceiptItemStatus,
} from "@/modules/daily-import/feishu-daily-import-contract";

import styles from "./feishu-daily-import.module.css";

type ImportKind = FeishuDailyImportItem["kind"];
type PreviewState = "idle" | "checking" | "ready" | "stale" | "failed";

interface DraftEntry {
  item: FeishuDailyImportItem;
  selected: boolean;
  timestampInput: string;
  timestampError?: string;
  serverStatus?: FeishuDailyImportReceiptItemStatus;
}

interface ApiPayload {
  message?: string;
  issues?: unknown;
  receipt?: FeishuDailyImportReceipt;
}

interface FeishuDailyImportProps {
  businessDate: string;
  createId?: () => string;
  onImported?: () => void;
  request?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

const GROUPS: ReadonlyArray<{ kind: ImportKind; label: string }> = [
  { kind: "meal", label: "饮食" },
  { kind: "expense", label: "消费" },
  { kind: "activity", label: "事项" },
];

const MEAL_LABELS = {
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐",
  snack: "加餐",
  other: "其他饮食",
} as const;

const EXPENSE_LABELS = {
  food: "餐饮",
  transport: "交通",
  shopping: "购物",
  housing: "居住",
  health: "健康",
  learning: "学习",
  entertainment: "娱乐",
  other: "其他",
} as const;

const ACTIVITY_STATUS_LABELS = {
  done: "已完成",
  planned: "待完成",
  cancelled: "已取消",
} as const;

const TIME_PRECISION_LABELS = {
  exact: "准确时间",
  estimated: "大致时间",
  "date-only": "仅确认日期",
} as const;

function defaultCreateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `daily-import-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toShanghaiLocalInput(occurredAt: string): string {
  const instant = new Date(occurredAt);
  if (!Number.isFinite(instant.getTime())) return "";
  return new Date(instant.getTime() + 8 * 60 * 60 * 1_000).toISOString().slice(0, 16);
}

function fromShanghaiLocalInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const instant = new Date(`${value}:00+08:00`);
  if (!Number.isFinite(instant.getTime())) return null;
  return `${value}:00+08:00`;
}

function formatFen(amountFen: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
  }).format(amountFen / 100);
}

function itemSummary(item: FeishuDailyImportItem): string {
  if (item.kind === "meal") {
    const foods = item.foods
      .map((food) => [food.name, food.quantity].filter(Boolean).join(" "))
      .join("、");
    const amount = "amountFen" in item && typeof item.amountFen === "number"
      ? ` · ${formatFen(item.amountFen)}`
      : "";
    return `${MEAL_LABELS[item.mealType]} · ${foods}${amount}`;
  }
  if (item.kind === "expense") {
    return [
      formatFen(item.amountFen),
      EXPENSE_LABELS[item.category],
      item.merchant,
    ].filter(Boolean).join(" · ");
  }
  return [
    item.title,
    ACTIVITY_STATUS_LABELS[item.status],
    item.durationMinutes ? `${item.durationMinutes} 分钟` : undefined,
  ].filter(Boolean).join(" · ");
}

function itemNote(item: FeishuDailyImportItem): string | undefined {
  return item.sourceText ?? item.note;
}

function makeDraftEntries(batch: FeishuDailyImport): DraftEntry[] {
  return batch.items.map((item) => ({
    item,
    selected: true,
    timestampInput: toShanghaiLocalInput(item.occurredAt),
  }));
}

function isReceipt(value: unknown): value is FeishuDailyImportReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Record<string, unknown>;
  return typeof receipt.batchId === "string"
    && typeof receipt.preview === "boolean"
    && typeof receipt.businessDate === "string"
    && typeof receipt.totalCount === "number"
    && typeof receipt.importedCount === "number"
    && typeof receipt.skippedCount === "number"
    && Array.isArray(receipt.items);
}

async function readPayload(response: Response): Promise<ApiPayload | null> {
  try {
    const value = await response.json() as unknown;
    if (!value || typeof value !== "object") return null;
    return value as ApiPayload;
  } catch {
    return null;
  }
}

function responseMessage(response: Response, payload: ApiPayload | null): string {
  if (payload?.message?.trim()) return payload.message;
  if (response.status === 404) return "导入服务尚未启动，请重启个人积累库后再试。";
  if (response.status === 409) return "发现同一条飞书消息的内容冲突，请回到原文核对后重新生成汇总。";
  if (response.status === 422) return "汇总内容未通过校验，请根据错误提示修改后再试。";
  return `导入服务暂时不可用（${response.status}），没有写入任何内容。`;
}

export function FeishuDailyImport({
  businessDate,
  createId = defaultCreateId,
  onImported,
  request = fetch,
}: FeishuDailyImportProps) {
  const [open, setOpen] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [raw, setRaw] = useState("");
  const [batch, setBatch] = useState<FeishuDailyImport | null>(null);
  const [entries, setEntries] = useState<DraftEntry[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>("idle");
  const [success, setSuccess] = useState<FeishuDailyImportReceipt | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const previewStateRef = useRef<PreviewState>(previewState);
  previewStateRef.current = previewState;

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && previewStateRef.current !== "checking") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      triggerRef.current?.focus();
    };
  }, [open]);

  const selectedCount = entries.filter((entry) =>
    entry.selected && entry.serverStatus !== "skipped" && !entry.timestampError
  ).length;
  const duplicateCount = entries.filter((entry) => entry.serverStatus === "skipped").length;
  const invalidCount = entries.filter((entry) => Boolean(entry.timestampError)).length;
  const selectedAmountFen = entries.reduce((total, entry) => {
    if (!entry.selected || entry.serverStatus === "skipped" || entry.timestampError) return total;
    return total + ("amountFen" in entry.item && typeof entry.item.amountFen === "number"
      ? entry.item.amountFen
      : 0);
  }, 0);

  const groupedEntries = useMemo(() => GROUPS.map((group) => ({
    ...group,
    entries: entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.item.kind === group.kind),
  })).filter((group) => group.entries.length > 0), [entries]);

  function closeDialog() {
    if (previewState === "checking") return;
    setOpen(false);
  }

  async function copyPrompt() {
    setShowPrompt(true);
    try {
      await navigator.clipboard.writeText(FEISHU_DAILY_IMPORT_BOT_PROMPT);
      setCopyStatus("提示词已复制，可以直接发送给飞书机器人。 ");
    } catch {
      setCopyStatus("无法自动复制，请展开提示词后手动复制。 ");
    }
  }

  function batchFromEntries(currentBatch: FeishuDailyImport, currentEntries: DraftEntry[], selectedOnly: boolean) {
    const items = currentEntries
      .filter((entry) => !entry.timestampError)
      .filter((entry) => !selectedOnly || (entry.selected && entry.serverStatus !== "skipped"))
      .map((entry) => entry.item);
    return parseFeishuDailyImport({ ...currentBatch, items });
  }

  function applyReceipt(
    receipt: FeishuDailyImportReceipt,
    currentBatch: FeishuDailyImport,
    currentEntries: DraftEntry[],
    receiptEntries: FeishuDailyImportItem[],
  ) {
    // The server source key may include Feishu chat context that the browser
    // deliberately does not reconstruct. Pair by the stable response order,
    // then map with the exact items that were sent.
    const statuses = new Map(receipt.items.flatMap((item, index) => {
      const submitted = receiptEntries[index];
      return submitted
        ? [[getFeishuImportItemSourceKey(submitted, currentBatch.batchId), item.status] as const]
        : [];
    }));
    const next = currentEntries.map((entry) => {
      const receivedStatus = statuses.get(
        getFeishuImportItemSourceKey(entry.item, currentBatch.batchId),
      );
      const serverStatus = receivedStatus ?? entry.serverStatus;
      return {
        ...entry,
        serverStatus,
        selected: serverStatus === "skipped" ? false : entry.selected,
      };
    });
    setEntries(next);
    return next;
  }

  async function previewImport(currentBatch: FeishuDailyImport, currentEntries: DraftEntry[]) {
    setPreviewState("checking");
    setServerError(null);
    setSuccess(null);
    try {
      const previewBatch = batchFromEntries(currentBatch, currentEntries, false);
      const response = await request("/api/v1/daily-imports?preview=true", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(previewBatch),
      });
      const payload = await readPayload(response);
      if (!response.ok || !isReceipt(payload?.receipt)) {
        setServerError(responseMessage(response, payload));
        setPreviewState("failed");
        return;
      }
      applyReceipt(payload.receipt, currentBatch, currentEntries, previewBatch.items);
      setPreviewState("ready");
    } catch (error) {
      setServerError(error instanceof Error
        ? `无法完成重复检查：${error.message}`
        : "无法完成重复检查，尚未写入任何内容。");
      setPreviewState("failed");
    }
  }

  async function parseAndPreview() {
    setParseError(null);
    setServerError(null);
    setSuccess(null);
    let parsed: FeishuDailyImport;
    try {
      parsed = parseFeishuDailyImport(raw);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "飞书汇总格式无法读取。");
      return;
    }
    if (parsed.businessDate !== businessDate) {
      setParseError(
        `汇总日期是 ${parsed.businessDate}，当前页面是 ${businessDate}。请切换到对应日期，或让机器人重新生成当天汇总。`,
      );
      return;
    }
    const nextEntries = makeDraftEntries(parsed);
    setBatch(parsed);
    setEntries(nextEntries);
    await previewImport(parsed, nextEntries);
  }

  function editTimestamp(index: number, value: string) {
    if (!batch) return;
    setEntries((current) => current.map((entry, entryIndex) => {
      if (entryIndex !== index) return entry;
      const occurredAt = fromShanghaiLocalInput(value);
      const timestampError = !occurredAt
        ? "请填写完整日期和时间"
        : value.slice(0, 10) !== batch.businessDate
          ? `必须属于 ${batch.businessDate}`
          : undefined;
      return {
        ...entry,
        timestampInput: value,
        timestampError,
        serverStatus: undefined,
        item: occurredAt
          ? { ...entry.item, occurredAt, timePrecision: "exact" } as FeishuDailyImportItem
          : entry.item,
      };
    }));
    setPreviewState("stale");
    setServerError(null);
    setSuccess(null);
  }

  function toggleEntry(index: number) {
    setEntries((current) => current.map((entry, entryIndex) =>
      entryIndex === index && entry.serverStatus !== "skipped"
        ? { ...entry, selected: !entry.selected }
        : entry
    ));
    setSuccess(null);
  }

  function toggleAll() {
    const selectable = entries.filter((entry) => entry.serverStatus !== "skipped" && !entry.timestampError);
    const shouldSelect = selectable.some((entry) => !entry.selected);
    setEntries((current) => current.map((entry) =>
      entry.serverStatus === "skipped" || entry.timestampError
        ? entry
        : { ...entry, selected: shouldSelect }
    ));
    setSuccess(null);
  }

  async function confirmImport() {
    if (!batch || previewState !== "ready" || selectedCount === 0) return;
    setServerError(null);
    setSuccess(null);
    setPreviewState("checking");
    try {
      const submission = batchFromEntries(batch, entries, true);
      const response = await request("/api/v1/daily-imports", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `feishu-daily-import-${createId()}`
            .replace(/[^A-Za-z0-9_-]/g, "-")
            .slice(0, 128),
        },
        body: JSON.stringify(submission),
      });
      const payload = await readPayload(response);
      if (!response.ok || !isReceipt(payload?.receipt)) {
        setServerError(responseMessage(response, payload));
        setPreviewState(response.status === 409 || response.status === 422 ? "stale" : "failed");
        return;
      }
      applyReceipt(payload.receipt, batch, entries, submission.items);
      setSuccess(payload.receipt);
      setPreviewState("ready");
      onImported?.();
    } catch {
      setServerError("没有收到导入服务的确认。为避免重复写入，请先重新检查，再决定是否重试。");
      setPreviewState("failed");
    }
  }

  return (
    <>
      <button
        aria-haspopup="dialog"
        className={styles.openButton}
        onClick={() => setOpen(true)}
        ref={triggerRef}
        type="button"
      >
        导入飞书汇总
      </button>

      {open ? createPortal((
        <div
          className={styles.backdrop}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeDialog();
          }}
        >
          <section
            aria-describedby="feishu-import-description"
            aria-labelledby="feishu-import-title"
            aria-modal="true"
            className={styles.dialog}
            onKeyDown={(event) => {
              if (event.key !== "Tab") return;
              const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
              );
              if (!focusable?.length) return;
              const first = focusable[0];
              const last = focusable[focusable.length - 1];
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }}
            ref={dialogRef}
            role="dialog"
          >
            <header className={styles.dialogHeader}>
              <div>
                <h2 id="feishu-import-title">导入飞书每日汇总</h2>
                <p id="feishu-import-description">
                  先预览和查重，再由你决定写入哪些记录；原始时间可在确认前逐条修改。
                </p>
              </div>
              <button
                aria-label="关闭飞书汇总导入"
                className={styles.closeButton}
                disabled={previewState === "checking"}
                onClick={closeDialog}
                ref={closeRef}
                type="button"
              >
                ×
              </button>
            </header>

            <div className={styles.dialogBody}>
              {!batch ? (
                <>
                  <ol aria-label="飞书汇总导入步骤" className={styles.workflow}>
                    <li><span>1</span>随手把饮食、消费和事项发给飞书机器人</li>
                    <li><span>2</span>让机器人按固定 JSON 模板生成当日汇总</li>
                    <li><span>3</span>粘贴到这里，检查后再写入个人积累库</li>
                  </ol>

                  <div className={styles.templateBar}>
                    <p>第一次使用？把内置提示词发给机器人，它以后就会按同一格式整理。</p>
                    <div className={styles.footerGroup}>
                      <button
                        aria-expanded={showPrompt}
                        className={styles.secondaryButton}
                        onClick={() => setShowPrompt((current) => !current)}
                        type="button"
                      >
                        {showPrompt ? "收起提示词" : "查看提示词"}
                      </button>
                      <button className={styles.copyButton} onClick={copyPrompt} type="button">
                        复制给飞书机器人
                      </button>
                    </div>
                  </div>

                  {showPrompt ? (
                    <label className={styles.promptLabel}>
                      <span>飞书机器人提示词（内含可导入示例）</span>
                      <textarea className={styles.promptPreview} readOnly value={FEISHU_DAILY_IMPORT_BOT_PROMPT} />
                    </label>
                  ) : null}
                  {copyStatus ? <p aria-live="polite" className={styles.status}>{copyStatus}</p> : null}

                  <label className={styles.editorLabel}>
                    <span>飞书机器人汇总内容</span>
                    <textarea
                      aria-describedby="feishu-import-editor-hint"
                      className={styles.editor}
                      onChange={(event) => {
                        setRaw(event.target.value);
                        setParseError(null);
                      }}
                      placeholder={'粘贴机器人返回的 ```json 代码块或完整 JSON'}
                      value={raw}
                    />
                  </label>
                  <p className={styles.hint} id="feishu-import-editor-hint">
                    当前导入日期：{businessDate} · 时间按 Asia/Shanghai 解释 · 解析不会写入数据。
                  </p>
                  {parseError ? <p className={styles.errorBox} role="alert">{parseError}</p> : null}

                  <footer className={styles.footerActions}>
                    <button className={styles.secondaryButton} onClick={closeDialog} type="button">
                      取消
                    </button>
                    <button disabled={!raw.trim()} onClick={parseAndPreview} type="button">
                      解析并预览
                    </button>
                  </footer>
                </>
              ) : (
                <>
                  <div className={styles.previewBar}>
                    <ul aria-label="导入统计" className={styles.metrics}>
                      <li className={styles.metric}>共 {entries.length} 条</li>
                      <li className={styles.metric}>已选 {selectedCount} 条</li>
                      <li className={styles.metric}>今日消费 {formatFen(selectedAmountFen)}</li>
                      <li className={styles.metric}>重复 {duplicateCount} 条</li>
                      {invalidCount > 0 ? <li className={styles.metric}>时间错误 {invalidCount} 条</li> : null}
                    </ul>
                    <button className={styles.selectButton} onClick={toggleAll} type="button">
                      {selectedCount > 0 ? "切换全选" : "选择可导入项"}
                    </button>
                  </div>

                  {previewState === "checking" ? (
                    <p aria-live="polite" className={styles.status}>正在检查格式和重复记录…</p>
                  ) : null}
                  {previewState === "stale" ? (
                    <p className={styles.status}>时间已修改，请重新检查后再确认导入。</p>
                  ) : null}
                  {serverError ? <p className={styles.errorBox} role="alert">{serverError}</p> : null}
                  {success ? (
                    <div aria-live="polite" className={styles.successBox} role="status">
                      <strong>飞书汇总已完成导入</strong>
                      已写入 {success.importedCount} 条，跳过重复记录 {success.skippedCount} 条，
                      本次金额 {formatFen(selectedAmountFen)}。今日时间线已刷新。
                    </div>
                  ) : null}

                  <div className={styles.groups}>
                    {groupedEntries.map((group) => (
                      <section aria-label={`${group.label}记录`} className={styles.group} key={group.kind}>
                        <header className={styles.groupHeader}>
                          <h3>{group.label}</h3>
                          <span>{group.entries.length} 条</span>
                        </header>
                        <ul className={styles.entryList}>
                          {group.entries.map(({ entry, index }, groupIndex) => {
                            const duplicate = entry.serverStatus === "skipped";
                            return (
                              <li
                                className={styles.entry}
                                data-duplicate={duplicate}
                                data-selected={entry.selected}
                                key={getFeishuImportItemSourceKey(entry.item, batch.batchId)}
                              >
                                <label className={styles.entryCheck}>
                                  <span className="sr-only">
                                    导入{group.label}第 {groupIndex + 1} 条
                                  </span>
                                  <input
                                    checked={entry.selected}
                                    disabled={duplicate}
                                    onChange={() => toggleEntry(index)}
                                    type="checkbox"
                                  />
                                </label>
                                <label className={styles.field}>
                                  <span>日期与时间（上海）</span>
                                  <input
                                    aria-invalid={Boolean(entry.timestampError)}
                                    aria-label={`${group.label}第 ${groupIndex + 1} 条时间`}
                                    max={`${batch.businessDate}T23:59`}
                                    min={`${batch.businessDate}T00:00`}
                                    onChange={(event) => editTimestamp(index, event.target.value)}
                                    step="60"
                                    type="datetime-local"
                                    value={entry.timestampInput}
                                  />
                                  {entry.timestampError ? (
                                    <span className={styles.inlineError}>{entry.timestampError}</span>
                                  ) : null}
                                </label>
                                <div className={styles.entryContent}>
                                  <strong>{itemSummary(entry.item)}</strong>
                                  {itemNote(entry.item) ? <p>{itemNote(entry.item)}</p> : null}
                                </div>
                                <div className={styles.badgeStack}>
                                  <span className={styles.badge}>
                                    {TIME_PRECISION_LABELS[entry.item.timePrecision]}
                                  </span>
                                  {duplicate ? <span className={styles.duplicateBadge}>已存在 · 将跳过</span> : null}
                                  {entry.timestampError ? <span className={styles.invalidBadge}>时间有误</span> : null}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    ))}
                  </div>

                  <footer className={styles.footerActions}>
                    <div className={styles.footerGroup}>
                      <button
                        className={styles.secondaryButton}
                        disabled={previewState === "checking"}
                        onClick={() => {
                          setBatch(null);
                          setEntries([]);
                          setPreviewState("idle");
                          setServerError(null);
                          setSuccess(null);
                        }}
                        type="button"
                      >
                        返回修改原文
                      </button>
                      <button
                        className={styles.secondaryButton}
                        disabled={previewState === "checking" || invalidCount > 0}
                        onClick={() => previewImport(batch, entries)}
                        type="button"
                      >
                        重新检查
                      </button>
                    </div>
                    <button
                      className={styles.primaryButton}
                      disabled={previewState !== "ready" || selectedCount === 0 || Boolean(success)}
                      onClick={confirmImport}
                      type="button"
                    >
                      {success ? "已完成导入" : `确认导入 ${selectedCount} 条`}
                    </button>
                  </footer>
                </>
              )}
            </div>
          </section>
        </div>
      ), document.body) : null}
    </>
  );
}

interface FeishuDailyImportHeaderToolsProps {
  businessDate: string;
  children: ReactNode;
}

export function FeishuDailyImportHeaderTools({
  businessDate,
  children,
}: FeishuDailyImportHeaderToolsProps) {
  const router = useRouter();
  return (
    <div className={styles.headerTools}>
      <FeishuDailyImport businessDate={businessDate} onImported={() => router.refresh()} />
      {children}
    </div>
  );
}
