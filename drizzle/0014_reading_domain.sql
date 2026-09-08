CREATE TABLE reading_books (
  book_id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(book_id)) BETWEEN 1 AND 128),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  author TEXT NOT NULL DEFAULT '' CHECK (length(author) <= 120),
  status TEXT NOT NULL CHECK (status IN ('wishlist', 'reading', 'finished')),
  total_pages INTEGER CHECK (total_pages IS NULL OR total_pages BETWEEN 1 AND 100000),
  current_page INTEGER NOT NULL DEFAULT 0 CHECK (current_page >= 0),
  rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  pdf_storage_key TEXT CHECK (pdf_storage_key IS NULL OR length(pdf_storage_key) BETWEEN 1 AND 512),
  pdf_original_name TEXT NOT NULL DEFAULT '' CHECK (length(pdf_original_name) <= 255),
  pdf_size_bytes INTEGER CHECK (pdf_size_bytes IS NULL OR pdf_size_bytes BETWEEN 1 AND 1073741824),
  pdf_added_at TEXT CHECK (pdf_added_at IS NULL OR (length(pdf_added_at) <= 64 AND pdf_added_at GLOB '*T*Z')),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE reading_notes (
  note_id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(note_id)) BETWEEN 1 AND 128),
  book_id TEXT NOT NULL REFERENCES reading_books(book_id) ON DELETE RESTRICT,
  title TEXT NOT NULL DEFAULT '' CHECK (length(title) <= 160),
  content TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 20000),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE INDEX reading_books_status_updated_idx
  ON reading_books (status, updated_at DESC, book_id)
  WHERE archived_at IS NULL;
CREATE INDEX reading_books_created_idx
  ON reading_books (created_at DESC, book_id);
CREATE INDEX reading_notes_book_updated_idx
  ON reading_notes (book_id, updated_at DESC, note_id)
  WHERE archived_at IS NULL;
CREATE INDEX reading_notes_created_idx
  ON reading_notes (created_at DESC, note_id);

CREATE TRIGGER reading_books_reject_delete
BEFORE DELETE ON reading_books
BEGIN
  SELECT RAISE(ABORT, 'reading books require archive status; physical delete is forbidden');
END;

CREATE TRIGGER reading_notes_reject_delete
BEFORE DELETE ON reading_notes
BEGIN
  SELECT RAISE(ABORT, 'reading notes require archive status; physical delete is forbidden');
END;

UPDATE app_meta SET value = '15' WHERE key = 'schema_version';
