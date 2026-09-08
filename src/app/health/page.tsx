import { getApplicationDatabase } from "@/core/db/application-database";
import { isBusinessDate, toHealthChecklistBusinessDate } from "@/core/time/business-date";
import { materializeHealthChecklistDay } from "@/modules/health-checklist/service";

import { HealthWorkspace, type HealthChecklistReadState } from "./health-workspace";

export const dynamic = "force-dynamic";

interface HealthPageProps {
  searchParams: Promise<{ date?: string | string[] }>;
}

export default async function HealthPage({
  searchParams,
}: HealthPageProps) {
  const query = await searchParams;
  const automaticDate = toHealthChecklistBusinessDate(new Date());
  const selectedDate = typeof query.date === "string" && isBusinessDate(query.date)
    ? query.date
    : null;
  const requested = selectedDate ?? automaticDate;
  let initial: HealthChecklistReadState;
  try {
    const { sqlite } = getApplicationDatabase();
    initial = {
      status: "ready",
      data: await materializeHealthChecklistDay(sqlite, requested),
    };
  } catch {
    initial = { status: "unavailable" };
  }

  return (
    <main className="page-shell narrow-shell health-checklist-page">
      <header className="page-title-row">
        <form className="page-title-actions date-picker-inline" method="get">
          <label htmlFor="health-checklist-date">清单日期</label>
          <input defaultValue={requested} id="health-checklist-date" name="date" type="date" />
          <button type="submit">跳转</button>
        </form>
      </header>
      <HealthWorkspace autoRollover={selectedDate === null} initial={initial} />
    </main>
  );
}
