import { getApplicationDatabase } from "@/core/db/application-database";
import { toShanghaiBusinessDate } from "@/core/time/business-date";
import { getPlanningSnapshot } from "@/modules/planning/service";

import { PlanningWorkspace } from "./planning-workspace";

export const dynamic = "force-dynamic";

function nextBusinessDate(businessDate: string): string {
  const [year, month, day] = businessDate.split("-").map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day!));
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export default function GoalsPage() {
  const businessDate = toShanghaiBusinessDate(new Date());
  const tomorrowBusinessDate = nextBusinessDate(businessDate);
  const database = getApplicationDatabase();
  const initialSnapshot = getPlanningSnapshot(database.sqlite, { businessDate });
  const tomorrowSnapshot = getPlanningSnapshot(database.sqlite, {
    businessDate: tomorrowBusinessDate,
  });

  return (
    <main className="page-shell planning-page">
      <PlanningWorkspace
        businessDate={businessDate}
        initialSnapshot={initialSnapshot}
        initialTomorrowActions={tomorrowSnapshot.todayActions}
        tomorrowBusinessDate={tomorrowBusinessDate}
      />
    </main>
  );
}
