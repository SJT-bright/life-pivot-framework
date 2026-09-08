
import { DomainSubnav } from "@/app/_components/domain-subnav";
import { getApplicationDatabase } from "@/core/db/application-database";
import { isBusinessDate, toShanghaiBusinessDate } from "@/core/time/business-date";
import type { ManualExerciseProgressSnapshot } from "@/modules/manual-exercise/progress-contracts";
import { getManualExerciseProgressSnapshot } from "@/modules/manual-exercise/progress-query";
import {
  getExerciseTrendsSnapshot,
  type ExerciseTrendsSnapshot,
} from "@/modules/manual-exercise/trends-query";

import { exerciseNavigationItems } from "../exercise-navigation";
import pageStyles from "../exercise-page.module.css";
import { ManualExerciseProgressWorkspace } from "./manual-exercise-progress-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ExerciseProgressPageProps {
  searchParams: Promise<{ date?: string | string[] }>;
}

export default async function ExerciseProgressPage({ searchParams }: ExerciseProgressPageProps) {
  const query = await searchParams;
  const today = toShanghaiBusinessDate(new Date());
  const businessDate = typeof query.date === "string" && isBusinessDate(query.date)
    ? query.date
    : today;
  let initial: ManualExerciseProgressSnapshot | null = null;
  let trends: ExerciseTrendsSnapshot | null = null;
  try {
    const { sqlite } = getApplicationDatabase();
    initial = getManualExerciseProgressSnapshot(sqlite, { asOfDate: businessDate });
    trends = getExerciseTrendsSnapshot(sqlite, { asOfDate: businessDate, weeks: 12 });
  } catch {
    initial = null;
    trends = null;
  }

  return (
    <main className="page-shell transition-page exercise-page">
      <header className={pageStyles.header}>
        <form className={pageStyles.controls} method="get">
          <label htmlFor="exercise-progress-date">
            导航日期
            <input defaultValue={businessDate} id="exercise-progress-date" name="date" type="date" />
          </label>
          <button type="submit">切换日期</button>
        </form>
      </header>
      <DomainSubnav
        activeKey="progress"
        date={businessDate}
        items={exerciseNavigationItems}
        label="运动健身"
      />
      <ManualExerciseProgressWorkspace
        key={businessDate}
        asOfDate={businessDate}
        initial={initial}
        initialTrends={trends}
      />
    </main>
  );
}
