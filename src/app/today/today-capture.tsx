"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { toShanghaiBusinessDate } from "@/core/time/business-date";
import type { StoredCapture } from "@/modules/today/contracts";
import type { CapturePage } from "@/modules/today/get-captures";
import type { CaptureSource } from "@/modules/today/get-capture-source";

import type { TodayCardState } from "./today-card-state";
import {
  emptyCaptureDraftEnvelope,
  loadCaptureDraftEnvelope,
  moveDraftToBusinessDate,
  persistCaptureDraftEnvelope,
  recoverLegacyDraft,
  startDraft,
  updateDraft,
  type CaptureDraft,
  type CaptureDraftEnvelope,
} from "./capture-draft";
import { CaptureTimeline } from "./capture-timeline";

interface TodayCaptureProps {
  businessDate: string;
  focusedSource?: CaptureSource | null;
  initialTimeline: CapturePage | TodayCardState<CapturePage>;
  request?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  createId?: () => string;
  now?: () => Date;
  storage?: Storage;
}

function toTimelineState(
  initialTimeline: CapturePage | TodayCardState<CapturePage>,
): TodayCardState<CapturePage> {
  return "status" in initialTimeline
    ? initialTimeline
    : { status: "ready", data: initialTimeline };
}

function sourceTime(value: string): string {
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  });
}

export function CaptureSourcePanel({ source }: { source: CaptureSource | null }) {
  return (
    <section aria-label="知识来源原文" className="capture-section">
      <div className="section-heading">
        <div>
          <h2>知识来源原文</h2>
        </div>
        {source ? (
          <p className="save-status">
            {source.disposition === "voided" ? "已作废" : "有效"}
          </p>
        ) : null}
      </div>
      {source ? (
        <article>
          <p>
            <time dateTime={source.businessDate}>{source.businessDate}</time>
            {" · "}
            <time dateTime={source.occurredAt}>{sourceTime(source.occurredAt)}</time>
          </p>
          <p style={{ whiteSpace: "pre-wrap" }}>{source.text}</p>
        </article>
      ) : (
        <p>来源记录不可用</p>
      )}
    </section>
  );
}

interface SaveResponse {
  section?: "entry";
  status: "saved" | "failed" | "conflict";
  item?: StoredCapture;
  message?: string;
}

function isStoredCapture(value: unknown): value is StoredCapture {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return [
    "id",
    "draftId",
    "businessDate",
    "occurredAt",
    "text",
    "createdAt",
  ].every((field) => typeof item[field] === "string");
}

export function TodayCapture({
  businessDate,
  focusedSource,
  initialTimeline,
  request = fetch,
  createId = () => crypto.randomUUID(),
  now = () => new Date(),
  storage,
}: TodayCaptureProps) {
  const [envelope, setEnvelope] = useState<CaptureDraftEnvelope>(emptyCaptureDraftEnvelope);
  const [hydrated, setHydrated] = useState(false);
  const [storageWritable, setStorageWritable] = useState(true);
  const [storageMessage, setStorageMessage] = useState<string | null>(null);
  const [newItems, setNewItems] = useState<StoredCapture[]>([]);
  const [crossDateSaved, setCrossDateSaved] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const envelopeRef = useRef(envelope);
  const inFlight = useRef(new Set<string>());
  const browserStorage = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
  const timelineState = toTimelineState(initialTimeline);

  function commitEnvelope(
    update: (current: CaptureDraftEnvelope) => CaptureDraftEnvelope,
  ): CaptureDraftEnvelope {
    const next = update(envelopeRef.current);
    envelopeRef.current = next;
    setEnvelope(next);
    return next;
  }

  useEffect(() => {
    if (!browserStorage) {
      setStorageWritable(false);
      setStorageMessage("浏览器草稿存储不可用；仍可直接保存到本地数据库。");
      setHydrated(true);
      return;
    }
    const loaded = loadCaptureDraftEnvelope(browserStorage);
    envelopeRef.current = loaded.envelope;
    setEnvelope(loaded.envelope);
    setStorageWritable(loaded.writable);
    setStorageMessage(loaded.recoveryMessage ?? null);
    setHydrated(true);
  }, [browserStorage]);

  useEffect(() => {
    if (!hydrated || !storageWritable || !browserStorage) return;
    if (!persistCaptureDraftEnvelope(browserStorage, envelope)) {
      setStorageWritable(false);
      setStorageMessage("浏览器无法持久化草稿；请尽快提交或手动复制内容。");
    }
  }, [browserStorage, envelope, hydrated, storageWritable]);

  const draftDependencies = {
    now,
    createId,
    toBusinessDate: toShanghaiBusinessDate,
  };

  function changeText(text: string) {
    commitEnvelope((current) => ({
      ...current,
      current: current.current
        ? updateDraft(current.current, text)
        : startDraft(undefined, text, draftDependencies),
    }));
    setCrossDateSaved(null);
  }

  function failPending(draftId: string, message: string) {
    commitEnvelope((current) => ({
      ...current,
      pending: current.pending.map((item) =>
        item.draft.draftId === draftId
          ? { ...item, status: "failed", message }
          : item),
    }));
  }

  async function sendDraft(draft: CaptureDraft) {
    if (inFlight.current.has(draft.draftId)) return;
    inFlight.current.add(draft.draftId);
    commitEnvelope((current) => ({
      ...current,
      pending: current.pending.map((item) =>
        item.draft.draftId === draft.draftId
          ? { ...item, status: "saving", message: undefined }
          : item),
    }));

    try {
      const response = await request("/api/v1/today/sections", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": draft.idempotencyKey,
        },
        body: JSON.stringify({
          section: "entry",
          draftId: draft.draftId,
          businessDate: draft.draftBusinessDate,
          occurredAt: draft.occurredAt,
          value: { text: draft.text },
        }),
      });
      let result: SaveResponse | null = null;
      try {
        result = (await response.json()) as SaveResponse;
      } catch {
        result = null;
      }
      if (!result) {
        const message = response.status === 404
          ? "本地保存服务未找到，请重启网页服务后再次确认保存。内容已安全保留。"
          : response.ok
            ? "保存结果无法确认，内容已安全保留；请再次确认保存。"
            : `本地保存服务暂时不可用（${response.status}），内容已安全保留；请稍后再次确认保存。`;
        failPending(draft.draftId, message);
        return;
      }
      if (response.ok && result.status === "saved" && !isStoredCapture(result.item)) {
        failPending(draft.draftId, "保存结果格式异常，内容已安全保留；请再次确认保存。");
        return;
      }
      if (!response.ok || result.status !== "saved" || !isStoredCapture(result.item)) {
        failPending(draft.draftId, result.message ?? "保存失败，内容已安全保留；请再次确认保存。");
        return;
      }

      commitEnvelope((current) => ({
        ...current,
        pending: current.pending.filter((item) => item.draft.draftId !== draft.draftId),
      }));
      if (result.item.businessDate === businessDate) {
        setNewItems((items) => [
          result.item!,
          ...items.filter((item) => item.id !== result.item!.id),
        ]);
      } else {
        setCrossDateSaved(result.item.businessDate);
      }
    } catch {
      failPending(draft.draftId, "没有收到本地保存服务的回应，内容已安全保留；请再次确认保存。");
    } finally {
      inFlight.current.delete(draft.draftId);
    }
  }

  function submitCurrent() {
    const draft = envelopeRef.current.current;
    if (!draft) {
      setStorageMessage("请先写下内容再保存。");
      return;
    }
    commitEnvelope((current) => ({
      ...current,
      current: current.current?.draftId === draft.draftId ? undefined : current.current,
      pending: current.pending.some((item) => item.draft.draftId === draft.draftId)
        ? current.pending
        : [...current.pending, { draft, status: "saving" }],
    }));
    void sendDraft(draft);
  }

  const currentDraft = envelope.current;
  const multiline = currentDraft?.text.includes("\n") ?? false;
  const savingCount = envelope.pending.filter((item) => item.status === "saving").length;
  const statusText = !hydrated
    ? "正在恢复草稿"
    : savingCount > 0
      ? `${savingCount} 条正在保存；可以继续记录`
      : currentDraft
        ? "草稿已保存在浏览器"
        : envelope.pending.length > 0
          ? `${envelope.pending.length} 条内容等待保存确认`
          : "";

  return (
    <>
      {focusedSource !== undefined ? <CaptureSourcePanel source={focusedSource} /> : null}

      <section className="capture-section" aria-labelledby="entry-heading">
        <div className="section-heading">
          <div>
            <h2 id="entry-heading">快速收集</h2>
          </div>
          {statusText ? <p className="save-status" aria-live="polite" role="status">{statusText}</p> : null}
        </div>

        {storageMessage ? <p role="alert" className="form-error">{storageMessage}</p> : null}
        {crossDateSaved ? (
          <p role="status">
            已按原日期保存。<Link href={`/today?date=${crossDateSaved}`}>查看 {crossDateSaved}</Link>
          </p>
        ) : null}

        {currentDraft && currentDraft.draftBusinessDate !== businessDate ? (
          <aside aria-label="冻结草稿日期">
            <p>这份草稿属于 {currentDraft.draftBusinessDate}</p>
            <button
              onClick={() => commitEnvelope((current) => ({
                ...current,
                current: current.current
                  ? moveDraftToBusinessDate(current.current, businessDate, now())
                  : undefined,
              }))}
              type="button"
            >
              改为当前日期
            </button>
          </aside>
        ) : null}

        <form
          ref={formRef}
          onSubmit={(event) => {
            event.preventDefault();
            submitCurrent();
          }}
        >
          <label htmlFor="today-entry">今天发生了什么？</label>
          <textarea
            id="today-entry"
            aria-describedby="today-entry-hint"
            maxLength={20_000}
            onChange={(event) => changeText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              if ((!multiline && !event.shiftKey) || (multiline && (event.ctrlKey || event.metaKey))) {
                event.preventDefault();
                formRef.current?.requestSubmit();
              }
            }}
            placeholder="例如：刚学到的概念、突然想到的点子、今天发生的事……"
            rows={multiline ? 6 : 1}
            value={currentDraft?.text ?? ""}
          />
          <div className="form-actions">
            <p id="today-entry-hint">
              {multiline ? "Enter 换行，Ctrl/Cmd + Enter 保存" : "Enter 保存，Shift + Enter 换行"}
            </p>
            <button className="capture-submit" type="submit">保存到待整理</button>
          </div>
        </form>

        {envelope.pending.length > 0 ? (
          <section aria-label="待确认提交">
            <h3>待确认提交</h3>
            {envelope.pending.map((item) => (
              <article key={item.draft.draftId}>
                <p>{item.draft.text}</p>
                <p>{item.status === "saving" ? "正在保存" : item.message ?? "结果未知，可安全重试"}</p>
                <button
                  disabled={item.status === "saving"}
                  onClick={() => void sendDraft(item.draft)}
                  type="button"
                >
                  再次确认保存
                </button>
              </article>
            ))}
          </section>
        ) : null}

        {envelope.legacy.length > 0 ? (
          <section aria-label="旧草稿恢复">
            <h3>发现旧草稿</h3>
            <p>旧内容不会自动发送；确认后才能继续编辑。</p>
            {envelope.legacy.map((item) => (
              <article key={item.sourceKey}>
                <p>{item.businessDate} · {item.text}</p>
                <button
                  disabled={Boolean(currentDraft)}
                  onClick={() => commitEnvelope((current) =>
                    recoverLegacyDraft(current, item.sourceKey, draftDependencies))}
                  type="button"
                >
                  继续编辑
                </button>
              </article>
            ))}
          </section>
        ) : null}
      </section>

      {timelineState.status === "ready" ? (
        <CaptureTimeline
          businessDate={businessDate}
          initialTimeline={timelineState.data}
          newItems={newItems}
          onRefreshed={() => setNewItems([])}
          request={request}
        />
      ) : (
        <section aria-label="今日时间线" className="capture-timeline">
          <h3>今日时间线</h3>
          <p role="status">时间线暂时无法读取；快速收集和原提交重试仍可使用。</p>
        </section>
      )}
    </>
  );
}
