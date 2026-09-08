import { connection } from "next/server";

import { getApplicationDatabase } from "@/core/db/application-database";
import { listWisdomReminders } from "@/modules/wisdom-reminders/query";
import type { WisdomReminder } from "@/modules/wisdom-reminders/contracts";

import { WisdomWorkspace } from "./wisdom-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function UnavailableWisdomPage() {
  return (
    <main className="page-shell narrow-shell wisdom-page">
      <section className="wisdom-unavailable" role="status">
        <p className="eyebrow">提醒</p>
        <h1>提醒库暂时无法读取</h1>
        <p>请稍后刷新重试，已有内容不会丢失。</p>
      </section>
    </main>
  );
}

export default async function WisdomPage() {
  await connection();
  let reminders: WisdomReminder[];
  try {
    reminders = listWisdomReminders(getApplicationDatabase().sqlite);
  } catch {
    return <UnavailableWisdomPage />;
  }

  return (
    <main className="page-shell narrow-shell wisdom-page">
      <WisdomWorkspace initial={reminders} />
    </main>
  );
}
