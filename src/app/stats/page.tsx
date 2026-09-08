import { connection } from "next/server";

import { getApplicationDatabase } from "@/core/db/application-database";
import { toShanghaiBusinessDate } from "@/core/time/business-date";
import {
  getExerciseTrendsSnapshot,
  type ExerciseTrendsSnapshot,
} from "@/modules/manual-exercise/trends-query";
import { getStatsOverview, type StatsOverview } from "@/modules/stats/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatMinutes(minutes: number): string {
  if (minutes <= 0) return "0 分钟";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours} 小时 ${rest} 分钟` : `${rest} 分钟`;
}

function BarRow({ label, value, max, suffix }: {
  label: string;
  value: number;
  max: number;
  suffix: string;
}) {
  const percent = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <li className="stats-bar-row">
      <span className="stats-bar-label">{label}</span>
      <span
        aria-hidden="true"
        className="stats-bar-track"
      >
        <i style={{ width: `${Math.max(percent, value > 0 ? 4 : 0)}%` }} />
      </span>
      <span className="stats-bar-value">{value.toLocaleString("zh-CN")}{suffix}</span>
    </li>
  );
}

function StatCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="stats-card">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function FactsList({
  overview,
  trends,
}: {
  overview: StatsOverview;
  trends: ExerciseTrendsSnapshot | null;
}) {
  const maxMonthly = Math.max(1, ...overview.reading.monthlyMinutes.map((row) => row.minutes));
  const maxHealth = Math.max(1, ...overview.health.map((row) => row.completions));
  const partRows = (trends?.series ?? [])
    .filter((entry) => entry.totalSets > 0)
    .slice(0, 6);
  const maxPartSets = Math.max(1, ...partRows.map((row) => row.totalSets));
  return (
    <>
      <div className="stats-grid">
        <StatCard title="阅读（今年）">
          <p className="stats-facts">
            读完 {overview.reading.finished} 本 · 在读 {overview.reading.reading} 本 · 待看 {overview.reading.waiting} 本
          </p>
          <p className="stats-facts">
            记录了 {overview.reading.yearSessions} 次阅读，共 {formatMinutes(overview.reading.yearMinutes)}、
            {overview.reading.yearPages.toLocaleString("zh-CN")} 页。
          </p>
          {overview.reading.monthlyMinutes.length > 0 ? (
            <ul className="stats-bars">
              {overview.reading.monthlyMinutes.map((row) => (
                <BarRow
                  key={row.month}
                  label={row.month}
                  max={maxMonthly}
                  suffix=" 分钟"
                  value={row.minutes}
                />
              ))}
            </ul>
          ) : (
            <p className="stats-empty">今年还没有阅读记录。</p>
          )}
        </StatCard>

        <StatCard title="训练（近 90 天）">
          <p className="stats-facts">
            完成 {overview.exercise.last90Completed} 次 · 跳过 {overview.exercise.last90Skipped} 次 ·
            累计 {formatMinutes(overview.exercise.last90Minutes)}。
          </p>
          {trends ? (
            <>
              <p className="stats-facts">
                连续训练 {trends.currentStreakWeeks} 周 · 近 {trends.weeks.length} 周累计{" "}
                {trends.series.reduce((total, entry) => total + entry.totalSets, 0).toLocaleString("zh-CN")} 组 ·{" "}
                {trends.series.reduce((total, entry) => total + entry.totalSessions, 0)} 次。
              </p>
              {partRows.length > 0 ? (
                <ul aria-label={`近 ${trends.weeks.length} 周各部位组数`} className="stats-bars">
                  {partRows.map((entry) => (
                    <BarRow
                      key={entry.bodyPart}
                      label={entry.bodyPart}
                      max={maxPartSets}
                      suffix=" 组"
                      value={entry.totalSets}
                    />
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
        </StatCard>

        <StatCard title="睡眠（近 30 天）">
          {overview.sleep.last30Count > 0 ? (
            <p className="stats-facts">
              记录了 {overview.sleep.last30Count} 晚，平均时长 {formatMinutes(overview.sleep.last30AvgMinutes ?? 0)}。
            </p>
          ) : (
            <p className="stats-empty">近 30 天还没有睡眠记录。</p>
          )}
        </StatCard>

        <StatCard title="每日复盘">
          <p className="stats-facts">
            累计 {overview.review.totalDays} 天 · 当前连续 {overview.review.currentStreak} 天 ·
            最长连续 {overview.review.longestStreak} 天。
          </p>
          <p className="stats-facts">
            手写累计 {overview.review.totalCharacters.toLocaleString("zh-CN")} 字。
          </p>
        </StatCard>

        <StatCard title="健康清单（近 30 天完成次数）">
          {overview.health.length > 0 ? (
            <ul className="stats-bars">
              {overview.health.map((row) => (
                <BarRow
                  key={row.name}
                  label={row.name}
                  max={maxHealth}
                  suffix=" 次"
                  value={row.completions}
                />
              ))}
            </ul>
          ) : (
            <p className="stats-empty">近 30 天还没有完成的健康项。</p>
          )}
        </StatCard>

        <StatCard title="随手记">
          <p className="stats-facts">
            累计 {overview.captures.total.toLocaleString("zh-CN")} 条（不含已作废） ·
            本月 {overview.captures.thisMonth} 条。
          </p>
        </StatCard>
      </div>
      <p className="stats-note">更新时间：{new Date(overview.generatedAt).toLocaleString("zh-CN")}</p>
    </>
  );
}

function UnavailableStatsPage() {
  return (
    <main className="page-shell narrow-shell stats-page">
      <section className="stats-card" role="status">
        <p>统计数据暂时无法读取；请稍后刷新重试。</p>
      </section>
    </main>
  );
}

export default async function StatsPage() {
  await connection();
  try {
    const database = getApplicationDatabase();
    const overview = getStatsOverview(database.sqlite);
    let trends: ExerciseTrendsSnapshot | null = null;
    try {
      trends = getExerciseTrendsSnapshot(database.sqlite, {
        asOfDate: toShanghaiBusinessDate(new Date()),
      });
    } catch {
      trends = null;
    }
    return (
      <main className="page-shell stats-page">
        <header className="page-header">
          <h1>事实汇总</h1>
        </header>
        <FactsList overview={overview} trends={trends} />
      </main>
    );
  } catch {
    return <UnavailableStatsPage />;
  }
}
