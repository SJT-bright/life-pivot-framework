import { afterEach, describe, expect, it, vi } from "vitest";

const getReadingBookRow = vi.fn();
const readPdfFile = vi.fn();

async function loadRoute() {
  vi.resetModules();
  vi.doMock("@/core/db/application-database", () => ({
    getApplicationDatabase: () => ({ sqlite: {} }),
  }));
  vi.doMock("@/modules/reading/query", () => ({ getReadingBookRow }));
  vi.doMock("@/modules/reading/pdf-storage", () => ({
    ReadingPdfError: class ReadingPdfError extends Error {},
    attachPdfToBook: vi.fn(),
    deletePdfFile: vi.fn(),
    parsePdfUpload: vi.fn(),
    readPdfFile,
    writePdfFile: vi.fn(),
  }));
  return import("./route");
}

afterEach(() => {
  getReadingBookRow.mockReset();
  readPdfFile.mockReset();
  vi.doUnmock("@/core/db/application-database");
  vi.doUnmock("@/modules/reading/query");
  vi.doUnmock("@/modules/reading/pdf-storage");
  vi.resetModules();
});

describe("reading PDF route", () => {
  it("serves PDFs with Chinese filenames through an ASCII-safe response header", async () => {
    getReadingBookRow.mockReturnValue({
      pdf_storage_key: "reading/book-1/file.pdf",
      pdf_original_name: "马斯克原理 (埃里克乔根森).pdf",
    });
    readPdfFile.mockReturnValue({
      bytes: Buffer.from("%PDF-1.7 test"),
      mimeType: "application/pdf",
    });
    const route = await loadRoute();

    const response = await route.GET(
      new Request("http://127.0.0.1/api/v1/reading/books/book-1/pdf"),
      { params: Promise.resolve({ bookId: "book-1" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("filename*=UTF-8''");
    expect(new TextDecoder().decode(await response.arrayBuffer())).toBe("%PDF-1.7 test");
  });
});
