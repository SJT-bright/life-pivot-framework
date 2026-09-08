"use client";

import { useEffect, useState } from "react";

import {
  clearConfirmedSimpleSubmission,
  freezeSimpleSubmission,
  markSimpleSubmissionUncertain,
  recoverSimpleSubmissions,
  storeSimpleSubmission,
  type StoredSimpleSubmission,
} from "@/app/accumulation/frozen-submission";
import type { PersonalDailyNote } from "@/modules/personal-notes/contracts";

interface TodayPersonalNoteCardProps {
  businessDate: string;
  initialNote: PersonalDailyNote | null;
}

function parseResult(value: unknown): PersonalDailyNote | null {
  if (typeof value !== "object" || value === null || !("result" in value)) return null;
  const result = value.result;
  if (typeof result !== "object" || result === null) return null;
  const record = result as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.businessDate === "string" &&
    typeof record.content === "string" && Number.isSafeInteger(record.revision) &&
    typeof record.createdAt === "string" && typeof record.updatedAt === "string"
    ? record as unknown as PersonalDailyNote
    : null;
}

function expectedMatches(stored: StoredSimpleSubmission, note: PersonalDailyNote): boolean {
  return note.id === stored.submission.expected.noteId &&
    note.businessDate === stored.submission.expected.businessDate &&
    note.revision === stored.submission.expected.revision;
}

export function TodayPersonalNoteCard({ businessDate, initialNote }: TodayPersonalNoteCardProps) {
  const [note, setNote] = useState(initialNote);
  const [content, setContent] = useState(initialNote?.content ?? "");
  const [active, setActive] = useState<StoredSimpleSubmission | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const recovery = recoverSimpleSubmissions("personal-note");
    if (recovery.kind === "recovered") {
      setActive(recovery);
      try {
        const recovered = JSON.parse(recovery.submission.body) as { content?: unknown };
        if (typeof recovered.content === "string") setContent(recovered.content);
      } catch {
        // The shared helper already validated the exact JSON body.
      }
      setMessage("有一份结果待确认，请重试原提交或放弃后继续编辑。");
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
        if (cleared.kind === "cleared") setActive(null);
        setMessage(response.status === 409
          ? "整体备注已变化，请刷新后重试。"
          : "保存未完成，内容仍保留，可修改后重试。");
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
      setContent(result.content);
      setActive(null);
      setMessage("已保存");
    } catch {
      setMessage("提交结果不确定，请重试原提交。");
    } finally {
      setSending(false);
    }
  }

  async function save(): Promise<void> {
    const noteId = note?.id ?? `personal-note-${crypto.randomUUID()}`;
    const expectedRevision = note?.revision ?? 0;
    const idempotencyKey = crypto.randomUUID();
    const body = JSON.stringify({
      type: "save-personal-daily-note",
      noteId,
      businessDate,
      content,
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

  return (
    <section aria-label="每日复盘" className="today-card personal-note-card">
      <h2>每日复盘</h2>
      <label htmlFor="personal-note-content">每日复盘</label>
      <textarea
        disabled={active !== null}
        id="personal-note-content"
        maxLength={20_000}
        onChange={(event) => setContent(event.target.value)}
        rows={6}
        value={content}
      />
      <div className="personal-note-actions">
        <button disabled={active !== null || sending} onClick={() => void save()} type="button">
          保存复盘
        </button>
        {active ? (
          <>
            <button disabled={sending} onClick={() => void send(active)} type="button">重试原提交</button>
            <button disabled={sending} onClick={abandon} type="button">放弃并保留表单草稿</button>
          </>
        ) : null}
      </div>
      {message ? <p aria-live="polite">{message}</p> : null}
    </section>
  );
}

