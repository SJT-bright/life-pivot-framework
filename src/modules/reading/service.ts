import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import {
  type IdempotentCommandOptions,
  runIdempotentCommand,
} from "@/core/db/idempotent-command";
import { toShanghaiBusinessDate } from "@/core/time/business-date";

import {
  type DailyReadingAppliedMutation,
  type DailyReadingCommand,
  type DailyReadingResult,
  type ReadingAppliedMutation,
  type ReadingBook,
  type ReadingCommand,
  type ReadingResult,
  ReadingValidationError,
  parseDailyReadingCommand,
  parseReadingCommand,
} from "./contracts";
import {
  getDailyReadingSnapshot,
  getReadingBook,
  getReadingBookRow,
  getReadingNote,
  getReadingSessionRow,
  getReadingSnapshot,
} from "./query";

export class ReadingConflictError extends Error {
  constructor(message = "The reading command no longer matches current state.") {
    super(message);
    this.name = "ReadingConflictError";
  }
}

export interface ReadingServiceDependencies {
  sqlite: Database.Database;
  now?: () => Date;
  createId?: () => string;
  writeBarrier?: IdempotentCommandOptions["writeBarrier"];
}

export interface ReadingService {
  execute(command: ReadingCommand, idempotencyKey: string): Promise<ReadingResult>;
}

export interface DailyReadingService {
  execute(
    command: DailyReadingCommand,
    idempotencyKey: string,
  ): Promise<DailyReadingResult>;
}

function conflict(message: string): never {
  throw new ReadingConflictError(message);
}

function increment(revision: number, resource: string): number {
  if (!Number.isSafeInteger(revision) || revision < 1 || revision >= Number.MAX_SAFE_INTEGER) {
    conflict(`${resource} revision cannot be incremented safely.`);
  }
  return revision + 1;
}

function getBook(sqlite: Database.Database, bookId: string) {
  return getReadingBookRow(sqlite, bookId);
}

function insertAudit(
  sqlite: Database.Database,
  eventType: string,
  resourceType: string,
  resourceId: string,
  payload: unknown,
  occurredAt: string,
): void {
  sqlite.prepare(`insert into audit_events
    (id, event_type, resource_type, resource_id, payload_json, occurred_at)
    values (?, ?, ?, ?, ?, ?)`).run(
      randomUUID(),
      eventType,
      resourceType,
      resourceId,
      JSON.stringify(payload),
      occurredAt,
    );
}

function applySaveBook(
  sqlite: Database.Database,
  command: Extract<ReadingCommand, { type: "save-book" }>,
  timestamp: string,
): ReadingAppliedMutation {
  const current = getBook(sqlite, command.bookId);
  if (!current) {
    if (command.expectedRevision !== 0) conflict("A new book requires revision zero.");
    sqlite.prepare(`insert into reading_books
      (book_id, title, author, status, total_pages, current_page, rating,
       revision, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(
        command.bookId,
        command.title,
        command.author,
        command.status,
        command.totalPages,
        command.currentPage,
        command.rating,
        timestamp,
        timestamp,
      );
    insertAudit(sqlite, "created", "reading_book", command.bookId, { title: command.title }, timestamp);
    return { operation: command.type, ownerId: command.bookId, ownerRevision: 1, businessDate: null };
  }

  if (current.revision !== command.expectedRevision) {
    conflict("The book revision is stale.");
  }
  const revision = increment(current.revision, "Book");
  const updated = sqlite.prepare(`update reading_books
    set title = ?, author = ?, status = ?, total_pages = ?, current_page = ?,
        rating = ?, revision = ?, updated_at = ?
    where book_id = ? and revision = ? and archived_at is null`).run(
      command.title,
      command.author,
      command.status,
      command.totalPages,
      command.currentPage,
      command.rating,
      revision,
      timestamp,
      command.bookId,
      current.revision,
    );
  if (updated.changes !== 1) conflict("The book revision is stale.");
  return { operation: command.type, ownerId: command.bookId, ownerRevision: revision, businessDate: null };
}

function applyArchiveBook(
  sqlite: Database.Database,
  command: Extract<ReadingCommand, { type: "archive-book" }>,
  timestamp: string,
): ReadingAppliedMutation {
  const current = getBook(sqlite, command.bookId);
  if (!current || current.revision !== command.expectedRevision) {
    conflict("The book revision is stale or unavailable.");
  }
  const revision = increment(current.revision, "Book");
  const updated = sqlite.prepare(`update reading_books
    set revision = ?, updated_at = ?, archived_at = ?
    where book_id = ? and revision = ? and archived_at is null`).run(
      revision,
      timestamp,
      timestamp,
      command.bookId,
      current.revision,
    );
  if (updated.changes !== 1) conflict("The book revision is stale.");
  return { operation: command.type, ownerId: command.bookId, ownerRevision: revision, businessDate: null };
}

function assertActiveBook(sqlite: Database.Database, bookId: string) {
  const book = getBook(sqlite, bookId);
  if (!book || book.archived_at !== null) conflict("The book does not exist.");
  return book;
}

function applySaveNote(
  sqlite: Database.Database,
  command: Extract<ReadingCommand, { type: "save-reading-note" }>,
  timestamp: string,
): ReadingAppliedMutation {
  const book = assertActiveBook(sqlite, command.bookId);
  void book;
  const current = getReadingNote(sqlite, command.noteId);
  if (!current) {
    if (command.expectedRevision !== 0) conflict("A new reading note requires revision zero.");
    sqlite.prepare(`insert into reading_notes
      (note_id, book_id, title, content, revision, created_at, updated_at)
      values (?, ?, ?, ?, 1, ?, ?)`).run(
        command.noteId,
        command.bookId,
        command.title,
        command.content,
        timestamp,
        timestamp,
      );
    insertAudit(sqlite, "created", "reading_note", command.noteId, { bookId: command.bookId }, timestamp);
    return { operation: command.type, ownerId: command.noteId, ownerRevision: 1, businessDate: null };
  }

  if (
    current.book_id !== command.bookId ||
    current.revision !== command.expectedRevision
  ) {
    conflict("The reading note revision or book is stale.");
  }
  const revision = increment(current.revision, "Reading note");
  const updated = sqlite.prepare(`update reading_notes
    set title = ?, content = ?, revision = ?, updated_at = ?
    where note_id = ? and revision = ? and archived_at is null`).run(
      command.title,
      command.content,
      revision,
      timestamp,
      command.noteId,
      current.revision,
    );
  if (updated.changes !== 1) conflict("The reading note revision is stale.");
  return { operation: command.type, ownerId: command.noteId, ownerRevision: revision, businessDate: null };
}

function applyArchiveNote(
  sqlite: Database.Database,
  command: Extract<ReadingCommand, { type: "archive-reading-note" }>,
  timestamp: string,
): ReadingAppliedMutation {
  const current = getReadingNote(sqlite, command.noteId);
  if (!current || current.revision !== command.expectedRevision) {
    conflict("The reading note revision is stale or unavailable.");
  }
  const revision = increment(current.revision, "Reading note");
  const updated = sqlite.prepare(`update reading_notes
    set revision = ?, updated_at = ?, archived_at = ?
    where note_id = ? and revision = ? and archived_at is null`).run(
      revision,
      timestamp,
      timestamp,
      command.noteId,
      current.revision,
    );
  if (updated.changes !== 1) conflict("The reading note revision is stale.");
  return { operation: command.type, ownerId: command.noteId, ownerRevision: revision, businessDate: null };
}

function applyCommand(
  sqlite: Database.Database,
  command: ReadingCommand,
  timestamp: string,
): ReadingAppliedMutation {
  switch (command.type) {
    case "save-book":
      return applySaveBook(sqlite, command, timestamp);
    case "archive-book":
      return applyArchiveBook(sqlite, command, timestamp);
    case "save-reading-note":
      return applySaveNote(sqlite, command, timestamp);
    case "archive-reading-note":
      return applyArchiveNote(sqlite, command, timestamp);
  }
}

function assertDailyBook(
  sqlite: Database.Database,
  command: DailyReadingCommand,
) {
  const book = assertActiveBook(sqlite, command.bookId);
  if (book.revision !== command.expectedBookRevision) {
    conflict("The book revision is stale.");
  }
  if (
    command.type === "save-reading-session" &&
    book.total_pages !== null &&
    command.endPage > book.total_pages
  ) {
    throw new ReadingValidationError("Reading pages exceed the book total.");
  }
  return book;
}

function advanceBookFromSession(
  sqlite: Database.Database,
  book: ReturnType<typeof assertDailyBook>,
  endPage: number,
  timestamp: string,
): number {
  const nextPage = Math.max(book.current_page, endPage);
  const nextStatus = book.total_pages !== null && nextPage >= book.total_pages
    ? "finished"
    : book.status === "wishlist"
      ? "reading"
      : book.status;
  if (nextPage === book.current_page && nextStatus === book.status) {
    return book.revision;
  }

  const revision = increment(book.revision, "Book");
  const updated = sqlite.prepare(`update reading_books
    set current_page = ?, status = ?, revision = ?, updated_at = ?
    where book_id = ? and revision = ? and archived_at is null`).run(
      nextPage,
      nextStatus,
      revision,
      timestamp,
      book.book_id,
      book.revision,
    );
  if (updated.changes !== 1) conflict("The book revision is stale.");
  return revision;
}

function applySaveSession(
  sqlite: Database.Database,
  command: Extract<DailyReadingCommand, { type: "save-reading-session" }>,
  timestamp: string,
): DailyReadingAppliedMutation {
  const book = assertDailyBook(sqlite, command);
  const current = getReadingSessionRow(sqlite, command.sessionId);
  let revision: number;

  if (!current) {
    if (command.expectedRevision !== 0) {
      conflict("A new reading session requires revision zero.");
    }
    sqlite.prepare(`insert into reading_sessions
      (session_id, book_id, business_date, start_page, end_page,
       duration_minutes, note, revision, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(
        command.sessionId,
        command.bookId,
        command.businessDate,
        command.startPage,
        command.endPage,
        command.durationMinutes,
        command.note,
        timestamp,
        timestamp,
      );
    revision = 1;
    insertAudit(
      sqlite,
      "created",
      "reading_session",
      command.sessionId,
      { bookId: command.bookId, businessDate: command.businessDate },
      timestamp,
    );
  } else {
    if (
      current.archived_at !== null ||
      current.book_id !== command.bookId ||
      current.revision !== command.expectedRevision
    ) {
      conflict("The reading session revision or book is stale.");
    }
    revision = increment(current.revision, "Reading session");
    const updated = sqlite.prepare(`update reading_sessions
      set business_date = ?, start_page = ?, end_page = ?, duration_minutes = ?,
          note = ?, revision = ?, updated_at = ?
      where session_id = ? and revision = ? and archived_at is null`).run(
        command.businessDate,
        command.startPage,
        command.endPage,
        command.durationMinutes,
        command.note,
        revision,
        timestamp,
        command.sessionId,
        current.revision,
      );
    if (updated.changes !== 1) conflict("The reading session revision is stale.");
  }

  const bookRevision = advanceBookFromSession(
    sqlite,
    book,
    command.endPage,
    timestamp,
  );
  return {
    operation: command.type,
    ownerId: command.sessionId,
    ownerRevision: revision,
    bookRevision,
    businessDate: command.businessDate,
  };
}

function applyArchiveSession(
  sqlite: Database.Database,
  command: Extract<DailyReadingCommand, { type: "archive-reading-session" }>,
  timestamp: string,
): DailyReadingAppliedMutation {
  const book = assertDailyBook(sqlite, command);
  const current = getReadingSessionRow(sqlite, command.sessionId);
  if (
    !current ||
    current.archived_at !== null ||
    current.book_id !== command.bookId ||
    current.business_date !== command.businessDate ||
    current.revision !== command.expectedRevision
  ) {
    conflict("The reading session revision or book is stale.");
  }
  const revision = increment(current.revision, "Reading session");
  const updated = sqlite.prepare(`update reading_sessions
    set revision = ?, updated_at = ?, archived_at = ?
    where session_id = ? and revision = ? and archived_at is null`).run(
      revision,
      timestamp,
      timestamp,
      command.sessionId,
      current.revision,
    );
  if (updated.changes !== 1) conflict("The reading session revision is stale.");
  return {
    operation: command.type,
    ownerId: command.sessionId,
    ownerRevision: revision,
    bookRevision: book.revision,
    businessDate: command.businessDate,
  };
}

function applyDailyCommand(
  sqlite: Database.Database,
  command: DailyReadingCommand,
  timestamp: string,
): DailyReadingAppliedMutation {
  switch (command.type) {
    case "save-reading-session":
      return applySaveSession(sqlite, command, timestamp);
    case "archive-reading-session":
      return applyArchiveSession(sqlite, command, timestamp);
  }
}

export function createReadingService(
  dependencies: ReadingServiceDependencies,
): ReadingService {
  const now = dependencies.now ?? (() => new Date());
  return {
    async execute(command, idempotencyKey) {
      const parsed = parseReadingCommand(command);
      let transactionNow: Date | undefined;
      const stableNow = () => {
        transactionNow ??= now();
        return transactionNow;
      };
      return runIdempotentCommand(
        dependencies.sqlite,
        {
          operation: "reading.command",
          idempotencyKey,
          now: stableNow,
          writeBarrier: dependencies.writeBarrier,
        },
        parsed,
        () => {
          const applied = applyCommand(dependencies.sqlite, parsed, stableNow().toISOString());
          return {
            snapshot: getReadingSnapshot(dependencies.sqlite),
            applied,
          };
        },
      );
    },
  };
}

export function createDailyReadingService(
  dependencies: ReadingServiceDependencies,
): DailyReadingService {
  const now = dependencies.now ?? (() => new Date());
  return {
    async execute(command, idempotencyKey) {
      const parsed = parseDailyReadingCommand(command);
      let transactionNow: Date | undefined;
      const stableNow = () => {
        transactionNow ??= now();
        return transactionNow;
      };
      if (parsed.businessDate > toShanghaiBusinessDate(stableNow())) {
        throw new ReadingValidationError("Future reading dates are not allowed.");
      }
      return runIdempotentCommand(
        dependencies.sqlite,
        {
          operation: "daily-reading.command",
          idempotencyKey,
          now: stableNow,
          writeBarrier: dependencies.writeBarrier,
        },
        parsed,
        () => {
          const applied = applyDailyCommand(
            dependencies.sqlite,
            parsed,
            stableNow().toISOString(),
          );
          return {
            snapshot: getDailyReadingSnapshot(dependencies.sqlite, {
              businessDate: parsed.businessDate,
            }),
            applied,
          };
        },
      );
    },
  };
}

export function getReadingBookForPdf(
  sqlite: Database.Database,
  bookId: string,
): ReadingBook | null {
  return getReadingBook(sqlite, bookId);
}
