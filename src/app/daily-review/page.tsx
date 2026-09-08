import { connection } from "next/server";

import { getApplicationDatabase } from "@/core/db/application-database";
import {
  isBusinessDate,
  toShanghaiBusinessDate,
} from "@/core/time/business-date";
import { getPersonalDailyNote } from "@/modules/personal-notes/query";

import { DailyReviewTemplateCard } from "./daily-review-template-card";
import { DateStepper } from "../today/date-stepper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DailyReviewPageProps {
  searchParams: Promise<{ readonly date?: string | string[] }>;
}

function UnavailableDailyReviewPage() {
  return (
    <main className="page-shell narrow-shell daily-review-page">
      <section className="daily-review-unavailable" role="status">
        <h2>复盘模板暂时无法读取</h2>
        <p>请稍后刷新重试，已有内容不会丢失。</p>
      </section>
    </main>
  );
}

export default async function DailyReviewPage({ searchParams }: DailyReviewPageProps) {
  await connection();
  const query = await searchParams;
  const today = toShanghaiBusinessDate(new Date());
  const requested = query.date;

  if (Array.isArray(requested) || (requested !== undefined && (!isBusinessDate(requested) || requested > today))) {
    return <UnavailableDailyReviewPage />;
  }

  const businessDate = requested ?? today;

  let initial;
  try {
    const database = getApplicationDatabase();
    initial = getPersonalDailyNote(database.sqlite, { businessDate });
  } catch {
    return <UnavailableDailyReviewPage />;
  }

  return (
    <main className="page-shell narrow-shell daily-review-page">
      <header className="page-title-row">
        <div className="page-title-actions">
          <DateStepper basePath="daily-review" businessDate={businessDate} today={today} />
          <a className="review-map-links" href="/review-map">复盘地图</a>
        </div>
      </header>
      <DailyReviewTemplateCard businessDate={businessDate} initialNote={initial} today={today} />
    </main>
  );
}
