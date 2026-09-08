import type Database from "better-sqlite3";

import {
  type DailyReadingBook,
  type DailyReadingSnapshot,
  type ReadingBook,
  type ReadingNote,
  type ReadingSession,
  type ReadingSnapshot,
} from "./contracts";

interface BookRow {
  book_id: string;
  title: string;
  author: string;
  status: ReadingBook["status"];
  total_pages: number | null;
  current_page: number;
  rating: number | null;
  pdf_storage_key: string | null;
  pdf_original_name: string;
  pdf_size_bytes: number | null;
  pdf_added_at: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

interface NoteRow {
  note_id: string;
  book_id: string;
  title: string;
  content: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

interface SessionRow {
  session_id: string;
  book_id: string;
  book_title: string;
  business_date: string;
  start_page: number;
  end_page: number;
  duration_minutes: number;
  note: string;
  revision: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

function bookFromRow(row: BookRow): ReadingBook {
  return {
    bookId: row.book_id,
    title: row.title,
    author: row.author,
    status: row.status,
    totalPages: row.total_pages,
    currentPage: row.current_page,
    rating: row.rating,
    pdf:
      row.pdf_storage_key === null ||
      row.pdf_size_bytes === null ||
      row.pdf_added_at === null
        ? null
        : {
            storageKey: row.pdf_storage_key,
            originalName: row.pdf_original_name,
            sizeBytes: row.pdf_size_bytes,
            addedAt: row.pdf_added_at,
          },
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function noteFromRow(row: NoteRow): ReadingNote {
  return {
    noteId: row.note_id,
    bookId: row.book_id,
    title: row.title,
    content: row.content,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function dailyBookFromRow(row: BookRow): DailyReadingBook {
  return {
    bookId: row.book_id,
    title: row.title,
    author: row.author,
    status: row.status,
    totalPages: row.total_pages,
    currentPage: row.current_page,
    revision: row.revision,
  };
}

function sessionFromRow(row: SessionRow): ReadingSession {
  return {
    sessionId: row.session_id,
    bookId: row.book_id,
    bookTitle: row.book_title,
    businessDate: row.business_date,
    startPage: row.start_page,
    endPage: row.end_page,
    pagesRead: row.end_page - row.start_page,
    durationMinutes: row.duration_minutes,
    note: row.note,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getReadingSnapshot(
  sqlite: Database.Database,
): ReadingSnapshot {
  const books = sqlite.prepare(`select book_id, title, author, status, total_pages,
      current_page, rating, pdf_storage_key, pdf_original_name, pdf_size_bytes,
      pdf_added_at, revision, created_at, updated_at, archived_at
    from reading_books
    where archived_at is null
    order by
      case status
        when 'reading' then 0
        when 'wishlist' then 1
        else 2
      end,
      updated_at desc,
      book_id`).all() as BookRow[];
  const notes = sqlite.prepare(`select note_id, book_id, title, content, revision,
      created_at, updated_at
    from reading_notes
    where archived_at is null
    order by updated_at desc, note_id`).all() as NoteRow[];

  return {
    books: books.map(bookFromRow),
    notes: notes.map(noteFromRow),
  };
}

export function getReadingBook(
  sqlite: Database.Database,
  bookId: string,
): ReadingBook | null {
  const row = sqlite.prepare(`select book_id, title, author, status, total_pages,
      current_page, rating, pdf_storage_key, pdf_original_name, pdf_size_bytes,
      pdf_added_at, revision, created_at, updated_at, archived_at
    from reading_books
    where book_id = ? and archived_at is null`).get(bookId) as BookRow | undefined;
  return row ? bookFromRow(row) : null;
}

export function getReadingBookRow(
  sqlite: Database.Database,
  bookId: string,
): BookRow | null {
  return sqlite.prepare(`select book_id, title, author, status, total_pages,
      current_page, rating, pdf_storage_key, pdf_original_name, pdf_size_bytes,
      pdf_added_at, revision, created_at, updated_at, archived_at
    from reading_books
    where book_id = ?`).get(bookId) as BookRow | null;
}

export function getReadingNote(
  sqlite: Database.Database,
  noteId: string,
): NoteRow | null {
  return sqlite.prepare(`select note_id, book_id, title, content, revision,
      created_at, updated_at
    from reading_notes
    where note_id = ?`).get(noteId) as NoteRow | null;
}

export interface DailyReadingSnapshotInput {
  businessDate: string;
}

export function getDailyReadingSnapshot(
  sqlite: Database.Database,
  input: DailyReadingSnapshotInput,
): DailyReadingSnapshot {
  const books = sqlite.prepare(`select book_id, title, author, status, total_pages,
      current_page, rating, pdf_storage_key, pdf_original_name, pdf_size_bytes,
      pdf_added_at, revision, created_at, updated_at, archived_at
    from reading_books
    where archived_at is null
    order by case status when 'reading' then 0 when 'wishlist' then 1 else 2 end,
      updated_at desc, book_id`).all() as BookRow[];
  const rows = sqlite.prepare(`select s.session_id, s.book_id, b.title as book_title,
      s.business_date, s.start_page, s.end_page, s.duration_minutes, s.note,
      s.revision, s.created_at, s.updated_at, s.archived_at
    from reading_sessions s
    join reading_books b on b.book_id = s.book_id
    where s.business_date = ? and s.archived_at is null
    order by s.created_at desc, s.session_id`).all(input.businessDate) as SessionRow[];
  const sessions = rows.map(sessionFromRow);

  return {
    businessDate: input.businessDate,
    books: books.map(dailyBookFromRow),
    sessions,
    totalPagesRead: sessions.reduce((total, session) => total + session.pagesRead, 0),
    totalMinutes: sessions.reduce((total, session) => total + session.durationMinutes, 0),
  };
}

export function getReadingSessionRow(
  sqlite: Database.Database,
  sessionId: string,
): SessionRow | null {
  return sqlite.prepare(`select s.session_id, s.book_id, b.title as book_title,
      s.business_date, s.start_page, s.end_page, s.duration_minutes, s.note,
      s.revision, s.created_at, s.updated_at, s.archived_at
    from reading_sessions s
    join reading_books b on b.book_id = s.book_id
    where s.session_id = ?`).get(sessionId) as SessionRow | null;
}
