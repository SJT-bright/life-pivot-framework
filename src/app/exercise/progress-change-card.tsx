import type { ManualExerciseProgressTransition } from "@/modules/manual-exercise/progress-contracts";

import styles from "./progress-change-card.module.css";

export interface ProgressChangeDisplay {
  readonly id: string;
  readonly dayName: string;
  readonly actionName: string;
  readonly metric: "sets" | "reps" | "weight";
  readonly before: string | null;
  readonly after: string | null;
  readonly direction: "increase" | "decrease" | "changed";
  readonly deltaLabel: string | null;
}

export interface ProgressTransitionDisplay {
  readonly id: string;
  readonly fromRevision: number;
  readonly toRevision: number;
  readonly effectiveFrom: string;
  readonly effectiveState: "scheduled" | "effective";
  readonly status: "pending" | "tracked" | "excluded";
  readonly createdAt: string;
  readonly changeNote: string;
  readonly changes: readonly ProgressChangeDisplay[];
}

interface ProgressChangeCardProps {
  readonly transition: ProgressTransitionDisplay;
  readonly onExclude?: () => void;
  readonly onLater?: () => void;
  readonly onTrack?: () => void;
  readonly busy?: boolean;
}

function displayValue(value: number | string | null): string | null {
  return value === null ? null : String(value);
}

export function toProgressTransitionDisplay(
  transition: ManualExerciseProgressTransition,
): ProgressTransitionDisplay {
  return {
    id: transition.toVersionId,
    fromRevision: transition.fromRevision,
    toRevision: transition.toRevision,
    effectiveFrom: transition.effectiveFrom,
    effectiveState: transition.effectiveState,
    status: transition.status,
    createdAt: transition.createdAt,
    changeNote: transition.changeNote,
    changes: transition.changes.map((change) => ({
      id: `${change.dayKey}:${change.actionKey}:${change.metric}`,
      dayName: change.dayName,
      actionName: change.actionName,
      metric: change.metric,
      before: displayValue(change.before),
      after: displayValue(change.after),
      direction: change.changeKind === "increase"
        ? "increase"
        : change.changeKind === "decrease"
          ? "decrease"
          : "changed",
      deltaLabel: change.delta === null
        ? change.changeKind === "incomparable" ? "保留原文" : null
        : `${change.delta > 0 ? "+" : ""}${change.delta}${change.unit ?? ""}`,
    })),
  };
}

const metricLabels = {
  sets: "组数",
  reps: "次数",
  weight: "重量",
} as const;

const directionLabels = {
  increase: "上调",
  decrease: "下调",
  changed: "已变化",
} as const;

function shown(value: string | null): string {
  return value === null || value.trim() === "" ? "未填写" : value;
}

export function ProgressChangeCard({
  transition,
  onExclude,
  onLater,
  onTrack,
  busy = false,
}: ProgressChangeCardProps) {
  return (
    <article className={styles.card}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>模板 v{transition.fromRevision} → v{transition.toRevision} · {transition.status === "pending" ? "待确认" : transition.status === "tracked" ? "已记录" : "仅保存模板"}</p>
          <h3>{transition.changeNote}</h3>
        </div>
        <span className={transition.effectiveState === "scheduled" ? styles.scheduledDate : styles.date}>
          {transition.effectiveState === "scheduled"
            ? `计划变化 · 将于 ${transition.effectiveFrom} 生效`
            : `从 ${transition.effectiveFrom} 生效`}
        </span>
      </header>
      <ul className={styles.changeList}>
        {transition.changes.map((change) => (
          <li className={styles.change} key={change.id}>
            <div className={styles.changeTitle}>
              <strong>{change.actionName}</strong>
              <span>{change.dayName}</span>
            </div>
            <div className={styles.values}>
              <span className={styles.metric}>{metricLabels[change.metric]}</span>
              <span>{shown(change.before)}</span>
              <span aria-hidden="true">→</span>
              <strong>{shown(change.after)}</strong>
              <span className={styles[change.direction]}>
                {change.deltaLabel ?? directionLabels[change.direction]}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <footer className={styles.footer}>
        <small>保存于 {transition.createdAt}</small>
        {onTrack && onExclude && onLater ? (
          <div className={styles.actions}>
            <button className={styles.primary} disabled={busy} onClick={onTrack} type="button">记录为进步</button>
            <button disabled={busy} onClick={onExclude} type="button">仅保存模板</button>
            <button disabled={busy} onClick={onLater} type="button">稍后处理</button>
          </div>
        ) : null}
      </footer>
    </article>
  );
}
