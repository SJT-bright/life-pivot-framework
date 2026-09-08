import { z } from "zod";

import { isBusinessDate } from "@/core/time/business-date";

import {
  MAX_RECOVERY_DURATION_DAYS,
  MIN_RECOVERY_DURATION_DAYS,
} from "./recovery-countdown";

const MAX_ROUTINE_ITEMS = 200;
const MAX_BATCH_ITEM_KEYS = 200;
const MAX_CONFIRMATION_KEYS = 200;

export const MANUAL_SKINCARE_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const MANUAL_SKINCARE_PHOTO_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export type ManualSkincarePhotoType = typeof MANUAL_SKINCARE_PHOTO_TYPES[number];
export const MANUAL_SKINCARE_PHOTO_ACCEPT = MANUAL_SKINCARE_PHOTO_TYPES.join(",");
const PHOTO_DATA_URL_PREFIXES = MANUAL_SKINCARE_PHOTO_TYPES.map(
  (mediaType) => `data:${mediaType};base64,`,
);
const MAX_PHOTO_DATA_URL_LENGTH = Math.max(...PHOTO_DATA_URL_PREFIXES.map(
  (prefix) => prefix.length,
)) + Math.ceil(MANUAL_SKINCARE_PHOTO_MAX_BYTES / 3) * 4;
const BASE64_PAYLOAD = /^[A-Za-z0-9+/]+={0,2}$/u;
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function decodeBase64Prefix(payload: string, maximumBytes = 12): number[] {
  const bytes: number[] = [];
  let buffer = 0;
  let bufferedBits = 0;
  for (const character of payload) {
    if (character === "=" || bytes.length >= maximumBytes) break;
    const value = BASE64_ALPHABET.indexOf(character);
    if (value < 0) return [];
    buffer = (buffer << 6) | value;
    bufferedBits += 6;
    while (bufferedBits >= 8 && bytes.length < maximumBytes) {
      bufferedBits -= 8;
      bytes.push((buffer >> bufferedBits) & 0xff);
    }
  }
  return bytes;
}

function hasExpectedPhotoSignature(prefix: string, payload: string): boolean {
  const bytes = decodeBase64Prefix(payload);
  if (prefix === "data:image/jpeg;base64,") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (prefix === "data:image/png;base64,") {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      .every((byte, index) => bytes[index] === byte);
  }
  return bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
}

export function manualSkincarePhotoDataUrlBytes(value: string): number | null {
  const prefix = PHOTO_DATA_URL_PREFIXES.find((candidate) => value.startsWith(candidate));
  if (!prefix) return null;
  const payload = value.slice(prefix.length);
  if (payload.length === 0 || payload.length % 4 !== 0 || !BASE64_PAYLOAD.test(payload)) {
    return null;
  }
  if (!hasExpectedPhotoSignature(prefix, payload)) return null;
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  const bytes = (payload.length / 4) * 3 - padding;
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : null;
}

export function isManualSkincarePhotoDataUrl(value: string): boolean {
  const bytes = manualSkincarePhotoDataUrlBytes(value);
  return bytes !== null && bytes <= MANUAL_SKINCARE_PHOTO_MAX_BYTES;
}

export function parseManualSkincarePhotoDataUrl(value: string): {
  readonly mediaType: ManualSkincarePhotoType;
  readonly base64: string;
  readonly byteLength: number;
} | null {
  const prefixIndex = PHOTO_DATA_URL_PREFIXES.findIndex((candidate) => value.startsWith(candidate));
  const byteLength = manualSkincarePhotoDataUrlBytes(value);
  if (prefixIndex < 0 || byteLength === null || byteLength > MANUAL_SKINCARE_PHOTO_MAX_BYTES) {
    return null;
  }
  return {
    mediaType: MANUAL_SKINCARE_PHOTO_TYPES[prefixIndex]!,
    base64: value.slice(PHOTO_DATA_URL_PREFIXES[prefixIndex]!.length),
    byteLength,
  };
}

const identifierSchema = z.string().trim().min(8).max(128);
const nameSchema = z.string().trim().min(1).max(160);
const brandSchema = z.string().trim().min(1).max(160);
const purposeSchema = z.string().trim().min(1).max(500);
const shortNoteSchema = z.string().trim().max(1_000);
const noteSchema = z.string().trim().max(4_000);
const nonNegativeSafeIntegerSchema = z
  .number()
  .int()
  .refine(Number.isSafeInteger)
  .min(0);
const recoveryDurationDaysSchema = z
  .number()
  .int()
  .refine(Number.isSafeInteger)
  .min(MIN_RECOVERY_DURATION_DAYS)
  .max(MAX_RECOVERY_DURATION_DAYS);
const businessDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine(isBusinessDate, "Invalid business date.");
const photoDataUrlSchema = z.string()
  .max(MAX_PHOTO_DATA_URL_LENGTH)
  .refine(isManualSkincarePhotoDataUrl, "Invalid skincare product photo.");

export const manualSkincareProductStatusSchema = z.enum([
  "active",
  "paused",
  "finished",
]);
export const manualSkincareSlotSchema = z.enum(["morning", "evening"]);
export const manualSkincareScopeSchema = z.enum(["today-only", "today-and-future"]);
export const manualSkincareNoteSectionSchema = z.enum(["morning", "evening", "overall"]);
export const manualSkincareCycleStatusSchema = z.enum(["draft", "active", "completed"]);

export const manualSkincareRoutineItemInputSchema = z.object({
  itemKey: identifierSchema,
  slot: manualSkincareSlotSchema,
  productId: identifierSchema,
  ordinal: nonNegativeSafeIntegerSchema,
}).strict();

function slotOrder(slot: ManualSkincareSlot): number {
  return slot === "morning" ? 0 : 1;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const routineItemsSchema = z
  .array(manualSkincareRoutineItemInputSchema)
  .max(MAX_ROUTINE_ITEMS)
  .superRefine((items, context) => {
    const itemKeys = new Set<string>();
    const slotOrdinals = new Set<string>();
    const slotProducts = new Set<string>();
    for (const [index, item] of items.entries()) {
      if (itemKeys.has(item.itemKey)) {
        context.addIssue({
          code: "custom",
          message: "Duplicate routine item key.",
          path: [index, "itemKey"],
        });
      }
      const slotOrdinal = `${item.slot}:${item.ordinal}`;
      if (slotOrdinals.has(slotOrdinal)) {
        context.addIssue({
          code: "custom",
          message: "Duplicate routine ordinal within a slot.",
          path: [index, "ordinal"],
        });
      }
      const slotProduct = `${item.slot}:${item.productId}`;
      if (slotProducts.has(slotProduct)) {
        context.addIssue({
          code: "custom",
          message: "Duplicate product within a routine slot.",
          path: [index, "productId"],
        });
      }
      itemKeys.add(item.itemKey);
      slotOrdinals.add(slotOrdinal);
      slotProducts.add(slotProduct);
    }
  })
  .transform((items) => [...items].sort(
    (left, right) =>
      slotOrder(left.slot) - slotOrder(right.slot)
      || left.ordinal - right.ordinal
      || compareText(left.itemKey, right.itemKey)
      || compareText(left.productId, right.productId),
  ));

function uniqueIdentifierArray(minimum: 0 | 1, maximum: number) {
  return z
    .array(identifierSchema)
    .min(minimum)
    .max(maximum)
    .superRefine((values, context) => {
      const seen = new Set<string>();
      values.forEach((value, index) => {
        if (seen.has(value)) {
          context.addIssue({
            code: "custom",
            message: "Duplicate item key.",
            path: [index],
          });
        }
        seen.add(value);
      });
    })
    .transform((values) => [...values].sort(compareText));
}

const confirmedRemovedUsedItemKeysSchema = uniqueIdentifierArray(0, MAX_CONFIRMATION_KEYS);
const batchItemKeysSchema = uniqueIdentifierArray(1, MAX_BATCH_ITEM_KEYS);

const saveProductCommandSchema = z.object({
  type: z.literal("save-product"),
  productId: identifierSchema,
  name: nameSchema,
  brand: brandSchema,
  currentPurpose: purposeSchema,
  status: manualSkincareProductStatusSchema,
  addedOn: businessDateSchema,
  note: noteSchema,
  // Optional preserves pre-photo frozen submissions: omitted means keep the
  // current image, while an explicit null removes it.
  photoDataUrl: photoDataUrlSchema.nullable().optional(),
  expectedProductRevision: nonNegativeSafeIntegerSchema,
}).strict();

const replaceRoutineCommandSchema = z.object({
  type: z.literal("replace-routine"),
  businessDate: businessDateSchema,
  scope: manualSkincareScopeSchema,
  items: routineItemsSchema,
  changeNote: shortNoteSchema,
  expectedRoutineRevision: nonNegativeSafeIntegerSchema,
  expectedDayRevision: nonNegativeSafeIntegerSchema,
  confirmedRemovedUsedItemKeys: confirmedRemovedUsedItemKeysSchema,
}).strict();

const setDayItemsUsedCommandSchema = z.object({
  type: z.literal("set-day-items-used"),
  businessDate: businessDateSchema,
  itemKeys: batchItemKeysSchema,
  used: z.boolean(),
  expectedDayRevision: nonNegativeSafeIntegerSchema,
}).strict();

const saveDayNoteCommandSchema = z.object({
  type: z.literal("save-day-note"),
  businessDate: businessDateSchema,
  section: manualSkincareNoteSectionSchema,
  note: noteSchema,
  expectedDayRevision: nonNegativeSafeIntegerSchema,
}).strict();

const saveRecoveryPlanCommandSchema = z.object({
  type: z.literal("save-recovery-plan"),
  planId: identifierSchema,
  name: nameSchema,
  note: noteSchema,
  expectedPlanRevision: nonNegativeSafeIntegerSchema,
}).strict();

const saveRecoveryCycleCommandSchema = z.object({
  type: z.literal("save-recovery-cycle"),
  planId: identifierSchema,
  cycleId: identifierSchema,
  ordinal: nonNegativeSafeIntegerSchema,
  name: nameSchema,
  goal: purposeSchema,
  // Optional keeps frozen submissions from older builds valid. New clients
  // send this value; the service projects expectedEndOn until the cycle starts.
  durationDays: recoveryDurationDaysSchema.optional(),
  expectedEndOn: businessDateSchema.nullable(),
  note: noteSchema,
  items: routineItemsSchema,
  expectedPlanRevision: nonNegativeSafeIntegerSchema,
  expectedCycleRevision: nonNegativeSafeIntegerSchema,
  expectedRoutineRevision: nonNegativeSafeIntegerSchema,
}).strict();

const startRecoveryCycleCommandSchema = z.object({
  type: z.literal("start-recovery-cycle"),
  planId: identifierSchema,
  cycleId: identifierSchema,
  effectiveFrom: businessDateSchema,
  expectedPlanRevision: nonNegativeSafeIntegerSchema,
  expectedCycleRevision: nonNegativeSafeIntegerSchema,
  expectedCurrentCycleId: identifierSchema.nullable(),
  expectedCurrentCycleRevision: nonNegativeSafeIntegerSchema,
  expectedActivationSequence: nonNegativeSafeIntegerSchema,
  expectedDayRevision: nonNegativeSafeIntegerSchema,
  confirmedRemovedUsedItemKeys: confirmedRemovedUsedItemKeysSchema,
}).strict();

const completeRecoveryCycleCommandSchema = z.object({
  type: z.literal("complete-recovery-cycle"),
  cycleId: identifierSchema,
  completedOn: businessDateSchema,
  expectedCycleRevision: nonNegativeSafeIntegerSchema,
}).strict();

export const manualSkincareCommandSchema = z.discriminatedUnion("type", [
  saveProductCommandSchema,
  replaceRoutineCommandSchema,
  setDayItemsUsedCommandSchema,
  saveDayNoteCommandSchema,
  saveRecoveryPlanCommandSchema,
  saveRecoveryCycleCommandSchema,
  startRecoveryCycleCommandSchema,
  completeRecoveryCycleCommandSchema,
]);

export class ManualSkincareValidationError extends Error {
  constructor(message = "Invalid manual skincare command.") {
    super(message);
    this.name = "ManualSkincareValidationError";
  }
}

export function parseManualSkincareCommand(value: unknown): ManualSkincareCommand {
  const parsed = manualSkincareCommandSchema.safeParse(value);
  if (!parsed.success) throw new ManualSkincareValidationError();
  return parsed.data;
}

export type ManualSkincareProductStatus = z.infer<typeof manualSkincareProductStatusSchema>;
export type ManualSkincareSlot = z.infer<typeof manualSkincareSlotSchema>;
export type ManualSkincareScope = z.infer<typeof manualSkincareScopeSchema>;
export type ManualSkincareNoteSection = z.infer<typeof manualSkincareNoteSectionSchema>;
export type ManualSkincareCycleStatus = z.infer<typeof manualSkincareCycleStatusSchema>;
export type ManualSkincareRoutineItemInput = z.output<
  typeof manualSkincareRoutineItemInputSchema
>;
export type ManualSkincareCommand = z.output<typeof manualSkincareCommandSchema>;

export interface ManualSkincareProductSnapshot {
  productId: string;
  name: string;
  brand: string;
  currentPurpose: string;
  status: ManualSkincareProductStatus;
  addedOn: string;
  note: string;
  /** Versioned, same-origin preview URL. Optional for legacy serialized snapshots. */
  photoUrl?: string | null;
  revision: number;
}

export interface ManualSkincareRoutineItemSnapshot extends ManualSkincareRoutineItemInput {
  productName: string;
  brand: string;
  currentPurpose: string;
}

export interface ManualSkincareDayItemSnapshot extends ManualSkincareRoutineItemSnapshot {
  used: boolean;
  usedAt: string | null;
}

export interface ManualSkincareDayCycleSnapshot {
  cycleId: string;
  name: string;
}

export interface ManualSkincareDaySnapshot {
  dayId: string | null;
  businessDate: string;
  materialized: boolean;
  routineRevision: number;
  activationSequence: number;
  recoveryCycle: ManualSkincareDayCycleSnapshot | null;
  morningNote: string;
  eveningNote: string;
  overallNote: string;
  revision: number;
  morningItems: ManualSkincareDayItemSnapshot[];
  eveningItems: ManualSkincareDayItemSnapshot[];
}

export interface ManualSkincareRecoveryCycleSnapshot {
  cycleId: string;
  planId: string;
  ordinal: number;
  name: string;
  goal: string;
  /** Planned natural-day length. Optional for older serialized snapshots. */
  durationDays?: number | null;
  expectedEndOn: string | null;
  status: ManualSkincareCycleStatus;
  actualStartedOn: string | null;
  actualCompletedOn: string | null;
  note: string;
  revision: number;
  routineRevision: number;
  items: ManualSkincareRoutineItemSnapshot[];
}

export interface ManualSkincareRecoveryPlanSnapshot {
  planId: string;
  name: string;
  note: string;
  revision: number;
  cycles: ManualSkincareRecoveryCycleSnapshot[];
}

export interface ManualSkincareDayInsight {
  businessDate: string;
  completedItems: number;
  totalItems: number;
  completionPercent: number | null;
  sleepQualityScore: number | null;
  sleepVariabilityMinutes: number | null;
  sleepPenalty: number;
  stabilityScore: number | null;
}

export interface ManualSkincareSnapshot {
  businessDate: string;
  products: ManualSkincareProductSnapshot[];
  latestRoutineRevision: number;
  activationSequence: number;
  selectedDay: ManualSkincareDaySnapshot | null;
  recoveryPlans: ManualSkincareRecoveryPlanSnapshot[];
  history: ManualSkincareDaySnapshot[];
  insights?: ManualSkincareDayInsight[];
}

export interface ManualSkincareAppliedMutation {
  operation: ManualSkincareCommand["type"];
  ownerId: string;
  ownerRevision: number;
  businessDate: string | null;
  activationSequence: number | null;
}

export interface ManualSkincareMutationResult {
  snapshot: ManualSkincareSnapshot;
  applied: ManualSkincareAppliedMutation;
}
