import { getApplicationDatabase } from "@/core/db/application-database";
import {
  isBusinessDate,
  toHealthChecklistBusinessDate,
  toShanghaiBusinessDate,
} from "@/core/time/business-date";
import { getDailySleepRecord } from "@/modules/daily-sleep/query";
import { materializeHealthChecklistDay } from "@/modules/health-checklist/service";
import { getPersonalDailyNote } from "@/modules/personal-notes/query";
import { getPersonalKnowledgeSnapshot } from "@/modules/personal-knowledge/query";
import { getDailyReadingSnapshot } from "@/modules/reading/query";
import { materializeManualSkincareDay } from "@/modules/manual-skincare/service";
import { getPlanningSnapshot } from "@/modules/planning/service";
import {
  getCaptureTimeline,
} from "@/modules/today/get-captures";
import {
  getCaptureSource,
  type CaptureSource,
} from "@/modules/today/get-capture-source";
import { listTodayReminders } from "@/modules/today-reminders/query";

import { CaptureSourcePanel } from "./today-capture";
import { TodayDashboard } from "./today-dashboard";
import { DateStepper } from "./date-stepper";
import { loadTodayDashboard } from "./load-today-dashboard";

export const dynamic = "force-dynamic";

interface TodayPageProps {
  searchParams: Promise<{
    date?: string | string[];
    source?: string | string[];
  }>;
}

function InvalidSourceFocus() {
  return (
    <main className="page-shell narrow-shell today-workspace">
      <section aria-label="知识来源原文" className="capture-section">
        <h1>知识来源原文</h1>
        <p>来源记录不可用</p>
      </section>
    </main>
  );
}

export default async function TodayPage({ searchParams }: TodayPageProps) {
  const query = await searchParams;
  const requestedDate = typeof query.date === "string" ? query.date : undefined;
  const sourceFocusRequested = query.source !== undefined;
  const sourceId = typeof query.source === "string" && query.source.trim().length > 0
    ? query.source
    : undefined;
  const validFocusedQuery = sourceFocusRequested
    && sourceId !== undefined
    && requestedDate !== undefined
    && isBusinessDate(requestedDate);

  if (sourceFocusRequested && !validFocusedQuery) return <InvalidSourceFocus />;

  if (validFocusedQuery) {
    let focusedSource: CaptureSource | null = null;
    try {
      const database = getApplicationDatabase();
      focusedSource = getCaptureSource(database.sqlite, {
        businessDate: requestedDate,
        sourceId,
      });
    } catch {
      focusedSource = null;
    }

    return (
      <main className="page-shell narrow-shell today-workspace today-source-focus">
        <CaptureSourcePanel source={focusedSource} />
      </main>
    );
  }

  const now = new Date();
  const today = toShanghaiBusinessDate(now);
  const selectedDate = requestedDate !== undefined && isBusinessDate(requestedDate)
    ? requestedDate
    : null;
  const businessDate = selectedDate ?? today;
  const healthBusinessDate = selectedDate ?? toHealthChecklistBusinessDate(now);
  const data = await loadTodayDashboard({
    openDatabase: getApplicationDatabase,
    readers: {
      captures: (database, date) => getCaptureTimeline(database.sqlite, {
        businessDate: date,
        limit: 50,
      }),
      sleep: (database, date) => getDailySleepRecord(database.sqlite, {
        recordDate: date,
      }),
      health: (database) => materializeHealthChecklistDay(database.sqlite, healthBusinessDate),
      dailyNote: (database, date) => getPersonalDailyNote(database.sqlite, {
        businessDate: date,
      }),
      personalKnowledge: (database, date) => getPersonalKnowledgeSnapshot(database.sqlite, {
        businessDate: date,
        noteLimit: 20,
      }),
      reading: (database, date) => getDailyReadingSnapshot(database.sqlite, {
        businessDate: date,
      }),
      skincare: (database, date) => materializeManualSkincareDay(database.sqlite, date),
      reminders: (database, date) => listTodayReminders(database.sqlite, {
        businessDate: date,
      }),
      planning: (database, date) => getPlanningSnapshot(database.sqlite, {
        businessDate: date,
      }),
    },
  }, businessDate);

  return (
    <main className="page-shell today-workspace">
      <header className="today-header">
        <DateStepper businessDate={businessDate} today={today} />
      </header>

      <TodayDashboard
        businessDate={businessDate}
        data={data}
        today={today}
      />
    </main>
  );
}
