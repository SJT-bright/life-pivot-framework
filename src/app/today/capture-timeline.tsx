"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import type {
  CapturePage,
  CaptureTimelineItem,
} from "@/modules/today/get-captures";
import type { StoredCapture } from "@/modules/today/contracts";

interface CaptureTimelineProps {
  businessDate: string;
  initialTimeline: CapturePage;
  newItems?: StoredCapture[];
  request?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  onRefreshed?: () => void;
}

function itemTime(value: string): string {
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  });
}

function CaptureTimelineRow({
  item,
  children,
}: {
  item: CaptureTimelineItem | StoredCapture;
  children?: ReactNode;
}) {
  return (
    <article>
      <time dateTime={item.occurredAt}>{itemTime(item.occurredAt)}</time>
      <div className="capture-row-main">
        <p>{item.text}</p>
        {children}
      </div>
    </article>
  );
}

interface VoidControlsProps {
  businessDate: string;
  itemId: string;
  disabled: boolean;
  request: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  onVoided: () => void;
}

function CaptureVoidControls({
  businessDate,
  itemId,
  disabled,
  request,
  onVoided,
}: VoidControlsProps) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function voidItem() {
    if (pending) return;
    setPending(true);
    setMessage(null);
    try {
      const response = await request("/api/v1/today/captures/void", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `capture-void-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({ itemId, businessDate }),
      });
      const result = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        setMessage(result?.message ?? "作废失败，请稍后重试");
        return;
      }
      setConfirming(false);
      onVoided();
    } catch {
      setMessage("没有收到本地服务的回应；记录仍然保留，请重试。");
    } finally {
      setPending(false);
    }
  }

  if (!confirming) {
    return (
      <div className="capture-item-actions">
        <button
          className="capture-void-button"
          disabled={disabled}
          onClick={() => {
            setMessage(null);
            setConfirming(true);
          }}
          type="button"
        >
          作废
        </button>
      </div>
    );
  }

  return (
    <div className="capture-item-actions capture-void-confirm">
      <span>作废后这条记录不再出现在时间线，但会保留证据；记错的内容可重新记录一条。</span>
      <button disabled={pending} onClick={() => void voidItem()} type="button">
        {pending ? "正在作废" : "确认作废"}
      </button>
      <button
        disabled={pending}
        onClick={() => {
          setConfirming(false);
          setMessage(null);
        }}
        type="button"
      >
        取消
      </button>
      {message ? <p role="alert">{message}</p> : null}
    </div>
  );
}

export function CaptureTimeline({
  businessDate,
  initialTimeline,
  newItems = [],
  request = fetch,
  onRefreshed = () => undefined,
}: CaptureTimelineProps) {
  const [items, setItems] = useState<CaptureTimelineItem[]>(initialTimeline.items);
  const [nextCursor, setNextCursor] = useState(initialTimeline.nextCursor);
  const [snapshot, setSnapshot] = useState(initialTimeline.snapshotHighWater);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const timelineGeneration = useRef(0);

  // A successful batch import refreshes the Server Component tree. Keep the
  // client-side paging state aligned with the new server snapshot so imported
  // records appear immediately instead of waiting for a full page reload.
  useEffect(() => {
    timelineGeneration.current += 1;
    setItems(initialTimeline.items);
    setNextCursor(initialTimeline.nextCursor);
    setSnapshot(initialTimeline.snapshotHighWater);
    setLoading(false);
    setMessage(null);
  }, [businessDate, initialTimeline]);

  async function loadPage(refresh: boolean) {
    if (loading) return;
    const requestGeneration = timelineGeneration.current;
    setLoading(true);
    setMessage(null);
    try {
      const query = new URLSearchParams({ date: businessDate, limit: "50" });
      if (!refresh && nextCursor) {
        query.set("cursor", nextCursor);
        query.set("snapshot", String(snapshot));
      }
      const response = await request(`/api/v1/today/captures?${query.toString()}`);
      if (!response.ok) throw new Error("timeline request failed");
      const page = (await response.json()) as CapturePage;
      if (requestGeneration !== timelineGeneration.current) return;
      if (refresh) {
        setItems(page.items);
        onRefreshed();
      } else {
        setItems((current) => {
          const known = new Set(current.map((item) => item.id));
          return [...current, ...page.items.filter((item) => !known.has(item.id))];
        });
      }
      setNextCursor(page.nextCursor);
      setSnapshot(page.snapshotHighWater);
    } catch {
      if (requestGeneration === timelineGeneration.current) {
        setMessage("时间线加载失败，请重试");
      }
    } finally {
      if (requestGeneration === timelineGeneration.current) setLoading(false);
    }
  }

  function handleVoided() {
    setMessage("已作废。");
    void loadPage(true);
  }

  return (
    <section aria-labelledby="capture-timeline-heading" className="capture-timeline">
      <div className="section-heading">
        <div>
          <h2 id="capture-timeline-heading">今日时间线</h2>
        </div>
        {newItems.length > 0 ? (
          <button disabled={loading} onClick={() => void loadPage(true)} type="button">
            刷新时间线
          </button>
        ) : null}
      </div>

      {newItems.length > 0 ? (
        <div aria-label="刚刚保存" className="capture-new-items">
          {newItems.map((item) => (
            <CaptureTimelineRow item={item} key={item.id} />
          ))}
        </div>
      ) : null}

      <div aria-label="已加载时间线">
        {items.map((item) => (
          <CaptureTimelineRow item={item} key={item.id}>
            <CaptureVoidControls
              businessDate={businessDate}
              disabled={loading}
              itemId={item.id}
              onVoided={handleVoided}
              request={request}
            />
          </CaptureTimelineRow>
        ))}
        {items.length === 0 && newItems.length === 0 ? <p>这一天还没有记录。</p> : null}
      </div>

      {nextCursor ? (
        <button
          className="timeline-load-more"
          disabled={loading}
          onClick={() => void loadPage(false)}
          type="button"
        >
          {loading ? "加载中" : "加载更多"}
        </button>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
