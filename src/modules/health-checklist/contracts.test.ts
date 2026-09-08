import { describe, expect, it } from "vitest";

import {
  parseHealthChecklistCommand,
  parseHealthChecklistItemInput,
} from "./contracts";

const item = {
  itemKey: "vitamin-daily-001",
  groupKey: "vitamins",
  groupLabel: "全天维生素",
  name: "维生素",
  targetText: "",
  note: "",
  ordinal: 0,
} as const;

describe("health checklist contracts", () => {
  it("accepts a stable item key and custom group labels", () => {
    expect(parseHealthChecklistItemInput(item)).toEqual(item);
    expect(parseHealthChecklistItemInput({
      ...item,
      itemKey: "custom-item-0001",
      groupKey: "custom",
      groupLabel: "自定义",
    })).toMatchObject({ groupLabel: "自定义" });
  });

  it("accepts the three strict command shapes", () => {
    expect(parseHealthChecklistCommand({
      type: "replace-health-checklist",
      templateId: "health-default",
      businessDate: "2026-08-12",
      scope: "today-and-future",
      name: "我的健康清单",
      changeNote: "",
      items: [item],
      expectedTemplateRevision: 0,
      expectedDayRevision: 1,
      confirmedRemovedCompletedItemKeys: [],
    }).type).toBe("replace-health-checklist");

    expect(parseHealthChecklistCommand({
      type: "set-health-checklist-items",
      businessDate: "2026-08-12",
      itemKeys: [item.itemKey],
      completed: true,
      expectedDayRevision: 1,
    }).type).toBe("set-health-checklist-items");

    expect(parseHealthChecklistCommand({
      type: "save-health-checklist-note",
      businessDate: "2026-08-12",
      note: "今天状态正常",
      expectedDayRevision: 1,
    }).type).toBe("save-health-checklist-note");
  });

  it("rejects duplicate item keys, ordinals, batch keys, invalid dates, and unknown fields", () => {
    const replace = {
      type: "replace-health-checklist",
      templateId: "health-default",
      businessDate: "2026-02-30",
      scope: "today-only",
      name: "我的健康清单",
      changeNote: "",
      items: [item, { ...item }],
      expectedTemplateRevision: 0,
      expectedDayRevision: 1,
      confirmedRemovedCompletedItemKeys: [],
    };
    expect(() => parseHealthChecklistCommand(replace)).toThrow();
    expect(() => parseHealthChecklistCommand({
      ...replace,
      businessDate: "2026-08-12",
      items: [item, { ...item, itemKey: "different-item-001" }],
    })).toThrow();
    expect(() => parseHealthChecklistCommand({
      type: "set-health-checklist-items",
      businessDate: "2026-08-12",
      itemKeys: [item.itemKey, item.itemKey],
      completed: true,
      expectedDayRevision: 1,
    })).toThrow();
    expect(() => parseHealthChecklistItemInput({ ...item, extra: true })).toThrow();
  });
});
