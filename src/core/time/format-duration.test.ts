import { describe, expect, it } from "vitest";

import {
  formatHoursMinutes,
  joinHoursMinutes,
  splitHoursMinutes,
} from "./format-duration";

describe("formatHoursMinutes", () => {
  it("formats minutes as human readable hours and minutes", () => {
    expect(formatHoursMinutes(415)).toBe("6 小时 55 分钟");
    expect(formatHoursMinutes(120)).toBe("2 小时");
    expect(formatHoursMinutes(45)).toBe("45 分钟");
    expect(formatHoursMinutes(0)).toBe("0 分钟");
    expect(formatHoursMinutes(null)).toBe("—");
  });
});

describe("splitHoursMinutes / joinHoursMinutes", () => {
  it("round-trips minutes through the hour and minute pair", () => {
    const [hours, minutes] = splitHoursMinutes(415);
    expect(hours).toBe("6");
    expect(minutes).toBe("55");
    expect(joinHoursMinutes(hours, minutes)).toBe(415);
  });

  it("returns null only when both parts are empty", () => {
    expect(joinHoursMinutes("", "")).toBeNull();
    expect(joinHoursMinutes("1", "")).toBe(60);
    expect(joinHoursMinutes("", "30")).toBe(30);
    expect(joinHoursMinutes("25", "0")).toBeUndefined();
    expect(joinHoursMinutes("1", "75")).toBeUndefined();
  });
});
