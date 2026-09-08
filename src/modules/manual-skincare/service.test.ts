import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { IdempotentCommandConflictError } from "@/core/db/idempotent-command";
import { migrateDatabase } from "@/core/db/migrate";

import type {
  ManualSkincareCommand,
  ManualSkincareRoutineItemInput,
} from "./contracts";
import { getManualSkincareProductPhoto, getManualSkincareSnapshot } from "./query";
import {
  createManualSkincareService,
  ManualSkincareConflictError,
  materializeManualSkincareDay,
} from "./service";

const databases: Database.Database[] = [];

const pngPhoto = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const cleanser = {
  productId: "product-cleanser-001",
  name: "温和洁面",
  brand: "示例品牌",
  currentPurpose: "清洁",
  status: "active",
  addedOn: "2026-08-01",
  note: "晚间使用",
} as const;

const cream = {
  productId: "product-cream-0001",
  name: "修护面霜",
  brand: "示例品牌",
  currentPurpose: "保湿修护",
  status: "active",
  addedOn: "2026-08-02",
  note: "薄涂",
} as const;

const morningCleanser: ManualSkincareRoutineItemInput = {
  itemKey: "item-morning-cleanser",
  slot: "morning",
  productId: cleanser.productId,
  ordinal: 0,
};

const eveningCream: ManualSkincareRoutineItemInput = {
  itemKey: "item-evening-cream",
  slot: "evening",
  productId: cream.productId,
  ordinal: 0,
};

function setup(initialNow = "2026-08-13T02:00:00.000Z") {
  const sqlite = new Database(":memory:");
  databases.push(sqlite);
  migrateDatabase(sqlite);
  let currentNow = new Date(initialNow);
  let sequence = 0;
  const options = {
    now: () => currentNow,
    createId: (prefix: string) => `${prefix}-${String(++sequence).padStart(6, "0")}`,
    writeBarrier: {
      runWrite: async <T>(action: () => T | Promise<T>) => await action(),
    },
  };
  return {
    sqlite,
    options,
    service: createManualSkincareService({ sqlite, ...options }),
    setNow(value: string) {
      currentNow = new Date(value);
    },
  };
}

function saveProductCommand(
  product: typeof cleanser | typeof cream,
  expectedProductRevision = 0,
  overrides: Partial<Extract<ManualSkincareCommand, { type: "save-product" }>> = {},
): Extract<ManualSkincareCommand, { type: "save-product" }> {
  return {
    type: "save-product",
    ...product,
    expectedProductRevision,
    ...overrides,
  };
}

async function seedProducts(context: ReturnType<typeof setup>) {
  await context.service.execute(saveProductCommand(cleanser), "manual-product-cleanser-0001");
  await context.service.execute(saveProductCommand(cream), "manual-product-cream-000001");
}

function replaceRoutineCommand(
  overrides: Partial<Extract<ManualSkincareCommand, { type: "replace-routine" }>> = {},
): Extract<ManualSkincareCommand, { type: "replace-routine" }> {
  return {
    type: "replace-routine",
    businessDate: "2026-08-13",
    scope: "today-and-future",
    items: [morningCleanser, eveningCream],
    changeNote: "建立基础早晚护肤",
    expectedRoutineRevision: 0,
    expectedDayRevision: 1,
    confirmedRemovedUsedItemKeys: [],
    ...overrides,
  };
}

function scalarCount(sqlite: Database.Database, table: string): number {
  return sqlite.prepare(`select count(*) from ${table}`).pluck().get() as number;
}

function totalChanges(sqlite: Database.Database): number {
  return sqlite.prepare("select total_changes()").pluck().get() as number;
}

function dayBytes(sqlite: Database.Database, businessDate: string): string {
  const day = sqlite.prepare(`
    select * from manual_skincare_days where business_date = ?
  `).get(businessDate);
  const items = sqlite.prepare(`
    select i.* from manual_skincare_day_items i
    join manual_skincare_days d on d.id = i.day_id
    where d.business_date = ? order by i.slot, i.ordinal, i.item_key
  `).all(businessDate);
  return JSON.stringify({ day, items });
}

function manualSkincareWriteBytes(sqlite: Database.Database): string {
  return JSON.stringify({
    routines: sqlite.prepare(
      "select * from manual_skincare_routine_versions order by revision",
    ).all(),
    routineItems: sqlite.prepare(
      "select * from manual_skincare_routine_items order by routine_version_id, slot, ordinal, item_key",
    ).all(),
    activations: sqlite.prepare(
      "select * from manual_skincare_routine_activations order by activation_sequence",
    ).all(),
    plans: sqlite.prepare(
      "select * from manual_skincare_recovery_plans order by id",
    ).all(),
    cycles: sqlite.prepare(
      "select * from manual_skincare_recovery_cycles order by id",
    ).all(),
    days: sqlite.prepare(
      "select * from manual_skincare_days order by business_date",
    ).all(),
    dayItems: sqlite.prepare(
      "select * from manual_skincare_day_items order by day_id, slot, ordinal, item_key",
    ).all(),
    auditEvents: sqlite.prepare("select * from audit_events order by id").all(),
    idempotencyKeys: sqlite.prepare("select * from idempotency_keys order by key").all(),
  });
}

function denyProfessionalSkincareWrites(sqlite: Database.Database): void {
  const tables = sqlite.prepare(`
    select name from sqlite_master
    where type = 'table' and name like 'skincare_%'
    order by name
  `).all() as Array<{ name: string }>;
  for (const { name } of tables) {
    if (!/^skincare_[a-z0-9_]+$/u.test(name)) throw new Error("Unsafe table name in test.");
    for (const operation of ["insert", "update", "delete"] as const) {
      sqlite.exec(`
        create temp trigger deny_${operation}_${name}
        before ${operation} on ${name}
        begin
          select raise(abort, 'professional skincare write denied');
        end;
      `);
    }
  }
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe("manual skincare service", () => {
  it("stores photo bytes once, keeps mutation snapshots small, preserves omitted photos, and removes explicitly", async () => {
    const context = setup();
    const created = await context.service.execute(saveProductCommand(cleanser, 0, {
      photoDataUrl: pngPhoto,
    }), "manual-photo-create-0001");
    expect(created.snapshot.products[0]?.photoUrl).toBe(
      "/api/v1/manual-skincare/products/product-cleanser-001/photo?revision=1",
    );
    expect(JSON.stringify(created)).not.toContain("data:image/");
    expect(getManualSkincareProductPhoto(context.sqlite, cleanser.productId)).toEqual({
      bytes: Buffer.from(pngPhoto.split(",")[1]!, "base64"),
      mediaType: "image/png",
      revision: 1,
    });
    const storedResponse = context.sqlite.prepare(`
      select response_json from idempotency_keys where key = 'manual-photo-create-0001'
    `).pluck().get() as string;
    expect(storedResponse).not.toContain("data:image/");
    expect(storedResponse.length).toBeLessThan(10_000);

    const preserved = await context.service.execute(saveProductCommand(cleanser, 1, {
      name: "温和洁面新名称",
    }), "manual-photo-preserve-0001");
    expect(preserved.snapshot.products[0]?.photoUrl).toContain("revision=2");
    expect(getManualSkincareProductPhoto(context.sqlite, cleanser.productId)?.bytes)
      .toEqual(Buffer.from(pngPhoto.split(",")[1]!, "base64"));

    const removed = await context.service.execute(saveProductCommand(cleanser, 2, {
      name: "温和洁面新名称",
      photoDataUrl: null,
    }), "manual-photo-remove-0001");
    expect(removed.snapshot.products[0]?.photoUrl).toBeNull();
    expect(getManualSkincareProductPhoto(context.sqlite, cleanser.productId)).toBeNull();
    expect(context.sqlite.prepare(`
      select photo_blob, photo_mime from manual_skincare_products where id = ?
    `).get(cleanser.productId)).toEqual({ photo_blob: null, photo_mime: null });
  });

  it.each([
    {
      route: "replace-routine" as const,
      reboundItem: { ...morningCleanser, productId: cream.productId },
    },
    {
      route: "start-recovery-cycle" as const,
      reboundItem: { ...morningCleanser, slot: "evening" as const },
    },
  ])("treats a used item's identity change through $route as a confirmed removal", async ({
    route,
    reboundItem,
  }) => {
    const context = setup();
    await seedProducts(context);
    const empty = await materializeManualSkincareDay(
      context.sqlite,
      "2026-08-13",
      context.options,
    );
    let result = await context.service.execute(replaceRoutineCommand({
      items: [morningCleanser],
      expectedDayRevision: empty.selectedDay!.revision,
    }), `manual-identity-base-${route}`);
    result = await context.service.execute({
      type: "set-day-items-used",
      businessDate: "2026-08-13",
      itemKeys: [morningCleanser.itemKey],
      used: true,
      expectedDayRevision: result.snapshot.selectedDay!.revision,
    }, `manual-identity-used-${route}`);
    const usedDayRevision = result.snapshot.selectedDay!.revision;

    if (route === "start-recovery-cycle") {
      await context.service.execute({
        type: "save-recovery-plan",
        planId: "identity-plan",
        name: "Identity plan",
        note: "",
        expectedPlanRevision: 0,
      }, "manual-identity-plan");
      await context.service.execute({
        type: "save-recovery-cycle",
        planId: "identity-plan",
        cycleId: "identity-cycle",
        ordinal: 0,
        name: "Identity cycle",
        goal: "Verify identity replacement",
        expectedEndOn: null,
        note: "",
        items: [reboundItem],
        expectedPlanRevision: 1,
        expectedCycleRevision: 0,
        expectedRoutineRevision: 1,
      }, "manual-identity-cycle");
    }

    const executeRebind = (confirmedRemovedUsedItemKeys: string[], suffix: string) => (
      route === "replace-routine"
        ? context.service.execute(replaceRoutineCommand({
            items: [reboundItem],
            expectedRoutineRevision: 1,
            expectedDayRevision: usedDayRevision,
            confirmedRemovedUsedItemKeys,
          }), `manual-identity-replace-${suffix}`)
        : context.service.execute({
            type: "start-recovery-cycle",
            planId: "identity-plan",
            cycleId: "identity-cycle",
            effectiveFrom: "2026-08-13",
            expectedPlanRevision: 2,
            expectedCycleRevision: 1,
            expectedCurrentCycleId: null,
            expectedCurrentCycleRevision: 0,
            expectedActivationSequence: 1,
            expectedDayRevision: usedDayRevision,
            confirmedRemovedUsedItemKeys,
          }, `manual-identity-start-${suffix}`)
    );

    const beforeRejected = manualSkincareWriteBytes(context.sqlite);
    await expect(executeRebind([], "rejected"))
      .rejects.toBeInstanceOf(ManualSkincareConflictError);
    expect(manualSkincareWriteBytes(context.sqlite)).toBe(beforeRejected);

    await expect(executeRebind([morningCleanser.itemKey], "confirmed")).resolves.toBeDefined();
    expect(context.sqlite.prepare(`
      select item_key as itemKey, product_id as productId, slot, used, used_at as usedAt
      from manual_skincare_day_items
      where day_id = (select id from manual_skincare_days where business_date = '2026-08-13')
    `).get()).toEqual({
      itemKey: morningCleanser.itemKey,
      productId: reboundItem.productId,
      slot: reboundItem.slot,
      used: 0,
      usedAt: null,
    });
    expect(context.sqlite.prepare(`
      select payload_json from audit_events
      where event_type = 'manual-skincare.used-item-removed'
    `).pluck().all()).toEqual([
      JSON.stringify({ businessDate: "2026-08-13", itemKey: morningCleanser.itemKey }),
    ]);
  });

  it.each(["active", "completed"] as const)(
    "rejects saving a %s recovery cycle without any writes",
    async (status) => {
      const context = setup();
      await seedProducts(context);
      await context.service.execute({
        type: "save-recovery-plan",
        planId: "immutable-plan",
        name: "Immutable plan",
        note: "",
        expectedPlanRevision: 0,
      }, `manual-immutable-plan-${status}`);
      await context.service.execute({
        type: "save-recovery-cycle",
        planId: "immutable-plan",
        cycleId: "immutable-cycle",
        ordinal: 0,
        name: "Immutable cycle",
        goal: "Initial goal",
        expectedEndOn: null,
        note: "",
        items: [morningCleanser],
        expectedPlanRevision: 1,
        expectedCycleRevision: 0,
        expectedRoutineRevision: 0,
      }, `manual-immutable-cycle-${status}`);
      context.sqlite.prepare(`
        update manual_skincare_recovery_cycles
        set status = ?, actual_started_on = '2026-08-13', actual_completed_on = ?
        where id = 'immutable-cycle'
      `).run(status, status === "completed" ? "2026-08-13" : null);
      const beforeRejected = manualSkincareWriteBytes(context.sqlite);

      await expect(context.service.execute({
        type: "save-recovery-cycle",
        planId: "immutable-plan",
        cycleId: "immutable-cycle",
        ordinal: 0,
        name: "Changed cycle",
        goal: "Changed goal",
        expectedEndOn: "2026-08-20",
        note: "changed",
        items: [eveningCream],
        expectedPlanRevision: 2,
        expectedCycleRevision: 1,
        expectedRoutineRevision: 1,
      }, `manual-immutable-save-${status}`))
        .rejects.toBeInstanceOf(ManualSkincareConflictError);
      expect(manualSkincareWriteBytes(context.sqlite)).toBe(beforeRejected);
    },
  );

  it("keeps product, routine, and materialized-day snapshots independent", async () => {
    const context = setup();
    await seedProducts(context);
    const empty = await materializeManualSkincareDay(
      context.sqlite,
      "2026-08-13",
      context.options,
    );
    expect(empty.selectedDay).toMatchObject({
      businessDate: "2026-08-13",
      materialized: true,
      revision: 1,
      morningNote: "",
      eveningNote: "",
      overallNote: "",
      morningItems: [],
      eveningItems: [],
    });

    const routine = await context.service.execute(
      replaceRoutineCommand({ expectedDayRevision: empty.selectedDay!.revision }),
      "manual-routine-initial-0001",
    );
    expect(routine.applied).toEqual({
      operation: "replace-routine",
      ownerId: "2026-08-13",
      ownerRevision: 2,
      businessDate: "2026-08-13",
      activationSequence: 1,
    });
    expect(routine.snapshot.selectedDay?.morningItems[0]).toMatchObject({
      itemKey: morningCleanser.itemKey,
      productName: "温和洁面",
      currentPurpose: "清洁",
      used: false,
    });

    const beforeDay = dayBytes(context.sqlite, "2026-08-13");
    const updated = await context.service.execute(
      saveProductCommand(cleanser, 1, {
        name: "温和洁面（新版名称）",
        currentPurpose: "当前改为旅行使用",
      }),
      "manual-product-cleanser-0002",
    );
    expect(updated.applied).toMatchObject({
      operation: "save-product",
      ownerId: cleanser.productId,
      ownerRevision: 2,
      businessDate: null,
      activationSequence: null,
    });
    expect(updated.snapshot.products.find((item) => item.productId === cleanser.productId))
      .toMatchObject({ name: "温和洁面（新版名称）", currentPurpose: "当前改为旅行使用" });
    expect(getManualSkincareSnapshot(context.sqlite, { businessDate: "2026-08-13" })
      .selectedDay?.morningItems[0]).toMatchObject({
        productName: "温和洁面",
        currentPurpose: "清洁",
      });
    expect(dayBytes(context.sqlite, "2026-08-13")).toBe(beforeDay);
    expect(() => context.sqlite.prepare(
      "delete from manual_skincare_products where id = ?",
    ).run(cleanser.productId)).toThrow();
  });

  it("applies scope rules, preserves stable used items, and audits exact confirmed removals", async () => {
    const context = setup();
    await seedProducts(context);
    const emptyToday = await materializeManualSkincareDay(
      context.sqlite,
      "2026-08-13",
      context.options,
    );
    const past = await materializeManualSkincareDay(
      context.sqlite,
      "2026-08-12",
      context.options,
    );
    const pastBytes = dayBytes(context.sqlite, "2026-08-12");
    let result = await context.service.execute(
      replaceRoutineCommand({ expectedDayRevision: emptyToday.selectedDay!.revision }),
      "manual-routine-scope-0001",
    );
    result = await context.service.execute({
      type: "set-day-items-used",
      businessDate: "2026-08-13",
      itemKeys: [morningCleanser.itemKey],
      used: true,
      expectedDayRevision: result.snapshot.selectedDay!.revision,
    }, "manual-used-cleanser-0001");

    const merged = await context.service.execute(replaceRoutineCommand({
      items: [morningCleanser],
      changeNote: "保留已使用项",
      expectedRoutineRevision: 1,
      expectedDayRevision: result.snapshot.selectedDay!.revision,
    }), "manual-routine-scope-0002");
    expect(merged.snapshot.selectedDay?.morningItems[0]).toMatchObject({
      itemKey: morningCleanser.itemKey,
      used: true,
    });
    expect(dayBytes(context.sqlite, "2026-08-12")).toBe(pastBytes);
    expect(past.selectedDay?.revision).toBe(1);

    const beforeRejectedRemoval = dayBytes(context.sqlite, "2026-08-13");
    const beforeAuditCount = scalarCount(context.sqlite, "audit_events");
    await expect(context.service.execute(replaceRoutineCommand({
      scope: "today-only",
      items: [],
      expectedRoutineRevision: 2,
      expectedDayRevision: merged.snapshot.selectedDay!.revision,
    }), "manual-routine-remove-0001")).rejects.toBeInstanceOf(ManualSkincareConflictError);
    expect(dayBytes(context.sqlite, "2026-08-13")).toBe(beforeRejectedRemoval);
    expect(scalarCount(context.sqlite, "audit_events")).toBe(beforeAuditCount);

    const versionCount = scalarCount(context.sqlite, "manual_skincare_routine_versions");
    const activationCount = scalarCount(context.sqlite, "manual_skincare_routine_activations");
    const removed = await context.service.execute(replaceRoutineCommand({
      scope: "today-only",
      items: [],
      expectedRoutineRevision: 2,
      expectedDayRevision: merged.snapshot.selectedDay!.revision,
      confirmedRemovedUsedItemKeys: [morningCleanser.itemKey],
    }), "manual-routine-remove-0002");
    expect(removed.snapshot.selectedDay?.morningItems).toEqual([]);
    expect(scalarCount(context.sqlite, "manual_skincare_routine_versions")).toBe(versionCount);
    expect(scalarCount(context.sqlite, "manual_skincare_routine_activations")).toBe(activationCount);
    expect(scalarCount(context.sqlite, "audit_events")).toBe(beforeAuditCount + 1);

    await expect(context.service.execute(replaceRoutineCommand({
      businessDate: "2026-08-12",
      expectedRoutineRevision: 2,
      expectedDayRevision: past.selectedDay!.revision,
    }), "manual-routine-past-0001")).rejects.toBeInstanceOf(ManualSkincareConflictError);

    const future = await materializeManualSkincareDay(
      context.sqlite,
      "2026-08-14",
      context.options,
    );
    await expect(context.service.execute({
      type: "set-day-items-used",
      businessDate: "2026-08-14",
      itemKeys: [morningCleanser.itemKey],
      used: true,
      expectedDayRevision: future.selectedDay!.revision,
    }, "manual-used-future-0001")).rejects.toBeInstanceOf(ManualSkincareConflictError);
  });

  it("replays a plain idempotent result and rolls stale failures back", async () => {
    const context = setup();
    const command = saveProductCommand(cleanser);
    const first = await context.service.execute(command, "manual-idempotency-0001");
    const replay = await context.service.execute(command, "manual-idempotency-0001");
    expect(replay).toEqual(first);
    expect(JSON.parse(JSON.stringify(replay))).toEqual(replay);
    expect(scalarCount(context.sqlite, "manual_skincare_products")).toBe(1);

    await expect(context.service.execute(
      saveProductCommand(cream),
      "manual-idempotency-0001",
    )).rejects.toBeInstanceOf(IdempotentCommandConflictError);

    const beforeProduct = context.sqlite.prepare(
      "select * from manual_skincare_products where id = ?",
    ).get(cleanser.productId);
    const beforeIdempotency = scalarCount(context.sqlite, "idempotency_keys");
    await expect(context.service.execute(
      saveProductCommand(cleanser, 0, { name: "过期写入" }),
      "manual-stale-product-0001",
    )).rejects.toBeInstanceOf(ManualSkincareConflictError);
    expect(context.sqlite.prepare(
      "select * from manual_skincare_products where id = ?",
    ).get(cleanser.productId)).toEqual(beforeProduct);
    expect(scalarCount(context.sqlite, "idempotency_keys")).toBe(beforeIdempotency);
  });

  it("keeps drafts inert, locks duration to the actual start date, and changes status only explicitly", async () => {
    const context = setup();
    await seedProducts(context);
    const empty = await materializeManualSkincareDay(
      context.sqlite,
      "2026-08-13",
      context.options,
    );
    let result = await context.service.execute(
      replaceRoutineCommand({
        items: [morningCleanser],
        expectedDayRevision: empty.selectedDay!.revision,
      }),
      "manual-cycle-base-routine-0001",
    );
    result = await context.service.execute({
      type: "set-day-items-used",
      businessDate: "2026-08-13",
      itemKeys: [morningCleanser.itemKey],
      used: true,
      expectedDayRevision: result.snapshot.selectedDay!.revision,
    }, "manual-cycle-base-used-0001");
    const usedDayRevision = result.snapshot.selectedDay!.revision;

    await context.service.execute({
      type: "save-recovery-plan",
      planId: "recovery-plan-0001",
      name: "屏障修护计划",
      note: "按需手动切换",
      expectedPlanRevision: 0,
    }, "manual-recovery-plan-0001");
    await context.service.execute({
      type: "save-recovery-cycle",
      planId: "recovery-plan-0001",
      cycleId: "recovery-cycle-0001",
      ordinal: 0,
      name: "第一周期",
      goal: "精简修护",
      durationDays: 2,
      expectedEndOn: null,
      note: "两天周期",
      items: [morningCleanser],
      expectedPlanRevision: 1,
      expectedCycleRevision: 0,
      expectedRoutineRevision: 1,
    }, "manual-recovery-cycle-0001");
    const savedSecond = await context.service.execute({
      type: "save-recovery-cycle",
      planId: "recovery-plan-0001",
      cycleId: "recovery-cycle-0002",
      ordinal: 1,
      name: "第二周期",
      goal: "增加晚间修护",
      durationDays: 5,
      expectedEndOn: null,
      note: "五天周期，仍需显式开始",
      items: [eveningCream],
      expectedPlanRevision: 2,
      expectedCycleRevision: 0,
      expectedRoutineRevision: 2,
    }, "manual-recovery-cycle-0002");
    expect(savedSecond.snapshot.activationSequence).toBe(1);
    expect(savedSecond.snapshot.recoveryPlans[0]?.cycles.map((cycle) => cycle.status))
      .toEqual(["draft", "draft"]);
    expect(savedSecond.snapshot.recoveryPlans[0]?.cycles.map((cycle) => ({
      durationDays: cycle.durationDays,
      expectedEndOn: cycle.expectedEndOn,
    }))).toEqual([
      { durationDays: 2, expectedEndOn: "2026-08-14" },
      { durationDays: 5, expectedEndOn: "2026-08-17" },
    ]);

    const beforeExpectedDatePass = JSON.stringify({
      plans: context.sqlite.prepare(
        "select * from manual_skincare_recovery_plans order by id",
      ).all(),
      cycles: context.sqlite.prepare(
        "select * from manual_skincare_recovery_cycles order by id",
      ).all(),
      activations: context.sqlite.prepare(
        "select * from manual_skincare_routine_activations order by activation_sequence",
      ).all(),
    });
    const changesBeforeRead = totalChanges(context.sqlite);
    context.setNow("2026-08-16T02:00:00.000Z");
    const afterDatePass = getManualSkincareSnapshot(context.sqlite, {
      businessDate: "2026-08-16",
    });
    expect(afterDatePass.recoveryPlans[0]?.cycles.map((cycle) => cycle.status))
      .toEqual(["draft", "draft"]);
    expect(totalChanges(context.sqlite)).toBe(changesBeforeRead);
    expect(JSON.stringify({
      plans: context.sqlite.prepare(
        "select * from manual_skincare_recovery_plans order by id",
      ).all(),
      cycles: context.sqlite.prepare(
        "select * from manual_skincare_recovery_cycles order by id",
      ).all(),
      activations: context.sqlite.prepare(
        "select * from manual_skincare_routine_activations order by activation_sequence",
      ).all(),
    })).toBe(beforeExpectedDatePass);

    context.setNow("2026-08-13T02:00:00.000Z");
    const startedFirst = await context.service.execute({
      type: "start-recovery-cycle",
      planId: "recovery-plan-0001",
      cycleId: "recovery-cycle-0001",
      effectiveFrom: "2026-08-13",
      expectedPlanRevision: 3,
      expectedCycleRevision: 1,
      expectedCurrentCycleId: null,
      expectedCurrentCycleRevision: 0,
      expectedActivationSequence: 1,
      expectedDayRevision: usedDayRevision,
      confirmedRemovedUsedItemKeys: [],
    }, "manual-start-cycle-0001");
    expect(startedFirst.applied).toMatchObject({
      operation: "start-recovery-cycle",
      ownerId: "recovery-cycle-0001",
      ownerRevision: 2,
      businessDate: "2026-08-13",
      activationSequence: 2,
    });
    expect(startedFirst.snapshot.selectedDay?.morningItems[0]).toMatchObject({
      itemKey: morningCleanser.itemKey,
      used: true,
    });
    expect(startedFirst.snapshot.recoveryPlans[0]?.cycles[0]).toMatchObject({
      durationDays: 2,
      actualStartedOn: "2026-08-13",
      expectedEndOn: "2026-08-14",
    });

    const completedFirst = await context.service.execute({
      type: "complete-recovery-cycle",
      cycleId: "recovery-cycle-0001",
      completedOn: "2026-08-13",
      expectedCycleRevision: 2,
    }, "manual-complete-cycle-0001");
    expect(completedFirst.snapshot.activationSequence).toBe(2);
    expect(completedFirst.snapshot.recoveryPlans[0]?.cycles.map((cycle) => cycle.status))
      .toEqual(["completed", "draft"]);

    const todayBytes = dayBytes(context.sqlite, "2026-08-13");
    const startedSecond = await context.service.execute({
      type: "start-recovery-cycle",
      planId: "recovery-plan-0001",
      cycleId: "recovery-cycle-0002",
      effectiveFrom: "2026-08-14",
      expectedPlanRevision: 3,
      expectedCycleRevision: 1,
      expectedCurrentCycleId: null,
      expectedCurrentCycleRevision: 0,
      expectedActivationSequence: 2,
      expectedDayRevision: 0,
      confirmedRemovedUsedItemKeys: [],
    }, "manual-start-cycle-0002");
    expect(startedSecond.snapshot.businessDate).toBe("2026-08-14");
    expect(startedSecond.snapshot.activationSequence).toBe(3);
    expect(startedSecond.snapshot.recoveryPlans[0]?.cycles.map((cycle) => cycle.status))
      .toEqual(["completed", "active"]);
    expect(startedSecond.snapshot.recoveryPlans[0]?.cycles[1]).toMatchObject({
      durationDays: 5,
      actualStartedOn: "2026-08-14",
      expectedEndOn: "2026-08-18",
    });
    expect(dayBytes(context.sqlite, "2026-08-13")).toBe(todayBytes);
  });

  it("keeps every professional skincare table under a hard zero-DML boundary", async () => {
    const context = setup();
    denyProfessionalSkincareWrites(context.sqlite);
    await seedProducts(context);
    const empty = await materializeManualSkincareDay(
      context.sqlite,
      "2026-08-13",
      context.options,
    );
    await expect(context.service.execute(
      replaceRoutineCommand({ expectedDayRevision: empty.selectedDay!.revision }),
      "manual-professional-boundary-0001",
    )).resolves.toMatchObject({
      snapshot: { latestRoutineRevision: 1, activationSequence: 1 },
    });
  });
});
