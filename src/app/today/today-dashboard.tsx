import Link from "next/link";

import type { DailySleepRecord } from "@/modules/daily-sleep/contracts";
import type { HealthChecklistDay } from "@/modules/health-checklist/contracts";
import type { PersonalDailyNote } from "@/modules/personal-notes/contracts";
import type { PersonalKnowledgeSnapshot } from "@/modules/personal-knowledge/contracts";
import type { DailyReadingSnapshot } from "@/modules/reading/contracts";
import type { ManualSkincareSnapshot } from "@/modules/manual-skincare/contracts";
import type { PlanningSnapshot } from "@/modules/planning/contracts";
import type { TodayReminder } from "@/modules/today-reminders/contracts";
import type { CapturePage } from "@/modules/today/get-captures";

import { TodayCard } from "./today-card";
import type { TodayCardState } from "./today-card-state";
import { TodayExerciseCard, type TodayExerciseCardState } from "./today-exercise-card";
import { CaptureTimeline } from "./capture-timeline";
import {
  TodayGoalsBoard,
  TodayLearningList,
  TodayOverviewFacts,
  TodayReminderDigest,
} from "./today-overview";

export interface TodayDashboardData {
  captures: TodayCardState<CapturePage>;
  sleep: TodayCardState<DailySleepRecord | null>;
  health: TodayCardState<HealthChecklistDay>;
  dailyNote: TodayCardState<PersonalDailyNote | null>;
  personalKnowledge: TodayCardState<PersonalKnowledgeSnapshot>;
  reading: TodayCardState<DailyReadingSnapshot>;
  exercise: TodayExerciseCardState;
  skincare: TodayCardState<ManualSkincareSnapshot>;
  reminders: TodayCardState<TodayReminder[]>;
  planning: TodayCardState<PlanningSnapshot>;
}

interface TodayDashboardProps {
  businessDate: string;
  data: TodayDashboardData;
  today: string;
}

export function TodayDashboard({
  businessDate,
  data,
}: TodayDashboardProps) {
  return (
    <div className="today-dashboard today-dashboard-readonly">
      <section aria-label="今日概览" className="today-card today-card-overview">
        <header className="today-card-heading">
          <h2>今日概览</h2>
          <Link href={`/daily-review?date=${businessDate}`} className="today-overview-review-link">
            {data.dailyNote.status === "ready" && data.dailyNote.data === null
              ? "今天还没写复盘 →"
              : "查看今日复盘 →"}
          </Link>
        </header>
        <TodayOverviewFacts
          exercise={data.exercise}
          health={data.health}
          reading={data.reading}
          reminders={data.reminders}
          sleep={data.sleep}
          skincare={data.skincare}
        />
      </section>

      <TodayCard
        className="today-card-goals"
        detailHref="/goals"
        detailLabel="打开目标与行动"
        state={data.planning}
        title="目的与今日目标"
      >
        {(planning) => <TodayGoalsBoard planning={planning} />}
      </TodayCard>

      <section aria-label="今日提醒" className="today-card today-card-reminders">
        <header className="today-card-heading">
          <h2>今日提醒</h2>
        </header>
        {data.reminders.status === "ready" ? (
          <TodayReminderDigest reminders={data.reminders.data} />
        ) : (
          <p className="today-overview-empty" role="status">提醒暂时无法读取。</p>
        )}
      </section>

      <TodayCard
        className="today-card-learning"
        detailHref={`/knowledge?date=${businessDate}`}
        detailLabel="打开知识体系"
        state={data.personalKnowledge}
        title="当日新学"
      >
        {(knowledge) => <TodayLearningList knowledge={knowledge} />}
      </TodayCard>

      <TodayExerciseCard state={data.exercise} />

      <TodayCard
        className="today-card-capture"
        detailHref="/knowledge"
        detailLabel="打开知识体系"
        state={data.captures}
        title="随手记 · 待整理"
      >
        {(captures) => (
          <CaptureTimeline
            businessDate={businessDate}
            initialTimeline={captures}
          />
        )}
      </TodayCard>
    </div>
  );
}
