import { z } from "zod";

import { isBusinessDate } from "@/core/time/business-date";

const MAX_ID_LENGTH = 128;
const MAX_BOOK_TITLE_LENGTH = 200;
const MAX_AUTHOR_LENGTH = 120;
const MAX_NOTE_TITLE_LENGTH = 160;
const MAX_NOTE_CONTENT_LENGTH = 20_000;
const MAX_SESSION_NOTE_LENGTH = 5_000;
const MAX_PDF_KEY_LENGTH = 512;
const MAX_PDF_NAME_LENGTH = 255;
const MAX_TOTAL_PAGES = 100_000;
const MAX_PDF_BYTES = 1_073_741_824;

const idSchema = z.string().trim().min(8).max(MAX_ID_LENGTH);
const nonnegativeSafeIntegerSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);
const positiveSafeIntegerSchema = z
  .number()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER);
const timestampSchema = z.string().datetime({ offset: true });
const nullableTimestampSchema = timestampSchema.nullable();
const businessDateSchema = z.string().refine(isBusinessDate);

export const readingBookStatusSchema = z.enum([
  "wishlist",
  "reading",
  "finished",
]);
export type ReadingBookStatus = z.infer<typeof readingBookStatusSchema>;

const bookTitleSchema = z.string().trim().min(1).max(MAX_BOOK_TITLE_LENGTH);
const authorSchema = z.string().trim().max(MAX_AUTHOR_LENGTH);
const noteTitleSchema = z.string().trim().max(MAX_NOTE_TITLE_LENGTH);
const noteContentSchema = z.string().trim().min(1).max(MAX_NOTE_CONTENT_LENGTH);

export const saveReadingBookCommandSchema = z.object({
  type: z.literal("save-book"),
  bookId: idSchema,
  title: bookTitleSchema,
  author: authorSchema,
  status: readingBookStatusSchema,
  totalPages: positiveSafeIntegerSchema.nullable(),
  currentPage: nonnegativeSafeIntegerSchema,
  rating: z.number().int().min(1).max(5).nullable(),
  expectedRevision: nonnegativeSafeIntegerSchema,
}).strict();

export const archiveReadingBookCommandSchema = z.object({
  type: z.literal("archive-book"),
  bookId: idSchema,
  expectedRevision: nonnegativeSafeIntegerSchema,
}).strict();

export const saveReadingNoteCommandSchema = z.object({
  type: z.literal("save-reading-note"),
  noteId: idSchema,
  bookId: idSchema,
  title: noteTitleSchema,
  content: noteContentSchema,
  expectedRevision: nonnegativeSafeIntegerSchema,
}).strict();

export const archiveReadingNoteCommandSchema = z.object({
  type: z.literal("archive-reading-note"),
  noteId: idSchema,
  bookId: idSchema,
  expectedRevision: nonnegativeSafeIntegerSchema,
}).strict();

export const readingCommandSchema = z.discriminatedUnion("type", [
  saveReadingBookCommandSchema,
  archiveReadingBookCommandSchema,
  saveReadingNoteCommandSchema,
  archiveReadingNoteCommandSchema,
]);
export type ReadingCommand = z.infer<typeof readingCommandSchema>;

export const saveReadingSessionCommandSchema = z.object({
  type: z.literal("save-reading-session"),
  sessionId: idSchema,
  bookId: idSchema,
  businessDate: businessDateSchema,
  startPage: z.number().int().min(0).max(MAX_TOTAL_PAGES),
  endPage: z.number().int().min(0).max(MAX_TOTAL_PAGES),
  durationMinutes: z.number().int().min(1).max(1_440),
  note: z.string().trim().max(MAX_SESSION_NOTE_LENGTH),
  expectedRevision: nonnegativeSafeIntegerSchema,
  expectedBookRevision: positiveSafeIntegerSchema,
}).strict().superRefine((command, context) => {
  if (command.endPage < command.startPage) {
    context.addIssue({
      code: "custom",
      message: "End page must not be before start page.",
      path: ["endPage"],
    });
  }
});

export const archiveReadingSessionCommandSchema = z.object({
  type: z.literal("archive-reading-session"),
  sessionId: idSchema,
  bookId: idSchema,
  businessDate: businessDateSchema,
  expectedRevision: positiveSafeIntegerSchema,
  expectedBookRevision: positiveSafeIntegerSchema,
}).strict();

export const dailyReadingCommandSchema = z.discriminatedUnion("type", [
  saveReadingSessionCommandSchema,
  archiveReadingSessionCommandSchema,
]);
export type DailyReadingCommand = z.infer<typeof dailyReadingCommandSchema>;

export const readingBookSchema = z.object({
  bookId: idSchema,
  title: bookTitleSchema,
  author: authorSchema,
  status: readingBookStatusSchema,
  totalPages: positiveSafeIntegerSchema.nullable(),
  currentPage: nonnegativeSafeIntegerSchema,
  rating: z.number().int().min(1).max(5).nullable(),
  pdf: z.object({
    storageKey: z.string().trim().min(1).max(MAX_PDF_KEY_LENGTH),
    originalName: z.string().trim().min(1).max(MAX_PDF_NAME_LENGTH),
    sizeBytes: positiveSafeIntegerSchema,
    addedAt: timestampSchema,
  }).nullable(),
  revision: positiveSafeIntegerSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict();
export type ReadingBook = z.infer<typeof readingBookSchema>;

export const readingNoteSchema = z.object({
  noteId: idSchema,
  bookId: idSchema,
  title: noteTitleSchema,
  content: noteContentSchema,
  revision: positiveSafeIntegerSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict();
export type ReadingNote = z.infer<typeof readingNoteSchema>;

export const dailyReadingBookSchema = z.object({
  bookId: idSchema,
  title: bookTitleSchema,
  author: authorSchema,
  status: readingBookStatusSchema,
  totalPages: positiveSafeIntegerSchema.nullable(),
  currentPage: nonnegativeSafeIntegerSchema,
  revision: positiveSafeIntegerSchema,
}).strict();
export type DailyReadingBook = z.infer<typeof dailyReadingBookSchema>;

export const readingSessionSchema = z.object({
  sessionId: idSchema,
  bookId: idSchema,
  bookTitle: bookTitleSchema,
  businessDate: businessDateSchema,
  startPage: z.number().int().min(0).max(MAX_TOTAL_PAGES),
  endPage: z.number().int().min(0).max(MAX_TOTAL_PAGES),
  pagesRead: z.number().int().min(0).max(MAX_TOTAL_PAGES),
  durationMinutes: z.number().int().min(1).max(1_440),
  note: z.string().max(MAX_SESSION_NOTE_LENGTH),
  revision: positiveSafeIntegerSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict();
export type ReadingSession = z.infer<typeof readingSessionSchema>;

export const dailyReadingSnapshotSchema = z.object({
  businessDate: businessDateSchema,
  books: z.array(dailyReadingBookSchema),
  sessions: z.array(readingSessionSchema),
  totalPagesRead: nonnegativeSafeIntegerSchema,
  totalMinutes: nonnegativeSafeIntegerSchema,
}).strict();
export type DailyReadingSnapshot = z.infer<typeof dailyReadingSnapshotSchema>;

export const readingSnapshotSchema = z.object({
  books: z.array(readingBookSchema),
  notes: z.array(readingNoteSchema),
}).strict();
export type ReadingSnapshot = z.infer<typeof readingSnapshotSchema>;

const readingOperationSchema = z.enum([
  "save-book",
  "archive-book",
  "save-reading-note",
  "archive-reading-note",
]);

export const readingAppliedMutationSchema = z.object({
  operation: readingOperationSchema,
  ownerId: idSchema,
  ownerRevision: nonnegativeSafeIntegerSchema,
  businessDate: nullableTimestampSchema,
}).strict();
export type ReadingAppliedMutation = z.infer<typeof readingAppliedMutationSchema>;

export const readingResultSchema = z.object({
  snapshot: readingSnapshotSchema,
  applied: readingAppliedMutationSchema,
}).strict();
export type ReadingResult = z.infer<typeof readingResultSchema>;

const dailyReadingOperationSchema = z.enum([
  "save-reading-session",
  "archive-reading-session",
]);

export const dailyReadingAppliedMutationSchema = z.object({
  operation: dailyReadingOperationSchema,
  ownerId: idSchema,
  ownerRevision: positiveSafeIntegerSchema,
  bookRevision: positiveSafeIntegerSchema,
  businessDate: businessDateSchema,
}).strict();
export type DailyReadingAppliedMutation = z.infer<
  typeof dailyReadingAppliedMutationSchema
>;

export const dailyReadingResultSchema = z.object({
  snapshot: dailyReadingSnapshotSchema,
  applied: dailyReadingAppliedMutationSchema,
}).strict();
export type DailyReadingResult = z.infer<typeof dailyReadingResultSchema>;

export const dailyReadingSnapshotResponseSchema = z.object({
  snapshot: dailyReadingSnapshotSchema,
}).strict();
export type DailyReadingSnapshotResponse = z.infer<
  typeof dailyReadingSnapshotResponseSchema
>;

export const dailyReadingMutationResponseSchema = z.object({
  result: dailyReadingResultSchema,
}).strict();
export type DailyReadingMutationResponse = z.infer<
  typeof dailyReadingMutationResponseSchema
>;

export const readingSnapshotResponseSchema = z.object({
  snapshot: readingSnapshotSchema,
}).strict();
export type ReadingSnapshotResponse = z.infer<typeof readingSnapshotResponseSchema>;

export const readingMutationResponseSchema = z.object({
  result: readingResultSchema,
}).strict();
export type ReadingMutationResponse = z.infer<typeof readingMutationResponseSchema>;

export class ReadingValidationError extends Error {
  constructor(message = "Invalid reading command.") {
    super(message);
    this.name = "ReadingValidationError";
  }
}

export function parseReadingCommand(value: unknown): ReadingCommand {
  const parsed = readingCommandSchema.safeParse(value);
  if (!parsed.success) throw new ReadingValidationError();
  return parsed.data;
}

export function parseDailyReadingCommand(value: unknown): DailyReadingCommand {
  const parsed = dailyReadingCommandSchema.safeParse(value);
  if (!parsed.success) throw new ReadingValidationError();
  return parsed.data;
}
