import { connection } from "next/server";

import { getApplicationDatabase } from "@/core/db/application-database";
import { toShanghaiBusinessDate } from "@/core/time/business-date";
import {
  countDailySleepHistory,
  getDailySleepHistory,
  getDailySleepRecord,
} from "@/modules/daily-sleep/query";

import {
  type DailySleepReadState,
  SleepWorkspace,
  type SleepWorkspaceInitial,
} from "./sleep-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLEEP_HISTORY_PAGE_SIZE = 30;

interface SleepPageProps {
  searchParams: Promise<{ page?: string | string[] }>;
}

export default async function SleepPage({ searchParams }: SleepPageProps) {
  await connection();
  const query = await searchParams;
  const page = typeof query.page === "string" && /^\d+$/.test(query.page)
    ? Math.max(1, Number(query.page))
    : 1;
  const businessDate = toShanghaiBusinessDate(new Date());
  let database: ReturnType<typeof getApplicationDatabase> | null;
  try {
    database = getApplicationDatabase();
  } catch {
    database = null;
  }

  const read = <T,>(reader: () => T): DailySleepReadState<T> => {
    if (!database) return { status: "unavailable" };
    try {
      return { status: "ready", data: reader() };
    } catch {
      return { status: "unavailable" };
    }
  };
  const initial: SleepWorkspaceInitial = {
    record: read(() => getDailySleepRecord(database!.sqlite, { recordDate: businessDate })),
    history: read(() => getDailySleepHistory(database!.sqlite, page === 1
      ? { limit: SLEEP_HISTORY_PAGE_SIZE }
      : { limit: SLEEP_HISTORY_PAGE_SIZE, offset: (page - 1) * SLEEP_HISTORY_PAGE_SIZE })),
  };
  let historyTotal = 0;
  if (database) {
    try {
      historyTotal = countDailySleepHistory(database.sqlite);
    } catch {
      historyTotal = 0;
    }
  }

  return <SleepWorkspace
    businessDate={businessDate}
    historyPagination={historyTotal > SLEEP_HISTORY_PAGE_SIZE
      ? { page, pageSize: SLEEP_HISTORY_PAGE_SIZE, total: historyTotal }
      : undefined}
    initial={initial}
  />;
}
