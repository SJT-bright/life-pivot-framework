import type { DailyReadingSnapshot } from "@/modules/reading/contracts";

import { DailyReadingPanel } from "../reading/daily-reading-panel";
import { TodayCard } from "./today-card";
import type { TodayCardState } from "./today-card-state";

interface TodayReadingCardProps {
  businessDate: string;
  state: TodayCardState<DailyReadingSnapshot>;
}

export function TodayReadingCard({ businessDate, state }: TodayReadingCardProps) {
  return (
    <TodayCard
      detailHref="/reading"
      detailLabel="打开阅读记录"
      state={state}
      title="今日阅读"
    >
      {(snapshot) => (
        <DailyReadingPanel
          businessDate={businessDate}
          initial={snapshot}
          mode="card"
        />
      )}
    </TodayCard>
  );
}
