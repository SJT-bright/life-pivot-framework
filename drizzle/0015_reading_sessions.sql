CREATE TABLE reading_sessions (
  session_id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(session_id)) BETWEEN 1 AND 128),
  book_id TEXT NOT NULL REFERENCES reading_books(book_id) ON DELETE RESTRICT,
  business_date TEXT NOT NULL CHECK (
    length(business_date) = 10 AND
    strftime('%Y-%m-%d', business_date) IS business_date
  ),
  start_page INTEGER NOT NULL CHECK (start_page BETWEEN 0 AND 100000),
  end_page INTEGER NOT NULL CHECK (end_page BETWEEN start_page AND 100000),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 1440),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 5000),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE INDEX reading_sessions_date_created_idx
  ON reading_sessions (business_date DESC, created_at DESC, session_id)
  WHERE archived_at IS NULL;
CREATE INDEX reading_sessions_book_date_idx
  ON reading_sessions (book_id, business_date DESC, created_at DESC, session_id)
  WHERE archived_at IS NULL;

CREATE TRIGGER reading_sessions_reject_delete
BEFORE DELETE ON reading_sessions
BEGIN
  SELECT RAISE(ABORT, 'reading sessions require archive status; physical delete is forbidden');
END;

UPDATE app_meta SET value = '16' WHERE key = 'schema_version';
