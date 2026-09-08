import { describe, expect, it } from "vitest";

import {
  MANUAL_SKINCARE_PHOTO_MAX_BYTES,
  isManualSkincarePhotoDataUrl,
  manualSkincareCommandSchema,
  manualSkincareCycleStatusSchema,
  manualSkincareProductStatusSchema,
  parseManualSkincareCommand,
} from "./contracts";

const pngPhoto = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const routineItems = [
  {
    itemKey: " evening-cleanser ",
    slot: "evening",
    productId: " cleanser-product ",
    ordinal: 0,
  },
  {
    itemKey: " morning-cleanser ",
    slot: "morning",
    productId: " cleanser-product ",
    ordinal: 0,
  },
  {
    itemKey: " morning-sunscreen ",
    slot: "morning",
    productId: " sunscreen-product ",
    ordinal: 1,
  },
] as const;

const validCommands = [
  {
    type: "save-product",
    productId: " product-0001 ",
    name: " 温和洁面 ",
    brand: " 示例品牌 ",
    currentPurpose: " 日常清洁 ",
    status: "active",
    addedOn: "2026-08-13",
    note: " 晚间也可使用 ",
    expectedProductRevision: 0,
  },
  {
    type: "replace-routine",
    businessDate: "2026-08-13",
    scope: "today-and-future",
    items: routineItems,
    changeNote: " 调整早晚顺序 ",
    expectedRoutineRevision: 3,
    expectedDayRevision: 1,
    confirmedRemovedUsedItemKeys: [" used-item-0002 ", " used-item-0001 "],
  },
  {
    type: "set-day-items-used",
    businessDate: "2026-08-13",
    itemKeys: [" morning-sunscreen ", " morning-cleanser "],
    used: true,
    expectedDayRevision: 2,
  },
  {
    type: "save-day-note",
    businessDate: "2026-08-13",
    section: "overall",
    note: " 今天皮肤状态稳定 ",
    expectedDayRevision: 3,
  },
  {
    type: "save-recovery-plan",
    planId: " plan-0001 ",
    name: " 屏障恢复计划 ",
    note: " 每个周期都由我手动开始 ",
    expectedPlanRevision: 0,
  },
  {
    type: "save-recovery-cycle",
    planId: "plan-0001",
    cycleId: " cycle-0001 ",
    ordinal: 0,
    name: " 精简周期 ",
    goal: " 减少刺激 ",
    durationDays: 17,
    expectedEndOn: "2026-08-20",
    note: " 结束日期只作提醒 ",
    items: routineItems,
    expectedPlanRevision: 1,
    expectedCycleRevision: 0,
    expectedRoutineRevision: 3,
  },
  {
    type: "start-recovery-cycle",
    planId: "plan-0001",
    cycleId: "cycle-0001",
    effectiveFrom: "2030-01-01",
    expectedPlanRevision: 2,
    expectedCycleRevision: 1,
    expectedCurrentCycleId: " current-cycle-0001 ",
    expectedCurrentCycleRevision: 4,
    expectedActivationSequence: 5,
    expectedDayRevision: 3,
    confirmedRemovedUsedItemKeys: [" used-item-0002 ", " used-item-0001 "],
  },
  {
    type: "complete-recovery-cycle",
    cycleId: "cycle-0001",
    completedOn: "2026-08-20",
    expectedCycleRevision: 2,
  },
] as const;

describe("manualSkincareCommandSchema", () => {
  it("accepts exactly the eight commands and trims reusable string values", () => {
    for (const command of validCommands) {
      expect(manualSkincareCommandSchema.safeParse(command).success).toBe(true);
    }

    const product = parseManualSkincareCommand(validCommands[0]);
    expect(product).toEqual({
      ...validCommands[0],
      productId: "product-0001",
      name: "温和洁面",
      brand: "示例品牌",
      currentPurpose: "日常清洁",
      note: "晚间也可使用",
    });
    expect(() => parseManualSkincareCommand({ type: "auto-advance-cycle" })).toThrow();
  });

  it("accepts an optional local photo mutation while preserving frozen legacy commands", () => {
    const legacy = parseManualSkincareCommand(validCommands[0]);
    expect(legacy).not.toHaveProperty("photoDataUrl");

    expect(parseManualSkincareCommand({ ...validCommands[0], photoDataUrl: pngPhoto }))
      .toMatchObject({ type: "save-product", photoDataUrl: pngPhoto });
    expect(parseManualSkincareCommand({ ...validCommands[0], photoDataUrl: null }))
      .toMatchObject({ type: "save-product", photoDataUrl: null });
    expect(isManualSkincarePhotoDataUrl(pngPhoto)).toBe(true);
  });

  it("rejects non-images, mismatched signatures, malformed base64, and photos over 2 MiB", () => {
    const oversizedPng = `data:image/png;base64,${Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(MANUAL_SKINCARE_PHOTO_MAX_BYTES),
    ]).toString("base64")}`;
    for (const photoDataUrl of [
      "data:text/plain;base64,aGVsbG8=",
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
      "data:image/png;base64,aGVsbG8=",
      "data:image/jpeg;base64,not*base64",
      oversizedPng,
    ]) {
      expect(() => parseManualSkincareCommand({ ...validCommands[0], photoDataUrl })).toThrow();
      expect(isManualSkincarePhotoDataUrl(photoDataUrl)).toBe(false);
    }
  });

  it("normalizes set-like arrays and routine order deterministically without merging distinct placements", () => {
    const routine = parseManualSkincareCommand(validCommands[1]);
    expect(routine.type).toBe("replace-routine");
    if (routine.type !== "replace-routine") throw new Error("Unexpected command type.");
    expect(routine.items).toEqual([
      {
        itemKey: "morning-cleanser",
        slot: "morning",
        productId: "cleanser-product",
        ordinal: 0,
      },
      {
        itemKey: "morning-sunscreen",
        slot: "morning",
        productId: "sunscreen-product",
        ordinal: 1,
      },
      {
        itemKey: "evening-cleanser",
        slot: "evening",
        productId: "cleanser-product",
        ordinal: 0,
      },
    ]);
    expect(routine.confirmedRemovedUsedItemKeys).toEqual([
      "used-item-0001",
      "used-item-0002",
    ]);

    const batch = parseManualSkincareCommand(validCommands[2]);
    expect(batch.type).toBe("set-day-items-used");
    if (batch.type !== "set-day-items-used") throw new Error("Unexpected command type.");
    expect(batch.itemKeys).toEqual(["morning-cleanser", "morning-sunscreen"]);
  });

  it("rejects unknown keys at the command and nested item levels", () => {
    expect(() => parseManualSkincareCommand({
      ...validCommands[0],
      ingredients: [],
    })).toThrow();
    expect(() => parseManualSkincareCommand({
      ...validCommands[1],
      items: [{ ...routineItems[0], note: "not part of a routine item" }],
    })).toThrow();
    expect(() => parseManualSkincareCommand({
      ...validCommands[5],
      automaticallyStarts: true,
    })).toThrow();
  });

  it("uses real business dates while leaving today-or-tomorrow enforcement to the service", () => {
    expect(() => parseManualSkincareCommand({
      ...validCommands[0],
      addedOn: "2026-02-30",
    })).toThrow();
    expect(() => parseManualSkincareCommand({
      ...validCommands[5],
      expectedEndOn: "2026-13-01",
    })).toThrow();
    expect(() => parseManualSkincareCommand({
      ...validCommands[6],
      effectiveFrom: "not-a-date",
    })).toThrow();
    expect(() => parseManualSkincareCommand({
      ...validCommands[7],
      completedOn: "2026-02-30",
    })).toThrow();

    const structurallyValidFutureStart = parseManualSkincareCommand(validCommands[6]);
    expect(structurallyValidFutureStart).toMatchObject({
      type: "start-recovery-cycle",
      effectiveFrom: "2030-01-01",
    });
  });

  it("rejects duplicate routine identities without equating morning and evening uses", () => {
    const duplicateCases = [
      [routineItems[0], { ...routineItems[1], itemKey: " evening-cleanser " }],
      [routineItems[1], { ...routineItems[2], ordinal: 0 }],
      [routineItems[1], {
        ...routineItems[2],
        productId: " cleanser-product ",
      }],
    ];
    for (const items of duplicateCases) {
      expect(() => parseManualSkincareCommand({ ...validCommands[1], items })).toThrow();
    }

    expect(() => parseManualSkincareCommand({
      ...validCommands[1],
      items: [routineItems[0], routineItems[1]],
    })).not.toThrow();
  });

  it("rejects duplicate or empty batch and confirmation keys", () => {
    expect(() => parseManualSkincareCommand({
      ...validCommands[2],
      itemKeys: ["morning-cleanser", " morning-cleanser "],
    })).toThrow();
    expect(() => parseManualSkincareCommand({
      ...validCommands[2],
      itemKeys: [],
    })).toThrow();
    expect(() => parseManualSkincareCommand({
      ...validCommands[2],
      itemKeys: ["   "],
    })).toThrow();
    expect(() => parseManualSkincareCommand({
      ...validCommands[1],
      confirmedRemovedUsedItemKeys: ["used-item-0001", " used-item-0001 "],
    })).toThrow();
  });

  it("requires non-negative safe integer revisions and ordinals", () => {
    const invalidValues = [-1, 1.5, Number.MAX_SAFE_INTEGER + 1];
    for (const expectedProductRevision of invalidValues) {
      expect(() => parseManualSkincareCommand({
        ...validCommands[0],
        expectedProductRevision,
      })).toThrow();
    }
    for (const expectedActivationSequence of invalidValues) {
      expect(() => parseManualSkincareCommand({
        ...validCommands[6],
        expectedActivationSequence,
      })).toThrow();
    }
    expect(() => parseManualSkincareCommand({
      ...validCommands[5],
      ordinal: -1,
    })).toThrow();
    for (const durationDays of [0, 366, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => parseManualSkincareCommand({
        ...validCommands[5],
        durationDays,
      })).toThrow();
    }
  });

  it("bounds text and array inputs", () => {
    expect(() => parseManualSkincareCommand({
      ...validCommands[0],
      name: " ",
    })).toThrow();
    expect(() => parseManualSkincareCommand({
      ...validCommands[0],
      note: "x".repeat(4_001),
    })).toThrow();
    expect(() => parseManualSkincareCommand({
      ...validCommands[1],
      items: Array.from({ length: 201 }, (_, index) => ({
        itemKey: `item-key-${index.toString().padStart(4, "0")}`,
        slot: index % 2 === 0 ? "morning" : "evening",
        productId: `product-${index.toString().padStart(4, "0")}`,
        ordinal: Math.floor(index / 2),
      })),
    })).toThrow();
    expect(() => parseManualSkincareCommand({
      ...validCommands[2],
      itemKeys: Array.from({ length: 201 }, (_, index) => `item-key-${index.toString().padStart(4, "0")}`),
    })).toThrow();
  });

  it("exposes only approved product and cycle statuses", () => {
    expect(manualSkincareProductStatusSchema.options).toEqual([
      "active",
      "paused",
      "finished",
    ]);
    expect(manualSkincareCycleStatusSchema.options).toEqual([
      "draft",
      "active",
      "completed",
    ]);
    expect(manualSkincareProductStatusSchema.safeParse("archived").success).toBe(false);
    expect(manualSkincareCycleStatusSchema.safeParse("scheduled").success).toBe(false);
  });

  it("accepts a bounded planned duration while preserving legacy expected-end submissions", () => {
    const withExpectedEnd = parseManualSkincareCommand(validCommands[5]);
    expect(withExpectedEnd).toMatchObject({
      type: "save-recovery-cycle",
      durationDays: 17,
      expectedEndOn: "2026-08-20",
    });
    const { durationDays: _durationDays, ...legacyCommand } = validCommands[5];
    expect(() => parseManualSkincareCommand(legacyCommand)).not.toThrow();
    expect(() => parseManualSkincareCommand({
      ...validCommands[5],
      expectedEndOn: null,
    })).not.toThrow();

    for (const field of [
      "automaticStart",
      "phase",
      "ingredient",
      "safety",
      "recommendation",
      "trend",
    ]) {
      expect(() => parseManualSkincareCommand({
        ...validCommands[5],
        [field]: "not allowed",
      })).toThrow();
    }
  });
});
