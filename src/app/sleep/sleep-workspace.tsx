"use client";

import { useState } from "react";

import type { DailySleepRecord } from "@/modules/daily-sleep/contracts";
import type { DailySleepHistory } from "@/modules/daily-sleep/query";

import { SimpleSleepForm } from "./simple-sleep-form";
import { SleepHistoryChart } from "./sleep-history-chart";

export type DailySleepReadState<T> =
  | { status: "ready"; data: T }
  | { status: "unavailable" };

export interface SleepWorkspaceInitial {
  record: DailySleepReadState<DailySleepRecord | null>;
  history: DailySleepReadState<DailySleepHistory>;
}

export interface SleepHistoryPagination {
  page: number;
  pageSize: number;
  total: number;
}

export interface SleepWorkspaceProps {
  businessDate: string;
  initial: SleepWorkspaceInitial;
  mode?: "full" | "card";
  request?: typeof fetch;
  createId?: () => string;
  storage?: Storage;
  historyPagination?: SleepHistoryPagination;
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}小时${rest > 0 ? `${rest}分钟` : ""}`;
}

export function SleepWorkspace({
  businessDate,
  initial,
  mode = "full",
  request,
  createId,
  storage,
  historyPagination,
}: SleepWorkspaceProps) {
  const [record, setRecord] = useState(initial.record);
  const [history, setHistory] = useState(initial.history);
  const scoreRecord = record.status === "ready" && record.data
    ? record.data
    : history.status === "ready"
      ? history.data.items[0] ?? null
      : null;

  const content = <>
    <section aria-labelledby="daily-sleep-form-heading" className="sleep-entry-panel">
      <h2 id="daily-sleep-form-heading">今日填写</h2>
      {record.status === "unavailable"
        ? <p>暂时无法读取</p>
        : <SimpleSleepForm
            businessDate={businessDate}
            createId={createId}
            initialRecord={record.data}
            onRefresh={(nextRecord, nextHistory) => {
              setRecord({ status: "ready", data: nextRecord });
              setHistory({ status: "ready", data: nextHistory });
            }}
            request={request}
            storage={storage}
          />}
    </section>
    {mode === "full" && <section aria-labelledby="daily-sleep-insights-heading" className="sleep-insights-panel">
      <h2 id="daily-sleep-insights-heading">手填质量分与睡眠波动</h2>
      {history.status === "unavailable"
        ? <p>暂时无法读取</p>
        : scoreRecord === null
          ? <p>暂无记录</p>
          : <>
              <div className="sleep-score-summary" aria-label="睡眠趋势摘要">
                <div><span>睡眠质量分</span><strong>{scoreRecord.qualityScore ?? "未填写"}</strong>{scoreRecord.qualityScore === null ? null : <small>/ 100</small>}</div>
                <div><span>平均睡眠波动</span><strong>{scoreRecord.sleepVariabilityMinutes === null ? "待积累" : `${scoreRecord.sleepVariabilityMinutes} 分钟`}</strong></div>
                <div><span>入睡波动</span><strong>{scoreRecord.score.bedVariabilityMinutes === null ? "—" : `${scoreRecord.score.bedVariabilityMinutes} 分钟`}</strong></div>
                <div><span>起床波动</span><strong>{scoreRecord.score.wakeVariabilityMinutes === null ? "—" : `${scoreRecord.score.wakeVariabilityMinutes} 分钟`}</strong></div>
              </div>
              {!scoreRecord.score.usedPreviousNaturalDay && <p className="sleep-score-context">缺少前一自然日记录，波动项暂按中性值计算。</p>}
              <SleepHistoryChart items={history.data.items} />
            </>}
    </section>}
    {mode === "full" && <section aria-labelledby="daily-sleep-history-heading" className="sleep-history-panel">
      <h2 id="daily-sleep-history-heading">历史记录</h2>
      {history.status === "unavailable"
        ? <p>暂时无法读取</p>
        : history.data.items.length === 0
          ? <p>还没有睡眠记录</p>
          : <ul className="sleep-history-list">{history.data.items.map((item) => <li className="sleep-history-item" key={item.id}>
              <strong>{item.recordDate}</strong> {item.asleepTime}－{item.wakeTime} · {formatMinutes(item.finalDurationMinutes)} · 质量分 {item.qualityScore ?? "未填写"} · {item.sleepVariabilityMinutes === null ? "缺前一自然日" : `波动 ${item.sleepVariabilityMinutes} 分钟`}
            </li>)}</ul>}
      {mode === "full" && historyPagination && history.status === "ready" ? (
        <nav aria-label="睡眠历史分页" className="sleep-history-pager">
          {historyPagination.page > 1
            ? <a href={`/sleep?page=${historyPagination.page - 1}`}>上一页</a>
            : <span />}
          <span>
            第 {historyPagination.page} / {Math.max(1, Math.ceil(historyPagination.total / historyPagination.pageSize))} 页（共 {historyPagination.total} 条）
          </span>
          {historyPagination.page * historyPagination.pageSize < historyPagination.total
            ? <a href={`/sleep?page=${historyPagination.page + 1}`}>下一页</a>
            : <span />}
        </nav>
      ) : null}
    </section>}
  </>;

  if (mode === "card") return <div>{content}</div>;
  return <main className="page-shell daily-sleep-workspace">
    {content}
  </main>;
}
