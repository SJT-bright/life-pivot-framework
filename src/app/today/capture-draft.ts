import { z } from "zod";

import { isBusinessDate } from "@/core/time/business-date";

export const CAPTURE_DRAFT_STORAGE_KEY = "life-pivot:capture-drafts:v1";

export interface CaptureDraft {
  version: 1;
  draftId: string;
  draftBusinessDate: string;
  occurredAt: string;
  idempotencyKey: string;
  text: string;
}

export interface PendingCapture {
  draft: CaptureDraft;
  status: "saving" | "uncertain" | "failed";
  message?: string;
}

export interface LegacyDraftRecovery {
  sourceKey: string;
  businessDate: string;
  text: string;
}

export interface CaptureDraftEnvelope {
  version: 1;
  current?: CaptureDraft;
  pending: PendingCapture[];
  legacy: LegacyDraftRecovery[];
}

interface DraftDependencies {
  now: () => Date;
  createId: () => string;
  toBusinessDate: (date: Date) => string;
}

export interface LoadedCaptureDraftEnvelope {
  envelope: CaptureDraftEnvelope;
  writable: boolean;
  recoveryMessage?: string;
}

const captureDraftSchema = z.object({
  version: z.literal(1),
  draftId: z.string().min(1).max(128),
  draftBusinessDate: z.string().refine(isBusinessDate),
  occurredAt: z.iso.datetime(),
  idempotencyKey: z.string().min(1).max(128),
  text: z.string().max(20_000),
}).strict();

const pendingCaptureSchema = z.object({
  draft: captureDraftSchema,
  status: z.enum(["saving", "uncertain", "failed"]),
  message: z.string().max(500).optional(),
}).strict();

const legacyRecoverySchema = z.object({
  sourceKey: z.string().min(1),
  businessDate: z.string().refine(isBusinessDate),
  text: z.string().max(20_000),
}).strict();

const envelopeSchema = z.object({
  version: z.literal(1),
  current: captureDraftSchema.optional(),
  pending: z.array(pendingCaptureSchema),
  legacy: z.array(legacyRecoverySchema),
}).strict();

const LEGACY_DRAFT_KEY = /^life-pivot:draft:entry:(\d{4}-\d{2}-\d{2}):([^:]+)$/;

export function emptyCaptureDraftEnvelope(): CaptureDraftEnvelope {
  return { version: 1, pending: [], legacy: [] };
}

export function startDraft(
  current: CaptureDraft | undefined,
  text: string,
  dependencies: DraftDependencies,
): CaptureDraft | undefined {
  if (current) return updateDraft(current, text);
  if (!text.trim()) return undefined;

  const instant = dependencies.now();
  return {
    version: 1,
    draftId: dependencies.createId(),
    draftBusinessDate: dependencies.toBusinessDate(instant),
    occurredAt: instant.toISOString(),
    idempotencyKey: dependencies.createId(),
    text,
  };
}

export function updateDraft(
  current: CaptureDraft,
  text: string,
): CaptureDraft | undefined {
  if (!text.trim()) return undefined;
  return { ...current, text };
}

export function moveDraftToBusinessDate(
  draft: CaptureDraft,
  businessDate: string,
  now: Date,
): CaptureDraft {
  if (!isBusinessDate(businessDate)) return draft;
  return {
    ...draft,
    draftBusinessDate: businessDate,
    occurredAt: now.toISOString(),
  };
}

export function loadCaptureDraftEnvelope(storage: Storage): LoadedCaptureDraftEnvelope {
  let raw: string | null;
  try {
    raw = storage.getItem(CAPTURE_DRAFT_STORAGE_KEY);
  } catch {
    return {
      envelope: emptyCaptureDraftEnvelope(),
      writable: false,
      recoveryMessage: "无法读取浏览器草稿存储；本次仍可保存到本地数据库。",
    };
  }

  if (raw !== null) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      return {
        envelope: emptyCaptureDraftEnvelope(),
        writable: false,
        recoveryMessage: "发现无法读取的草稿证据，已原样保留，请先手动备份。",
      };
    }

    const parsed = envelopeSchema.safeParse(decoded);
    if (!parsed.success) {
      return {
        envelope: emptyCaptureDraftEnvelope(),
        writable: false,
        recoveryMessage: "发现其他版本或损坏的草稿证据，已原样保留。",
      };
    }

    return {
      envelope: {
        ...parsed.data,
        pending: parsed.data.pending.map((item) =>
          item.status === "saving" ? { ...item, status: "uncertain" as const } : item),
      },
      writable: true,
    };
  }

  const legacy: LegacyDraftRecovery[] = [];
  try {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((key): key is string => key !== null)
      .sort();
    for (const sourceKey of keys) {
      const match = LEGACY_DRAFT_KEY.exec(sourceKey);
      if (!match) continue;
      const businessDate = match[1];
      if (!businessDate || !isBusinessDate(businessDate)) continue;
      const text = storage.getItem(sourceKey);
      if (!text?.trim()) continue;
      legacy.push({ sourceKey, businessDate, text });
    }
  } catch {
    return {
      envelope: emptyCaptureDraftEnvelope(),
      writable: false,
      recoveryMessage: "无法枚举旧草稿；旧数据未被删除。",
    };
  }

  return { envelope: { version: 1, pending: [], legacy }, writable: true };
}

export function persistCaptureDraftEnvelope(
  storage: Storage,
  envelope: CaptureDraftEnvelope,
): boolean {
  try {
    storage.setItem(CAPTURE_DRAFT_STORAGE_KEY, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

export function recoverLegacyDraft(
  envelope: CaptureDraftEnvelope,
  sourceKey: string,
  dependencies: DraftDependencies,
): CaptureDraftEnvelope {
  if (envelope.current) return envelope;
  const recovery = envelope.legacy.find((item) => item.sourceKey === sourceKey);
  if (!recovery) return envelope;
  const instant = dependencies.now();
  return {
    ...envelope,
    current: {
      version: 1,
      draftId: dependencies.createId(),
      draftBusinessDate: recovery.businessDate,
      occurredAt: instant.toISOString(),
      idempotencyKey: dependencies.createId(),
      text: recovery.text,
    },
    legacy: envelope.legacy.filter((item) => item.sourceKey !== sourceKey),
  };
}
