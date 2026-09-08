import { connection } from "next/server";

import { getApplicationDatabase } from "@/core/db/application-database";
import { isBusinessDate, toShanghaiBusinessDate } from "@/core/time/business-date";
import { materializeManualSkincareDay } from "@/modules/manual-skincare/service";

import { ManualSkincareWorkspace } from "./manual-skincare-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface SkincarePageProps {
  readonly searchParams: Promise<{ readonly date?: string | string[] }>;
}

function unavailablePage() {
  return (
    <main className="page-shell narrow-shell transition-page manual-skincare-page">
      <section className="manual-skincare-unavailable" role="status">
        <h2>护肤记录暂时无法读取</h2>
        <p>请稍后刷新重试；其他页面仍可正常使用。</p>
      </section>
    </main>
  );
}

export default async function SkincarePage({
  searchParams,
}: SkincarePageProps) {
  await connection();
  const query = await searchParams;
  const today = toShanghaiBusinessDate(new Date());
  const requested = query.date;
  if (Array.isArray(requested) || (requested !== undefined && (
    !isBusinessDate(requested) || requested > today
  ))) {
    return unavailablePage();
  }
  const businessDate = requested ?? today;

  let initial;
  try {
    const { sqlite } = getApplicationDatabase();
    initial = await materializeManualSkincareDay(sqlite, businessDate);
  } catch {
    return unavailablePage();
  }

  return (
    <main className="page-shell narrow-shell transition-page manual-skincare-page">
      <h1 className="sr-only">护肤记录</h1>
      <ManualSkincareWorkspace initial={initial} today={today} />
    </main>
  );
}
