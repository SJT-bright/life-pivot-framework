import { connection } from "next/server";

import { getApplicationDatabase } from "@/core/db/application-database";
import { toShanghaiBusinessDate } from "@/core/time/business-date";
import type { DailyReadingSnapshot } from "@/modules/reading/contracts";
import {
  getDailyReadingSnapshot,
  getReadingSnapshot,
} from "@/modules/reading/query";

import { DailyReadingPanel } from "./daily-reading-panel";
import { ReadingWorkspace } from "./reading-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function UnavailableReadingPage() {
  return (
    <main className="page-shell reading-page">
      <section className="reading-unavailable" role="status">
        <h1>读书板块暂时无法读取</h1>
        <p>请稍后重新加载。现有数据不会因此被修改。</p>
      </section>
    </main>
  );
}

export default async function ReadingPage() {
  await connection();
  try {
    const database = getApplicationDatabase();
    const initial = getReadingSnapshot(database.sqlite);
    const businessDate = toShanghaiBusinessDate(new Date());
    let daily: DailyReadingSnapshot | null = null;
    try {
      daily = getDailyReadingSnapshot(database.sqlite, { businessDate });
    } catch {
      daily = null;
    }

    return (
      <main className="page-shell reading-page">
        <ReadingWorkspace initial={initial} />
        {daily ? (
          <DailyReadingPanel businessDate={businessDate} initial={daily} />
        ) : (
          <section className="reading-unavailable" role="status">
            <h2>每日阅读暂时无法读取</h2>
            <p>书库仍可正常使用，请稍后重新加载每日记录。</p>
          </section>
        )}
      </main>
    );
  } catch {
    return <UnavailableReadingPage />;
  }
}
