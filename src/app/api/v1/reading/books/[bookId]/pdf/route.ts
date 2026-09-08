import { getApplicationDatabase } from "@/core/db/application-database";
import {
  ReadingPdfError,
  attachPdfToBook,
  deletePdfFile,
  parsePdfUpload,
  readPdfFile,
  writePdfFile,
} from "@/modules/reading/pdf-storage";
import { getReadingBookRow } from "@/modules/reading/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

interface PdfRouteContext {
  params: Promise<{ bookId: string }>;
}

function isLoopback(request: Request): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(request.url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function json(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function parseBookId(raw: string): string | null {
  if (!raw || raw.length > 128 || !/^[A-Za-z0-9._-]+$/.test(raw)) return null;
  return raw;
}

function inlinePdfDisposition(originalName: string | null): string {
  const displayName = (originalName?.trim() || "book.pdf").replace(/[\r\n]/g, "_");
  const encodedName = encodeURIComponent(displayName).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `inline; filename="book.pdf"; filename*=UTF-8''${encodedName}`;
}

export async function POST(
  request: Request,
  context: PdfRouteContext,
): Promise<Response> {
  if (!isLoopback(request)) return json({ message: "Local access only." }, 403);
  const { bookId } = await context.params;
  const safeBookId = parseBookId(bookId);
  if (!safeBookId) return json({ message: "Invalid book id." }, 400);

  try {
    const database = getApplicationDatabase();
    const book = getReadingBookRow(database.sqlite, safeBookId);
    if (!book) return json({ message: "Book not found." }, 404);

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return json({ message: "Request content must be multipart form data." }, 400);
    }
    const parsed = await parsePdfUpload(formData);
    const written = writePdfFile(process.env, safeBookId, parsed.bytes);
    const timestamp = new Date().toISOString();
    try {
      attachPdfToBook(database.sqlite, safeBookId, {
        storageKey: written.storageKey,
        originalName: parsed.originalName,
        sizeBytes: written.sizeBytes,
        addedAt: timestamp,
      }, timestamp);
    } catch (error) {
      deletePdfFile(process.env, written.storageKey);
      if (error instanceof ReadingPdfError) {
        return json({ message: error.message }, 404);
      }
      throw error;
    }
    return json({
      pdf: {
        storageKey: written.storageKey,
        originalName: parsed.originalName,
        sizeBytes: written.sizeBytes,
        addedAt: timestamp,
      },
    }, 200);
  } catch (error) {
    if (error instanceof ReadingPdfError) {
      return json({ message: error.message }, 400);
    }
    return json({ message: "Unable to process PDF upload." }, 500);
  }
}

export async function GET(
  request: Request,
  context: PdfRouteContext,
): Promise<Response> {
  if (!isLoopback(request)) return json({ message: "Local access only." }, 403);
  const { bookId } = await context.params;
  const safeBookId = parseBookId(bookId);
  if (!safeBookId) return json({ message: "Invalid book id." }, 400);

  try {
    const database = getApplicationDatabase();
    const book = getReadingBookRow(database.sqlite, safeBookId);
    if (!book) return json({ message: "Book not found." }, 404);
    if (!book.pdf_storage_key) return json({ message: "No PDF attached." }, 404);

    const file = readPdfFile(process.env, book.pdf_storage_key);
    const copy = new Uint8Array(file.bytes.byteLength);
    copy.set(file.bytes);
    const blob = new Blob([copy], {
      type: "application/pdf",
    });
    return new Response(blob, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": inlinePdfDisposition(book.pdf_original_name),
        "cache-control": "no-store",
        "content-length": String(file.bytes.length),
      },
    });
  } catch (error) {
    if (error instanceof ReadingPdfError) {
      return json({ message: error.message }, 404);
    }
    return json({ message: "Unable to load PDF." }, 500);
  }
}

export async function DELETE(
  request: Request,
  context: PdfRouteContext,
): Promise<Response> {
  if (!isLoopback(request)) return json({ message: "Local access only." }, 403);
  const { bookId } = await context.params;
  const safeBookId = parseBookId(bookId);
  if (!safeBookId) return json({ message: "Invalid book id." }, 400);

  try {
    const database = getApplicationDatabase();
    const book = getReadingBookRow(database.sqlite, safeBookId);
    if (!book) return json({ message: "Book not found." }, 404);
    if (!book.pdf_storage_key) return json({ message: "No PDF attached." }, 404);

    const storageKey = book.pdf_storage_key;
    const timestamp = new Date().toISOString();
    database.sqlite.prepare(`update reading_books
      set pdf_storage_key = null, pdf_original_name = '', pdf_size_bytes = null,
          pdf_added_at = null, updated_at = ?
      where book_id = ? and archived_at is null`).run(timestamp, safeBookId);
    deletePdfFile(process.env, storageKey);
    return json({ message: "PDF removed." }, 200);
  } catch {
    return json({ message: "Unable to remove PDF." }, 500);
  }
}

export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      allow: "GET, HEAD, OPTIONS, POST, DELETE",
      "cache-control": "no-store",
    },
  });
}

export function PUT(): Response {
  return json({ message: "Method not allowed." }, 405);
}

export function PATCH(): Response {
  return json({ message: "Method not allowed." }, 405);
}
