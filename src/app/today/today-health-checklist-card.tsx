"use client";

import { HealthWorkspace } from "@/app/health/health-workspace";
import type { HealthChecklistDay } from "@/modules/health-checklist/contracts";

interface TodayHealthChecklistCardProps {
  autoRollover?: boolean;
  businessDate: string;
  day: HealthChecklistDay;
}

export function TodayHealthChecklistCard({
  autoRollover = false,
  businessDate,
  day,
}: TodayHealthChecklistCardProps) {
  const completed = day.items.filter((item) => item.completed).length;

  return (
    <div className="today-domain-card today-domain-card-health">
      <p className="today-domain-card-summary">
        今日完成 {completed} / {day.items.length} 项
      </p>
      <HealthWorkspace
        autoRollover={autoRollover}
        initial={{ status: "ready", data: day }}
        mode="card"
      />
    </div>
  );
}
