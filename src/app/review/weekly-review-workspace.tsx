"use client";

import { useState } from "react";
import { formatHoursMinutes } from "@/core/time/format-duration";
import type { WeeklyReviewSnapshot } from "@/modules/weekly-review/contracts";
import type { WeeklyExtras } from "@/modules/weekly-review/query";

type Submission = { body: Record<string, unknown>; key: string };
const requestKey = () => typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `weekly-${Date.now()}-${Math.random()}`;
const empty = (label: string) => <p className="weekly-review-empty">暂无{label}记录。</p>;
function shiftDate(date: string, days: number): string { const value = new Date(`${date}T00:00:00.000Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }

function comparisonLine(label: string, current: number, previous: number, unit = ""): string {
  const delta = current - previous;
  const deltaText = delta === 0 ? "与上周持平" : delta > 0 ? `比上周多 ${delta}${unit}` : `比上周少 ${Math.abs(delta)}${unit}`;
  return `${label} ${current}${unit}（${deltaText}）`;
}

export function WeeklyReviewWorkspace({ initial, extras, today }: { initial: WeeklyReviewSnapshot; extras: WeeklyExtras; today: string }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [draft, setDraft] = useState(initial.summary?.content ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [pending, setPending] = useState<Submission | null>(null);
  const [saving, setSaving] = useState(false);
  async function send(submission: Submission): Promise<boolean> {
    setSaving(true); setMessage(null);
    try {
      const response = await fetch("/api/v1/weekly-review", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": submission.key }, body: JSON.stringify(submission.body) });
      if (response.status === 409) { setLocked(true); setMessage("周总结已在其他位置更新，请重新加载后再编辑。"); return false; }
      if (!response.ok) { setMessage("暂时无法保存；已保留当前草稿。"); return false; }
      const value = await response.json() as { result?: WeeklyReviewSnapshot };
      if (!value.result) throw new Error("invalid response");
      setSnapshot(value.result); setPending(null); return true;
    } catch { setPending(submission); setMessage("网络状态不确定；请求已冻结，可手动重试。"); return false; }
    finally { setSaving(false); }
  }
  function save() { if (!locked) void send({ key: requestKey(), body: { type: "save-weekly-summary", periodStart: snapshot.periodStart, periodEndExclusive: snapshot.periodEndExclusive, content: draft, expectedRevision: snapshot.summary?.revision ?? null } }); }
  function pin(targetType: WeeklyReviewSnapshot["recentEdits"][number]["targetType"], targetId: string, pinned: boolean) { void send({ key: requestKey(), body: { type: pinned ? "unpin-review-target" : "pin-review-target", targetType, targetId, periodStart: snapshot.periodStart, periodEndExclusive: snapshot.periodEndExclusive } }); }
  const sleepAvg = snapshot.sleepRecords.length > 0
    ? Math.round(snapshot.sleepRecords.reduce((sum, item) => sum + item.durationMinutes, 0) / snapshot.sleepRecords.length)
    : null;
  const trainingCompleted = snapshot.trainingDays.filter((item) => item.status === "completed").length;
  return <section className="weekly-review-workspace" aria-live="polite">
    <nav aria-label="周回顾导航" className="weekly-review-period">
      <a href={`/review?start=${shiftDate(snapshot.periodStart, -7)}`}>上一周</a>
      <span>{snapshot.periodStart} 至 {shiftDate(snapshot.periodEndExclusive, -1)}（含当天）</span>
      <a href={`/review?start=${snapshot.periodEndExclusive}`}>下一周</a>
      <form action="/review" className="weekly-review-jump" method="get">
        <label htmlFor="weekly-jump-date">跳到某周</label>
        <input id="weekly-jump-date" max={today} name="start" type="date" />
        <button type="submit">跳转</button>
      </form>
    </nav>
    <section className="weekly-review-compare">
      <h2>与上周对比</h2>
      <ul>
        <li>{comparisonLine("记录天数", snapshot.recordedDays.length, extras.previous.recordedDays, " 天")}</li>
        <li>{comparisonLine("完成训练", trainingCompleted, extras.previous.trainingCompleted, " 次")}</li>
        <li>
          {sleepAvg === null
            ? "本周还没有睡眠记录"
            : extras.previous.sleepAvgMinutes === null
              ? `平均睡眠 ${formatHoursMinutes(sleepAvg)}（上周无记录）`
              : `平均睡眠 ${formatHoursMinutes(sleepAvg)}（上周 ${formatHoursMinutes(extras.previous.sleepAvgMinutes)}）`}
        </li>
      </ul>
    </section>
    <section className="weekly-review-goals">
      <h2>目标进展</h2>
      {extras.goals.length ? (
        <ul>
          {extras.goals.map((goal) => (
            <li key={goal.id}>
              <span className="weekly-goal-title">{goal.goalType === "long-term" ? "长期" : "阶段"} · {goal.title}</span>
              <span>手动进度 {goal.progressPercent}% · 本周完成行动 {goal.actionsCompletedThisWeek} 个</span>
            </li>
          ))}
        </ul>
      ) : <p className="weekly-review-empty">暂无进行中的目标。 <a href="/goals">目标与行动</a></p>}
    </section>
    <section><h2>本周记录</h2><p>已有 {snapshot.recordedDays.length} 天留下事实记录。</p></section>
    <div className="weekly-review-grid">
      <section><h2>训练</h2>{snapshot.trainingDays.length ? <ul>{snapshot.trainingDays.map((item) => <li key={item.id}>{item.businessDate} · {item.name} · {item.status}</li>)}</ul> : empty("训练")}</section>
      <section><h2>睡眠</h2>{snapshot.sleepRecords.length ? <ul>{snapshot.sleepRecords.map((item) => <li key={item.recordDate}>{item.recordDate} · {item.asleepTime}–{item.wakeTime} · {formatHoursMinutes(item.durationMinutes)}</li>)}</ul> : empty("睡眠")}</section>
      <section><h2>护肤</h2>{snapshot.skincareUses.length ? <ul>{snapshot.skincareUses.map((item, index) => <li key={`${item.businessDate}-${index}`}>{item.businessDate} · {item.productName}</li>)}</ul> : empty("护肤")}</section>
      <section><h2>健康</h2>{snapshot.healthCompletions.length ? <ul>{snapshot.healthCompletions.map((item, index) => <li key={`${item.businessDate}-${index}`}>{item.businessDate} · {item.name}</li>)}</ul> : empty("健康")}</section>
      <section><h2>知识新增</h2>{snapshot.knowledgeAdditions.length ? <ul>{snapshot.knowledgeAdditions.map((item) => <li key={item.id}>{item.businessDate} · {item.title}</li>)}</ul> : empty("知识")}</section>
      <section><h2>最近修改</h2>{snapshot.recentEdits.length ? <ul>{snapshot.recentEdits.map((item) => <li key={`${item.targetType}-${item.targetId}`}><span>{item.title}</span><button disabled={saving} onClick={() => pin(item.targetType, item.targetId, item.pinned)} type="button">{item.pinned ? `取消置顶：${item.title}` : `置顶：${item.title}`}</button></li>)}</ul> : empty("最近修改")}</section>
    </div>
    <section className="weekly-review-summary"><h2>我的周总结</h2><label className="sr-only" htmlFor="weekly-summary">我的周总结</label><textarea disabled={locked || saving} id="weekly-summary" maxLength={10_000} onChange={(event) => setDraft(event.currentTarget.value)} value={draft} /><div className="weekly-review-actions"><button disabled={locked || saving} onClick={save} type="button">保存周总结</button>{pending ? <button disabled={saving} onClick={() => void send(pending)} type="button">重试已冻结请求</button> : null}</div>{message ? <p role={locked ? "alert" : "status"}>{message}</p> : null}{snapshot.summary ? <p>已保存版本 {snapshot.summary.revision}</p> : null}</section>
  </section>;
}
