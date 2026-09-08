import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type Database from "better-sqlite3";

import { resolveAppPaths, resolveStorageKey } from "@/core/config/app-paths";

const MAX_PDF_BYTES = 100 * 1024 * 1024; // 100 MB
const PDF_MAGIC = "%PDF-";
const STORAGE_PREFIX = "reading";

export class ReadingPdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadingPdfError";
  }
}

export interface ReadingPdfRecord {
  storageKey: string;
  originalName: string;
  sizeBytes: number;
  addedAt: string;
}

function safeStorageSegment(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value) && !value.startsWith(".") && !value.endsWith(".");
}

export function storageKeyFor(bookId: string, fileId: string): string {
  return `${STORAGE_PREFIX}/${bookId}/${fileId}.pdf`;
}

export function resolvePdfPath(environment: NodeJS.ProcessEnv, storageKey: string): string {
  const paths = resolveAppPaths(environment);
  return resolveStorageKey(paths.dataRoot, storageKey);
}

export function assertSafeBookId(bookId: string): void {
  if (!bookId || bookId.length > 128 || !safeStorageSegment(bookId)) {
    throw new ReadingPdfError("非法书籍标识");
  }
}

export interface ParsedPdfFile {
  bytes: Uint8Array;
  originalName: string;
}

export async function parsePdfUpload(value: FormData): Promise<ParsedPdfFile> {
  const file = value.get("file");
  if (!(file instanceof File)) {
    throw new ReadingPdfError("缺少 PDF 文件");
  }
  if (file.size < 4) {
    throw new ReadingPdfError("PDF 文件为空或过小");
  }
  if (file.size > MAX_PDF_BYTES) {
    throw new ReadingPdfError("PDF 文件超过 100 MB 限制");
  }
  const name = file.name.trim();
  if (!name || name.length > 255 || path.basename(name) !== name) {
    throw new ReadingPdfError("非法文件名");
  }
  if (!/\.pdf$/i.test(name)) {
    throw new ReadingPdfError("只接受 PDF 文件");
  }
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const head = new TextDecoder("ascii").decode(bytes.subarray(0, Math.min(16, bytes.length)));
  if (!head.startsWith(PDF_MAGIC)) {
    throw new ReadingPdfError("文件内容不是有效的 PDF");
  }
  return { bytes, originalName: name };
}

export function writePdfFile(
  environment: NodeJS.ProcessEnv,
  bookId: string,
  bytes: Uint8Array,
): { storageKey: string; sizeBytes: number } {
  assertSafeBookId(bookId);
  const fileId = randomUUID();
  const storageKey = storageKeyFor(bookId, fileId);
  const filePath = resolvePdfPath(environment, storageKey);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(bytes));
  return { storageKey, sizeBytes: bytes.length };
}

export function deletePdfFile(
  environment: NodeJS.ProcessEnv,
  storageKey: string,
): void {
  const filePath = resolvePdfPath(environment, storageKey);
  fs.rmSync(filePath, { force: true });
}

export function readPdfFile(
  environment: NodeJS.ProcessEnv,
  storageKey: string,
): { bytes: Buffer; mimeType: string } {
  const filePath = resolvePdfPath(environment, storageKey);
  if (!fs.existsSync(filePath)) {
    throw new ReadingPdfError("PDF 文件不存在");
  }
  const bytes = fs.readFileSync(filePath);
  if (bytes.length < PDF_MAGIC.length || !bytes.subarray(0, PDF_MAGIC.length).toString("ascii").startsWith(PDF_MAGIC)) {
    throw new ReadingPdfError("PDF 文件内容损坏");
  }
  return { bytes, mimeType: "application/pdf" };
}

export function attachPdfToBook(
  sqlite: Database.Database,
  bookId: string,
  record: ReadingPdfRecord,
  timestamp: string,
): void {
  const result = sqlite.prepare(`update reading_books
    set pdf_storage_key = ?, pdf_original_name = ?, pdf_size_bytes = ?,
        pdf_added_at = ?, updated_at = ?
    where book_id = ? and archived_at is null`).run(
      record.storageKey,
      record.originalName,
      record.sizeBytes,
      record.addedAt,
      timestamp,
      bookId,
    );
  if (result.changes !== 1) throw new ReadingPdfError("书籍不存在或已归档");
}

export function clearPdfFromBook(
  sqlite: Database.Database,
  bookId: string,
  timestamp: string,
): void {
  sqlite.prepare(`update reading_books
    set pdf_storage_key = null, pdf_original_name = '', pdf_size_bytes = null,
        pdf_added_at = null, updated_at = ?
    where book_id = ? and archived_at is null`).run(timestamp, bookId);
}
