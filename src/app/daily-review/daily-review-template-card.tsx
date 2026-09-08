"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  clearConfirmedSimpleSubmission,
  freezeSimpleSubmission,
  markSimpleSubmissionUncertain,
  recoverSimpleSubmissions,
  storeSimpleSubmission,
  type StoredSimpleSubmission,
} from "@/app/accumulation/frozen-submission";
import { toShanghaiBusinessDate } from "@/core/time/business-date";
import type { PersonalDailyNote } from "@/modules/personal-notes/contracts";

interface ReviewFields {
  readonly completed: string;
  readonly effective: string;
  readonly tomorrow: string;
}

interface SerializedReviewPayload extends ReviewFields {
  readonly schemaVersion: "daily-review-template-v1";
}

function emptyReviewContent(): ReviewFields {
  return { completed: "", effective: "", tomorrow: "" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseReviewContent(content: string | null): ReviewFields {
  if (!content?.trim()) return emptyReviewContent();

  try {
    const parsed = JSON.parse(content);
    if (
      isRecord(parsed)
      && parsed.schemaVersion === "daily-review-template-v1"
      && typeof parsed.completed === "string"
      && typeof parsed.effective === "string"
      && typeof parsed.tomorrow === "string"
    ) {
      return {
        completed: parsed.completed,
        effective: parsed.effective,
        tomorrow: parsed.tomorrow,
      };
    }
  } catch {
    // 回退到旧备注格式：全部放入“今天做了什么”。
  }

  return {
    ...emptyReviewContent(),
    completed: content,
  };
}

function serializeReviewContent({ completed, effective, tomorrow }: ReviewFields): string {
  const payload: SerializedReviewPayload = {
    schemaVersion: "daily-review-template-v1",
    completed,
    effective,
    tomorrow,
  };
  return JSON.stringify(payload);
}

interface DailyReviewTemplateCardProps {
  readonly businessDate: string;
  readonly initialNote: PersonalDailyNote | null;
  readonly today?: string;
}

function parseResult(value: unknown): PersonalDailyNote | null {
  if (typeof value !== "object" || value === null || !("result" in value)) return null;
  const result = value.result;
  if (typeof result !== "object" || result === null) return null;
  const record = result as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.businessDate === "string"
    && typeof record.content === "string" && Number.isSafeInteger(record.revision)
    && typeof record.createdAt === "string" && typeof record.updatedAt === "string"
      ? record as unknown as PersonalDailyNote
      : null;
}

function expectedMatches(stored: StoredSimpleSubmission, note: PersonalDailyNote): boolean {
  return note.id === stored.submission.expected.noteId
    && note.businessDate === stored.submission.expected.businessDate
    && note.revision === stored.submission.expected.revision;
}

function noteRevisionAndId(note: PersonalDailyNote | null): { noteId: string; expectedRevision: number } {
  return note ? { noteId: note.id, expectedRevision: note.revision } : {
    noteId: `personal-note-${crypto.randomUUID()}`,
    expectedRevision: 0,
  };
}

export function DailyReviewTemplateCard({ businessDate, initialNote, today: todayProp }: DailyReviewTemplateCardProps) {
  const router = useRouter();
  const today = todayProp ?? toShanghaiBusinessDate(new Date());
  const [note, setNote] = useState<PersonalDailyNote | null>(initialNote);
  const initialFields = parseReviewContent(initialNote?.content ?? null);
  const [completed, setCompleted] = useState(initialFields.completed);
  const [effective, setEffective] = useState(initialFields.effective);
  const [tomorrow, setTomorrow] = useState(initialFields.tomorrow);
  const [active, setActive] = useState<StoredSimpleSubmission | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [converting, setConverting] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveDate, setMoveDate] = useState("");
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    const recovery = recoverSimpleSubmissions("personal-note");
    if (recovery.kind === "recovered") {
      setActive(recovery);
      try {
        const restored = JSON.parse(recovery.submission.body) as { content?: unknown };
        if (typeof restored.content === "string") {
          const parsed = parseReviewContent(restored.content);
          setCompleted(parsed.completed);
          setEffective(parsed.effective);
          setTomorrow(parsed.tomorrow);
        }
      } catch {
        // shared helper already validates the exact JSON body.
      }
      setMessage("有一份复盘结果待确认，请重试原提交或放弃后继续编辑。");
    } else if (recovery.kind !== "none") {
      setMessage("本机提交记录暂时不可用，请先保留当前内容。");
    }
  }, []);

  async function send(stored: StoredSimpleSubmission): Promise<void> {
    setSending(true);
    try {
      const response = await fetch(stored.submission.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": stored.submission.idempotencyKey,
        },
        body: stored.submission.body,
      });
      if (!response.ok) {
        const cleared = clearConfirmedSimpleSubmission(window.localStorage, stored);
        if (cleared.kind === "cleared") {
          setActive(null);
        }
        setMessage(response.status === 409
          ? "复盘内容已变化，请刷新后重试。"
          : "保存未完成，内容仍保留，可修改后重试。"
        );
        return;
      }
      const result = parseResult(await response.json());
      if (!result || !expectedMatches(stored, result)) {
        setMessage("服务器返回无法确认，请使用原提交重试。");
        return;
      }
      const cleared = clearConfirmedSimpleSubmission(window.localStorage, stored);
      if (cleared.kind !== "cleared") {
        setMessage("已收到保存结果，但本机提交记录未能安全清除。");
        return;
      }
      setNote(result);
      const parsed = parseReviewContent(result.content);
      setCompleted(parsed.completed);
      setEffective(parsed.effective);
      setTomorrow(parsed.tomorrow);
      setActive(null);
      setMessage("已保存");
    } catch {
      setMessage("提交结果不确定，请重试原提交。");
    } finally {
      setSending(false);
    }
  }

  async function save(override?: ReviewFields): Promise<void> {
    const fields = override ?? { completed, effective, tomorrow };
    const payload = serializeReviewContent(fields);
    const { noteId, expectedRevision } = noteRevisionAndId(note);
    const idempotencyKey = crypto.randomUUID();
    const body = JSON.stringify({
      type: "save-personal-daily-note",
      noteId,
      businessDate,
      content: payload,
      expectedRevision,
    });
    const frozen = freezeSimpleSubmission({
      purpose: "personal-note",
      endpoint: "/api/v1/personal-notes",
      operation: "save-personal-daily-note",
      ownerId: noteId,
      localRevision: expectedRevision + 1,
      idempotencyKey,
      body,
      expected: { noteId, businessDate, revision: expectedRevision + 1 },
      createdAt: new Date().toISOString(),
    });
    const stored = storeSimpleSubmission(window.localStorage, frozen);
    if (stored.kind !== "stored") {
      setMessage("无法安全保存本机提交记录，本次未发送。");
      return;
    }
    const uncertain = markSimpleSubmissionUncertain(window.localStorage, stored);
    if (uncertain.kind !== "recovered") {
      setMessage("无法锁定本次提交，本次未发送。");
      return;
    }
    setActive(uncertain);
    await send(uncertain);
  }

  // 一键清空：把三个框清空并立即保存，下一天从零开始写。
  async function clearAndSave(): Promise<void> {
    if (sending) return;
    setCompleted("");
    setEffective("");
    setTomorrow("");
    await save({ completed: "", effective: "", tomorrow: "" });
  }

  function abandon(): void {
    if (!active) return;
    const cleared = clearConfirmedSimpleSubmission(window.localStorage, active);
    if (cleared.kind === "cleared") {
      setActive(null);
      setMessage("已放弃原提交，表单内容仍保留。");
    } else {
      setMessage("无法安全放弃原提交，请保留当前页面。");
    }
  }

  async function moveToTarget(): Promise<void> {
    if (!note || !moveDate || moveDate === note.businessDate || moving) return;
    setMoving(true);
    try {
      const response = await fetch("/api/v1/personal-notes", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `move-note-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          type: "move-personal-daily-note",
          noteId: note.id,
          fromBusinessDate: note.businessDate,
          toBusinessDate: moveDate,
          expectedRevision: note.revision,
        }),
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        setMessage(payload && typeof payload === "object" && "message" in payload
          && typeof (payload as { message?: unknown }).message === "string"
          ? (payload as { message: string }).message
          : "复盘未移动，请稍后重试。");
        return;
      }
      const moved = parseResult(payload);
      if (!moved) {
        setMessage("服务器返回无法确认，请刷新页面核对复盘所在日期。");
        return;
      }
      setNote(moved);
      setMoveOpen(false);
      setMoveDate("");
      setMessage(`复盘已移动到 ${moved.businessDate}。`);
      router.replace(`/daily-review?date=${moved.businessDate}`);
    } catch {
      setMessage("没有收到本地服务的回应，复盘未移动；请刷新页面核对当前状态。");
    } finally {
      setMoving(false);
    }
  }

  function nextDay(date: string): string {
    const [year, month, day] = date.split("-").map(Number);
    const shifted = new Date(Date.UTC(year!, month! - 1, day!));
    shifted.setUTCDate(shifted.getUTCDate() + 1);
    return shifted.toISOString().slice(0, 10);
  }

  async function convertTomorrowToAction(): Promise<void> {
    const source = tomorrow.trim();
    if (!source) {
      setMessage("先在“明天做什么更好”里写一句，再转成行动。");
      return;
    }
    if (converting) return;
    setConverting(true);
    try {
      const title = `改进：${source.split("\n")[0]!.trim().slice(0, 480)}`;
      const response = await fetch("/api/v1/planning", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `review-to-action-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          type: "create-action",
          id: `action-review-${crypto.randomUUID()}`,
          goalId: null,
          parentActionId: null,
          actionType: "today",
          businessDate: nextDay(businessDate),
          title,
          priority: "normal",
          estimatedMinutes: null,
          notes: source,
        }),
      });
      const result = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        setMessage(result?.message ?? "创建行动失败，请稍后重试。");
        return;
      }
      setMessage(`已创建 ${nextDay(businessDate)} 的行动，可在“目标与行动”里查看。`);
    } catch {
      setMessage("没有收到本地服务的回应，行动未创建；请重试。");
    } finally {
      setConverting(false);
    }
  }

  return (
    <section aria-label="每日复盘模板" className="today-card personal-note-card">
      <h2>每日复盘模板</h2>
      <label htmlFor="daily-review-completed">今天做了什么</label>
      <textarea
        disabled={active !== null}
        id="daily-review-completed"
        maxLength={6000}
        onChange={(event) => setCompleted(event.target.value)}
        rows={5}
        value={completed}
      />
      <label htmlFor="daily-review-effective">什么是有效的</label>
      <textarea
        disabled={active !== null}
        id="daily-review-effective"
        maxLength={6000}
        onChange={(event) => setEffective(event.target.value)}
        rows={5}
        value={effective}
      />
      <label htmlFor="daily-review-tomorrow">明天做什么更好</label>
      <textarea
        disabled={active !== null}
        id="daily-review-tomorrow"
        maxLength={6000}
        onChange={(event) => setTomorrow(event.target.value)}
        rows={5}
        value={tomorrow}
      />
      <div className="personal-note-actions">
        <button disabled={active !== null || sending || moving} onClick={() => void save()} type="button">
          保存复盘
        </button>
        <button
          disabled={active !== null || sending || moving}
          onClick={() => void clearAndSave()}
          title="把三个框清空并立即保存，方便重新开始写"
          type="button"
        >
          {sending ? "处理中" : "一键清空"}
        </button>
        <button
          disabled={active !== null || converting || moving || tomorrow.trim().length === 0}
          onClick={() => void convertTomorrowToAction()}
          title="把“明天做什么更好”的第一句创建为明天的今日行动"
          type="button"
        >
          {converting ? "正在创建行动" : "转成明日行动"}
        </button>
        {note ? (
          <button
            disabled={active !== null || sending || moving}
            onClick={() => setMoveOpen((open) => !open)}
            title="复盘做晚了被记到第二天？把它移动到正确的日期"
            type="button"
          >
            {moveOpen ? "取消修改日期" : "修改日期"}
          </button>
        ) : null}
        {active ? (
          <>
            <button disabled={sending} onClick={() => void send(active)} type="button">重试原提交</button>
            <button disabled={sending} onClick={abandon} type="button">放弃并保留表单草稿</button>
          </>
        ) : null}
      </div>
      {note && moveOpen ? (
        <div className="personal-note-move">
          <label htmlFor="daily-review-move-date">移动复盘到</label>
          <div>
            <input
              id="daily-review-move-date"
              max={today}
              onChange={(event) => setMoveDate(event.target.value)}
              type="date"
              value={moveDate}
            />
            <button
              disabled={moving || !moveDate || moveDate === note.businessDate}
              onClick={() => void moveToTarget()}
              type="button"
            >
              {moving ? "正在移动" : "确认移动"}
            </button>
          </div>
          <p>移动后，这份复盘会按新日期计入周回顾和复盘地图。</p>
        </div>
      ) : null}
      {message ? <p aria-live="polite">{message}</p> : null}
    </section>
  );
}


