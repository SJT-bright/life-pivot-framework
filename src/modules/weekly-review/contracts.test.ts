import { describe, expect, it } from "vitest";

import { parseWeeklyReviewQuery } from "./contracts";

describe("weekly review query contract", () => {
  it("accepts one complete bounded query", () => {
    expect(parseWeeklyReviewQuery(new URLSearchParams(
      "start=2026-12-28&end=2027-01-04&recentLimit=20",
    ))).toEqual({ periodStart: "2026-12-28", periodEndExclusive: "2027-01-04", recentLimit: 20 });
  });

  it("rejects duplicate, unknown, malformed, non-increasing, overlong, and unbounded queries", () => {
    for (const query of [
      "start=2026-08-01&start=2026-08-01&end=2026-08-08",
      "start=2026-08-01&end=2026-08-08&extra=true",
      "start=2026-02-30&end=2026-03-01",
      "start=2026-08-08&end=2026-08-08",
      "start=2026-08-01&end=2026-09-02",
      "start=2026-08-01&end=2026-08-08&recentLimit=0",
      "start=2026-08-01&end=2026-08-08&recentLimit=101",
      "start=2026-08-01&end=2026-08-08&recentLimit=1e2",
      "start=2026-08-05&end=2026-08-12",
      "start=2026-08-03&end=2026-08-11",
    ]) expect(() => parseWeeklyReviewQuery(new URLSearchParams(query)), query).toThrow();
  });
});
