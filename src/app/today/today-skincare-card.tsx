"use client";

import { useState } from "react";

import {
  useManualSkincareSubmission,
  type UseManualSkincareSubmissionOptions,
} from "@/app/skincare/use-manual-skincare-submission";
import type {
  ManualSkincareDayItemSnapshot,
  ManualSkincareMutationResult,
  ManualSkincareSnapshot,
} from "@/modules/manual-skincare/contracts";

import { TodayCard } from "./today-card";
import type { TodayCardState } from "./today-card-state";

export interface TodaySkincareCardProps extends UseManualSkincareSubmissionOptions {
  state: TodayCardState<ManualSkincareSnapshot>;
  today: string;
}

interface ReadyTodaySkincareCardProps extends UseManualSkincareSubmissionOptions {
  initial: ManualSkincareSnapshot;
  today: string;
}

function completion(items: readonly ManualSkincareDayItemSnapshot[]): string {
  return `${items.filter((item) => item.used).length} / ${items.length}`;
}

function ReadyTodaySkincareCard({
  initial,
  today,
  request,
  storage,
  createId,
  now,
}: ReadyTodaySkincareCardProps) {
  const [snapshot, setSnapshot] = useState(initial);
  const submission = useManualSkincareSubmission({ request, storage, createId, now });
  const day = snapshot.selectedDay;
  const dayCycle = day?.recoveryCycle ?? null;
  const cycle = dayCycle
    ? snapshot.recoveryPlans.flatMap((plan) => plan.cycles)
      .find((candidate) => candidate.cycleId === dayCycle.cycleId)
    : undefined;

  function applyConfirmed(result: ManualSkincareMutationResult | null) {
    if (
      result?.snapshot.businessDate === snapshot.businessDate
      && result.snapshot.selectedDay?.businessDate === day?.businessDate
    ) {
      setSnapshot(result.snapshot);
    }
  }

  async function toggleItem(item: ManualSkincareDayItemSnapshot) {
    if (!day) return;
    applyConfirmed(await submission.submit({
      type: "set-day-items-used",
      businessDate: day.businessDate,
      itemKeys: [item.itemKey],
      used: !item.used,
      expectedDayRevision: day.revision,
    }));
  }

  async function retry() {
    applyConfirmed(await submission.retry());
  }

  const canCheck = submission.canWrite && day !== null && day.businessDate <= today;

  return (
    <TodayCard
      className="today-domain-card today-domain-card-skincare"
      detailHref={`/skincare?date=${snapshot.businessDate}`}
      detailLabel="打开完整护肤记录"
      state={{ status: "ready", data: day }}
      title="护肤记录"
    >
      {(selectedDay) => selectedDay ? (
        <>
          <p className="today-domain-card-summary">
            当前周期：{dayCycle?.name ?? "未关联恢复周期"}
          </p>
          {cycle?.expectedEndOn ? (
            <p>预计结束：{cycle.expectedEndOn}（仅提醒，不会自动切换）</p>
          ) : null}

          {([
            ["AM", selectedDay.morningItems],
            ["PM", selectedDay.eveningItems],
          ] as const).map(([label, items]) => (
            <section aria-label={`${label} 护肤清单`} key={label}>
              <h3>{label}</h3>
              <p>{label} {completion(items)}</p>
              {items.length === 0 ? <p>暂无项目</p> : (
                <ul>
                  {items.map((item) => (
                    <li key={item.itemKey}>
                      <label>
                        <input
                          aria-label={`${label} ${item.productName}已使用`}
                          checked={item.used}
                          disabled={!canCheck || submission.status === "saving"}
                          onChange={() => { void toggleItem(item); }}
                          type="checkbox"
                        />
                        {item.productName}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}

          <details>
            <summary>查看三项备注</summary>
            <p>晨间备注：{selectedDay.morningNote || "未填写"}</p>
            <p>晚间备注：{selectedDay.eveningNote || "未填写"}</p>
            <p>整体备注：{selectedDay.overallNote || "未填写"}</p>
          </details>

          {submission.status === "uncertain" ? (
            <div role="status">
              <p>结果未确认，已保留原提交。</p>
              <button onClick={() => { void retry(); }} type="button">使用原提交重试</button>
              <button onClick={() => { submission.abandon(); }} type="button">放弃待确认提交</button>
            </div>
          ) : null}
          {submission.status === "reload-required" ? <p role="status">需要重新加载后确认。</p> : null}
          {submission.status === "unavailable" ? <p role="status">本地恢复不可用，暂不能修改。</p> : null}
        </>
      ) : <p>当前没有可执行的护肤清单。</p>}
    </TodayCard>
  );
}

export function TodaySkincareCard({ state, today, ...dependencies }: TodaySkincareCardProps) {
  if (state.status === "unavailable") {
    return (
      <TodayCard state={state} title="护肤记录">
        {() => null}
      </TodayCard>
    );
  }
  return <ReadyTodaySkincareCard initial={state.data} today={today} {...dependencies} />;
}
