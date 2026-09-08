"use client";

import { useMemo, useState } from "react";

import type { ExerciseTrendsSnapshot } from "@/modules/manual-exercise/trends-query";

const WIDTH = 920;
const HEIGHT = 380;
const PADDING = { top: 24, right: 24, bottom: 42, left: 48 };

const PART_COLORS: readonly string[] = [
  "#356955", "#c07a4a", "#4a7fb5", "#9a6bb5", "#c0566b",
  "#4fa89a", "#b5943f", "#5f6d67", "#7a8a55", "#a0758f",
];

function partColor(index: number): string {
  return PART_COLORS[index % PART_COLORS.length];
}

function shortWeek(weekStart: string): string {
  const [, month, day] = weekStart.split("-");
  return `${Number(month)}/${Number(day)}`;
}

interface HoverState {
  x: number;
  y: number;
  weekIndex: number;
}

export function ExerciseTrendsChart({ snapshot }: { snapshot: ExerciseTrendsSnapshot }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [hover, setHover] = useState<HoverState | null>(null);

  const series = useMemo(() => {
    if (selected.size === 0) return snapshot.series;
    return snapshot.series.filter((entry) => selected.has(entry.bodyPart));
  }, [selected, snapshot.series]);

  const maxY = useMemo(() => {
    const values = series.flatMap((entry) => entry.points.map((point) => point.volume));
    const peak = Math.max(20, ...values);
    return Math.ceil(peak / 20) * 20;
  }, [series]);

  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const weekCount = Math.max(1, snapshot.weeks.length);
  const x = (index: number) => PADDING.left + (plotWidth / weekCount) * (index + 0.5);
  const y = (volume: number) => PADDING.top + plotHeight * (1 - volume / maxY);

  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(maxY * ratio));

  function toggle(part: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(part)) next.delete(part);
      else next.add(part);
      return next;
    });
  }

  return (
    <div className="exercise-trends-chart">
      <div className="exercise-trends-legend">
        {snapshot.series.map((entry, index) => {
          const active = selected.size === 0 || selected.has(entry.bodyPart);
          return (
            <button
              className={active ? "exercise-trends-chip is-active" : "exercise-trends-chip"}
              key={entry.bodyPart}
              onClick={() => toggle(entry.bodyPart)}
              type="button"
            >
              <i aria-hidden="true" style={{ background: partColor(index) }} />
              {entry.bodyPart}
            </button>
          );
        })}
      </div>
      <svg
        aria-label="各部位每周训练容量折线图"
        role="img"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      >
        {gridValues.map((value) => (
          <g key={value}>
            <line
              className="exercise-trends-gridline"
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={y(value)}
              y2={y(value)}
            />
            <text className="exercise-trends-axis-label" textAnchor="end" x={PADDING.left - 8} y={y(value) + 4}>
              {value}
            </text>
          </g>
        ))}
        {snapshot.weeks.map((week, index) => (
          <text
            className="exercise-trends-axis-label"
            key={week}
            textAnchor="middle"
            x={x(index)}
            y={HEIGHT - PADDING.bottom + 20}
          >
            {shortWeek(week)}
          </text>
        ))}
        {series.map((entry) => {
          const seriesIndex = snapshot.series.indexOf(entry);
          const points = entry.points.map((point, index) => `${x(index)},${y(point.volume)}`).join(" ");
          return (
            <g key={entry.bodyPart}>
              <polyline
                className="exercise-trends-line"
                fill="none"
                points={points}
                stroke={partColor(seriesIndex)}
                strokeWidth={2.5}
              />
              {entry.points.map((point, index) => (
                <circle
                  className="exercise-trends-dot"
                  cx={x(index)}
                  cy={y(point.volume)}
                  data-part={entry.bodyPart}
                  data-index={index}
                  fill={partColor(seriesIndex)}
                  key={`${entry.bodyPart}-${point.weekStart}`}
                  r={4}
                  stroke="rgba(255,255,255,0.9)"
                  strokeWidth={1.5}
                />
              ))}
            </g>
          );
        })}
        {/* 悬浮列：覆盖整列用于拾取，同时高亮该周 */}
        {hover ? (
          <line
            className="exercise-trends-cursor"
            x1={x(hover.weekIndex)}
            x2={x(hover.weekIndex)}
            y1={PADDING.top}
            y2={HEIGHT - PADDING.bottom}
          />
        ) : null}
        {snapshot.weeks.map((week, index) => (
          <rect
            fill="transparent"
            key={`pick-${week}`}
            height={plotHeight}
            onBlur={() => setHover(null)}
            onPointerDown={() => setHover({ x: x(index), y: 0, weekIndex: index })}
            onPointerEnter={() => setHover({ x: x(index), y: 0, weekIndex: index })}
            onPointerLeave={() => setHover(null)}
            width={plotWidth / weekCount}
            x={PADDING.left + (plotWidth / weekCount) * index}
            y={PADDING.top}
          />
        ))}
      </svg>
      {hover ? (
        <div
          className="exercise-trends-tooltip"
          style={{ left: `${(x(hover.weekIndex) / WIDTH) * 100}%` }}
        >
          <strong>周 {shortWeek(snapshot.weeks[hover.weekIndex])} 起</strong>
          {series.length === 0 ? <p>本周没有记录</p> : series.map((entry) => {
            const point = entry.points[hover.weekIndex];
            if (!point || point.sessions === 0) return null;
            return (
              <p key={entry.bodyPart}>
                {entry.bodyPart}：{point.sets} 组 · {point.reps} 次 · 容量 {point.volume}（{point.sessions} 练）
              </p>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
