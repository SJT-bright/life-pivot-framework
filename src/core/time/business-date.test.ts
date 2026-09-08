import { describe, expect, it } from "vitest";

import {
  isBusinessDate,
  millisecondsUntilHealthChecklistRollover,
  toHealthChecklistBusinessDate,
  toShanghaiBusinessDate,
} from "./business-date";

describe("toShanghaiBusinessDate", () => {
  it("changes date at Asia/Shanghai midnight", () => {
    expect(toShanghaiBusinessDate(new Date("2026-08-09T15:59:59.000Z"))).toBe("2026-08-09");
    expect(toShanghaiBusinessDate(new Date("2026-08-09T16:00:00.000Z"))).toBe("2026-08-10");
  });
});

describe("health checklist 07:00 rollover", () => {
  it("keeps the previous checklist before 07:00 and switches exactly at 07:00", () => {
    expect(toHealthChecklistBusinessDate(new Date("2026-08-29T22:59:59.999Z")))
      .toBe("2026-08-29");
    expect(toHealthChecklistBusinessDate(new Date("2026-08-29T23:00:00.000Z")))
      .toBe("2026-08-30");
  });

  it("calculates the next 07:00 boundary without relying on the computer timezone", () => {
    expect(millisecondsUntilHealthChecklistRollover(
      new Date("2026-08-29T22:59:30.000Z"),
    )).toBe(30_000);
    expect(millisecondsUntilHealthChecklistRollover(
      new Date("2026-08-29T23:00:00.000Z"),
    )).toBe(24 * 60 * 60 * 1000);
  });
});

describe("isBusinessDate", () => {
  it.each(["2026-08-09", "2000-02-29"])("accepts %s", (value) => {
    expect(isBusinessDate(value)).toBe(true);
  });

  it.each(["2026-02-30", "2026-8-9", "not-a-date"])("rejects %s", (value) => {
    expect(isBusinessDate(value)).toBe(false);
  });
});
