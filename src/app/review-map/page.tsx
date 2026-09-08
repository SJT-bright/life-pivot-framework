import Link from "next/link";
import { connection } from "next/server";

import { getApplicationDatabase } from "@/core/db/application-database";
import { toShanghaiBusinessDate } from "@/core/time/business-date";
import { listPersonalDailyNotes } from "@/modules/personal-notes/query";

import {
  buildHeatmap,
  computeReviewStats,
  reviewExcerpt,
  summarizeDailyReview,
  type DailyReviewSummary,
} from "./note-summary";
import { extractReviewKeywords, keywordsForReview } from "./keywords";
import { ReviewGraph } from "./review-graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"] as const;

function formatChineseDate(businessDate: string): string {
  const [year, month, day] = businessDate.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function formatMonthDay(businessDate: string): string {
  const [, month, day] = businessDate.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="review-stat-card">
      <p className="review-stat-value">{value}</p>
      <p className="review-stat-label">{label}</p>
    </div>
  );
}

export default async function ReviewMapPage() {
  await connection();
  const today = toShanghaiBusinessDate(new Date());

  let summaries: DailyReviewSummary[] = [];
  let available = true;
  try {
    const { sqlite } = getApplicationDatabase();
    summaries = listPersonalDailyNotes(sqlite, { limit: 400 }).map(summarizeDailyReview);
  } catch {
    available = false;
  }

  if (!available) {
    return (
      <main className="page-shell review-map-page">
        <section className="review-map-unavailable" role="status">
          <p>暂时无法读取每日复盘数据。已有内容不会丢失，稍后再来看看。</p>
        </section>
      </main>
    );
  }

  const stats = computeReviewStats(summaries, today);
  const heatmap = buildHeatmap(summaries, today);
  const heatmapFirstDate = heatmap[0]?.[0]?.date;
  const heatmapLastDate = heatmap.at(-1)?.at(-1)?.date;
  const recent = summaries
    .slice(0, 8)
    .map((summary) => ({ summary, excerpt: reviewExcerpt(summary) }));
  // 星图按时间从旧到新串成链，最近 120 天。
  const graphDays = summaries.slice(0, 120).reverse();
  const graphTexts = graphDays.map((summary) =>
    `${summary.completed} ${summary.effective} ${summary.tomorrow}`);
  const keywords = extractReviewKeywords(graphTexts);
  const graph = graphDays.map((summary, index) => ({
    date: summary.businessDate,
    chars: summary.chars,
    excerpt: reviewExcerpt(summary, 120),
    keywords: keywordsForReview(graphTexts[index], keywords),
  }));

  return (
    <main className="page-shell review-map-page">
      <p className="review-map-links">
        <Link href="/daily-review">写复盘</Link>
      </p>

      <section aria-label="复盘成就" className="review-stats">
        <StatCard
          label="连续复盘"
          value={`${stats.currentStreak} 天`}
        />
        <StatCard label="累计复盘" value={`${stats.totalDays} 天`} />
        <StatCard label="本月已复盘" value={`${stats.monthDays} 天`} />
        <StatCard label="累计字数" value={`${stats.totalChars.toLocaleString("zh-CN")} 字`} />
      </section>

      <section aria-label="复盘热力日历" className="review-heatmap-section">
        <div className="review-heatmap-heading">
          <h2>坚持的热力</h2>
          {heatmapFirstDate && heatmapLastDate ? (
            <p>
              <time dateTime={heatmapFirstDate}>{formatChineseDate(heatmapFirstDate)}</time>
              <span aria-hidden="true"> — </span>
              <time dateTime={heatmapLastDate}>{formatChineseDate(heatmapLastDate)}</time>
            </p>
          ) : null}
        </div>
        <div className="review-heatmap-calendar">
          <div aria-hidden="true" className="review-heatmap-weekdays">
            {WEEKDAY_LABELS.map((label) => <span key={label}>周{label}</span>)}
          </div>
          <div className="review-heatmap-scroll">
            <div className="review-heatmap" role="region" aria-label={`最近 ${heatmap.length} 周复盘热力图，纵向为周一到周日`}>
              {heatmap.map((column, index) => (
                <div className="review-heatmap-column" key={column[0]?.date ?? `week-${index}`}>
                  {column.map((cell, weekday) => {
                    const state = cell.reviewed ? `已复盘，${cell.chars} 字` : "没有复盘";
                    const label = `${formatChineseDate(cell.date)}，星期${WEEKDAY_LABELS[weekday]}，${state}`;
                    return (
                      <Link
                        aria-current={cell.date === today ? "date" : undefined}
                        aria-label={label}
                        className={`review-heatmap-cell is-level-${cell.level}`}
                        href={`/daily-review?date=${cell.date}`}
                        key={cell.date}
                        title={`${cell.date} · 星期${WEEKDAY_LABELS[weekday]} · ${state}`}
                      >
                        <time dateTime={cell.date}>{formatMonthDay(cell.date)}</time>
                      </Link>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div aria-hidden="true" className="review-heatmap-legend">
          <span>少</span>
          {[1, 2, 3, 4].map((level) => (
            <i className={`review-heatmap-cell is-level-${level}`} key={level} />
          ))}
          <span>多</span>
        </div>
      </section>

      <section aria-label="复盘星图" className="review-graph-section">
        <h2>复盘星图</h2>
        {graph.length === 0 ? (
          <p className="review-map-empty">暂无复盘记录。</p>
        ) : (
          <ReviewGraph days={graph} />
        )}
      </section>

      <section aria-label="近期复盘" className="review-gallery-section">
        <h2>近期复盘</h2>
        {recent.length === 0 ? (
          <p className="review-map-empty">暂无复盘记录。</p>
        ) : (
          <div className="review-gallery">
            {recent.map(({ summary, excerpt }) => (
              <article className="review-gallery-card" key={summary.businessDate}>
                <header>
                  <h3>
                    <Link href={`/daily-review?date=${summary.businessDate}`}>
                      {formatChineseDate(summary.businessDate)}
                    </Link>
                  </h3>
                  <span className="status-pill">{summary.chars} 字</span>
                </header>
                <p>{excerpt || "这一天只留下了标题。"}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
