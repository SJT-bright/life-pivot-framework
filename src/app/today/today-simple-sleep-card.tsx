"use client";

import { useState } from "react";

import { SimpleSleepForm } from "@/app/sleep/simple-sleep-form";
import type { DailySleepRecord } from "@/modules/daily-sleep/contracts";

interface TodaySimpleSleepCardProps {
  businessDate: string;
  initialRecord: DailySleepRecord | null;
}

function formatMinutes(value: number): string {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (hours === 0) return `${minutes}分钟`;
  if (minutes === 0) return `${hours}小时`;
  return `${hours}小时${minutes}分钟`;
}

export function TodaySimpleSleepCard({
  businessDate,
  initialRecord,
}: TodaySimpleSleepCardProps) {
  const [record, setRecord] = useState(initialRecord);

  return (
    <div className="today-domain-card today-domain-card-sleep">
      <p className="today-domain-card-summary">
        {record
          ? `${record.asleepTime} → ${record.wakeTime} · ${formatMinutes(record.finalDurationMinutes)}`
          : "暂无记录"}
      </p>
      <SimpleSleepForm
        businessDate={businessDate}
        initialRecord={record}
        onRefresh={(refreshedRecord) => setRecord(refreshedRecord)}
      />
    </div>
  );
}
