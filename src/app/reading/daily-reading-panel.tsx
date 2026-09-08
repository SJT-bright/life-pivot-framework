"use client";

import { useEffect, useMemo, useState } from "react";

import {
  type SimpleRecovery,
  type StoredSimpleSubmission,
  clearConfirmedSimpleSubmission,
  freezeSimpleSubmission,
  markSimpleSubmissionUncertain,
  reconcileSimpleSubmissionStorageChange,
  recoverSimpleSubmissions,
  storeSimpleSubmission,
} from "@/app/accumulation/frozen-submission";
import {
  type DailyReadingBook,
  type DailyReadingCommand,
  type DailyReadingSnapshot,
  type ReadingSession,
  dailyReadingMutationResponseSchema,
  dailyReadingSnapshotResponseSchema,
  dailyReadingCommandSchema,
} from "@/modules/reading/contracts";

interface DailyReadingPanelProps {
  businessDate: string;
  createId?: () => string;
  initial: DailyReadingSnapshot;
  mode?: "page" | "card";
  onRefresh?: (snapshot: DailyReadingSnapshot) => void;
  request?: typeof fetch;
  storage?: Storage;
}

interface Draft {
  sessionId: string | null;
  bookId: string;
  startPage: string;
  endPage: string;
  durationMinutes: string;
  note: string;
  expectedRevision: number;
}

const DAILY_READING_SUBMISSION_PREFIX =
  "life-pivot:accumulation:submission:v1:daily-reading:";

function storageOrNull(provided?: Storage): Storage | null {
  if (provided) return provided;
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function preferredBook(books: readonly DailyReadingBook[]): DailyReadingBook | null {
  return books.find((book) => book.status === "reading") ?? books[0] ?? null;
}

function emptyDraft(books: readonly DailyReadingBook[]): Draft {
  const book = preferredBook(books);
  const currentPage = book?.currentPage ?? 0;
  return {
    sessionId: null,
    bookId: book?.bookId ?? "",
    startPage: String(currentPage),
    endPage: String(currentPage),
    durationMinutes: "",
    note: "",
    expectedRevision: 0,
  };
}

function draftFromSession(session: ReadingSession): Draft {
  return {
    sessionId: session.sessionId,
    bookId: session.bookId,
    startPage: String(session.startPage),
    endPage: String(session.endPage),
    durationMinutes: String(session.durationMinutes),
    note: session.note,
    expectedRevision: session.revision,
  };
}

function draftFromFrozen(stored: StoredSimpleSubmission): Draft | null {
  try {
    const body = JSON.parse(stored.submission.body) as Record<string, unknown>;
    if (body.type !== "save-reading-session") return null;
    return {
      sessionId: String(body.sessionId),
      bookId: String(body.bookId),
      startPage: String(body.startPage),
      endPage: String(body.endPage),
      durationMinutes: String(body.durationMinutes),
      note: String(body.note ?? ""),
      expectedRevision: Number(body.expectedRevision),
    };
  } catch {
    return null;
  }
}

function expectedBookRevision(book: DailyReadingBook, endPage: number): number {
  const nextPage = Math.max(book.currentPage, endPage);
  const nextStatus = book.totalPages !== null && nextPage >= book.totalPages
    ? "finished"
    : book.status === "wishlist"
      ? "reading"
      : book.status;
  return nextPage !== book.currentPage || nextStatus !== book.status
    ? book.revision + 1
    : book.revision;
}

function statusLabel(status: DailyReadingBook["status"]): string {
  if (status === "reading") return "在读";
  if (status === "finished") return "已读完";
  return "待看";
}

export function DailyReadingPanel({
  businessDate,
  createId = () => crypto.randomUUID(),
  initial,
  mode = "page",
  onRefresh,
  request = fetch,
  storage: providedStorage,
}: DailyReadingPanelProps) {
  const [snapshot, setSnapshot] = useState(initial);
  const [draft, setDraft] = useState(() => emptyDraft(initial.books));
  const [active, setActive] = useState<StoredSimpleSubmission | null>(null);
  const [recoveryLock, setRecoveryLock] = useState<"external" | "unavailable" | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const locked = active !== null || recoveryLock !== null;
  const selectedBook = useMemo(
    () => snapshot.books.find((book) => book.bookId === draft.bookId) ?? null,
    [draft.bookId, snapshot.books],
  );

  useEffect(() => {
    const storage = storageOrNull(providedStorage);
    if (!storage) {
      setRecoveryLock("unavailable");
      setMessage("本机恢复存储不可用，暂时不能保存阅读记录");
      return;
    }
    const recovery = recoverSimpleSubmissions("daily-reading", storage);
    if (recovery.kind === "recovered") {
      const recoveredDraft = draftFromFrozen(recovery);
      if (recoveredDraft) setDraft(recoveredDraft);
      setActive(recovery);
      setRecoveryLock(null);
      setMessage("保存结果不确定，只能重试原提交或放弃");
    } else if (recovery.kind === "locked") {
      setRecoveryLock("external");
      setMessage(recovery.reason === "storage-cleared"
        ? "本机阅读提交证据已被清除，请刷新后继续"
        : "本机阅读提交已在其他页面变化，请刷新后继续");
    } else if (recovery.kind === "storage-unavailable") {
      setRecoveryLock("unavailable");
      setMessage("本机恢复存储不可用，暂时不能保存阅读记录");
    } else {
      setRecoveryLock(null);
    }
  }, [providedStorage]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (event: StorageEvent) => {
      if (active) {
        const reconciliation = reconcileSimpleSubmissionStorageChange(
          { purpose: "daily-reading", outerKey: active.outerKey, outerRaw: active.outerRaw },
          event,
        );
        if (reconciliation.kind !== "locked") return;
      } else if (
        event.key !== null &&
        !event.key.startsWith(DAILY_READING_SUBMISSION_PREFIX)
      ) {
        return;
      }
      setRecoveryLock("external");
      setMessage(event.key === null
        ? "本机阅读提交证据已被清除，请刷新后继续"
        : "本机阅读提交已在其他页面变化，请刷新后继续");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [active]);

  function update<K extends keyof Draft>(key: K, value: Draft[K]): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function applySnapshot(next: DailyReadingSnapshot, nextMessage: string): void {
    setSnapshot(next);
    setDraft(emptyDraft(next.books));
    setMessage(nextMessage);
    onRefresh?.(next);
  }

  async function selectDate(date: string): Promise<void> {
    if (locked) return;
    try {
      const response = await request(
        `/api/v1/daily-reading?date=${encodeURIComponent(date)}`,
        { method: "GET", cache: "no-store" },
      );
      if (!response.ok) throw new Error("daily reading read failed");
      const parsed = dailyReadingSnapshotResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("invalid daily reading snapshot");
      applySnapshot(parsed.data.snapshot, "");
    } catch {
      setMessage("暂时无法读取所选日期，当前内容未被覆盖");
    }
  }

  async function clearKnownFailure(
    storage: Storage,
    stored: StoredSimpleSubmission,
    status: number,
  ): Promise<void> {
    const uncertain = markSimpleSubmissionUncertain(storage, stored);
    if (uncertain.kind === "storage-unavailable") {
      setRecoveryLock("unavailable");
      setMessage("本机提交存储不可用，请刷新后继续");
      return;
    }
    if (uncertain.kind !== "recovered") {
      setRecoveryLock("external");
      setMessage("本机提交状态已变化，请保留当前页面");
      return;
    }
    const cleared = clearConfirmedSimpleSubmission(storage, uncertain);
    if (cleared.kind !== "cleared") {
      setActive(uncertain);
      setRecoveryLock(cleared.kind === "storage-unavailable" ? "unavailable" : "external");
      setMessage("本机提交状态已变化，请保留当前页面");
      return;
    }
    setActive(null);
    setMessage(status === 409
      ? "书籍或记录已变化，请刷新后再保存"
      : status === 422
        ? "页码或时间不符合要求，请修改后再保存"
        : "请求未被接受，请修改后再保存");
  }

  async function send(stored: StoredSimpleSubmission): Promise<void> {
    const storage = storageOrNull(providedStorage);
    if (!storage) {
      setRecoveryLock("unavailable");
      setMessage("本机恢复存储不可用，未发送");
      return;
    }
    if (recoveryLock !== null) return;
    setSaving(true);
    try {
      const response = await request(stored.submission.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": stored.submission.idempotencyKey,
        },
        body: stored.submission.body,
        cache: "no-store",
      });
      if (!response.ok) {
        if ([400, 409, 415, 422].includes(response.status)) {
          await clearKnownFailure(storage, stored, response.status);
          return;
        }
        throw new Error("uncertain daily reading response");
      }
      const parsed = dailyReadingMutationResponseSchema.safeParse(await response.json());
      const expected = stored.submission.expected;
      if (
        !parsed.success ||
        parsed.data.result.applied.operation !== expected.operation ||
        parsed.data.result.applied.ownerId !== expected.ownerId ||
        parsed.data.result.applied.ownerRevision !== expected.ownerRevision ||
        parsed.data.result.applied.bookRevision !== expected.bookRevision ||
        parsed.data.result.applied.businessDate !== expected.businessDate
      ) {
        throw new Error("unexpected daily reading confirmation");
      }
      const uncertain = markSimpleSubmissionUncertain(storage, stored);
      if (uncertain.kind !== "recovered") throw new Error("submission evidence changed");
      const cleared = clearConfirmedSimpleSubmission(storage, uncertain);
      if (cleared.kind !== "cleared") {
        throw new Error("submission evidence was not cleared");
      }
    } catch {
      const uncertain: SimpleRecovery = markSimpleSubmissionUncertain(storage, stored);
      if (uncertain.kind === "recovered") setActive(uncertain);
      else if (uncertain.kind === "locked") setRecoveryLock("external");
      else if (uncertain.kind === "storage-unavailable") setRecoveryLock("unavailable");
      setMessage("保存结果不确定，只能重试原提交或放弃");
      return;
    } finally {
      setSaving(false);
    }

    setActive(null);
    const expectedBusinessDate = stored.submission.expected.businessDate;
    const latest = typeof expectedBusinessDate === "string"
      ? await fetchLatestSnapshot(expectedBusinessDate)
      : null;
    if (!latest) {
      setMessage("保存已确认，但刷新失败，请刷新页面查看最新内容");
      return;
    }
    applySnapshot(latest, "已保存本次阅读");
  }

  async function fetchLatestSnapshot(date: string): Promise<DailyReadingSnapshot | null> {
    try {
      const response = await request(
        `/api/v1/daily-reading?date=${encodeURIComponent(date)}`,
        { method: "GET", cache: "no-store" },
      );
      if (!response.ok) return null;
      const parsed = dailyReadingSnapshotResponseSchema.safeParse(await response.json());
      return parsed.success && parsed.data.snapshot.businessDate === date
        ? parsed.data.snapshot
        : null;
    } catch {
      return null;
    }
  }

  async function submitCommand(
    command: DailyReadingCommand,
    expected: Record<string, string | number>,
  ): Promise<void> {
    const storage = storageOrNull(providedStorage);
    if (!storage || locked || saving) {
      if (!storage) {
        setRecoveryLock("unavailable");
        setMessage("本机恢复存储不可用，未发送");
      }
      return;
    }
    const parsed = dailyReadingCommandSchema.safeParse(command);
    if (!parsed.success) {
      setMessage("请填写有效的页码和阅读分钟");
      return;
    }
    let frozen;
    try {
      frozen = freezeSimpleSubmission({
        purpose: "daily-reading",
        endpoint: "/api/v1/daily-reading",
        operation: command.type,
        ownerId: command.sessionId,
        localRevision: Number(expected.ownerRevision),
        idempotencyKey: createId(),
        body: JSON.stringify(parsed.data),
        expected,
        createdAt: new Date().toISOString(),
      });
    } catch {
      setMessage("请填写有效的页码和阅读分钟");
      return;
    }
    const stored = storeSimpleSubmission(storage, frozen);
    if (stored.kind !== "stored") {
      if (stored.kind === "storage-unavailable") setRecoveryLock("unavailable");
      setMessage(stored.kind === "storage-unavailable"
        ? "本机恢复存储不可用，未发送"
        : "已有待确认的阅读提交");
      return;
    }
    setActive(stored);
    await send(stored);
  }

  async function submit(): Promise<void> {
    if (!selectedBook) {
      setMessage("请先选择一本书");
      return;
    }
    const sessionId = draft.sessionId ?? createId();
    const endPage = Number(draft.endPage);
    const ownerRevision = draft.expectedRevision + 1;
    await submitCommand({
      type: "save-reading-session",
      sessionId,
      bookId: selectedBook.bookId,
      businessDate: snapshot.businessDate,
      startPage: Number(draft.startPage),
      endPage,
      durationMinutes: Number(draft.durationMinutes),
      note: draft.note,
      expectedRevision: draft.expectedRevision,
      expectedBookRevision: selectedBook.revision,
    }, {
      operation: "save-reading-session",
      ownerId: sessionId,
      ownerRevision,
      bookRevision: expectedBookRevision(selectedBook, endPage),
      businessDate: snapshot.businessDate,
    });
  }

  async function archive(session: ReadingSession): Promise<void> {
    const book = snapshot.books.find((item) => item.bookId === session.bookId);
    if (!book) {
      setMessage("这本书已不可编辑，记录仍会保留在历史中");
      return;
    }
    await submitCommand({
      type: "archive-reading-session",
      sessionId: session.sessionId,
      bookId: session.bookId,
      businessDate: session.businessDate,
      expectedRevision: session.revision,
      expectedBookRevision: book.revision,
    }, {
      operation: "archive-reading-session",
      ownerId: session.sessionId,
      ownerRevision: session.revision + 1,
      bookRevision: book.revision,
      businessDate: session.businessDate,
    });
  }

  function abandon(): void {
    const storage = storageOrNull(providedStorage);
    if (!storage || !active) return;
    const uncertain = active.submission.status === "uncertain"
      ? { kind: "recovered" as const, ...active }
      : markSimpleSubmissionUncertain(storage, active);
    if (uncertain.kind !== "recovered") return;
    if (clearConfirmedSimpleSubmission(storage, uncertain).kind !== "cleared") return;
    setActive(null);
    setMessage("已放弃原提交，表单内容仍保留");
  }

  function chooseBook(bookId: string): void {
    const book = snapshot.books.find((item) => item.bookId === bookId);
    setDraft({
      ...emptyDraft(snapshot.books),
      bookId,
      startPage: String(book?.currentPage ?? 0),
      endPage: String(book?.currentPage ?? 0),
    });
  }

  const summary = snapshot.sessions.length === 0
    ? "这一天还没有阅读记录"
    : `今日共读 ${snapshot.totalPagesRead} 页 · ${snapshot.totalMinutes} 分钟`;
  const form = (
    <form
      className={mode === "page" ? "reading-form" : undefined}
      onSubmit={(event) => { event.preventDefault(); void submit(); }}
    >
      {mode === "page" ? <h2>记一次阅读</h2> : null}
      {mode === "page" ? (
        <label>
          日期
          <input
            aria-label="阅读日期"
            disabled={locked}
            onChange={(event) => void selectDate(event.target.value)}
            type="date"
            value={snapshot.businessDate}
          />
        </label>
      ) : null}
      <label>
        书籍
        <select
          aria-label="书籍"
          disabled={locked || snapshot.books.length === 0}
          onChange={(event) => chooseBook(event.target.value)}
          value={draft.bookId}
        >
          {snapshot.books.length === 0 ? <option value="">暂无书籍</option> : null}
          {snapshot.books.map((book) => (
            <option key={book.bookId} value={book.bookId}>
              {book.title} · {statusLabel(book.status)}
            </option>
          ))}
        </select>
      </label>
      <div className="reading-edit-grid">
        <label>
          从第几页开始
          <input
            aria-label="从第几页开始"
            disabled={locked}
            max={selectedBook?.totalPages ?? 100_000}
            min="0"
            onChange={(event) => update("startPage", event.target.value)}
            required
            type="number"
            value={draft.startPage}
          />
        </label>
        <label>
          读到第几页
          <input
            aria-label="读到第几页"
            disabled={locked}
            max={selectedBook?.totalPages ?? 100_000}
            min="0"
            onChange={(event) => update("endPage", event.target.value)}
            required
            type="number"
            value={draft.endPage}
          />
        </label>
      </div>
      <label>
        阅读分钟
        <input
          aria-label="阅读分钟"
          disabled={locked}
          max="1440"
          min="1"
          onChange={(event) => update("durationMinutes", event.target.value)}
          required
          type="number"
          value={draft.durationMinutes}
        />
      </label>
      <details>
        <summary>本次备注（可选）</summary>
        <label>
          本次备注
          <textarea
            aria-label="本次备注"
            disabled={locked}
            maxLength={5_000}
            onChange={(event) => update("note", event.target.value)}
            value={draft.note}
          />
        </label>
      </details>
      {!active ? (
        <div className="reading-note-actions">
          <button disabled={locked || saving || selectedBook === null} type="submit">
            {draft.sessionId ? "更新本次阅读" : "保存本次阅读"}
          </button>
          {draft.sessionId ? (
            <button
              disabled={saving}
              onClick={() => setDraft(emptyDraft(snapshot.books))}
              type="button"
            >
              取消编辑
            </button>
          ) : null}
        </div>
      ) : (
        <div className="reading-note-actions">
          <button disabled={recoveryLock !== null || saving} onClick={() => void send(active)} type="button">
            重试原提交
          </button>
          <button disabled={recoveryLock !== null || saving} onClick={abandon} type="button">
            放弃并保留表单
          </button>
        </div>
      )}
      {snapshot.books.length === 0 ? (
        <p className="reading-empty">暂无书籍。</p>
      ) : null}
      {message ? <p className="reading-status" role="status">{message}</p> : null}
    </form>
  );

  const sessions = (
    <div className="reading-book-list">
      <p className="today-domain-card-summary">{summary}</p>
      {snapshot.sessions.length === 0 ? (
        <p className="reading-empty">暂无阅读记录。</p>
      ) : snapshot.sessions.map((session) => (
        <article className="reading-book-card" key={session.sessionId}>
          <div className="reading-book-header">
            <div>
              <h3>{session.bookTitle}</h3>
              <p className="reading-book-meta">
                {session.startPage} → {session.endPage} 页 · {session.durationMinutes} 分钟
              </p>
            </div>
            <div className="reading-book-actions">
              <button
                disabled={locked || saving}
                onClick={() => setDraft(draftFromSession(session))}
                type="button"
              >
                编辑
              </button>
              <button
                disabled={locked || saving}
                onClick={() => void archive(session)}
                type="button"
              >
                移除
              </button>
            </div>
          </div>
          {session.note ? <p>{session.note}</p> : null}
        </article>
      ))}
    </div>
  );

  if (mode === "card") {
    return (
      <div className="today-domain-card today-domain-card-reading">
        {sessions}
        {form}
      </div>
    );
  }

  return (
    <section aria-label="每日阅读记录" className="reading-workspace">
      <header>
        <h2>每日阅读记录</h2>
      </header>
      <div className="reading-layout">
        {form}
        {sessions}
      </div>
    </section>
  );
}
