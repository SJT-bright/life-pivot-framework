import { describe, expect, it, vi } from "vitest";

import { IdempotentCommandConflictError } from "@/core/db/idempotent-command";

import type { PersonalDailyNote } from "./contracts";
import { handlePersonalNotesRequest } from "./request-handler";
import { PersonalNoteDateOccupiedError, PersonalNoteMoveBlockedError } from "./service";

const note: PersonalDailyNote = {
  id: "note-20260812",
  businessDate: "2026-08-12",
  content: "当天整体备注",
  revision: 1,
  createdAt: "2026-08-12T10:00:00.000Z",
  updatedAt: "2026-08-12T10:00:00.000Z",
};
const command = {
  type: "save-personal-daily-note",
  noteId: note.id,
  businessDate: note.businessDate,
  content: note.content,
  expectedRevision: 0,
};
const moveCommand = {
  type: "move-personal-daily-note",
  noteId: note.id,
  fromBusinessDate: "2026-08-12",
  toBusinessDate: "2026-08-11",
  expectedRevision: 1,
};

function getRequest(url = "http://127.0.0.1:3000/api/v1/personal-notes?date=2026-08-12") {
  return new Request(url, { headers: { host: "127.0.0.1:3000" } });
}

function postRequest(overrides: { origin?: string; contentType?: string; key?: string; body?: string } = {}) {
  return new Request("http://127.0.0.1:3000/api/v1/personal-notes", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      origin: overrides.origin ?? "http://127.0.0.1:3000",
      "content-type": overrides.contentType ?? "application/json",
      "idempotency-key": overrides.key ?? "personal-note-key-0001",
    },
    body: overrides.body ?? JSON.stringify(command),
  });
}

function dependencies(overrides: Partial<Parameters<typeof handlePersonalNotesRequest>[1]> = {}) {
  return {
    getNote: vi.fn(() => note),
    save: vi.fn(async () => note),
    move: vi.fn(async () => ({ ...note, businessDate: "2026-08-11", revision: 2 })),
    ...overrides,
  };
}

describe("handlePersonalNotesRequest", () => {
  it("returns one date note with no-store", async () => {
    const deps = dependencies();
    const response = await handlePersonalNotesRequest(getRequest(), deps);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ note });
    expect(deps.getNote).toHaveBeenCalledWith({ businessDate: "2026-08-12" });
  });

  it("rejects missing, duplicate, unknown, and invalid GET query values", async () => {
    for (const query of ["", "?date=2026-08-12&date=2026-08-13", "?date=2026-08-12&x=1", "?date=2026-02-30"]) {
      const response = await handlePersonalNotesRequest(
        getRequest(`http://127.0.0.1:3000/api/v1/personal-notes${query}`),
        dependencies(),
      );
      expect(response.status, query).toBe(400);
      expect(response.headers.get("cache-control"), query).toBe("no-store");
    }
  });

  it("validates a local JSON mutation then returns the authoritative result", async () => {
    const deps = dependencies();
    const response = await handlePersonalNotesRequest(postRequest(), deps);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ result: note });
    expect(deps.save).toHaveBeenCalledWith(command, "personal-note-key-0001");
  });

  it("moves a note and returns the moved result", async () => {
    const deps = dependencies();
    const response = await handlePersonalNotesRequest(
      postRequest({ key: "personal-move-key-0001", body: JSON.stringify(moveCommand) }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      result: { ...note, businessDate: "2026-08-11", revision: 2 },
    });
    expect(deps.move).toHaveBeenCalledWith(moveCommand, "personal-move-key-0001");
  });

  it("maps move conflicts, blocked moves, and invalid move bodies to friendly messages", async () => {
    const occupied = await handlePersonalNotesRequest(
      postRequest({ body: JSON.stringify(moveCommand) }),
      dependencies({ move: async () => { throw new PersonalNoteDateOccupiedError(); } }),
    );
    expect(occupied.status).toBe(409);
    expect((await occupied.json()).message).toContain("目标日期");

    const blocked = await handlePersonalNotesRequest(
      postRequest({ body: JSON.stringify(moveCommand) }),
      dependencies({ move: async () => { throw new PersonalNoteMoveBlockedError("不能把复盘移动到未来的日期。"); } }),
    );
    expect(blocked.status).toBe(422);
    expect((await blocked.json()).message).toContain("未来");

    const stale = await handlePersonalNotesRequest(
      postRequest({ body: JSON.stringify(moveCommand) }),
      dependencies({ move: async () => { throw new IdempotentCommandConflictError(); } }),
    );
    expect(stale.status).toBe(409);

    const invalidDate = await handlePersonalNotesRequest(
      postRequest({ body: JSON.stringify({ ...moveCommand, toBusinessDate: "2026-02-30" }) }),
      dependencies(),
    );
    expect(invalidDate.status).toBe(422);

    const unexpected = await handlePersonalNotesRequest(
      postRequest({ body: JSON.stringify(moveCommand) }),
      dependencies({ move: async () => { throw new Error("SQLITE_ERROR C:\\private\\notes.sqlite"); } }),
    );
    expect(unexpected.status).toBe(500);
    expect(JSON.stringify(await unexpected.json())).not.toContain("private");
  });

  it("maps unsafe, malformed, invalid, conflicting, and unexpected writes without leaking details", async () => {
    const cases = [
      postRequest({ origin: "https://evil.example" }),
      postRequest({ contentType: "text/plain" }),
      postRequest({ body: "{" }),
      postRequest({ body: JSON.stringify({ ...command, unknown: true }) }),
    ];
    const expected = [403, 415, 400, 422];
    for (let index = 0; index < cases.length; index += 1) {
      const response = await handlePersonalNotesRequest(cases[index]!, dependencies());
      expect(response.status).toBe(expected[index]);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }

    const conflict = await handlePersonalNotesRequest(postRequest(), {
      ...dependencies(),
      save: async () => { throw new IdempotentCommandConflictError(); },
    });
    expect(conflict.status).toBe(409);

    const failure = await handlePersonalNotesRequest(postRequest(), {
      ...dependencies(),
      save: async () => { throw new Error("SQLITE_ERROR C:\\private\\notes.sqlite"); },
    });
    expect(failure.status).toBe(500);
    expect(JSON.stringify(await failure.json())).not.toContain("private");
  });
});
