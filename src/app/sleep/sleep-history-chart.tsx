"use client";

import { useId } from "react";

import type { DailySleepRecord } from "@/modules/daily-sleep/contracts";

export interface SleepHistoryChartProps {
  items: readonly DailySleepRecord[];
}

type ScoredSleepRecord = DailySleepRecord & { qualityScore: number };

const WIDTH = 680;
const HEIGHT = 260;
const LEFT = 50;
const RIGHT = 22;
const TOP = 24;
const BOTTOM = 42;

function dayNumber(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Math.floor(Date.UTC(year!, month! - 1, day!) / 86_400_000);
}

function shortDate(value: string): string {
  return `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}`;
}

function consecutive(left: ScoredSleepRecord, right: ScoredSleepRecord): boolean {
  return dayNumber(right.recordDate) - dayNumber(left.recordDate) === 1;
}

export function SleepHistoryChart({ items }: SleepHistoryChartProps) {
  const id = useId().replaceAll(":", "");
  const ordered = items
    .filter((item): item is ScoredSleepRecord => item.qualityScore !== null)
    .sort((left, right) => left.recordDate.localeCompare(right.recordDate))
    .slice(-30);

  if (ordered.length === 0) {
    return <p className="sleep-score-chart-empty">暂无质量分记录。</p>;
  }

  const firstDay = dayNumber(ordered[0]!.recordDate);
  const lastDay = dayNumber(ordered.at(-1)!.recordDate);
  const daySpan = Math.max(1, lastDay - firstDay);
  const x = (record: ScoredSleepRecord) => LEFT
    + ((dayNumber(record.recordDate) - firstDay) / daySpan) * (WIDTH - LEFT - RIGHT);
  const y = (score: number) => TOP + ((100 - score) / 40) * (HEIGHT - TOP - BOTTOM);

  const segments: ScoredSleepRecord[][] = [];
  for (const record of ordered) {
    const current = segments.at(-1);
    if (!current || !consecutive(current.at(-1)!, record)) {
      segments.push([record]);
    } else {
      current.push(record);
    }
  }

  const labelInterval = Math.max(1, Math.ceil(ordered.length / 6));
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  return <figure className="sleep-score-chart">
    <figcaption>
      <strong>近 30 条睡眠质量分</strong>
    </figcaption>
    <svg
      aria-labelledby={`${titleId} ${descriptionId}`}
      className="sleep-score-chart-svg"
      role="img"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
    >
      <title id={titleId}>睡眠质量分历史折线图</title>
      <desc id={descriptionId}>按日期升序展示你填写的睡眠质量分。纵轴从 60 到 100；没有填写分数的日期不会被连接。</desc>
      {[60, 70, 80, 90, 100].map((score) => <g className="sleep-score-gridline" key={score}>
        <line x1={LEFT} x2={WIDTH - RIGHT} y1={y(score)} y2={y(score)} />
        <text x={LEFT - 10} y={y(score) + 4}>{score}</text>
      </g>)}
      {segments.map((segment) => segment.length > 1
        ? <polyline
            className="sleep-score-line"
            fill="none"
            key={`${segment[0]!.recordDate}-${segment.at(-1)!.recordDate}`}
            points={segment.map((record) => `${x(record)},${y(record.qualityScore)}`).join(" ")}
          />
        : null)}
      {ordered.map((record, index) => <g className="sleep-score-point" key={record.id}>
        <circle
          aria-label={`${record.recordDate}，你填写的睡眠质量分 ${record.qualityScore}`}
          cx={x(record)}
          cy={y(record.qualityScore)}
          r={5}
          role="img"
          tabIndex={0}
        />
        {(index % labelInterval === 0 || index === ordered.length - 1) && <text
          className="sleep-score-date-label"
          textAnchor="middle"
          x={x(record)}
          y={HEIGHT - 14}
        >{shortDate(record.recordDate)}</text>}
      </g>)}
    </svg>
  </figure>;
}
