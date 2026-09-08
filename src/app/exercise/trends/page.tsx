import { DomainSubnav } from "@/app/_components/domain-subnav";
import { getApplicationDatabase } from "@/core/db/application-database";
import { toShanghaiBusinessDate } from "@/core/time/business-date";
import {
  RECOMMENDED_WEEKLY_SETS,
  getExerciseTrendsSnapshot,
  type ExerciseTrendsSnapshot,
} from "@/modules/manual-exercise/trends-query";

import { exerciseNavigationItems } from "../exercise-navigation";
import pageStyles from "../exercise-page.module.css";
import { ExerciseTrendsChart } from "./exercise-trends-chart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatChineseDate(businessDate: string): string {
  const [, month, day] = businessDate.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

function ThisWeekOverview({ snapshot }: { snapshot: ExerciseTrendsSnapshot }) {
  const currentWeekStart = snapshot.weeks.at(-1)!;
  const rows = snapshot.series.map((entry) => ({
    bodyPart: entry.bodyPart,
    sets: entry.points.at(-1)?.sets ?? 0,
    sessions: entry.points.at(-1)?.sessions ?? 0,
  })).filter((row) => row.sets > 0 || row.sessions > 0);

  if (rows.length === 0) {
    return <p className="exercise-trends-empty">暂无本周训练记录。</p>;
  }

  return (
    <ul className="exercise-trends-overview">
      {rows.map((row) => {
        const inRange = row.sets >= RECOMMENDED_WEEKLY_SETS.min;
        const meterRatio = Math.min(1, row.sets / RECOMMENDED_WEEKLY_SETS.max);
        const bandStart = (RECOMMENDED_WEEKLY_SETS.min / RECOMMENDED_WEEKLY_SETS.max) * 100;
        return (
          <li key={row.bodyPart}>
            <div className="exercise-trends-overview-head">
              <strong>{row.bodyPart}</strong>
              <span>{row.sets} 组 · {row.sessions} 练</span>
            </div>
            <div
              aria-label={`${row.bodyPart} 本周 ${row.sets} 组，推荐每周 ${RECOMMENDED_WEEKLY_SETS.min} 到 ${RECOMMENDED_WEEKLY_SETS.max} 组`}
              className="exercise-trends-meter"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={RECOMMENDED_WEEKLY_SETS.max}
              aria-valuenow={row.sets}
            >
              <span style={{ width: `${meterRatio * 100}%` }} className={inRange ? "is-in-range" : undefined} />
              <i
                aria-hidden="true"
                className="exercise-trends-meter-band"
                style={{ left: `${bandStart}%` }}
                title={`推荐 ${RECOMMENDED_WEEKLY_SETS.min}–${RECOMMENDED_WEEKLY_SETS.max} 组`}
              />
            </div>
            <p className={inRange ? "exercise-trends-meter-note is-ok" : "exercise-trends-meter-note"}>
              {inRange
                ? "已进入推荐区间"
                : `推荐每周 ${RECOMMENDED_WEEKLY_SETS.min}–${RECOMMENDED_WEEKLY_SETS.max} 组`}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

export default async function ExerciseTrendsPage() {
  const today = toShanghaiBusinessDate(new Date());
  let snapshot: ExerciseTrendsSnapshot | null = null;
  try {
    const { sqlite } = getApplicationDatabase();
    snapshot = getExerciseTrendsSnapshot(sqlite, { asOfDate: today });
  } catch {
    snapshot = null;
  }

  return (
    <main className="page-shell exercise-page">
      <DomainSubnav
        activeKey="trends"
        date={today}
        items={exerciseNavigationItems}
        label="运动健身"
      />

      {snapshot === null ? (
        <section className="exercise-trends-empty" role="status">
          <p>训练数据暂时不可读，请稍后刷新。</p>
        </section>
      ) : (
        <>
          <section aria-label="训练节奏" className="exercise-trends-stats">
            <div className="review-stat-card">
              <p className="review-stat-value">{snapshot.currentStreakWeeks} 周</p>
            <p className="review-stat-label">连续训练</p>
            </div>
            <div className="review-stat-card">
              <p className="review-stat-value">{snapshot.series.length} 个</p>
              <p className="review-stat-label">训练部位</p>
            </div>
            <div className="review-stat-card">
              <p className="review-stat-value">
                {snapshot.series.reduce((total, entry) => total + entry.totalSessions, 0)} 次
              </p>
              <p className="review-stat-label">累计训练</p>
            </div>
            <div className="review-stat-card">
              <p className="review-stat-value">
                {snapshot.series.reduce((total, entry) => total + entry.totalSets, 0)} 组
              </p>
              <p className="review-stat-label">累计组数</p>
            </div>
          </section>

          <section aria-label="每周容量曲线" className="exercise-trends-section">
            <h2>每周容量曲线</h2>
            {snapshot.series.length === 0 ? (
              <p className="exercise-trends-empty">暂无训练记录。</p>
            ) : (
              <ExerciseTrendsChart snapshot={snapshot} />
            )}
          </section>

          <section aria-label="本周概览" className="exercise-trends-section">
            <h2>本周概览</h2>
            <ThisWeekOverview snapshot={snapshot} />
          </section>

          <section aria-label="最近训练" className="exercise-trends-section">
            <h2>最近训练</h2>
            {snapshot.recentSessions.length === 0 ? (
              <p className="exercise-trends-empty">还没有训练记录。</p>
            ) : (
              <ul className="exercise-trends-sessions">
                {snapshot.recentSessions.map((session) => (
                  <li key={session.businessDate}>
                    <div className="exercise-trends-session-head">
                      <strong>{formatChineseDate(session.businessDate)} · {session.bodyPart}</strong>
                      <span>{session.sets} 组 · {session.reps} 次 · 容量 {session.volume}</span>
                    </div>
                    <p>
                      {session.actions.map((action) => `${action.name} ${action.sets}×${action.reps}`).join("，")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
