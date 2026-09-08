import { describe, expect, it, vi } from "vitest";

import { handleWeeklyReviewRequest } from "./request-handler";

const snapshot = { periodStart: "2026-08-03", periodEndExclusive: "2026-08-10", recordedDays: [], trainingDays: [], sleepRecords: [], skincareUses: [], activeRecoveryCycle: null, healthCompletions: [], knowledgeAdditions: [], summary: null, recentEdits: [] };
const command = { type: "save-weekly-summary", periodStart: "2026-08-03", periodEndExclusive: "2026-08-10", content: "", expectedRevision: null };
function post(body = JSON.stringify(command)) {
  return new Request("http://127.0.0.1:3000/api/v1/weekly-review", { method: "POST", headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "content-type": "application/json", "idempotency-key": "weekly-key-00000001" }, body });
}

describe("weekly review request handler", () => {
  it("serves strict no-store GET and local idempotent POST", async () => {
    const get = vi.fn(() => snapshot);
    const execute = vi.fn(async () => snapshot);
    const read = await handleWeeklyReviewRequest(new Request("http://127.0.0.1:3000/api/v1/weekly-review?start=2026-08-03&end=2026-08-10"), { get, execute });
    expect(read.status).toBe(200);
    expect(read.headers.get("cache-control")).toBe("no-store");
    const saved = await handleWeeklyReviewRequest(post(), { get, execute });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ result: snapshot });
    expect(execute).toHaveBeenCalledWith(command, "weekly-key-00000001");
  });

  it("rejects unknown queries and unsafe JSON mutations without leaking failures", async () => {
    const deps = { get: vi.fn(() => snapshot), execute: vi.fn(async () => { throw new Error("C:\\private\\weekly.sqlite raw sqlite"); }) };
    expect((await handleWeeklyReviewRequest(new Request("http://127.0.0.1:3000/api/v1/weekly-review?start=2026-08-03&end=2026-08-10&x=1"), deps)).status).toBe(400);
    expect((await handleWeeklyReviewRequest(new Request("http://evil.example/api", { method: "POST", headers: { host: "evil.example", "content-type": "application/json" }, body: "{}" }), deps)).status).toBe(403);
    const failed = await handleWeeklyReviewRequest(post(), deps);
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain("private");
  });
});
