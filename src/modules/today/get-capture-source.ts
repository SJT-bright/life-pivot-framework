import type Database from "better-sqlite3";

import { isBusinessDate } from "@/core/time/business-date";

export interface CaptureSource {
  id: string;
  businessDate: string;
  occurredAt: string;
  text: string;
  createdAt: string;
  disposition: "active" | "voided";
}

export interface CaptureSourceInput {
  businessDate: string;
  sourceId: string;
}

export class CaptureSourceInputError extends Error {
  constructor(message = "Invalid capture source input") {
    super(message);
    this.name = "CaptureSourceInputError";
  }
}

export class CaptureSourceNotFoundError extends Error {
  constructor(message = "Capture source not found") {
    super(message);
    this.name = "CaptureSourceNotFoundError";
  }
}

interface CaptureSourceRow {
  id: string;
  business_date: string;
  occurred_at: string;
  content: string;
  created_at: string;
  disposition: "active" | "voided";
}

export function getCaptureSource(
  sqlite: Database.Database,
  input: CaptureSourceInput,
): CaptureSource {
  if (!isBusinessDate(input.businessDate) || input.sourceId.trim().length === 0) {
    throw new CaptureSourceInputError();
  }

  const row = sqlite.prepare(`
    select
      source.id,
      source.business_date,
      source.occurred_at,
      source.content,
      source.created_at,
      case when exists (
        select 1
        from capture_items as disposition_event
        where disposition_event.corrects_item_id = source.id
          and disposition_event.event_type = 'void'
      ) then 'voided' else 'active' end as disposition
    from capture_items as source
    where source.id = ?
      and source.business_date = ?
      and source.event_type = 'capture'
  `).get(input.sourceId, input.businessDate) as CaptureSourceRow | undefined;

  if (!row) throw new CaptureSourceNotFoundError();

  return {
    id: row.id,
    businessDate: row.business_date,
    occurredAt: row.occurred_at,
    text: row.content,
    createdAt: row.created_at,
    disposition: row.disposition,
  };
}
