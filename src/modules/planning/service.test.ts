import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { migrateDatabase } from "@/core/db/migrate";
import { RevisionConflictError } from "@/core/mutations/revision";

import type { PlanningCommand } from "./contracts";
import { PlanningValidationError } from "./contracts";
import {
  PlanningConflictError,
  createPlanningService,
  getPlanningSnapshot,
} from "./service";

const databases: Database.Database[] = [];

const generalLifeAreaId = "life-area-general";
const longTermGoal: Extract<PlanningCommand, { type: "create-goal" }> = {
  type: "create-goal",
  id: "goal-long-0001",
  lifeAreaId: generalLifeAreaId,
  goalType: "long-term",
  title: "Build a durable planning practice",
  description: "A long-term goal",
  startDate: "2026-08-01",
  targetDate: "2026-12-31",
};

function setup(now = new Date("2026-08-10T01:02:03.000Z")) {
  const sqlite = new Database(":memory:");
  databases.push(sqlite);
  migrateDatabase(sqlite);
  let generated = 0;

  return {
    sqlite,
    service: createPlanningService(sqlite, {
      now: () => now,
      createId: () => `generated-event-${++generated}`,
      writeBarrier: { runWrite: async <T>(action: () => T | Promise<T>) => action() },
    }),
  };
}

function actionRow(sqlite: Database.Database, id: string) {
  return sqlite
    .prepare(
      `select id, goal_id, parent_action_id, action_type, business_date, status, revision
       from actions where id = ?`,
    )
    .get(id);
}

function eventRows(sqlite: Database.Database, actionId: string) {
  return sqlite
    .prepare(
      `select event_type, business_date, from_business_date, to_business_date, occurred_at
       from action_events where action_id = ? order by rowid`,
    )
    .all(actionId);
}

async function createGoalAndTodayAction(
  service: ReturnType<typeof createPlanningService>,
  actionId = "today-action-0001",
) {
  await service.execute(longTermGoal, "planning-key-goal-0001");
  await service.execute(
    {
      type: "create-action",
      id: actionId,
      goalId: longTermGoal.id,
      actionType: "today",
      businessDate: "2026-08-10",
      title: "Complete one focused planning action",
      priority: "normal",
      notes: "",
    },
    "planning-key-action-0001",
  );
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe("planning service", () => {
  it("replays the same planning command without duplicating rows", async () => {
    const { sqlite, service } = setup();

    const first = await service.execute(longTermGoal, "planning-key-0001");
    const replay = await service.execute(
      { ...longTermGoal, title: longTermGoal.title },
      "planning-key-0001",
    );

    expect(replay).toEqual(first);
    expect(sqlite.prepare("select count(*) from goals").pluck().get()).toBe(1);
    expect(first.goals).toEqual([
      expect.objectContaining({ id: longTermGoal.id, revision: 1, status: "active" }),
    ]);
  });

  it("rejects invalid goal hierarchy, inactive parents, mismatched life areas, and reversed dates", async () => {
    const { sqlite, service } = setup();
    await service.execute(longTermGoal, "planning-key-hierarchy-0001");
    await service.execute(
      {
        type: "create-goal",
        id: "goal-stage-0001",
        lifeAreaId: generalLifeAreaId,
        parentGoalId: longTermGoal.id,
        goalType: "stage",
        title: "Create a stage goal",
        description: "",
      },
      "planning-key-hierarchy-0002",
    );
    sqlite.prepare(
      `insert into life_areas (id, name, display_order, revision, created_at, updated_at, archived_at)
       values (?, ?, 1, 1, ?, ?, null)`,
    ).run(
      "life-area-other",
      "Other",
      "2026-08-10T00:00:00.000Z",
      "2026-08-10T00:00:00.000Z",
    );

    const invalidCommands: PlanningCommand[] = [
      {
        type: "create-goal",
        id: "goal-stage-0002",
        lifeAreaId: generalLifeAreaId,
        parentGoalId: "goal-stage-0001",
        goalType: "stage",
        title: "A stage cannot parent another stage",
        description: "",
      },
      {
        type: "create-goal",
        id: "goal-stage-0003",
        lifeAreaId: "life-area-other",
        parentGoalId: longTermGoal.id,
        goalType: "stage",
        title: "A stage must remain in its parent life area",
        description: "",
      },
      {
        type: "create-goal",
        id: "goal-date-00001",
        lifeAreaId: generalLifeAreaId,
        goalType: "long-term",
        title: "Dates must progress forward",
        description: "",
        startDate: "2026-12-31",
        targetDate: "2026-08-10",
      },
    ];

    for (const [index, command] of invalidCommands.entries()) {
      await expect(
        service.execute(command, `planning-key-invalid-${index}`),
      ).rejects.toBeInstanceOf(PlanningValidationError);
    }
    expect(sqlite.prepare("select count(*) from goals").pluck().get()).toBe(2);
  });

  it("only creates action children for active goals and enforces weekly and today hierarchy rules", async () => {
    const { sqlite, service } = setup();
    await service.execute(longTermGoal, "planning-key-action-rule-0001");
    await service.execute(
      {
        type: "create-action",
        id: "weekly-action-0001",
        goalId: longTermGoal.id,
        actionType: "weekly",
        title: "Plan the week",
        priority: "high",
        notes: "",
      },
      "planning-key-action-rule-0002",
    );

    const invalidCommands: PlanningCommand[] = [
      {
        type: "create-action",
        id: "weekly-action-0002",
        goalId: longTermGoal.id,
        actionType: "weekly",
        businessDate: "2026-08-10",
        title: "Weekly actions are unscheduled",
        priority: "normal",
        notes: "",
      },
      {
        type: "create-action",
        id: "today-action-0001",
        goalId: longTermGoal.id,
        actionType: "today",
        title: "Today actions need a date",
        priority: "normal",
        notes: "",
      },
      {
        type: "create-action",
        id: "today-action-0002",
        goalId: null,
        parentActionId: "weekly-action-0001",
        actionType: "today",
        businessDate: "2026-08-10",
        title: "A child keeps its parent goal identity",
        priority: "normal",
        notes: "",
      },
    ];

    for (const [index, command] of invalidCommands.entries()) {
      await expect(
        service.execute(command, `planning-key-action-invalid-${index}`),
      ).rejects.toBeInstanceOf(PlanningValidationError);
    }

    await service.execute(
      {
        type: "update-goal",
        id: longTermGoal.id,
        revision: 1,
        title: longTermGoal.title,
        description: longTermGoal.description,
        status: "paused",
        progressPercent: 0,
      },
      "planning-key-action-rule-0003",
    );
    await expect(
      service.execute(
        {
          type: "create-action",
          id: "today-action-0003",
          goalId: longTermGoal.id,
          actionType: "today",
          businessDate: "2026-08-10",
          title: "Inactive goals cannot gain actions",
          priority: "normal",
          notes: "",
        },
        "planning-key-action-rule-0004",
      ),
    ).rejects.toBeInstanceOf(PlanningValidationError);
    expect(sqlite.prepare("select count(*) from actions").pluck().get()).toBe(1);
  });

  it("rejects a second today child for the same weekly parent and business date across distinct commands", async () => {
    const { sqlite, service } = setup();
    await service.execute(longTermGoal, "planning-key-duplicate-child-goal");
    await service.execute(
      {
        type: "create-action",
        id: "weekly-duplicate-parent",
        goalId: longTermGoal.id,
        actionType: "weekly",
        title: "Plan one weekly action",
        priority: "normal",
        notes: "",
      },
      "planning-key-duplicate-child-weekly",
    );
    await service.execute(
      {
        type: "create-action",
        id: "today-duplicate-child-1",
        goalId: longTermGoal.id,
        parentActionId: "weekly-duplicate-parent",
        actionType: "today",
        businessDate: "2026-08-10",
        title: "Plan one weekly action",
        priority: "normal",
        notes: "",
      },
      "planning-key-duplicate-child-first",
    );

    await expect(
      service.execute(
        {
          type: "create-action",
          id: "today-duplicate-child-2",
          goalId: longTermGoal.id,
          parentActionId: "weekly-duplicate-parent",
          actionType: "today",
          businessDate: "2026-08-10",
          title: "Plan one weekly action",
          priority: "normal",
          notes: "",
        },
        "planning-key-duplicate-child-second",
      ),
    ).rejects.toBeInstanceOf(PlanningConflictError);
    expect(
      sqlite
        .prepare(
          `select count(*) from actions
           where action_type = 'today' and parent_action_id = ? and business_date = ?`,
        )
        .pluck()
        .get("weekly-duplicate-parent", "2026-08-10"),
    ).toBe(1);
  });

  it("records a status transition as one immutable event before projecting the new action status", async () => {
    const { sqlite, service } = setup();
    await createGoalAndTodayAction(service);

    await service.execute(
      {
        type: "set-action-status",
        actionId: "today-action-0001",
        revision: 1,
        businessDate: "2026-08-10",
        status: "completed",
      },
      "planning-key-status-0001",
    );

    expect(actionRow(sqlite, "today-action-0001")).toMatchObject({
      status: "completed",
      revision: 2,
    });
    expect(eventRows(sqlite, "today-action-0001")).toEqual([
      {
        event_type: "completed",
        business_date: "2026-08-10",
        from_business_date: null,
        to_business_date: null,
        occurred_at: "2026-08-10T01:02:03.000Z",
      },
    ]);
  });

  it("leaves events and revisions untouched for stale, no-op, and wrong-from mutations", async () => {
    const { sqlite, service } = setup();
    await createGoalAndTodayAction(service);

    await expect(
      service.execute(
        {
          type: "set-action-status",
          actionId: "today-action-0001",
          revision: 2,
          businessDate: "2026-08-10",
          status: "completed",
        },
        "planning-key-stale-0001",
      ),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    await service.execute(
      {
        type: "set-action-status",
        actionId: "today-action-0001",
        revision: 1,
        businessDate: "2026-08-10",
        status: "pending",
      },
      "planning-key-noop-0001",
    );
    await expect(
      service.execute(
        {
          type: "reschedule-action",
          actionId: "today-action-0001",
          revision: 1,
          fromBusinessDate: "2026-08-09",
          toBusinessDate: "2026-08-11",
        },
        "planning-key-wrong-from-0001",
      ),
    ).rejects.toBeInstanceOf(PlanningConflictError);
    await service.execute(
      {
        type: "reschedule-action",
        actionId: "today-action-0001",
        revision: 1,
        fromBusinessDate: "2026-08-10",
        toBusinessDate: "2026-08-10",
      },
      "planning-key-noop-0002",
    );

    expect(actionRow(sqlite, "today-action-0001")).toMatchObject({
      business_date: "2026-08-10",
      revision: 1,
      status: "pending",
    });
    expect(eventRows(sqlite, "today-action-0001")).toEqual([]);
    expect(sqlite.prepare("select count(*) from idempotency_keys").pluck().get()).toBe(4);
  });

  it("uses the injected Shanghai operation day for reschedule facts while from and to retain schedule dates", async () => {
    const { sqlite, service } = setup(new Date("2026-08-10T16:30:00.000Z"));
    await createGoalAndTodayAction(service);

    await service.execute(
      {
        type: "reschedule-action",
        actionId: "today-action-0001",
        revision: 1,
        fromBusinessDate: "2026-08-10",
        toBusinessDate: "2026-08-12",
      },
      "planning-key-reschedule-0001",
    );

    expect(actionRow(sqlite, "today-action-0001")).toMatchObject({
      business_date: "2026-08-12",
      revision: 2,
    });
    expect(eventRows(sqlite, "today-action-0001")).toEqual([
      {
        event_type: "rescheduled",
        business_date: "2026-08-11",
        from_business_date: "2026-08-10",
        to_business_date: "2026-08-12",
        occurred_at: "2026-08-10T16:30:00.000Z",
      },
    ]);
  });

  it("keeps null-goal actions visible and exposes only legacy undated today actions as unassigned", async () => {
    const { sqlite, service } = setup();
    await service.execute(
      {
        type: "create-action",
        id: "weekly-no-goal-001",
        goalId: null,
        actionType: "weekly",
        title: "A weekly action without a goal is allowed",
        priority: "low",
        notes: "",
      },
      "planning-key-null-goal-0001",
    );
    sqlite.exec("drop trigger actions_require_today_business_date_insert");
    sqlite.prepare(
      `insert into actions
        (id, goal_id, parent_action_id, action_type, business_date, title, status, priority,
         estimated_minutes, notes, revision, created_at, updated_at, archived_at)
       values (?, null, null, 'today', null, ?, 'pending', 'normal', null, '', 1, ?, ?, null)`,
    ).run(
      "legacy-undated-001",
      "Legacy undated task",
      "2026-08-01T00:00:00.000Z",
      "2026-08-01T00:00:00.000Z",
    );

    const snapshot = getPlanningSnapshot(sqlite, { businessDate: "2026-08-10" });

    expect(snapshot.weeklyActions).toEqual([
      expect.objectContaining({ id: "weekly-no-goal-001", goalId: null, businessDate: null }),
    ]);
    expect(snapshot.unassignedActions).toEqual([
      expect.objectContaining({
        id: "legacy-undated-001",
        actionType: "today",
        businessDate: null,
        goalId: null,
      }),
    ]);
    expect(snapshot.todayActions).toEqual([]);
    expect(snapshot.overdueActions).toEqual([]);
  });

  // Migration v2 allowed weekly rows with dates, so readers must preserve and surface them.
  it("keeps a migrated weekly action with its legacy business date visible without rewriting it", () => {
    const { sqlite } = setup();
    sqlite.prepare(
      `insert into actions
        (id, goal_id, parent_action_id, action_type, business_date, title, status, priority,
         estimated_minutes, notes, revision, created_at, updated_at, archived_at)
       values (?, null, null, 'weekly', ?, ?, 'pending', 'normal', null, '', 1, ?, ?, null)`,
    ).run(
      "legacy-dated-weekly-001",
      "2026-08-03",
      "Legacy weekly action with an assigned date",
      "2026-08-03T00:00:00.000Z",
      "2026-08-03T00:00:00.000Z",
    );

    const snapshot = getPlanningSnapshot(sqlite, { businessDate: "2026-08-10" });

    expect(snapshot.weeklyActions).toEqual([
      expect.objectContaining({
        id: "legacy-dated-weekly-001",
        actionType: "weekly",
        businessDate: "2026-08-03",
      }),
    ]);
    expect(
      sqlite.prepare("select business_date from actions where id = ?").pluck().get("legacy-dated-weekly-001"),
    ).toBe("2026-08-03");
  });

  // A hidden archived weekly parent cannot receive a new visible today child.
  it("rejects a today child of an archived weekly parent without persisting a partial command", async () => {
    const { sqlite, service } = setup();
    await service.execute(longTermGoal, "planning-key-archived-parent-0001");
    await service.execute(
      {
        type: "create-action",
        id: "weekly-archived-parent-001",
        goalId: longTermGoal.id,
        actionType: "weekly",
        title: "An archived weekly parent",
        priority: "normal",
        notes: "",
      },
      "planning-key-archived-parent-0002",
    );
    sqlite.prepare(
      "update actions set status = 'archived', archived_at = ? where id = ?",
    ).run("2026-08-10T01:02:03.000Z", "weekly-archived-parent-001");

    await expect(
      service.execute(
        {
          type: "create-action",
          id: "today-child-of-archived-001",
          goalId: longTermGoal.id,
          parentActionId: "weekly-archived-parent-001",
          actionType: "today",
          businessDate: "2026-08-10",
          title: "A child must not attach to archived work",
          priority: "normal",
          notes: "",
        },
        "planning-key-archived-parent-0003",
      ),
    ).rejects.toBeInstanceOf(PlanningValidationError);

    expect(actionRow(sqlite, "today-child-of-archived-001")).toBeUndefined();
    expect(sqlite.prepare("select count(*) from idempotency_keys").pluck().get()).toBe(2);
  });

  // Read-model snapshots cross the server/client boundary as plain serializable values.
  it("returns a structured-cloneable planning snapshot", async () => {
    const { sqlite, service } = setup();
    await createGoalAndTodayAction(service);

    const snapshot = getPlanningSnapshot(sqlite, { businessDate: "2026-08-10" });

    expect(structuredClone(snapshot)).toEqual(snapshot);
  });
});
