import { describe, expect, it, vi } from "vitest";

import type {
  DailyReadingCommand,
  DailyReadingResult,
  DailyReadingSnapshot,
} from "./contracts";
import { handleDailyReadingRequest } from "./daily-request-handler";

const snapshot: DailyReadingSnapshot = {
  businessDate: "2026-08-14",
  books: [],
  sessions: [],
  totalPagesRead: 0,
  totalMinutes: 0,
};
const command: DailyReadingCommand = {
  type: "save-reading-session",
  sessionId: "session-http-0001",
  bookId: "book-http-0001",
  businessDate: "2026-08-14",
  startPage: 10,
  endPage: 25,
  durationMinutes: 30,
  note: "",
  expectedRevision: 0,
  expectedBookRevision: 1,
};
const result: DailyReadingResult = {
  snapshot,
  applied: {
    operation: "save-reading-session",
    ownerId: "session-http-0001",
    ownerRevision: 1,
    bookRevision: 2,
    businessDate: "2026-08-14",
  },
};

describe("daily reading request handler", () => {
  it("reads one strict business date with no-store isolation", async () => {
    const getSnapshot = vi.fn(() => snapshot);
    const response = await handleDailyReadingRequest(
      new Request("http://127.0.0.1:3000/api/v1/daily-reading?date=2026-08-14"),
      { getSnapshot, execute: vi.fn() },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ snapshot });
    expect(getSnapshot).toHaveBeenCalledWith("2026-08-14");

    const invalid = await handleDailyReadingRequest(
      new Request("http://127.0.0.1:3000/api/v1/daily-reading?date=2026-02-30"),
      { getSnapshot: vi.fn(), execute: vi.fn() },
    );
    expect(invalid.status).toBe(400);
  });

  it("executes a strict local session command and rejects unknown fields", async () => {
    const execute = vi.fn(async () => result);
    const request = (body: unknown) => new Request(
      "http://127.0.0.1:3000/api/v1/daily-reading",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "daily-reading-http-0001",
          origin: "http://127.0.0.1:3000",
          host: "127.0.0.1:3000",
        },
        body: JSON.stringify(body),
      },
    );
    const response = await handleDailyReadingRequest(request(command), {
      getSnapshot: vi.fn(),
      execute,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result });
    expect(execute).toHaveBeenCalledWith(command, "daily-reading-http-0001");

    const invalid = await handleDailyReadingRequest(
      request({ ...command, unexpected: true }),
      { getSnapshot: vi.fn(), execute: vi.fn() },
    );
    expect(invalid.status).toBe(422);
  });
});
