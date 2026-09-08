import Link from "next/link";

import { formatHoursMinutes } from "@/core/time/format-duration";
import type { HealthChecklistDay } from "@/modules/health-checklist/contracts";
import type { PersonalKnowledgeSnapshot } from "@/modules/personal-knowledge/contracts";
import type { DailyReadingSnapshot } from "@/modules/reading/contracts";
import type { ManualSkincareSnapshot } from "@/modules/manual-skincare/contracts";
import type { PlanningSnapshot } from "@/modules/planning/contracts";
import type { TodayReminder } from "@/modules/today-reminders/contracts";
import type { DailySleepRecord } from "@/modules/daily-sleep/contracts";

import type { TodayCardState } from "./today-card-state";
import type { TodayExerciseCardState } from "./today-exercise-card";

const actionStatusLabels = {
  pending: "待办",
  completed: "已完成",
  skipped: "已跳过",
  archived: "已归档",
} as const;

const priorityLabels = {
  high: "高",
  normal: "普通",
  low: "低",
} as const;

function OverviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="today-overview-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function FactValue<T>({ state, render }: {
  state: TodayCardState<T>;
  render: (data: T) => React.ReactNode;
}) {
  if (state.status !== "ready") {
    return <span className="today-overview-empty">暂时无法读取</span>;
  }
  return <>{render(state.data)}</>;
}

export function TodayOverviewFacts({
  exercise,
  health,
  reading,
  reminders,
  sleep,
  skincare,
}: {
  exercise: TodayExerciseCardState;
  health: TodayCardState<HealthChecklistDay>;
  reading: TodayCardState<DailyReadingSnapshot>;
  reminders: TodayCardState<TodayReminder[]>;
  sleep: TodayCardState<DailySleepRecord | null>;
  skincare: TodayCardState<ManualSkincareSnapshot>;
}) {
  return (
    <dl className="today-overview">
      <OverviewRow label="睡眠">
        <FactValue state={sleep} render={(record) => (
          record
            ? <>{formatHoursMinutes(record.finalDurationMinutes)}{record.qualityScore !== null ? ` · 手环质量分 ${record.qualityScore}` : ""}</>
            : <span className="today-overview-empty">未记录</span>
        )} />
      </OverviewRow>
      <OverviewRow label="阅读">
        <FactValue state={reading} render={(snapshot) => (
          snapshot.totalMinutes > 0 || snapshot.totalPagesRead > 0
            ? <>{formatHoursMinutes(snapshot.totalMinutes)} · {snapshot.totalPagesRead} 页</>
            : <span className="today-overview-empty">未记录</span>
        )} />
      </OverviewRow>
      <OverviewRow label="训练">
        {exercise.status === "ready"
          ? <>{exercise.data.currentDayName} · {exercise.data.isRest ? "休息日" : `${exercise.data.completedActions} / ${exercise.data.totalActions} 个动作`}{exercise.data.calculatedMinutes > 0 ? ` · ${formatHoursMinutes(exercise.data.calculatedMinutes)}` : ""}</>
          : <span className="today-overview-empty">还没有训练计划</span>}
      </OverviewRow>
      <OverviewRow label="健康清单">
        <FactValue state={health} render={(day) => {
          const done = day.items.filter((item) => item.completed).length;
          return day.items.length > 0
            ? <>{done} / {day.items.length} 项完成</>
            : <span className="today-overview-empty">还没有健康项</span>;
        }} />
      </OverviewRow>
      <OverviewRow label="护肤">
        <FactValue state={skincare} render={(snapshot) => {
          const morning = snapshot.selectedDay?.morningItems ?? [];
          const evening = snapshot.selectedDay?.eveningItems ?? [];
          return morning.length > 0 || evening.length > 0
            ? <>早 {morning.filter((item) => item.used).length} / {morning.length} · 晚 {evening.filter((item) => item.used).length} / {evening.length}</>
            : <span className="today-overview-empty">暂无护肤清单</span>;
        }} />
      </OverviewRow>
      <OverviewRow label="提醒">
        <FactValue state={reminders} render={(items) => (
          items.length > 0
            ? <>{items.filter((reminder) => !reminder.completed).length} 件待办 · 共 {items.length} 件</>
            : <span className="today-overview-empty">今天没有挂着的事</span>
        )} />
      </OverviewRow>
    </dl>
  );
}

export function TodayGoalsBoard({ planning }: { planning: PlanningSnapshot | null }) {
  if (!planning) {
    return (
      <p className="today-overview-empty">
        目标数据暂时无法读取；<Link href="/goals">打开目标与行动</Link>查看。
      </p>
    );
  }

  const activeGoals = planning.goals.filter((goal) => goal.status === "active");
  const goalsByArea = planning.lifeAreas
    .map((area) => ({
      area,
      goals: activeGoals.filter((goal) => goal.lifeAreaId === area.id),
    }))
    .filter((group) => group.goals.length > 0);
  const ungroupedGoals = activeGoals.filter(
    (goal) => !planning.lifeAreas.some((area) => area.id === goal.lifeAreaId),
  );
  const goalTitle = (goalId: string | null) =>
    goalId === null ? null
      : planning.goals.find((goal) => goal.id === goalId)?.title ?? null;
  const todayActions = [
    ...planning.todayActions.filter((action) => action.status === "pending"),
    ...planning.todayActions.filter((action) => action.status === "completed"),
    ...planning.todayActions.filter((action) => action.status === "skipped"),
  ];

  return (
    <div className="today-goals-board">
      <section aria-label="今日行动" className="today-goals-today">
        <h3>今日行动（{todayActions.length}）</h3>
        {todayActions.length === 0 ? (
          <p className="today-overview-empty">
            今天还没有安排行动；<Link href="/goals">去目标与行动添加 →</Link>
          </p>
        ) : (
          <ul className="today-goals-actions">
            {todayActions.map((action) => (
              <li data-status={action.status} key={action.id}>
                <span aria-hidden="true" className="today-action-dot" />
                <span className="today-action-title">{action.title}</span>
                <span className="today-action-meta">
                  {priorityLabels[action.priority]}
                  {goalTitle(action.goalId) ? ` · ${goalTitle(action.goalId)}` : ""}
                </span>
                <span className="today-action-status">{actionStatusLabels[action.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="所有目的" className="today-goals-areas">
        <h3>所有目的</h3>
        {goalsByArea.length === 0 && ungroupedGoals.length === 0 ? (
          <p className="today-overview-empty">
            还没有进行中的长期目标；<Link href="/goals">去建立一个 →</Link>
          </p>
        ) : (
          <ul className="today-goals-tree">
            {goalsByArea.map(({ area, goals }) => (
              <li key={area.id}>
                <p className="today-goals-area">{area.name}</p>
                <ul>
                  {goals.map((goal) => (
                    <li key={goal.id}>
                      <span className="today-goal-type">{goal.goalType === "long-term" ? "长期" : "阶段"}</span>
                      <span className="today-goal-title">{goal.title}</span>
                      <span className="today-goal-progress">{goal.progressPercent}%</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
            {ungroupedGoals.length > 0 ? (
              <li>
                <p className="today-goals-area">未分组</p>
                <ul>
                  {ungroupedGoals.map((goal) => (
                    <li key={goal.id}>
                      <span className="today-goal-type">{goal.goalType === "long-term" ? "长期" : "阶段"}</span>
                      <span className="today-goal-title">{goal.title}</span>
                      <span className="today-goal-progress">{goal.progressPercent}%</span>
                    </li>
                  ))}
                </ul>
              </li>
            ) : null}
          </ul>
        )}
      </section>
    </div>
  );
}

export function TodayLearningList({
  knowledge,
}: {
  knowledge: PersonalKnowledgeSnapshot | null;
}) {
  if (!knowledge) {
    return (
      <p className="today-overview-empty">
        学习记录暂时无法读取；<Link href="/knowledge">打开知识体系</Link>查看。
      </p>
    );
  }
  const moduleNames = new Map(
    knowledge.modules.map((module) => [module.moduleId, module.name]),
  );
  if (knowledge.dailyNotes.length === 0) {
    return (
      <p className="today-overview-empty">
        今天还没有正式学习记录；<Link href={`/knowledge?date=${knowledge.businessDate}`}>去记录一条 →</Link>
      </p>
    );
  }
  return (
    <ul className="today-learning-list">
      {knowledge.dailyNotes.map((note) => (
        <li key={note.noteId}>
          <p className="today-learning-meta">
            {moduleNames.get(note.moduleId) ?? "未知模块"}
          </p>
          <h3>{note.title}</h3>
          <p className="today-learning-content">{note.content}</p>
        </li>
      ))}
    </ul>
  );
}

export function TodayReminderDigest({ reminders }: { reminders: TodayReminder[] }) {
  if (reminders.length === 0) {
    return <p className="today-overview-empty">今天没有挂着的事。</p>;
  }
  return (
    <ul className="today-reminder-digest">
      {reminders.map((reminder) => (
        <li data-completed={reminder.completed ? "true" : "false"} key={reminder.id}>
          <span aria-hidden="true">{reminder.completed ? "✓" : "○"}</span>
          <span className="today-reminder-title">{reminder.title}</span>
          {reminder.scheduledTime ? <time>{reminder.scheduledTime}</time> : null}
        </li>
      ))}
    </ul>
  );
}
