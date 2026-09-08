"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { TodayReminder } from "@/modules/today-reminders/contracts";

const CHANNEL_NAME = "life-pivot-today-reminders";

function nextDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day!));
  shifted.setUTCDate(shifted.getUTCDate() + 1);
  return shifted.toISOString().slice(0, 10);
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

interface TodayRemindersCardProps {
  businessDate: string;
  initialReminders: TodayReminder[];
  request?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

interface ReminderResponse {
  reminders?: TodayReminder[];
  reminder?: TodayReminder;
  createdReminder?: TodayReminder;
  alertClaimed?: boolean;
  message?: string;
}

export function TodayRemindersCard({
  businessDate,
  initialReminders,
  request = fetch,
}: TodayRemindersCardProps) {
  const [reminders, setReminders] = useState(() => sortReminders(initialReminders));
  const [title, setTitle] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editTime, setEditTime] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const channelRef = useRef<BroadcastChannel | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await request(
        `/api/v1/today-reminders?date=${encodeURIComponent(businessDate)}`,
        { cache: "no-store" },
      );
      const result = (await response.json()) as ReminderResponse;
      if (!response.ok || !Array.isArray(result.reminders)) throw new Error();
      setReminders(sortReminders(result.reminders));
    } catch {
      setStatus("暂时无法刷新提醒；已显示上次读取的内容。");
    }
  }, [businessDate, request]);

  useEffect(() => {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = () => void refresh();
      channelRef.current = channel;
    }
    return () => {
      channelRef.current?.close();
      channelRef.current = null;
    };
  }, [refresh]);

  useEffect(() => {
    setReminders(sortReminders(initialReminders));
  }, [businessDate, initialReminders]);

  async function execute(command: object, after?: (result: ReminderResponse) => void) {
    setSaving(true);
    setStatus(null);
    try {
      const response = await request("/api/v1/today-reminders", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `today-card-${crypto.randomUUID()}`,
        },
        body: JSON.stringify(command),
      });
      const result = (await response.json()) as ReminderResponse;
      if (!response.ok || !result.reminder) {
        setStatus(result.message ?? "保存失败，请再试一次。");
        if (response.status === 409) await refresh();
        return false;
      }
      channelRef.current?.postMessage({ type: "changed", businessDate });
      after?.(result);
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
      reminderId: `reminder-card-${crypto.randomUUID()}`,
      businessDate,
      title: normalizedTitle,
      scheduledTime: scheduledTime || null,
    }, (result) => {
      setReminders((current) => sortReminders([
        result.reminder!,
        ...current.filter((item) => item.id !== result.reminder!.id),
      ]));
    });
    if (saved) {
      setTitle("");
      setScheduledTime("");
    }
  }

  async function toggleCompleted(reminder: TodayReminder) {
    await execute({
      type: "set-today-reminder-completed",
      reminderId: reminder.id,
      completed: !reminder.completed,
      expectedRevision: reminder.revision,
    }, (result) => {
      setReminders((current) => sortReminders([
        result.reminder!,
        ...current.filter((item) => item.id !== result.reminder!.id),
      ]));
    });
  }

  function beginEdit(reminder: TodayReminder) {
    setConfirmDeleteId(null);
    setEditingId(reminder.id);
    setEditTitle(reminder.title);
    setEditTime(reminder.scheduledTime ?? "");
  }

  async function saveEdit(reminder: TodayReminder) {
    const normalizedTitle = editTitle.trim();
    if (!normalizedTitle) {
      setStatus("提醒内容不能为空。");
      return;
    }
    const saved = await execute({
      type: "update-today-reminder",
      reminderId: reminder.id,
      expectedRevision: reminder.revision,
      title: normalizedTitle,
      scheduledTime: editTime || null,
    }, (result) => {
      setReminders((current) => sortReminders([
        result.reminder!,
        ...current.filter((item) => item.id !== result.reminder!.id),
      ]));
    });
    if (saved) setEditingId(null);
  }

  async function remove(reminder: TodayReminder) {
    const saved = await execute({
      type: "delete-today-reminder",
      reminderId: reminder.id,
      expectedRevision: reminder.revision,
    }, (result) => {
      setReminders((current) =>
        current.filter((item) => item.id !== result.reminder!.id));
    });
    if (saved) {
      setConfirmDeleteId(null);
      setStatus("已删除这条提醒（历史里保留了记录）。");
    }
  }

  async function moveToTomorrow(reminder: TodayReminder) {
    const saved = await execute({
      type: "reschedule-today-reminder",
      reminderId: reminder.id,
      expectedRevision: reminder.revision,
      toBusinessDate: nextDay(reminder.businessDate),
    }, (result) => {
      setReminders((current) => sortReminders([
        result.reminder!,
        ...current.filter((item) => item.id !== result.reminder!.id),
      ]));
    });
    if (saved) {
      setStatus(`已移到 ${nextDay(reminder.businessDate)}，在那天的时间线里能看到。`);
    }
  }

  const pending = reminders.filter((reminder) => !reminder.completed);
  const completed = reminders.filter((reminder) => reminder.completed);

  return (
    <div className="reminders-card">
      <form className="reminder-add-form" onSubmit={submit}>
        <input
          aria-label="要记住的事"
          autoComplete="off"
          maxLength={240}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="要记住的事，例如：五点开会"
          value={title}
        />
        <input
          aria-label="提醒时间（可选）"
          onChange={(event) => setScheduledTime(event.target.value)}
          type="time"
          value={scheduledTime}
        />
        <button disabled={saving || title.trim().length === 0} type="submit">
          {saving ? "正在保存" : "记下来"}
        </button>
      </form>

      {status ? <p aria-live="polite" className="reminders-status" role="status">{status}</p> : null}

      {pending.length === 0 && completed.length === 0 ? (
        <p className="reminders-empty">暂无提醒。</p>
      ) : null}

      <ul className="reminders-list">
        {pending.map((reminder) => (
          <li key={reminder.id}>
            {editingId === reminder.id ? (
              <div className="reminder-edit-row">
                <input
                  aria-label="修改提醒内容"
                  maxLength={240}
                  onChange={(event) => setEditTitle(event.target.value)}
                  value={editTitle}
                />
                <input
                  aria-label="修改提醒时间"
                  onChange={(event) => setEditTime(event.target.value)}
                  type="time"
                  value={editTime}
                />
                <button disabled={saving} onClick={() => void saveEdit(reminder)} type="button">
                  保存
                </button>
                <button disabled={saving} onClick={() => setEditingId(null)} type="button">
                  取消
                </button>
              </div>
            ) : confirmDeleteId === reminder.id ? (
              <div className="reminder-delete-row">
                <span>删除「{reminder.title}」？历史记录会保留。</span>
                <button disabled={saving} onClick={() => void remove(reminder)} type="button">
                  确认删除
                </button>
                <button disabled={saving} onClick={() => setConfirmDeleteId(null)} type="button">
                  取消
                </button>
              </div>
            ) : (
              <>
                <button
                  aria-label={`完成：${reminder.title}`}
                  className="reminder-check"
                  disabled={saving}
                  onClick={() => void toggleCompleted(reminder)}
                  title="标记完成"
                  type="button"
                >
                  <span aria-hidden="true">✓</span>
                </button>
                <div className="reminder-title-wrap">
                  <p>{reminder.title}</p>
                  {reminder.scheduledTime ? (
                    <time dateTime={`${reminder.businessDate}T${reminder.scheduledTime}`}>
                      {reminder.scheduledTime}
                    </time>
                  ) : null}
                </div>
                <div className="reminder-row-actions">
                  <button
                    disabled={saving}
                    onClick={() => beginEdit(reminder)}
                    type="button"
                  >
                    编辑
                  </button>
                  <button
                    disabled={saving}
                    onClick={() => void moveToTomorrow(reminder)}
                    title="把这条提醒移到下一天"
                    type="button"
                  >
                    移到明天
                  </button>
                  <button
                    disabled={saving}
                    onClick={() => {
                      setEditingId(null);
                      setConfirmDeleteId(reminder.id);
                    }}
                    type="button"
                  >
                    删除
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>

      {completed.length > 0 ? (
        <details className="reminders-completed">
          <summary>已完成 {completed.length} 条</summary>
          <ul>
            {completed.map((reminder) => (
              <li key={reminder.id}>
                <button
                  aria-label={`重新打开：${reminder.title}`}
                  className="reminder-check is-done"
                  disabled={saving}
                  onClick={() => void toggleCompleted(reminder)}
                  title="重新打开"
                  type="button"
                >
                  <span aria-hidden="true">✓</span>
                </button>
                <div className="reminder-title-wrap">
                  <p>{reminder.title}</p>
                  {reminder.scheduledTime ? <time>{reminder.scheduledTime}</time> : null}
                </div>
                <div className="reminder-row-actions">
                  <button disabled={saving} onClick={() => void remove(reminder)} type="button">
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
