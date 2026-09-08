"use client";

import { useEffect, useRef, useState } from "react";

import type {
  ManualExerciseProgressSnapshot,
  ManualExerciseProgressTransition,
} from "@/modules/manual-exercise/progress-contracts";
import type { ExerciseTrendsSnapshot } from "@/modules/manual-exercise/trends-query";

import {
  ProgressChangeCard,
  toProgressTransitionDisplay,
} from "../progress-change-card";
import { useManualExerciseProgress } from "../use-manual-exercise-progress";
import { BodyProgressDashboard } from "./body-progress-dashboard";
import styles from "./manual-exercise-progress.module.css";

interface ManualExerciseProgressWorkspaceProps {
  readonly asOfDate: string;
  readonly initial: ManualExerciseProgressSnapshot | null;
  readonly initialTrends: ExerciseTrendsSnapshot | null;
}

function factValue(value: string | null, suffix = ""): string {
  return value?.trim() ? `${value}${suffix}` : "—";
}

export function ManualExerciseProgressWorkspace({
  asOfDate,
  initial,
  initialTrends,
}: ManualExerciseProgressWorkspaceProps) {
  const progress = useManualExerciseProgress({ asOfDate, initial });
  const loadedRef = useRef(false);
  const [deferred, setDeferred] = useState<ReadonlySet<string>>(() => new Set());
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    loadedRef.current = false;
    setDeferred(new Set());
    setShowAll(false);
  }, [asOfDate]);

  useEffect(() => {
    if (initial?.asOfDate === asOfDate || loadedRef.current) return;
    loadedRef.current = true;
    void progress.refresh();
  }, [asOfDate, initial, progress.refresh]);

  const snapshot = progress.snapshot;
  const effectivePending = (snapshot?.pending ?? []).filter((item) => item.effectiveState === "effective");
  const effectiveTracked = (snapshot?.tracked ?? []).filter((item) => item.effectiveState === "effective");
  const scheduledTransitions = [
    ...(snapshot?.pending ?? []), ...(snapshot?.tracked ?? []), ...(snapshot?.excluded ?? []),
  ].filter((item) => item.effectiveState === "scheduled")
    .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom) || right.toRevision - left.toRevision);
  const visiblePending = effectivePending.filter((item) => !deferred.has(item.toVersionId));
  const visibleScheduled = scheduledTransitions.filter((item) => item.status !== "pending" || !deferred.has(item.toVersionId));
  const shownTracked = showAll ? effectiveTracked : effectiveTracked.slice(0, 6);
  const shownFacts = showAll ? snapshot?.actualFacts ?? [] : (snapshot?.actualFacts ?? []).slice(0, 8);
  const actionCount = new Set(
    effectiveTracked.flatMap((transition) =>
      transition.changes.map((change) => `${change.dayKey}:${change.actionKey}`),
    ),
  ).size;

  async function decide(
    transition: ManualExerciseProgressTransition,
    decision: "tracked" | "excluded",
  ) {
    await progress.decide(transition, decision);
  }

  if (!snapshot) {
    return (
      <div className={styles.workspace}>
        {initialTrends ? <BodyProgressDashboard muscles={initialTrends.muscleProgress} /> : null}
        <section className={styles.empty} role="status">
          <h2>进步数据暂时无法读取</h2>
          {progress.status === "uncertain" ? (
            <button onClick={() => void progress.retry()} type="button">重试原决定</button>
          ) : progress.status === "reload-required" ? (
            <button onClick={() => window.location.reload()} type="button">刷新页面核对</button>
          ) : (
            <button onClick={() => void progress.refresh()} type="button">重新读取</button>
          )}
          <p>{progress.message ?? "请稍后刷新重试；训练模板和每日记录不受影响。"}</p>
        </section>
      </div>
    );
  }

  return (
    <section className={styles.workspace}>
      {initialTrends ? <BodyProgressDashboard muscles={initialTrends.muscleProgress} /> : null}
      <div className={styles.summary} aria-label="进步记录摘要">
        <div><strong>{effectivePending.length}</strong><span>当前待确认</span></div>
        <div><strong>{effectiveTracked.length}</strong><span>当前已记录</span></div>
        <div><strong>{actionCount}</strong><span>涉及动作</span></div>
        <div><strong>{snapshot.actualFacts.length}</strong><span>实际训练事实</span></div>
      </div>

      {progress.message ? (
        <div className={styles.notice} role="status">
          <p>{progress.message}</p>
          {progress.status === "uncertain" ? (
            <button onClick={() => void progress.retry()} type="button">重试原决定</button>
          ) : null}
          {progress.status === "reload-required" ? (
            <button onClick={() => window.location.reload()} type="button">刷新页面核对</button>
          ) : null}
        </div>
      ) : null}

      <section className={styles.section} aria-labelledby="pending-progress-heading">
        <header className={styles.sectionHeader}>
          <div>
            <h2 id="pending-progress-heading">当前待确认的模板变化</h2>
          </div>
        </header>
        {visiblePending.length > 0 ? (
          <div className={styles.cardList}>
            {visiblePending.map((transition) => (
              <ProgressChangeCard
                busy={!progress.canWrite}
                key={transition.toVersionId}
                onExclude={() => void decide(transition, "excluded")}
                onLater={() => setDeferred((current) => new Set(current).add(transition.toVersionId))}
                onTrack={() => void decide(transition, "tracked")}
                transition={toProgressTransitionDisplay(transition)}
              />
            ))}
          </div>
        ) : <p className={styles.emptyLine}>现在没有需要确认的模板变化。</p>}
      </section>

      {visibleScheduled.length > 0 ? (
        <section className={`${styles.section} ${styles.scheduledSection}`} aria-labelledby="scheduled-progress-heading">
          <header className={styles.sectionHeader}>
            <div>
              <h2 id="scheduled-progress-heading">未来计划</h2>
            </div>
          </header>
          <div className={styles.cardList}>
            {visibleScheduled.map((transition) => (
              <ProgressChangeCard
                busy={!progress.canWrite}
                key={transition.toVersionId}
                onExclude={transition.status === "pending" ? () => void decide(transition, "excluded") : undefined}
                onLater={transition.status === "pending"
                  ? () => setDeferred((current) => new Set(current).add(transition.toVersionId))
                  : undefined}
                onTrack={transition.status === "pending" ? () => void decide(transition, "tracked") : undefined}
                transition={toProgressTransitionDisplay(transition)}
              />
            ))}
          </div>
        </section>
      ) : null}

      <div className={styles.columns}>
        <section className={styles.section} aria-labelledby="tracked-progress-heading">
          <header className={styles.sectionHeader}>
            <div>
              <h2 id="tracked-progress-heading">进步时间线</h2>
            </div>
          </header>
          {shownTracked.length > 0 ? (
            <div className={styles.cardList}>
              {shownTracked.map((transition) => (
                <ProgressChangeCard
                  key={transition.toVersionId}
                  transition={toProgressTransitionDisplay(transition)}
                />
              ))}
            </div>
          ) : <p className={styles.emptyLine}>截至当前日期，还没有确认记录的计划变化。</p>}
        </section>

        <section className={styles.section} aria-labelledby="actual-progress-heading">
          <header className={styles.sectionHeader}>
            <div>
              <h2 id="actual-progress-heading">实际训练事实</h2>
            </div>
          </header>
          {shownFacts.length > 0 ? (
            <ol className={styles.factList}>
              {shownFacts.map((fact) => (
                <li key={`${fact.businessDate}:${fact.templateVersionId}:${fact.dayKey}:${fact.actionKey}`}>
                  <div><strong>{fact.actionName}</strong><span>{fact.dayName} · {fact.businessDate}</span></div>
                  <dl>
                    <div><dt>组数</dt><dd>{fact.actualSets || "—"}</dd></div>
                    <div><dt>次数</dt><dd>{factValue(fact.actualRepsText)}</dd></div>
                    <div><dt>重量</dt><dd>{factValue(fact.actualWeightText)}</dd></div>
                  </dl>
                </li>
              ))}
            </ol>
          ) : <p className={styles.emptyLine}>还没有可展示的实际训练数据。</p>}
        </section>
      </div>

      {(effectiveTracked.length > 6 || snapshot.actualFacts.length > 8) ? (
        <button className={styles.moreButton} onClick={() => setShowAll((value) => !value)} type="button">
          {showAll ? "收起较早记录" : "查看全部记录"}
        </button>
      ) : null}
    </section>
  );
}
