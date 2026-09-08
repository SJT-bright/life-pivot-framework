import { describe, expect, it, vi } from "vitest";

const snapshot = { periodStart: "2026-08-10", periodEndExclusive: "2026-08-17", recordedDays: [], trainingDays: [], sleepRecords: [], skincareUses: [], activeRecoveryCycle: null, healthCompletions: [], knowledgeAdditions: [], summary: null, recentEdits: [] };
vi.mock("@/core/db/application-database", () => ({ getApplicationDatabase: () => ({ sqlite: {} }) }));
const mocks = vi.hoisted(() => ({ getWeeklyReviewSnapshot: vi.fn() }));
vi.mock("@/modules/weekly-review/query", () => ({ getWeeklyReviewSnapshot: mocks.getWeeklyReviewSnapshot }));
vi.mock("./weekly-review-workspace", () => ({ WeeklyReviewWorkspace: () => <div /> }));

import ReviewPage from "./page";

describe("ReviewPage", () => {
  it("awaits Next search params and loads the requested Monday week", async () => {
    mocks.getWeeklyReviewSnapshot.mockReturnValue(snapshot);
    const page = await ReviewPage({ searchParams: Promise.resolve({ start: "2026-08-03" }) });

    const children = page.props.children as Array<{ props?: { initial?: typeof snapshot } }>;
    const workspaceNode = children.find((child) => child?.props && "initial" in child.props);

    expect(workspaceNode?.props?.initial).toEqual(snapshot);
    expect(mocks.getWeeklyReviewSnapshot).toHaveBeenCalledWith({}, {
      periodStart: "2026-08-03",
      periodEndExclusive: "2026-08-10",
      recentLimit: 20,
    });
  });
});
