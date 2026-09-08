
import { DomainSubnav } from "@/app/_components/domain-subnav";
import { getApplicationDatabase } from "@/core/db/application-database";
import { isBusinessDate, toShanghaiBusinessDate } from "@/core/time/business-date";
import {
  countManualExerciseHistory,
  getManualExerciseSnapshot,
} from "@/modules/manual-exercise/queries";

import { exerciseNavigationItems } from "./exercise-navigation";
import styles from "./exercise-page.module.css";
import {
  ManualExerciseWorkspace,
  type ManualExerciseView,
} from "./manual-exercise-workspace";

export const EXERCISE_HISTORY_PAGE_SIZE = 20;

interface ExerciseRecordPageProps {
  readonly activeKey: ManualExerciseView;
  readonly searchParams: Promise<{ date?: string | string[]; page?: string | string[] }>;
  readonly view: ManualExerciseView;
}

export async function ExerciseRecordPage({
  activeKey,
  searchParams,
  view,
}: ExerciseRecordPageProps) {
  const query = await searchParams;
  const today = toShanghaiBusinessDate(new Date());
  const businessDate = typeof query.date === "string" && isBusinessDate(query.date)
    ? query.date
    : today;
  const requestedPage = typeof query.page === "string" && /^\d+$/.test(query.page)
    ? Math.max(1, Number(query.page))
    : 1;
  const historyOffset = view === "history" ? (requestedPage - 1) * EXERCISE_HISTORY_PAGE_SIZE : 0;

  let initial = null;
  let historyTotal = 0;
  try {
    const { sqlite } = getApplicationDatabase();
    initial = getManualExerciseSnapshot(sqlite, {
      businessDate,
      historyLimit: EXERCISE_HISTORY_PAGE_SIZE,
      historyOffset,
    });
    historyTotal = countManualExerciseHistory(sqlite);
  } catch {
    initial = null;
  }

  return (
    <main className="page-shell transition-page exercise-page">
      {view !== "today" && (
        <header className={styles.header}>
          <form className={styles.controls} data-draft-ignore="true" method="get">
            <label htmlFor={`manual-exercise-date-${view}`}>
              记录日期
              <input defaultValue={businessDate} id={`manual-exercise-date-${view}`} name="date" type="date" />
            </label>
            <button type="submit">切换日期</button>
          </form>
        </header>
      )}
      <DomainSubnav
        activeKey={activeKey}
        date={businessDate}
        items={exerciseNavigationItems}
        label="运动健身"
      />
      <ManualExerciseWorkspace
        businessDate={businessDate}
        enableProgressPrompts={view === "template"}
        historyPagination={view === "history" && historyTotal > EXERCISE_HISTORY_PAGE_SIZE
          ? { page: requestedPage, pageSize: EXERCISE_HISTORY_PAGE_SIZE, total: historyTotal }
          : undefined}
        initial={initial}
        initialView={view}
        showViewTabs={false}
        today={today}
      />
    </main>
  );
}
