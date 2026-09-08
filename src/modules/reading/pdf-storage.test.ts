import { describe, expect, it } from "vitest";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

import { migrateDatabase } from "@/core/db/migrate";

import {
  ReadingPdfError,
  attachPdfToBook,
  deletePdfFile,
  parsePdfUpload,
  readPdfFile,
  resolvePdfPath,
  storageKeyFor,
  writePdfFile,
} from "./pdf-storage";

function tempEnv(): { env: NodeJS.ProcessEnv; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reading-pdf-test-"));
  return { env: { ...process.env, LIFE_OS_DATA_ROOT: root }, root };
}

function pdfBytes(text = "%PDF-1.4 fake content"): Uint8Array {
  return new TextEncoder().encode(text);
}

function blobPart(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function createPdfFile(env: NodeJS.ProcessEnv, bookId: string, bytes: Uint8Array): string {
  const written = writePdfFile(env, bookId, bytes);
  return written.storageKey;
}

describe("pdf storage", () => {
  it("writes a PDF under the book segment and reads it back", () => {
    const { env, root } = tempEnv();
    try {
      const bytes = pdfBytes();
      const storageKey = createPdfFile(env, "book-pdf-0001", bytes);
      expect(storageKey).toMatch(/^reading\/book-pdf-0001\/[a-f0-9-]+\.pdf$/);

      const file = readPdfFile(env, storageKey);
      expect(file.mimeType).toBe("application/pdf");
      expect(file.bytes.toString("ascii").startsWith("%PDF-")).toBe(true);

      const resolved = resolvePdfPath(env, storageKey);
      expect(fs.existsSync(resolved)).toBe(true);

      deletePdfFile(env, storageKey);
      expect(fs.existsSync(resolved)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects unsafe book ids and unknown storage keys", () => {
    const { env, root } = tempEnv();
    try {
      for (const bookId of ["", "..", "a/b", "a\\b", "x".repeat(129), ".hidden"]) {
        expect(() => writePdfFile(env, bookId, pdfBytes())).toThrow();
      }
      expect(() => readPdfFile(env, "reading/unknown-../pdf")).toThrow();
      expect(() => readPdfFile(env, "reading/missing-book/missing.pdf")).toThrow(
        ReadingPdfError,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects corrupt PDF content on read", () => {
    const { env, root } = tempEnv();
    try {
      const storageKey = createPdfFile(env, "book-corrupt-0001", new TextEncoder().encode("not a pdf at all"));
      expect(() => readPdfFile(env, storageKey)).toThrow(/损坏|invalid/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("parses a multipart upload with a valid PDF file and rejects invalid ones", async () => {
    const valid = new FormData();
    valid.append("file", new File([blobPart(pdfBytes())], "book.pdf", { type: "application/pdf" }));
    const parsed = await parsePdfUpload(valid);
    expect(parsed.originalName).toBe("book.pdf");
    expect(parsed.bytes.length).toBeGreaterThan(0);

    const missing = new FormData();
    await expect(parsePdfUpload(missing)).rejects.toThrow(/缺少 PDF/i);

    const wrongName = new FormData();
    wrongName.append("file", new File([blobPart(pdfBytes())], "book.txt", { type: "text/plain" }));
    await expect(parsePdfUpload(wrongName)).rejects.toThrow(/PDF/i);

    const notPdf = new FormData();
    notPdf.append(
      "file",
      new File([blobPart(new TextEncoder().encode("hello"))], "book.pdf", { type: "application/pdf" }),
    );
    await expect(parsePdfUpload(notPdf)).rejects.toThrow(/有效的 PDF/i);
  });

  it("attaches a PDF record to a book row and clears it", () => {
    const sqlite = new Database(":memory:");
    migrateDatabase(sqlite);
    const timestamp = "2026-08-14T08:00:00.000Z";
    sqlite.prepare(`insert into reading_books
      (book_id, title, author, status, current_page, revision, created_at, updated_at)
      values (?, ?, '', 'wishlist', 0, 1, ?, ?)`).run(
        "book-attach-0001", "附带书", timestamp, timestamp,
      );

    attachPdfToBook(sqlite, "book-attach-0001", {
      storageKey: "reading/book-attach-0001/abc.pdf",
      originalName: "book.pdf",
      sizeBytes: 100,
      addedAt: timestamp,
    }, timestamp);

    const row = sqlite.prepare("select pdf_storage_key, pdf_original_name, pdf_size_bytes from reading_books where book_id = ?")
      .get("book-attach-0001") as Record<string, unknown>;
    expect(row).toMatchObject({
      pdf_storage_key: "reading/book-attach-0001/abc.pdf",
      pdf_original_name: "book.pdf",
      pdf_size_bytes: 100,
    });

    sqlite.prepare(`update reading_books
      set pdf_storage_key = null, pdf_original_name = '', pdf_size_bytes = null,
          pdf_added_at = null, updated_at = ?
      where book_id = ?`).run(timestamp, "book-attach-0001");
    const cleared = sqlite.prepare("select pdf_storage_key from reading_books where book_id = ?")
      .pluck().get("book-attach-0001");
    expect(cleared).toBeNull();
    sqlite.close();
  });

  it("storageKeyFor keeps book id and file id in safe segments", () => {
    expect(storageKeyFor("book-1", "file-1")).toBe("reading/book-1/file-1.pdf");
  });
});
