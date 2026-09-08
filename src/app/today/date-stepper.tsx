"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day!));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function weekdayLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Intl.DateTimeFormat("zh-CN", {
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year!, month! - 1, day!)));
  return weekday;
}

interface DateStepperProps {
  businessDate: string;
  today: string;
  basePath?: string;
}

export function DateStepper({ businessDate, today, basePath = "today" }: DateStepperProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  function goTo(date: string) {
    if (pending || date > today) return;
    setPending(true);
    router.push(date === today && basePath === "today" ? "/today" : `/${basePath}?date=${date}`, { scroll: false });
  }

  const previous = shiftDate(businessDate, -1);
  const next = shiftDate(businessDate, 1);
  const isToday = businessDate === today;

  return (
    <div aria-label="记录日期" className="date-stepper" role="group">
      <button
        aria-label={`前一天（${previous}）`}
        disabled={pending}
        onClick={() => goTo(previous)}
        type="button"
      >
        ‹
      </button>
      <span className="date-stepper-current">
        <strong>{businessDate}</strong>
        <span>{weekdayLabel(businessDate)}{isToday ? " · 今天" : " · 补录"}</span>
        <label className="date-stepper-jump">
          选日期
          <input
            aria-label="选择记录日期"
            max={today}
            onChange={(event) => {
              if (event.target.value) goTo(event.target.value);
            }}
            type="date"
            value={businessDate}
          />
        </label>
      </span>
      <button
        aria-label={`后一天（${next}）`}
        disabled={pending || next > today}
        onClick={() => goTo(next)}
        type="button"
      >
        ›
      </button>
      {!isToday ? (
        <button
          className="date-stepper-today"
          disabled={pending}
          onClick={() => goTo(today)}
          type="button"
        >
          回到今天
        </button>
      ) : null}
    </div>
  );
}
