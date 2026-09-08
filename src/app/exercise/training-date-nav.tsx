"use client";

import { isBusinessDate } from "@/core/time/business-date";

import styles from "./training-date-nav.module.css";

export interface TrainingDateRecord {
  readonly businessDate: string;
  readonly status: string;
  readonly resolution?: { readonly outcome: "rest" | "skipped" | "unrecorded" } | null;
  readonly isRest?: boolean;
}

export interface TrainingDateNavProps {
  readonly date: string;
  readonly today: string;
  readonly records?: readonly TrainingDateRecord[];
  readonly onDateChange: (date: string) => void;
  readonly disabled?: boolean;
}

const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** Date-only arithmetic stays independent of the device timezone and DST. */
export function shiftTrainingDate(date: string, days: number): string {
  if (!isBusinessDate(date) || !Number.isInteger(days)) return date;
  const parsed = new Date(`${date}T12:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function trainingWeekDates(date: string): string[] {
  if (!isBusinessDate(date)) return [];
  const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  const monday = shiftTrainingDate(date, -((weekday + 6) % 7));
  return Array.from({ length: 7 }, (_, offset) => shiftTrainingDate(monday, offset));
}

function weekdayLabel(date: string): string {
  return weekdays[new Date(`${date}T12:00:00.000Z`).getUTCDay()] ?? "";
}

function recordLabel(record: TrainingDateRecord | undefined, date: string, today: string): string {
  if (date > today) return "未到";
  if (record?.resolution?.outcome === "rest" || record?.status === "rested"
    || (record?.isRest && record.status === "completed")) return "休息";
  if (record?.resolution?.outcome === "unrecorded") return "记不清";
  if (record?.status === "skipped" || record?.resolution?.outcome === "skipped") return "已跳过";
  if (record?.status === "completed") return "已完成";
  if (record?.status === "partial") return "部分完成";
  if (record?.status === "in-progress") return "训练中";
  return date < today ? "待补记" : "待记录";
}

export function TrainingDateNav({ date, today, records = [], onDateChange, disabled = false }: TrainingDateNavProps) {
  const currentDate = isBusinessDate(date) ? date : today;
  const week = trainingWeekDates(currentDate);
  const recordsByDate = new Map(records.map((record) => [record.businessDate, record]));
  const fullDate = `${currentDate.replace("-", " 年 ").replace("-", " 月 ")} 日`;

  function selectDate(nextDate: string) {
    if (!disabled && nextDate !== currentDate && isBusinessDate(nextDate) && nextDate <= today) {
      onDateChange(nextDate);
    }
  }

  return (
    <section aria-label="训练日期" className={styles.navigator} data-draft-ignore="true">
      <div className={styles.toolbar}>
        <div aria-live="polite" aria-atomic="true" className={styles.current}>
          <strong><time dateTime={currentDate}>{fullDate}</time><span>{weekdayLabel(currentDate)}</span></strong>
          <span className={styles.context}>{currentDate === today ? "今天" : currentDate < today ? "补记" : "未到日期"}</span>
        </div>
        <div className={styles.controls}>
          <button aria-label="上一天" disabled={disabled} onClick={() => selectDate(shiftTrainingDate(currentDate, -1))} type="button">‹</button>
          <input aria-label="选择训练日期" disabled={disabled} max={today} onChange={(event) => selectDate(event.target.value)} type="date" value={currentDate} />
          <button aria-label="下一天" disabled={disabled || currentDate >= today} onClick={() => selectDate(shiftTrainingDate(currentDate, 1))} type="button">›</button>
          <button className={styles.today} disabled={disabled || currentDate === today} onClick={() => selectDate(today)} type="button">回今天</button>
        </div>
      </div>
      <div aria-label="本周训练记录" className={styles.week}>
        {week.map((day) => {
          const label = recordLabel(recordsByDate.get(day), day, today);
          return (
            <button
              aria-label={`${day} ${weekdayLabel(day)} ${label}`}
              aria-current={day === today ? "date" : undefined}
              aria-pressed={day === currentDate}
              className={styles.day}
              data-selected={day === currentDate}
              data-status={label}
              disabled={disabled || day > today}
              key={day}
              onClick={() => selectDate(day)}
              title={`${day} · ${label}`}
              type="button"
            >
              <span className={styles.weekday}>{weekdayLabel(day)}</span>
              <span className={styles.dateNumber}>{Number(day.slice(5, 7))}/{Number(day.slice(8))}</span>
              <span className={styles.dayStatus}>{label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
