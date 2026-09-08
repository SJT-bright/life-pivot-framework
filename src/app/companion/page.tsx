import { getApplicationDatabase } from "@/core/db/application-database";
import { toShanghaiBusinessDate } from "@/core/time/business-date";
import type { TodayReminder } from "@/modules/today-reminders/contracts";
import {
  listIncompletePastReminders,
  listTodayReminders,
} from "@/modules/today-reminders/query";

import { TodayRemindersPanel } from "../today/today-reminders-panel";
import styles from "./companion.module.css";

export const dynamic = "force-dynamic";

export default function CompanionPage() {
  const businessDate = toShanghaiBusinessDate(new Date());
  let reminders: TodayReminder[] = [];
  let pastReminders: TodayReminder[] = [];
  let remindersAvailable = true;
  try {
    const { sqlite } = getApplicationDatabase();
    reminders = listTodayReminders(sqlite, { businessDate });
    pastReminders = listIncompletePastReminders(sqlite, {
      beforeBusinessDate: businessDate,
      limit: 100,
    });
  } catch {
    remindersAvailable = false;
    reminders = [];
    pastReminders = [];
  }
  return (
    <main className={`companion-page ${styles.page}`}>
      <TodayRemindersPanel
        businessDate={businessDate}
        desktopCompanion
        initialAvailable={remindersAvailable}
        initialPastReminders={pastReminders}
        initialReminders={reminders}
      />
    </main>
  );
}
