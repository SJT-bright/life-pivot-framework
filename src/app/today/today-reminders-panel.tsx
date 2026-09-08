"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { toShanghaiBusinessDate } from "@/core/time/business-date";
import type { TodayReminder } from "@/modules/today-reminders/contracts";

import companionStyles from "../companion/companion.module.css";

const CHANNEL_NAME = "life-pivot-today-reminders";
const EMPTY_REMINDERS: TodayReminder[] = [];

interface TodayRemindersPanelProps {
  businessDate: string;
  desktopCompanion?: boolean;
  initialAvailable?: boolean;
  initialPastReminders?: TodayReminder[];
  initialReminders: TodayReminder[];
  request?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

interface ReminderResponse {
  pastReminders?: TodayReminder[];
  reminders?: TodayReminder[];
  reminder?: TodayReminder;
  alertClaimed?: boolean;
  message?: string;
}

function sortReminders(reminders: TodayReminder[]): TodayReminder[] {
  return [...reminders].sort((left, right) => {
    if (left.completed !== right.completed) return left.completed ? 1 : -1;
    if (left.scheduledTime === null && right.scheduledTime !== null) return 1;
    if (left.scheduledTime !== null && right.scheduledTime === null) return -1;
    return (left.scheduledTime ?? "").localeCompare(right.scheduledTime ?? "")
      || left.createdAt.localeCompare(right.createdAt)
      || left.id.localeCompare(right.id);
  });
}

function sortPastReminders(reminders: TodayReminder[]): TodayReminder[] {
  return [...reminders].sort((left, right) => {
    return right.businessDate.localeCompare(left.businessDate)
      || (left.scheduledTime === null ? 1 : 0) - (right.scheduledTime === null ? 1 : 0)
      || (left.scheduledTime ?? "").localeCompare(right.scheduledTime ?? "")
      || left.createdAt.localeCompare(right.createdAt)
      || left.id.localeCompare(right.id);
  });
}

function createToken(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function shanghaiClockTime(now: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(now);
}

function isReminderDue(reminder: TodayReminder, now: Date): boolean {
  return reminder.alertedAt === null
    && !reminder.completed
    && reminder.scheduledTime !== null
    && reminder.businessDate === toShanghaiBusinessDate(now)
    && reminder.scheduledTime <= shanghaiClockTime(now);
}

function reminderTiming(reminder: TodayReminder, now: Date): string | null {
  if (!reminder.scheduledTime) return null;
  const today = toShanghaiBusinessDate(now);
  if (reminder.businessDate !== today) return reminder.scheduledTime;
  const currentTime = shanghaiClockTime(now);
  const [hour, minute] = reminder.scheduledTime.split(":").map(Number);
  const [currentHour, currentMinute] = currentTime.split(":").map(Number);
  const remaining = (hour! * 60 + minute!) - (currentHour! * 60 + currentMinute!);
  if (reminder.alertedAt !== null && remaining <= 0) return `已提醒 · ${reminder.scheduledTime}`;
  if (remaining < 0) return `已到时间 · ${reminder.scheduledTime}`;
  if (remaining === 0) return `就是现在 · ${reminder.scheduledTime}`;
  if (remaining <= 60) return `还有 ${remaining} 分钟 · ${reminder.scheduledTime}`;
  return reminder.scheduledTime;
}

export function TodayRemindersPanel({
  businessDate,
  desktopCompanion = false,
  initialAvailable = true,
  initialPastReminders = EMPTY_REMINDERS,
  initialReminders,
  request = fetch,
}: TodayRemindersPanelProps) {
  const [reminders, setReminders] = useState(() => sortReminders(initialReminders));
  const [pastReminders, setPastReminders] = useState(
    () => sortPastReminders(initialPastReminders),
  );
  const [available, setAvailable] = useState(initialAvailable);
  const [title, setTitle] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [companionExpanded, setCompanionExpandedState] = useState(false);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const companionExpandedRef = useRef(false);
  const companionHoveredRef = useRef(false);
  const companionDraggingRef = useRef(false);
  const dragFrameRef = useRef<number | null>(null);
  const pendingDragScreenYRef = useRef<number | null>(null);
  const alertingRef = useRef(new Set<string>());
  const alertRetryAtRef = useRef(new Map<string, number>());

  const pending = useMemo(
    () => reminders.filter((reminder) => !reminder.completed),
    [reminders],
  );

  const urgentCount = useMemo(
    () => pending.filter((reminder) => reminder.alertedAt !== null || isReminderDue(reminder, now)).length,
    [now, pending],
  );

  const refresh = useCallback(async () => {
    try {
      const response = await request(`/api/v1/today-reminders?date=${encodeURIComponent(businessDate)}`,
        { cache: "no-store" });
      const result = await response.json() as ReminderResponse;
      if (!response.ok || !Array.isArray(result.reminders)) throw new Error();
      setReminders(sortReminders(result.reminders));
      if (Array.isArray(result.pastReminders)) {
        setPastReminders(sortPastReminders(result.pastReminders));
      }
      setAvailable(true);
      setStatus((current) => current === "暂时无法刷新；已显示上次读取的内容。" ? null : current);
    } catch {
      setAvailable(false);
      setStatus("暂时无法刷新；已显示上次读取的内容。");
    }
  }, [businessDate, request]);

  useEffect(() => {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = () => void refresh();
      channelRef.current = channel;
    }
    const clockInterval = window.setInterval(() => {
      const nextNow = new Date();
      if (toShanghaiBusinessDate(nextNow) !== businessDate) {
        window.location.reload();
        return;
      }
      setNow(nextNow);
    }, 1_000);
    const refreshInterval = window.setInterval(() => {
      void refresh();
    }, 30_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(clockInterval);
      window.clearInterval(refreshInterval);
      window.removeEventListener("focus", onFocus);
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
      if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
      if (companionDraggingRef.current) {
        window.lifePivotDesktop?.moveCompanion({ phase: "end" });
      }
      dragFrameRef.current = null;
      pendingDragScreenYRef.current = null;
      companionDraggingRef.current = false;
      channelRef.current?.close();
      channelRef.current = null;
    };
    void refresh();
  }, [businessDate, refresh]);

  useEffect(() => {
    const desktop = window.lifePivotDesktop;
    if (!desktop) return;
    for (const reminder of pending) {
      if (!isReminderDue(reminder, now)) continue;
      if (alertingRef.current.has(reminder.id)) continue;
      if ((alertRetryAtRef.current.get(reminder.id) ?? 0) > now.getTime()) continue;
      alertingRef.current.add(reminder.id);
      void (async () => {
        try {
          const response = await request("/api/v1/today-reminders", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": createToken("today-reminder-alert"),
            },
            body: JSON.stringify({
              type: "claim-today-reminder-alert",
              reminderId: reminder.id,
              expectedRevision: reminder.revision,
            }),
          });
          const result = await response.json() as ReminderResponse;
          if (!response.ok || !result.reminder) {
            alertRetryAtRef.current.set(reminder.id, Date.now() + 15_000);
            if (response.status === 409) void refresh();
            return;
          }
          setReminders((current) => sortReminders([
            result.reminder!,
            ...current.filter((item) => item.id !== result.reminder!.id),
          ]));
          channelRef.current?.postMessage({ type: "changed", businessDate });
          if (result.alertClaimed === true && result.reminder.scheduledTime) {
            expandCompanion();
            setStatus(`${result.reminder.scheduledTime} · 到时间了：${result.reminder.title}`);
            desktop.notifyReminder({
              id: result.reminder.id,
              scheduledTime: result.reminder.scheduledTime,
              title: result.reminder.title,
            });
          } else if (result.reminder.alertedAt === null) {
            alertRetryAtRef.current.set(reminder.id, Date.now() + 5_000);
          }
        } catch {
          alertRetryAtRef.current.set(reminder.id, Date.now() + 15_000);
          setStatus("到点提醒暂时无法连接，软件会继续重试。");
        } finally {
          alertingRef.current.delete(reminder.id);
        }
      })();
    }
  }, [businessDate, now, pending, refresh, request]);

  useEffect(() => {
    setReminders(sortReminders(initialReminders));
    setPastReminders(sortPastReminders(initialPastReminders));
    setAvailable(initialAvailable);
  }, [businessDate, initialAvailable, initialPastReminders, initialReminders]);

  async function execute(command: object, idempotencyKey: string): Promise<boolean> {
    setSaving(true);
    setStatus(null);
    try {
      const response = await request("/api/v1/today-reminders", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify(command),
      });
      const result = await response.json() as ReminderResponse;
      if (!response.ok || !result.reminder) {
        setStatus(result.message ?? "保存失败，请再试一次。");
        if (response.status === 409) await refresh();
        return false;
      }
      setAvailable(true);
      const savedReminder = result.reminder;
      setReminders((current) => sortReminders([
        ...(savedReminder.businessDate === businessDate ? [savedReminder] : []),
        ...current.filter((item) => item.id !== savedReminder.id),
      ]));
      setPastReminders((current) => sortPastReminders([
        ...(savedReminder.businessDate < businessDate && !savedReminder.completed
          ? [savedReminder]
          : []),
        ...current.filter((item) => item.id !== savedReminder.id),
      ]));
      channelRef.current?.postMessage({ type: "changed", businessDate });
      return true;
    } catch {
      setStatus("没有收到本地服务的回应，请确认软件仍在运行后重试。");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setStatus("先写下要记住的事。");
      return;
    }
    const saved = await execute({
      type: "add-today-reminder",
      reminderId: createToken("reminder"),
      businessDate,
      title: normalizedTitle,
      scheduledTime: scheduledTime || null,
    }, createToken("today-reminder"));
    if (saved) {
      setTitle("");
      setScheduledTime("");
      setStatus(
        businessDate === toShanghaiBusinessDate(new Date())
          ? "已记下，会同步到桌面悬浮窗。"
          : `已记在 ${businessDate}；桌面悬浮窗只显示今天。`,
      );
    }
  }

  async function complete(reminder: TodayReminder) {
    await execute({
      type: "set-today-reminder-completed",
      reminderId: reminder.id,
      completed: true,
      expectedRevision: reminder.revision,
    }, createToken("today-reminder"));
  }

  function expandCompanion() {
    if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
    collapseTimerRef.current = null;
    if (companionExpandedRef.current) return;
    companionExpandedRef.current = true;
    setCompanionExpandedState(true);
    window.lifePivotDesktop?.setCompanionExpanded(true);
  }

  function scheduleCompanionCollapse() {
    if (companionDraggingRef.current) return;
    if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
    collapseTimerRef.current = setTimeout(() => {
      collapseTimerRef.current = null;
      if (!companionExpandedRef.current) return;
      companionExpandedRef.current = false;
      setCompanionExpandedState(false);
      window.lifePivotDesktop?.setCompanionExpanded(false);
    }, 420);
  }

  function handleCompanionPointerEnter() {
    companionHoveredRef.current = true;
    expandCompanion();
  }

  function handleCompanionPointerLeave() {
    companionHoveredRef.current = false;
    scheduleCompanionCollapse();
  }

  function beginCompanionDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !window.lifePivotDesktop) return;
    if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
    collapseTimerRef.current = null;
    companionDraggingRef.current = true;
    pendingDragScreenYRef.current = null;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    window.lifePivotDesktop.moveCompanion({ phase: "start", screenY: event.screenY });
    event.preventDefault();
  }

  function updateCompanionDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (!companionDraggingRef.current) return;
    pendingDragScreenYRef.current = event.screenY;
    if (dragFrameRef.current !== null) return;
    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = null;
      const screenY = pendingDragScreenYRef.current;
      pendingDragScreenYRef.current = null;
      if (screenY !== null && companionDraggingRef.current) {
        window.lifePivotDesktop?.moveCompanion({ phase: "move", screenY });
      }
    });
  }

  function endCompanionDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (!companionDraggingRef.current) return;
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    const screenY = pendingDragScreenYRef.current;
    pendingDragScreenYRef.current = null;
    if (screenY !== null) {
      window.lifePivotDesktop?.moveCompanion({ phase: "move", screenY });
    }
    companionDraggingRef.current = false;
    window.lifePivotDesktop?.moveCompanion({ phase: "end" });
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    if (!companionHoveredRef.current) scheduleCompanionCollapse();
  }

  function nudgeCompanion(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const distance = event.shiftKey ? 80 : 24;
    window.lifePivotDesktop?.moveCompanion({
      phase: "nudge",
      deltaY: event.key === "ArrowUp" ? -distance : distance,
    });
  }

  const companionTab = <button
    aria-label={`展开今日提醒，还有 ${pending.length} 件事${urgentCount > 0 ? `，${urgentCount} 件到点了` : ""}`}
    aria-expanded={companionExpanded}
    className={`reminder-companion-tab${desktopCompanion ? ` ${companionStyles.railTab}` : ""}`}
    data-urgent={urgentCount > 0 ? "true" : undefined}
    onClick={expandCompanion}
    type="button"
  >
    <span>今日</span>
    <strong>{pending.length}</strong>
  </button>;

  return (
    <section
      aria-label={`今日还有 ${pending.length} 件事`}
      className="reminder-companion"
      onPointerEnter={handleCompanionPointerEnter}
      onPointerLeave={handleCompanionPointerLeave}
    >
      {desktopCompanion ? <div className={companionStyles.rail}>
        {companionTab}
        <button
          aria-label="上下拖动今日悬浮窗"
          className={companionStyles.dragHandle}
          onClick={(event) => event.preventDefault()}
          onKeyDown={nudgeCompanion}
          onLostPointerCapture={endCompanionDrag}
          onPointerCancel={endCompanionDrag}
          onPointerDown={beginCompanionDrag}
          onPointerMove={updateCompanionDrag}
          onPointerUp={endCompanionDrag}
          title="拖动可上下移动；方向键可微调"
          type="button"
        >
          <span aria-hidden="true" className={companionStyles.dragGrip} />
        </button>
      </div> : companionTab}
      <div
        aria-hidden={!companionExpanded}
        className="reminder-companion-panel"
        inert={!companionExpanded}
      >
        <header>
          <div>
            <p>桌面提醒</p>
            <h1>{pending.length > 0 ? `还有 ${pending.length} 件事` : "今天已清空"}</h1>
            <span>有时间的任务会到点响铃</span>
          </div>
          <button
            className="reminder-open-main"
            onClick={() => window.lifePivotDesktop?.openMainWindow("/today")}
            type="button"
          >
            打开今日
          </button>
        </header>
        <ReminderList
          available={available}
          pending={pending}
          now={now}
          onComplete={complete}
          saving={saving}
        />
        {desktopCompanion ? <PastReminders
          onComplete={complete}
          reminders={pastReminders}
          saving={saving}
        /> : null}
        <ReminderForm
          compact
          onSubmit={submit}
          saving={saving}
          scheduledTime={scheduledTime}
          setScheduledTime={setScheduledTime}
          setTitle={setTitle}
          title={title}
        />
        {status ? <p aria-live="polite" className="reminder-status">{status}</p> : null}
      </div>
    </section>
  );
}

function formatPastBusinessDate(businessDate: string): string {
  const [year, month, day] = businessDate.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function PastReminders({
  reminders,
  onComplete,
  saving,
}: {
  reminders: TodayReminder[];
  onComplete: (reminder: TodayReminder) => void;
  saving: boolean;
}) {
  const groups = useMemo(() => {
    const grouped = new Map<string, TodayReminder[]>();
    for (const reminder of reminders) {
      const group = grouped.get(reminder.businessDate);
      if (group) group.push(reminder);
      else grouped.set(reminder.businessDate, [reminder]);
    }
    return [...grouped.entries()];
  }, [reminders]);

  return (
    <details className="reminder-past">
      <summary>
        <span>往期任务</span>
        <strong aria-label={`往期未完成 ${reminders.length} 项`}>{reminders.length}</strong>
      </summary>
      <div className="reminder-past-list">
        {groups.length === 0 ? <p>没有往期未完成任务</p> : groups.map(([date, items]) => (
          <section className="reminder-past-group" key={date}>
            <h2>{formatPastBusinessDate(date)}</h2>
            <ol>
              {items.map((reminder) => (
                <li key={reminder.id}>
                  <button
                    aria-label={`完成往期任务：${reminder.title}`}
                    className="reminder-check"
                    disabled={saving}
                    onClick={() => void onComplete(reminder)}
                    title="标记完成"
                    type="button"
                  >
                    <span aria-hidden="true">✓</span>
                  </button>
                  <div>
                    <p>{reminder.title}</p>
                    {reminder.scheduledTime ? <time
                      dateTime={`${reminder.businessDate}T${reminder.scheduledTime}`}
                    >{reminder.scheduledTime}</time> : null}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </details>
  );
}

interface ReminderFormProps {
  compact?: boolean;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  saving: boolean;
  scheduledTime: string;
  setScheduledTime: (value: string) => void;
  setTitle: (value: string) => void;
  title: string;
}

function ReminderForm({
  compact = false,
  onSubmit,
  saving,
  scheduledTime,
  setScheduledTime,
  setTitle,
  title,
}: ReminderFormProps) {
  return (
    <form className={`reminder-form${compact ? " reminder-form-compact" : ""}`} onSubmit={onSubmit}>
      <label htmlFor={compact ? "companion-reminder-title" : "reminder-title"}>要记住的事</label>
      <input
        autoComplete="off"
        id={compact ? "companion-reminder-title" : "reminder-title"}
        maxLength={240}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="例如：五点开会"
        value={title}
      />
      <div>
        <label htmlFor={compact ? "companion-reminder-time" : "reminder-time"}>时间（可选，到点响铃）</label>
        <input
          id={compact ? "companion-reminder-time" : "reminder-time"}
          onChange={(event) => setScheduledTime(event.target.value)}
          type="time"
          value={scheduledTime}
        />
        <button disabled={saving || title.trim().length === 0} type="submit">
          {saving ? "正在保存" : "记下来"}
        </button>
      </div>
    </form>
  );
}

function ReminderList({
  available,
  pending,
  now,
  onComplete,
  saving,
}: {
  available: boolean;
  pending: TodayReminder[];
  now: Date;
  onComplete: (reminder: TodayReminder) => void;
  saving: boolean;
}) {
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    setScrollProgress(0);
  }, [pending.length]);

  if (!available) {
    return (
      <div className="reminder-empty">
        <strong>暂时无法读取提醒</strong>
        <p>请确认软件仍在运行；这里会自动重试。</p>
      </div>
    );
  }
  if (pending.length === 0) {
    return (
      <div className="reminder-empty">
        <strong>暂无提醒</strong>
      </div>
    );
  }
  return (
    <div className="reminder-list-shell">
      <ol
        className="reminder-list"
        onScroll={(event) => {
          const element = event.currentTarget;
          const availableScroll = element.scrollHeight - element.clientHeight;
          setScrollProgress(availableScroll <= 0 ? 0 : element.scrollTop / availableScroll);
        }}
      >
        {pending.map((reminder) => {
          const timing = reminderTiming(reminder, now);
          const urgent = timing?.startsWith("已提醒")
            || timing?.startsWith("已到时间")
            || timing?.startsWith("就是现在");
          return (
            <li className={urgent ? "is-urgent" : undefined} key={reminder.id}>
              <button
                aria-label={`完成：${reminder.title}`}
                className="reminder-check"
                disabled={saving}
                onClick={() => void onComplete(reminder)}
                title="标记完成"
                type="button"
              >
                <span aria-hidden="true">✓</span>
              </button>
              <div>
                <p>{reminder.title}</p>
                {timing ? <time dateTime={`${reminder.businessDate}T${reminder.scheduledTime}`}>{timing}</time> : null}
              </div>
            </li>
          );
        })}
      </ol>
      <aside aria-label={`待办共 ${pending.length} 条`} className="reminder-list-rail">
        <span>待办</span>
        <strong>{pending.length}</strong>
        <span>条</span>
        <i aria-hidden="true"><b style={{ transform: `scaleY(${Math.max(0.08, scrollProgress)})` }} /></i>
      </aside>
    </div>
  );
}
