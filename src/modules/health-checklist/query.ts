import type Database from "better-sqlite3";

import { isBusinessDate } from "@/core/time/business-date";

import type { HealthChecklistDay, HealthChecklistDayItem } from "./contracts";

interface DayRow {
  id: string;
  business_date: string;
  template_version_id: string;
  note: string;
  revision: number;
  template_id: string;
  template_revision: number;
  template_name: string;
}

interface ItemRow {
  id: string;
  item_key: string;
  group_key: string;
  group_label: string;
  name: string;
  target_text: string;
  note: string;
  ordinal: number;
  completed: number;
  completed_at: string | null;
}

function mapItem(row: ItemRow): HealthChecklistDayItem {
  return {
    id: row.id,
    itemKey: row.item_key,
    groupKey: row.group_key,
    groupLabel: row.group_label,
    name: row.name,
    targetText: row.target_text,
    note: row.note,
    ordinal: row.ordinal,
    completed: row.completed === 1,
    completedAt: row.completed_at,
  };
}

export function getHealthChecklistDay(
  sqlite: Database.Database,
  input: { businessDate: string },
): HealthChecklistDay | null {
  if (!isBusinessDate(input.businessDate)) {
    throw new TypeError("Invalid health checklist date.");
  }
  const row = sqlite.prepare(`
    select d.id, d.business_date, d.template_version_id, d.note, d.revision,
           v.template_id, v.revision as template_revision, t.name as template_name
    from health_checklist_days d
    join health_checklist_versions v on v.id = d.template_version_id
    join health_checklist_templates t on t.id = v.template_id
    where d.business_date = ?
  `).get(input.businessDate) as DayRow | undefined;
  if (!row) return null;
  const items = sqlite.prepare(`
    select id, item_key, group_key, group_label, name, target_text, note,
           ordinal, completed, completed_at
    from health_checklist_day_items
    where day_id = ?
    order by ordinal asc
  `).all(row.id) as ItemRow[];
  const persistentItemKeys = sqlite.prepare(`
    select item_key from health_checklist_template_items
    where template_version_id = ?
    order by ordinal asc
  `).all(row.template_version_id).map((entry) => (entry as { item_key: string }).item_key);
  return {
    id: row.id,
    businessDate: row.business_date,
    templateId: row.template_id,
    templateVersionId: row.template_version_id,
    templateRevision: row.template_revision,
    templateName: row.template_name,
    note: row.note,
    revision: row.revision,
    items: items.map(mapItem),
    persistentItemKeys,
  };
}
