"use client";

import { useEffect, useMemo, useState } from "react";

import {
  clearConfirmedSimpleSubmission,
  freezeSimpleSubmission,
  markSimpleSubmissionUncertain,
  recoverSimpleSubmissions,
  storeSimpleSubmission,
  type StoredSimpleSubmission,
} from "@/app/accumulation/frozen-submission";
import type {
  HealthChecklistCommand,
  HealthChecklistDay,
  HealthChecklistDayItem,
  HealthChecklistItemInput,
} from "@/modules/health-checklist/contracts";
import {
  millisecondsUntilHealthChecklistRollover,
  toHealthChecklistBusinessDate,
} from "@/core/time/business-date";

export type HealthChecklistReadState =
  | { readonly status: "ready"; readonly data: HealthChecklistDay }
  | { readonly status: "unavailable" };

interface HealthWorkspaceProps {
  readonly initial: HealthChecklistReadState;
  readonly mode?: "full" | "card";
  readonly request?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readonly storage?: Storage;
  readonly createId?: () => string;
  readonly now?: () => Date;
  readonly autoRollover?: boolean;
}

function defaultId(): string {
  return `health-${crypto.randomUUID()}`;
}

function systemNow(): Date {
  return new Date();
}

function isDay(value: unknown): value is HealthChecklistDay {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.businessDate === "string" &&
    typeof record.revision === "number" && Array.isArray(record.items);
}

function resolveStorage(provided: Storage | undefined): Storage | undefined {
  if (provided) return provided;
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function HealthWorkspace({
  initial,
  mode = "full",
  request = fetch,
  storage: providedStorage,
  createId = defaultId,
  now = systemNow,
  autoRollover = false,
}: HealthWorkspaceProps) {
  const [day, setDay] = useState(initial.status === "ready" ? initial.data : null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [active, setActive] = useState<StoredSimpleSubmission | null>(null);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [routine, setRoutine] = useState(true);
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);
  const storage = resolveStorage(providedStorage);

  useEffect(() => {
    if (initial.status === "ready") setDay(initial.data);
  }, [initial]);

  useEffect(() => {
    const recovery = recoverSimpleSubmissions("health-checklist", storage);
    if (recovery.kind === "recovered") {
      setActive(recovery);
      setMessage("存在结果不确定的健康清单提交，请明确重试或放弃。");
    } else if (recovery.kind === "locked") {
      setReloadRequired(true);
      setMessage("健康清单提交状态已变化，请刷新页面。");
    } else if (recovery.kind === "storage-unavailable") {
      setMessage("本机提交存储不可用，暂时不能保存健康清单。");
    }
  }, [storage]);

  useEffect(() => {
    if (!autoRollover) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      const observedAt = now();
      const dateAlreadyChanged = toHealthChecklistBusinessDate(observedAt) !== day?.businessDate;
      const delay = busy || active !== null
        ? 1_000
        : dateAlreadyChanged
          ? 50
          : millisecondsUntilHealthChecklistRollover(observedAt) + 150;
      timer = setTimeout(async () => {
        if (busy || active !== null) {
          if (!disposed) schedule();
          return;
        }
        const nextDate = toHealthChecklistBusinessDate(now());
        if (nextDate !== day?.businessDate) {
          try {
            const response = await request(
              `/api/v1/health-checklist?date=${encodeURIComponent(nextDate)}`,
              { cache: "no-store" },
            );
            if (!response.ok) throw new Error("health rollover failed");
            const payload = await response.json() as { day?: unknown };
            if (!isDay(payload.day)) throw new Error("invalid health rollover payload");
            if (!disposed) {
              setDay(payload.day);
              setMessage("早上 7 点已刷新为今天的新清单。");
              setRenamingKey(null);
              setConfirmingKey(null);
            }
          } catch {
            if (!disposed) setMessage("已到清单换日时间，暂时刷新失败，请稍后重试。");
          }
        }
        if (!disposed) schedule();
      }, delay);
    };

    schedule();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, autoRollover, busy, day?.businessDate, now, request]);

  const items = useMemo(
    () => [...(day?.items ?? [])].sort((left, right) => left.ordinal - right.ordinal),
    [day],
  );
  const persistentKeys = useMemo(
    () => new Set(day?.persistentItemKeys ?? []),
    [day],
  );
  const completedCount = items.filter((item) => item.completed).length;

  if (initial.status === "unavailable" || !day) {
    return <section className="health-checklist-unavailable"><p>暂时无法读取健康清单</p></section>;
  }

  const currentDay = day;
  const locked = busy || active !== null || reloadRequired;

  async function refresh(): Promise<void> {
    const response = await request(`/api/v1/health-checklist?date=${currentDay.businessDate}`);
    if (!response.ok) return;
    const payload = await response.json() as { day?: unknown };
    if (isDay(payload.day)) setDay(payload.day);
  }

  async function send(stored: StoredSimpleSubmission): Promise<void> {
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
        setMessage("提交结果不确定。请重试原提交，或放弃并保留当前草稿。");
        return;
      }

      if (response.status === 409) {
        if (storage) clearConfirmedSimpleSubmission(storage, stored);
        setActive(null);
        setReloadRequired(true);
        setMessage("清单已变化，请刷新页面后再编辑。");
        return;
      }
      if ([400, 403, 415, 422].includes(response.status)) {
        if (storage) clearConfirmedSimpleSubmission(storage, stored);
        setActive(null);
        setMessage("提交内容未被接受，请检查后重试。");
        return;
      }
      if (!response.ok) {
        setActive(stored);
        setMessage("提交结果不确定。请重试原提交，或放弃并保留当前草稿。");
        return;
      }
      const payload = await response.json() as { result?: unknown };
      if (!isDay(payload.result) || payload.result.businessDate !== currentDay.businessDate) {
        setActive(stored);
        setMessage("服务器确认内容不完整，请重试原提交。");
        return;
      }
      if (!storage || clearConfirmedSimpleSubmission(storage, stored).kind !== "cleared") {
        setActive(stored);
        setMessage("本机确认清理失败，请刷新页面。");
        return;
      }
      setActive(null);
      setDay(payload.result);
      setConfirmingKey(null);
      setMessage("健康清单已保存。");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function submit(command: HealthChecklistCommand): Promise<void> {
    if (!storage || locked) return;
    const idempotencyKey = createId();
    const frozen = freezeSimpleSubmission({
      purpose: "health-checklist",
      endpoint: "/api/v1/health-checklist",
      operation: command.type,
      ownerId: currentDay.businessDate,
      localRevision: currentDay.revision + 1,
      idempotencyKey,
      body: JSON.stringify(command),
      expected: { businessDate: currentDay.businessDate, revision: currentDay.revision + 1 },
      createdAt: now().toISOString(),
    });
    const stored = storeSimpleSubmission(storage, frozen);
    if (stored.kind !== "stored") {
      setMessage("无法冻结本次提交，尚未发送请求。");
      return;
    }
    const uncertain = markSimpleSubmissionUncertain(storage, stored);
    if (uncertain.kind !== "recovered") {
      setReloadRequired(true);
      setMessage("无法确认本机提交状态，请刷新页面。");
      return;
    }
    setActive(uncertain);
    await send(uncertain);
  }

  // 任务的名称就是目标本身。常驻任务属于每日模板（之后每天自动出现），
  // 手动任务只存在于指定这一天；两种任务在同一个列表里混排。
  function toItemInput(item: HealthChecklistDayItem, ordinal: number): HealthChecklistItemInput {
    return {
      itemKey: item.itemKey,
      groupKey: item.groupKey || "custom",
      groupLabel: item.groupLabel || "清单",
      name: item.name,
      targetText: item.targetText,
      note: item.note,
      ordinal,
    };
  }

  async function replaceItems(
    next: readonly HealthChecklistDayItem[],
    changeNote: string,
    options: {
      scope?: "today-only" | "today-and-future";
      confirmedRemovedCompletedItemKeys?: string[];
      templateItemKeys?: string[];
    } = {},
  ): Promise<void> {
    await submit({
      type: "replace-health-checklist",
      templateId: currentDay.templateId,
      businessDate: currentDay.businessDate,
      scope: options.scope ?? "today-and-future",
      name: currentDay.templateName,
      changeNote,
      items: next.map(toItemInput),
      templateItemKeys: options.templateItemKeys,
      expectedTemplateRevision: currentDay.templateRevision,
      expectedDayRevision: currentDay.revision,
      confirmedRemovedCompletedItemKeys: options.confirmedRemovedCompletedItemKeys ?? [],
    });
  }

  function isPersistent(item: HealthChecklistDayItem): boolean {
    return persistentKeys.has(item.itemKey);
  }

  async function addItem(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const name = newItemName.trim();
    if (!name) {
      setMessage("先写下任务名称。");
      return;
    }
    const item: HealthChecklistDayItem = {
      id: `local-${createId()}`,
      itemKey: createId(),
      groupKey: "custom",
      groupLabel: "清单",
      name,
      targetText: "",
      note: "",
      ordinal: 0,
      completed: false,
      completedAt: null,
    };
    setNewItemName("");
    if (routine) {
      await replaceItems([item, ...items], `新增常驻任务：${name}`, {
        scope: "today-and-future",
        templateItemKeys: [
          item.itemKey,
          ...items.filter(isPersistent).map((entry) => entry.itemKey),
        ],
      });
    } else {
      await replaceItems([item, ...items], `新增今日任务：${name}`, {
        scope: "today-only",
      });
    }
  }

  async function removeItem(item: HealthChecklistDayItem): Promise<void> {
    setRenamingKey(null);
    const next = items.filter((entry) => entry.itemKey !== item.itemKey);
    const confirmed = item.completed ? [item.itemKey] : [];
    if (isPersistent(item)) {
      await replaceItems(next, `删除常驻任务：${item.name}`, {
        scope: "today-and-future",
        confirmedRemovedCompletedItemKeys: confirmed,
        templateItemKeys: next.filter(isPersistent).map((entry) => entry.itemKey),
      });
    } else {
      await replaceItems(next, `删除今日任务：${item.name}`, {
        scope: "today-only",
        confirmedRemovedCompletedItemKeys: confirmed,
      });
    }
  }

  async function renameItem(): Promise<void> {
    const item = items.find((entry) => entry.itemKey === renamingKey);
    const name = renameValue.trim();
    setRenamingKey(null);
    if (!item || !name || name === item.name) return;
    const next = items.map((entry) => entry.itemKey === item.itemKey ? { ...entry, name } : entry);
    if (isPersistent(item)) {
      await replaceItems(next, `重命名常驻任务：${item.name} → ${name}`, {
        scope: "today-and-future",
        templateItemKeys: next.filter(isPersistent).map((entry) => entry.itemKey),
      });
    } else {
      await replaceItems(next, `重命名今日任务：${item.name} → ${name}`, {
        scope: "today-only",
      });
    }
  }

  return (
    <section className={`health-checklist-workspace health-checklist-workspace-${mode}`}>
      {message ? <p role="status">{message}</p> : null}
      {active ? (
        <div className="health-checklist-uncertain">
          <button disabled={busy} onClick={() => void send(active)} type="button">重试原提交</button>
          <button disabled={busy} onClick={() => {
            if (!storage) return;
            const cleared = clearConfirmedSimpleSubmission(storage, active);
            if (cleared.kind === "cleared") {
              setActive(null);
              setMessage("已放弃原提交，当前表单草稿仍保留。");
            }
          }} type="button">放弃并保留当前草稿</button>
        </div>
      ) : null}

      <div className="health-checklist-panel">
        <header className="health-checklist-heading">
          <div>
            <h2>今日任务</h2>
            {autoRollover ? <small>每天早上 7:00 自动刷新</small> : null}
          </div>
          <p className="health-progress-text">
            已完成 <strong>{completedCount}</strong> / {items.length}
          </p>
        </header>
        <div
          aria-label="今日完成进度"
          aria-valuemax={items.length}
          aria-valuemin={0}
          aria-valuenow={completedCount}
          className="health-progress"
          role="progressbar"
        >
          <span style={{ width: `${items.length === 0 ? 0 : (completedCount / items.length) * 100}%` }} />
        </div>

        <form className="health-add-form" onSubmit={addItem}>
          <input
            aria-label="任务名称"
            autoComplete="off"
            disabled={locked}
            id="health-checklist-new-item"
            maxLength={160}
            onChange={(event) => setNewItemName(event.target.value)}
            placeholder="输入任务名称，回车即可添加"
            value={newItemName}
          />
          <label
            className={routine ? "health-routine-toggle is-on" : "health-routine-toggle"}
            title="常驻任务会加入每日模板，之后每天自动出现"
          >
            <input
              aria-label="设为常驻，每天都出现"
              checked={routine}
              onChange={(event) => setRoutine(event.target.checked)}
              type="checkbox"
            />
            常驻
          </label>
          <button disabled={locked || newItemName.trim().length === 0} type="submit">添加</button>
        </form>
        <p className="health-add-hint">
          {routine
            ? "会加入每日常驻模板：之后每天自动出现，不用重新添加。"
            : "只添加到今天这一天，不会出现在明天。"}
        </p>

        {items.length === 0 ? (
          <p className="health-checklist-empty">暂无任务。</p>
        ) : (
          <ul className="health-item-list">
            {items.map((item) => {
              const persistent = isPersistent(item);
              const confirming = confirmingKey === item.itemKey;
              return (
                <li className={item.completed ? "health-item is-completed" : "health-item"} key={item.itemKey}>
                  <input
                    aria-label={`完成 ${item.name}`}
                    checked={item.completed}
                    className="health-item-check"
                    disabled={locked}
                    onChange={() => void submit({
                      type: "set-health-checklist-items",
                      businessDate: currentDay.businessDate,
                      itemKeys: [item.itemKey],
                      completed: !item.completed,
                      expectedDayRevision: currentDay.revision,
                    })}
                    type="checkbox"
                  />
                  <div className="health-item-main">
                    {renamingKey === item.itemKey ? (
                      <span className="health-item-rename">
                        <input
                          aria-label={`重命名 ${item.name}`}
                          autoFocus
                          disabled={locked}
                          maxLength={160}
                          onChange={(event) => setRenameValue(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void renameItem();
                            } else if (event.key === "Escape") {
                              setRenamingKey(null);
                            }
                          }}
                          value={renameValue}
                        />
                        <button disabled={locked} onClick={() => void renameItem()} type="button">保存</button>
                        <button onClick={() => setRenamingKey(null)} type="button">取消</button>
                      </span>
                    ) : (
                      <>
                        <button
                          className="health-item-name"
                          disabled={locked}
                          onClick={() => {
                            setRenamingKey(item.itemKey);
                            setRenameValue(item.name);
                          }}
                          title="点击修改名称"
                          type="button"
                        >
                          {item.name}
                        </button>
                        {persistent ? (
                          <span className="health-item-badge" title="常驻任务，每天自动出现">常驻</span>
                        ) : null}
                      </>
                    )}
                  </div>
                  <button
                    aria-label={confirming
                      ? `确认删除常驻任务 ${item.name}，之后每天都不再出现`
                      : `删除 ${item.name}`}
                    className={confirming ? "health-item-remove is-confirming" : "health-item-remove"}
                    disabled={locked}
                    onClick={() => {
                      if (!persistent || confirming) {
                        setConfirmingKey(null);
                        void removeItem(item);
                      } else {
                        setConfirmingKey(item.itemKey);
                      }
                    }}
                    title={confirming
                      ? "再点一次确认：常驻任务会从之后每天移除"
                      : persistent ? "删除常驻任务（之后每天都不再出现）" : "删除任务"}
                    type="button"
                  >
                    {confirming ? "确认删除" : "×"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <details className="health-checklist-note">
        <summary>当天备注</summary>
        <label>
          当天备注
          <textarea defaultValue={currentDay.note} disabled={locked} id="health-checklist-day-note" maxLength={4000} />
        </label>
        <button disabled={locked} onClick={() => {
          const note = (document.getElementById("health-checklist-day-note") as HTMLTextAreaElement | null)?.value ?? currentDay.note;
          void submit({
            type: "save-health-checklist-note",
            businessDate: currentDay.businessDate,
            note,
            expectedDayRevision: currentDay.revision,
          });
        }} type="button">保存当天备注</button>
      </details>
    </section>
  );
}
