import { describe, expect, it } from "vitest";

import Database from "better-sqlite3";

import { migrateDatabase } from "@/core/db/migrate";

import type { DailyReadingCommand, ReadingCommand } from "./contracts";
import { getDailyReadingSnapshot, getReadingSnapshot } from "./query";
import { createDailyReadingService, createReadingService } from "./service";

function createDatabase(): Database.Database {
  const sqlite = new Database(":memory:");
  migrateDatabase(sqlite);
  return sqlite;
}

const NOW = "2026-08-14T08:00:00.000Z";

function service(sqlite: Database.Database) {
  return createReadingService({ sqlite, now: () => new Date(NOW) });
}

async function execute(
  sqlite: Database.Database,
  command: ReadingCommand,
  idempotencyKey?: string,
) {
  return service(sqlite).execute(
    command,
    idempotencyKey ?? `reading-test-key-${command.type}-${command.expectedRevision}`,
  );
}

describe("reading service", () => {
  it("creates a wishlist book and reads it back in the snapshot", async () => {
    const sqlite = createDatabase();
    const result = await execute(sqlite, {
      type: "save-book",
      bookId: "book-service-0001",
      title: "服务测试书",
      author: "作者甲",
      status: "wishlist",
      totalPages: null,
      currentPage: 0,
      rating: null,
      expectedRevision: 0,
    });

    expect(result.applied).toEqual({
      operation: "save-book",
      ownerId: "book-service-0001",
      ownerRevision: 1,
      businessDate: null,
    });
    expect(result.snapshot.books).toHaveLength(1);
    expect(result.snapshot.books[0]).toMatchObject({
      bookId: "book-service-0001",
      title: "服务测试书",
      author: "作者甲",
      status: "wishlist",
      totalPages: null,
      currentPage: 0,
      rating: null,
      revision: 1,
    });
  });

  it("updates progress and status with a matching revision", async () => {
    const sqlite = createDatabase();
    await execute(sqlite, {
      type: "save-book",
      bookId: "book-progress-0001",
      title: "进度书",
      author: "",
      status: "wishlist",
      totalPages: 200,
      currentPage: 0,
      rating: null,
      expectedRevision: 0,
    });

    const updated = await execute(sqlite, {
      type: "save-book",
      bookId: "book-progress-0001",
      title: "进度书",
      author: "",
      status: "reading",
      totalPages: 200,
      currentPage: 50,
      rating: null,
      expectedRevision: 1,
    });

    expect(updated.applied.ownerRevision).toBe(2);
    expect(updated.snapshot.books[0]).toMatchObject({
      status: "reading",
      currentPage: 50,
      totalPages: 200,
      revision: 2,
    });
  });

  it("rejects a stale book revision with a conflict", async () => {
    const sqlite = createDatabase();
    await execute(sqlite, {
      type: "save-book",
      bookId: "book-stale-0001",
      title: "过期书",
      author: "",
      status: "wishlist",
      totalPages: null,
      currentPage: 0,
      rating: null,
      expectedRevision: 0,
    });

    await expect(execute(sqlite, {
      type: "save-book",
      bookId: "book-stale-0001",
      title: "过期书",
      author: "",
      status: "reading",
      totalPages: null,
      currentPage: 10,
      rating: null,
      expectedRevision: 1,
    })).resolves.toBeDefined();

    await expect(execute(sqlite, {
      type: "save-book",
      bookId: "book-stale-0001",
      title: "过期书",
      author: "",
      status: "reading",
      totalPages: null,
      currentPage: 20,
      rating: null,
      expectedRevision: 1,
    }, "reading-test-key-save-book-stale")).rejects.toThrow(/stale/i);
  });

  it("archives a book and removes it from the snapshot", async () => {
    const sqlite = createDatabase();
    await execute(sqlite, {
      type: "save-book",
      bookId: "book-archive-0001",
      title: "归档书",
      author: "",
      status: "wishlist",
      totalPages: null,
      currentPage: 0,
      rating: null,
      expectedRevision: 0,
    });

    const archived = await execute(sqlite, {
      type: "archive-book",
      bookId: "book-archive-0001",
      expectedRevision: 1,
    });
    expect(archived.applied.ownerRevision).toBe(2);
    expect(archived.snapshot.books).toHaveLength(0);
  });

  it("saves reading notes against a book and includes them in the snapshot", async () => {
    const sqlite = createDatabase();
    await execute(sqlite, {
      type: "save-book",
      bookId: "book-note-0001",
      title: "有读后感书",
      author: "",
      status: "finished",
      totalPages: 300,
      currentPage: 300,
      rating: 5,
      expectedRevision: 0,
    });

    const note = await execute(sqlite, {
      type: "save-reading-note",
      noteId: "note-service-0001",
      bookId: "book-note-0001",
      title: "读完感想",
      content: "这本书非常精彩，教会了我如何管理时间。",
      expectedRevision: 0,
    });

    expect(note.applied).toMatchObject({
      operation: "save-reading-note",
      ownerId: "note-service-0001",
      ownerRevision: 1,
    });
    expect(note.snapshot.notes).toHaveLength(1);
    expect(note.snapshot.notes[0]).toMatchObject({
      noteId: "note-service-0001",
      bookId: "book-note-0001",
      title: "读完感想",
      content: "这本书非常精彩，教会了我如何管理时间。",
    });
  });

  it("rejects a note for a missing book", async () => {
    const sqlite = createDatabase();
    await expect(execute(sqlite, {
      type: "save-reading-note",
      noteId: "note-missing-0001",
      bookId: "book-does-not-exist",
      title: "",
      content: "内容",
      expectedRevision: 0,
    })).rejects.toThrow(/does not exist/i);
  });

  it("archives a reading note and removes it from the snapshot", async () => {
    const sqlite = createDatabase();
    await execute(sqlite, {
      type: "save-book",
      bookId: "book-note2-0001",
      title: "第二本书",
      author: "",
      status: "reading",
      totalPages: 100,
      currentPage: 10,
      rating: null,
      expectedRevision: 0,
    });
    await execute(sqlite, {
      type: "save-reading-note",
      noteId: "note-archive-0001",
      bookId: "book-note2-0001",
      title: "",
      content: "暂时记录",
      expectedRevision: 0,
    });

    const archived = await execute(sqlite, {
      type: "archive-reading-note",
      noteId: "note-archive-0001",
      bookId: "book-note2-0001",
      expectedRevision: 1,
    });
    expect(archived.snapshot.notes).toHaveLength(0);
  });

  it("replays an idempotent command with the same key", async () => {
    const sqlite = createDatabase();
    const command: ReadingCommand = {
      type: "save-book",
      bookId: "book-idem-0001",
      title: "幂等书",
      author: "",
      status: "wishlist",
      totalPages: null,
      currentPage: 0,
      rating: null,
      expectedRevision: 0,
    };
    const first = await execute(sqlite, command);
    const second = await execute(sqlite, command);

    expect(second).toEqual(first);
    expect(getReadingSnapshot(sqlite).books).toHaveLength(1);
  });
});

describe("daily reading service", () => {
  async function executeDaily(
    sqlite: Database.Database,
    command: DailyReadingCommand,
    idempotencyKey = `daily-reading-test-${command.type}-${command.sessionId}`,
  ) {
    return createDailyReadingService({
      sqlite,
      now: () => new Date(NOW),
    }).execute(command, idempotencyKey);
  }

  it("records multiple sessions for one day and advances the book in the same transaction", async () => {
    const sqlite = createDatabase();
    await execute(sqlite, {
      type: "save-book",
      bookId: "book-daily-0001",
      title: "每天读一点",
      author: "",
      status: "reading",
      totalPages: 200,
      currentPage: 10,
      rating: null,
      expectedRevision: 0,
    });

    const first = await executeDaily(sqlite, {
      type: "save-reading-session",
      sessionId: "session-daily-0001",
      bookId: "book-daily-0001",
      businessDate: "2026-08-14",
      startPage: 10,
      endPage: 28,
      durationMinutes: 35,
      note: "第一段",
      expectedRevision: 0,
      expectedBookRevision: 1,
    });
    const second = await executeDaily(sqlite, {
      type: "save-reading-session",
      sessionId: "session-daily-0002",
      bookId: "book-daily-0001",
      businessDate: "2026-08-14",
      startPage: 28,
      endPage: 40,
      durationMinutes: 20,
      note: "第二段",
      expectedRevision: 0,
      expectedBookRevision: 2,
    });

    expect(first.applied).toMatchObject({
      operation: "save-reading-session",
      ownerId: "session-daily-0001",
      ownerRevision: 1,
      businessDate: "2026-08-14",
      bookRevision: 2,
    });
    expect(second.snapshot.sessions).toHaveLength(2);
    expect(second.snapshot).toMatchObject({ totalPagesRead: 30, totalMinutes: 55 });
    expect(getReadingSnapshot(sqlite).books[0]).toMatchObject({
      currentPage: 40,
      revision: 3,
    });
  });

  it("rejects future dates and stale book revisions without partial writes", async () => {
    const sqlite = createDatabase();
    await execute(sqlite, {
      type: "save-book",
      bookId: "book-daily-0002",
      title: "冲突测试",
      author: "",
      status: "reading",
      totalPages: 100,
      currentPage: 5,
      rating: null,
      expectedRevision: 0,
    });
    const command: DailyReadingCommand = {
      type: "save-reading-session",
      sessionId: "session-daily-future",
      bookId: "book-daily-0002",
      businessDate: "2026-08-15",
      startPage: 5,
      endPage: 10,
      durationMinutes: 15,
      note: "",
      expectedRevision: 0,
      expectedBookRevision: 1,
    };

    await expect(executeDaily(sqlite, command)).rejects.toThrow(/future|未来/i);
    expect(getDailyReadingSnapshot(sqlite, { businessDate: "2026-08-15" }).sessions)
      .toHaveLength(0);
  });
});
