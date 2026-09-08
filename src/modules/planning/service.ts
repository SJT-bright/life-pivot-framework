import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import {
  type IdempotentCommandOptions,
  runIdempotentCommand,
} from "@/core/db/idempotent-command";
import { assertExpectedRevision } from "@/core/mutations/revision";
import { toShanghaiBusinessDate } from "@/core/time/business-date";

import {
  type PlanningAction,
  type PlanningCommand,
  type PlanningSnapshot,
  PlanningValidationError,
  parsePlanningBusinessDate,
  parsePlanningCommand,
} from "./contracts";

export class PlanningConflictError extends Error {
  constructor(message = "The planning command no longer matches the current state.") {
    super(message);
    this.name = "PlanningConflictError";
  }
}

export interface PlanningServiceDependencies {
  now?: () => Date;
  createId?: () => string;
  writeBarrier?: IdempotentCommandOptions["writeBarrier"];
}

export interface PlanningService {
  execute(command: PlanningCommand, idempotencyKey: string): Promise<PlanningSnapshot>;
}

interface GoalRow {
  id: string;
  life_area_id: string;
  parent_goal_id: string | null;
  goal_type: "long-term" | "stage";
  title: string;
  description: string;
  status: "active" | "completed" | "paused" | "archived";
  progress_percent: number;
  revision: number;
  archived_at: string | null;
}

interface ActionRow {
  id: string;
  goal_id: string | null;
  parent_action_id: string | null;
  action_type: "weekly" | "today";
  business_date: string | null;
  title: string;
  status: "pending" | "completed" | "skipped" | "archived";
  priority: "low" | "normal" | "high";
  estimated_minutes: number | null;
  notes: string;
  revision: number;
  archived_at: string | null;
}

function validation(message: string): never {
  throw new PlanningValidationError(message);
}

function findGoal(sqlite: Database.Database, id: string): GoalRow | undefined {
  return sqlite
    .prepare(
      `select id, life_area_id, parent_goal_id, goal_type, title, description, status,
              progress_percent, revision, archived_at
       from goals where id = ?`,
    )
    .get(id) as GoalRow | undefined;
}

function findAction(sqlite: Database.Database, id: string): ActionRow | undefined {
  return sqlite
    .prepare(
      `select id, goal_id, parent_action_id, action_type, business_date, title, status,
              priority, estimated_minutes, notes, revision, archived_at
       from actions where id = ?`,
    )
    .get(id) as ActionRow | undefined;
}

function assertActiveGoal(sqlite: Database.Database, goalId: string | null): void {
  if (goalId === null) return;
  const goal = findGoal(sqlite, goalId);
  if (!goal || goal.status !== "active" || goal.archived_at !== null) {
    validation("Actions can only be added to active goals.");
  }
}

function actionSnapshot(row: ActionRow): PlanningAction {
  return {
    id: row.id,
    goalId: row.goal_id,
    parentActionId: row.parent_action_id,
    actionType: row.action_type,
    businessDate: row.business_date,
    title: row.title,
    status: row.status,
    priority: row.priority,
    estimatedMinutes: row.estimated_minutes,
    notes: row.notes,
    revision: row.revision,
  };
}

function actionRows(
  sqlite: Database.Database,
  sql: string,
  ...parameters: readonly unknown[]
): ReadonlyArray<PlanningAction> {
  return (sqlite.prepare(sql).all(...parameters) as ActionRow[]).map(actionSnapshot);
}

export function getPlanningSnapshot(
  sqlite: Database.Database,
  input: { businessDate: string },
): PlanningSnapshot {
  const businessDate = parsePlanningBusinessDate(input.businessDate);
  const lifeAreas = sqlite
    .prepare(
      `select id, name from life_areas
       where archived_at is null
       order by display_order asc, name asc, id asc`,
    )
    .all() as Array<{ id: string; name: string }>;
  const goals = sqlite
    .prepare(
      `select id, life_area_id, parent_goal_id, goal_type, title, description, status,
              progress_percent, revision
       from goals
       where status = 'active' and archived_at is null
       order by created_at asc, id asc`,
    )
    .all()
    .map((row) => {
      const goal = row as Omit<GoalRow, "archived_at">;
      return {
        id: goal.id,
        lifeAreaId: goal.life_area_id,
        parentGoalId: goal.parent_goal_id,
        goalType: goal.goal_type,
        title: goal.title,
        description: goal.description,
        status: goal.status,
        progressPercent: goal.progress_percent,
        revision: goal.revision,
      };
    });
  const actionColumns = `id, goal_id, parent_action_id, action_type, business_date, title, status,
    priority, estimated_minutes, notes, revision, archived_at`;
  const visibleAction = "status <> 'archived' and archived_at is null";

  return {
    businessDate,
    lifeAreas,
    goals,
    weeklyActions: actionRows(
      sqlite,
      `select ${actionColumns} from actions
       where action_type = 'weekly' and ${visibleAction}
       order by created_at asc, id asc`,
    ),
    todayActions: actionRows(
      sqlite,
      `select ${actionColumns} from actions
       where action_type = 'today' and business_date = ? and ${visibleAction}
       order by created_at asc, id asc`,
      businessDate,
    ),
    overdueActions: actionRows(
      sqlite,
      `select ${actionColumns} from actions
       where action_type = 'today' and business_date is not null and business_date < ?
         and status = 'pending' and archived_at is null
       order by business_date asc, created_at asc, id asc`,
      businessDate,
    ),
    unassignedActions: actionRows(
      sqlite,
      `select ${actionColumns} from actions
       where action_type = 'today' and business_date is null and ${visibleAction}
       order by created_at asc, id asc`,
    ),
  };
}

function createGoal(
  sqlite: Database.Database,
  command: Extract<PlanningCommand, { type: "create-goal" }>,
  timestamp: string,
): void {
  if (findGoal(sqlite, command.id)) validation("A goal with this id already exists.");
  const lifeArea = sqlite
    .prepare("select id from life_areas where id = ? and archived_at is null")
    .get(command.lifeAreaId);
  if (!lifeArea) validation("The selected life area does not exist.");

  const parentGoalId = command.parentGoalId ?? null;
  const startDate = command.startDate ?? null;
  const targetDate = command.targetDate ?? null;
  if (startDate !== null && targetDate !== null && startDate > targetDate) {
    validation("A goal target date cannot precede its start date.");
  }
  if (command.goalType === "long-term") {
    if (parentGoalId !== null) validation("Long-term goals cannot have a parent goal.");
  } else {
    if (parentGoalId === null) validation("Stage goals require a long-term parent goal.");
    const parent = findGoal(sqlite, parentGoalId);
    if (
      !parent ||
      parent.goal_type !== "long-term" ||
      parent.life_area_id !== command.lifeAreaId ||
      parent.status !== "active" ||
      parent.archived_at !== null
    ) {
      validation("Stage goals require an active long-term parent in the same life area.");
    }
  }

  sqlite
    .prepare(
      `insert into goals
        (id, life_area_id, parent_goal_id, goal_type, title, description, start_date,
         target_date, progress_percent, status, revision, created_at, updated_at, archived_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', 1, ?, ?, null)`,
    )
    .run(
      command.id,
      command.lifeAreaId,
      parentGoalId,
      command.goalType,
      command.title,
      command.description,
      startDate,
      targetDate,
      timestamp,
      timestamp,
    );
}

function updateGoal(
  sqlite: Database.Database,
  command: Extract<PlanningCommand, { type: "update-goal" }>,
  timestamp: string,
): void {
  const goal = findGoal(sqlite, command.id);
  if (!goal) validation("The goal does not exist.");
  assertExpectedRevision(command.revision, goal.revision);
  sqlite
    .prepare(
      `update goals
       set title = ?, description = ?, status = ?, progress_percent = ?, revision = ?,
           updated_at = ?, archived_at = ?
       where id = ?`,
    )
    .run(
      command.title,
      command.description,
      command.status,
      command.progressPercent,
      goal.revision + 1,
      timestamp,
      command.status === "archived" ? timestamp : null,
      command.id,
    );
}

function createAction(
  sqlite: Database.Database,
  command: Extract<PlanningCommand, { type: "create-action" }>,
  timestamp: string,
): void {
  if (findAction(sqlite, command.id)) validation("An action with this id already exists.");
  const goalId = command.goalId ?? null;
  const parentActionId = command.parentActionId ?? null;
  const businessDate = command.businessDate ?? null;
  if (command.actionType === "weekly") {
    if (businessDate !== null || parentActionId !== null) {
      validation("Weekly actions must have no business date or parent action.");
    }
  } else if (businessDate === null) {
    validation("Today actions require a business date.");
  }

  assertActiveGoal(sqlite, goalId);
  if (parentActionId !== null) {
    const parent = findAction(sqlite, parentActionId);
    if (
      command.actionType !== "today" ||
      !parent ||
      parent.action_type !== "weekly" ||
      parent.goal_id !== goalId ||
      parent.status === "archived" ||
      parent.archived_at !== null
    ) {
      validation("Today action parents must be weekly actions with the same goal.");
    }
    const existingChild = sqlite
      .prepare(
        `select id from actions
         where action_type = 'today' and parent_action_id = ? and business_date = ?
         limit 1`,
      )
      .get(parentActionId, businessDate);
    if (existingChild) {
      throw new PlanningConflictError(
        "This weekly action is already scheduled for the requested business date.",
      );
    }
  }

  sqlite
    .prepare(
      `insert into actions
        (id, goal_id, parent_action_id, action_type, business_date, title, status, priority,
         estimated_minutes, notes, revision, created_at, updated_at, archived_at)
       values (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, 1, ?, ?, null)`,
    )
    .run(
      command.id,
      goalId,
      parentActionId,
      command.actionType,
      businessDate,
      command.title,
      command.priority,
      command.estimatedMinutes ?? null,
      command.notes,
      timestamp,
      timestamp,
    );
}

function setActionStatus(
  sqlite: Database.Database,
  command: Extract<PlanningCommand, { type: "set-action-status" }>,
  timestamp: string,
  createId: () => string,
): void {
  const action = findAction(sqlite, command.actionId);
  if (!action || action.archived_at !== null || action.status === "archived") {
    validation("The action is not available.");
  }
  assertExpectedRevision(command.revision, action.revision);
  if (action.status === command.status) return;

  const eventType = command.status === "pending"
    ? "reopened"
    : command.status;
  sqlite
    .prepare(
      `insert into action_events
        (id, action_id, event_type, business_date, from_business_date, to_business_date,
         occurred_at, payload_json)
       values (?, ?, ?, ?, null, null, ?, '{}')`,
    )
    .run(createId(), action.id, eventType, command.businessDate, timestamp);
  sqlite
    .prepare(
      `update actions
       set status = ?, revision = ?, updated_at = ?
       where id = ?`,
    )
    .run(command.status, action.revision + 1, timestamp, action.id);
}

function rescheduleAction(
  sqlite: Database.Database,
  command: Extract<PlanningCommand, { type: "reschedule-action" }>,
  timestamp: string,
  operationBusinessDate: string,
  createId: () => string,
): void {
  const action = findAction(sqlite, command.actionId);
  if (!action || action.archived_at !== null || action.status === "archived") {
    validation("The action is not available.");
  }
  assertExpectedRevision(command.revision, action.revision);
  if (action.action_type !== "today" || action.business_date === null) {
    validation("Only dated today actions can be rescheduled.");
  }
  if (action.business_date !== command.fromBusinessDate) {
    throw new PlanningConflictError("The action no longer has the requested source date.");
  }
  if (command.fromBusinessDate === command.toBusinessDate) return;

  sqlite
    .prepare(
      `insert into action_events
        (id, action_id, event_type, business_date, from_business_date, to_business_date,
         occurred_at, payload_json)
       values (?, ?, 'rescheduled', ?, ?, ?, ?, '{}')`,
    )
    .run(
      createId(),
      action.id,
      operationBusinessDate,
      command.fromBusinessDate,
      command.toBusinessDate,
      timestamp,
    );
  sqlite
    .prepare(
      `update actions
       set business_date = ?, revision = ?, updated_at = ?
       where id = ?`,
    )
    .run(command.toBusinessDate, action.revision + 1, timestamp, action.id);
}

function applyCommand(
  sqlite: Database.Database,
  command: PlanningCommand,
  now: Date,
  createId: () => string,
): void {
  const timestamp = now.toISOString();
  switch (command.type) {
    case "create-goal":
      createGoal(sqlite, command, timestamp);
      return;
    case "update-goal":
      updateGoal(sqlite, command, timestamp);
      return;
    case "create-action":
      createAction(sqlite, command, timestamp);
      return;
    case "set-action-status":
      setActionStatus(sqlite, command, timestamp, createId);
      return;
    case "reschedule-action":
      rescheduleAction(
        sqlite,
        command,
        timestamp,
        toShanghaiBusinessDate(now),
        createId,
      );
      return;
  }
}

export function createPlanningService(
  sqlite: Database.Database,
  dependencies: PlanningServiceDependencies = {},
): PlanningService {
  const now = dependencies.now ?? (() => new Date());
  const createId = dependencies.createId ?? randomUUID;

  return {
    execute(command, idempotencyKey) {
      let transactionNow: Date | undefined;
      const stableNow = () => {
        transactionNow ??= now();
        return transactionNow;
      };

      return runIdempotentCommand(
        sqlite,
        {
          operation: "planning.command",
          idempotencyKey,
          now: stableNow,
          writeBarrier: dependencies.writeBarrier,
        },
        command,
        () => {
          const parsed = parsePlanningCommand(command);
          const acceptedAt = stableNow();
          applyCommand(sqlite, parsed, acceptedAt, createId);
          return getPlanningSnapshot(sqlite, {
            businessDate: toShanghaiBusinessDate(acceptedAt),
          });
        },
      );
    },
  };
}
