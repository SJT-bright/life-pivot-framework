// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlanningAction, PlanningSnapshot } from "@/modules/planning/contracts";

import { PlanningWorkspace } from "./planning-workspace";

const businessDate = "2026-08-10";
type PlanningRequest = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function mockRequest(implementation: PlanningRequest) {
  return vi.fn<PlanningRequest>(implementation);
}

function ids() {
  let index = 0;
  return () => `generated-${String(++index).padStart(8, "0")}`;
}

function snapshot(overrides: Partial<PlanningSnapshot> = {}): PlanningSnapshot {
  return {
    businessDate,
    lifeAreas: [{ id: "area-000001", name: "个人成长" }],
    goals: [],
    weeklyActions: [],
    todayActions: [],
    overdueActions: [],
    unassignedActions: [],
    ...overrides,
  };
}

function action(overrides: Partial<PlanningAction> = {}): PlanningAction {
  return {
    id: "action-000001",
    goalId: "goal-long-0001",
    parentActionId: null,
    actionType: "today",
    businessDate,
    title: "整理今日笔记",
    status: "pending",
    priority: "normal",
    estimatedMinutes: null,
    notes: "",
    revision: 1,
    ...overrides,
  };
}

function commandFrom(init?: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe("PlanningWorkspace", () => {
  it("places the goal board before every creation form and omits idle promotional copy", () => {
    render(<PlanningWorkspace businessDate={businessDate} initialSnapshot={snapshot()} />);

    const board = screen.getByLabelText("目标与行动看板");
    const forms = screen.getByLabelText("创建目标与行动");
    expect(board.compareDocumentPosition(forms) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(screen.queryByText("可以开始规划")).not.toBeInTheDocument();
    expect(screen.queryByText("当前只显示活跃目标。")).not.toBeInTheDocument();
  });

  it("puts tomorrow actions and long-term goals in the first focus area", () => {
    const longTermGoal: PlanningSnapshot["goals"][number] = {
      id: "goal-long-0001",
      lifeAreaId: "area-000001",
      parentGoalId: null,
      goalType: "long-term",
      title: "持续积累个人作品",
      description: "",
      status: "active",
      progressPercent: 35,
      revision: 1,
    };
    const tomorrowAction = action({
      id: "action-tomorrow-0001",
      businessDate: "2026-08-11",
      title: "整理前一天复盘留下的目标",
    });

    render(
      <PlanningWorkspace
        businessDate={businessDate}
        initialSnapshot={snapshot({ goals: [longTermGoal] })}
        initialTomorrowActions={[tomorrowAction]}
        tomorrowBusinessDate="2026-08-11"
      />,
    );

    const focus = screen.getByLabelText("明日目标与长期目标");
    const board = screen.getByLabelText("目标与行动看板");
    expect(focus.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(within(focus).getByRole("heading", { name: "明日目标" })).toBeVisible();
    expect(within(focus).getByText("整理前一天复盘留下的目标")).toBeVisible();
    expect(within(focus).getByRole("heading", { name: "长期目标" })).toBeVisible();
    expect(within(focus).getByText("持续积累个人作品")).toBeVisible();
    expect(within(focus).getByText("35%")).toBeVisible();
  });

  it("creates a long-term goal and then a stage goal", async () => {
    const user = userEvent.setup();
    const longTermGoal: PlanningSnapshot["goals"][number] = {
      id: "generated-00000001",
      lifeAreaId: "area-000001",
      parentGoalId: null,
      goalType: "long-term",
      title: "建立个人知识资产",
      description: "",
      status: "active",
      progressPercent: 0,
      revision: 1,
    };
    const stageGoal: PlanningSnapshot["goals"][number] = {
      id: "generated-00000003",
      lifeAreaId: "area-000001",
      parentGoalId: longTermGoal.id,
      goalType: "stage",
      title: "完成第一轮资料整理",
      description: "",
      status: "active",
      progressPercent: 0,
      revision: 1,
    };
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const command = commandFrom(init);
      return Response.json(command.goalType === "long-term"
        ? snapshot({ goals: [longTermGoal] })
        : snapshot({ goals: [longTermGoal, stageGoal] }));
    });

    render(
      <PlanningWorkspace
        businessDate={businessDate}
        createId={ids()}
        initialSnapshot={snapshot()}
        request={request}
      />,
    );

    await user.type(screen.getByLabelText("长期目标名称"), longTermGoal.title);
    await user.click(screen.getByRole("button", { name: "创建长期目标" }));

    expect((await screen.findAllByText(longTermGoal.title))[0]).toBeVisible();
    const [, firstInit] = request.mock.calls[0] ?? [];
    expect(commandFrom(firstInit)).toMatchObject({
      type: "create-goal",
      goalType: "long-term",
      lifeAreaId: "area-000001",
      parentGoalId: null,
      title: longTermGoal.title,
    });

    await user.selectOptions(screen.getByLabelText("父级长期目标"), longTermGoal.id);
    await user.type(screen.getByLabelText("阶段目标名称"), stageGoal.title);
    await user.click(screen.getByRole("button", { name: "创建阶段目标" }));

    expect(await screen.findByText(stageGoal.title)).toBeVisible();
    expect(request).toHaveBeenCalledTimes(2);
    const [, secondInit] = request.mock.calls[1] ?? [];
    expect(commandFrom(secondInit)).toMatchObject({
      type: "create-goal",
      goalType: "stage",
      lifeAreaId: "area-000001",
      parentGoalId: longTermGoal.id,
      title: stageGoal.title,
    });
  });

  it("completes a today action exactly once", async () => {
    const user = userEvent.setup();
    const todayAction = action();
    const request = mockRequest(async () => Response.json(snapshot({
      todayActions: [{ ...todayAction, status: "completed", revision: 2 }],
    })));

    render(
      <PlanningWorkspace
        businessDate={businessDate}
        createId={ids()}
        initialSnapshot={snapshot({ todayActions: [todayAction] })}
        request={request}
      />,
    );

    await user.click(screen.getByRole("button", { name: "完成：整理今日笔记" }));

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    const [, init] = request.mock.calls[0] ?? [];
    expect(commandFrom(init)).toEqual({
      type: "set-action-status",
      actionId: todayAction.id,
      revision: 1,
      businessDate,
      status: "completed",
    });
    expect(await screen.findByText("已完成")).toBeVisible();
  });

  it("confirms an overdue completion that disappears and unlocks the next mutation", async () => {
    const user = userEvent.setup();
    const overdue = action({
      id: "overdue-action-0001",
      goalId: null,
      businessDate: "2026-08-09",
      title: "完成逾期行动",
    });
    const createdWeekly = action({
      id: "generated-00000002",
      goalId: null,
      actionType: "weekly",
      businessDate: null,
      title: "完成后继续规划",
    });
    const request = mockRequest(async (_input, init) => {
      const command = commandFrom(init);
      return Response.json(command.type === "set-action-status"
        ? snapshot()
        : snapshot({ weeklyActions: [createdWeekly] }));
    });

    render(
      <PlanningWorkspace
        businessDate={businessDate}
        createId={ids()}
        initialSnapshot={snapshot({ overdueActions: [overdue] })}
        request={request}
      />,
    );

    await user.click(screen.getByRole("button", { name: "完成：完成逾期行动" }));
    expect(await screen.findByText("已保存")).toBeVisible();

    await user.type(screen.getByLabelText("本周行动名称"), createdWeekly.title);
    await user.click(screen.getByRole("button", { name: "创建本周行动" }));

    expect(await screen.findByText(createdWeekly.title)).toBeVisible();
    expect(request).toHaveBeenCalledTimes(2);
    const [, secondInit] = request.mock.calls[1] ?? [];
    expect(commandFrom(secondInit)).toMatchObject({
      type: "create-action",
      id: createdWeekly.id,
      title: createdWeekly.title,
    });
  });

  it("settles a same-key retry when an overdue completion disappears", async () => {
    const user = userEvent.setup();
    const overdue = action({
      id: "overdue-action-retry",
      goalId: null,
      businessDate: "2026-08-09",
      title: "重试逾期完成",
    });
    const request = mockRequest(async () => request.mock.calls.length === 1
      ? Response.json({ message: "unknown" }, { status: 500 })
      : Response.json(snapshot()));

    render(
      <PlanningWorkspace
        businessDate={businessDate}
        createId={ids()}
        initialSnapshot={snapshot({ overdueActions: [overdue] })}
        request={request}
      />,
    );

    await user.click(screen.getByRole("button", { name: "完成：重试逾期完成" }));
    const retry = await screen.findByRole("button", { name: "使用原提交重试" });
    const [, firstInit] = request.mock.calls[0] ?? [];
    await user.click(retry);

    expect(await screen.findByText("已保存")).toBeVisible();
    expect(screen.queryByRole("button", { name: "使用原提交重试" })).not.toBeInTheDocument();
    const [, secondInit] = request.mock.calls[1] ?? [];
    expect(secondInit?.body).toBe(firstInit?.body);
    expect(secondInit?.headers).toEqual(firstInit?.headers);
  });

  it("keeps the frozen retry when an action status response jumps to an unrelated revision", async () => {
    const user = userEvent.setup();
    const todayAction = action();
    const request = mockRequest(async () => Response.json(snapshot({
      todayActions: [{ ...todayAction, status: "completed", revision: 99 }],
    })));

    render(
      <PlanningWorkspace
        businessDate={businessDate}
        createId={ids()}
        initialSnapshot={snapshot({ todayActions: [todayAction] })}
        request={request}
      />,
    );

    await user.click(screen.getByRole("button", { name: "完成：整理今日笔记" }));
    const retry = await screen.findByRole("button", { name: "使用原提交重试" });
    const [, firstInit] = request.mock.calls[0] ?? [];
    await user.click(retry);

    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "使用原提交重试" })).toBeEnabled();
    const [, secondInit] = request.mock.calls[1] ?? [];
    expect(secondInit?.body).toBe(firstInit?.body);
    expect(secondInit?.headers).toEqual(firstInit?.headers);
  });

  it.each([
    {
      name: "confirms an old skipped action when the returned snapshot no longer contains it",
      command: {
        type: "set-action-status",
        actionId: "action-000001",
        revision: 5,
        businessDate: "2026-08-09",
        status: "skipped",
      },
      remainsRetry: false,
    },
    {
      name: "keeps retrying when a same-day completed action is absent from the returned snapshot",
      command: {
        type: "set-action-status",
        actionId: "action-000001",
        revision: 5,
        businessDate,
        status: "completed",
      },
      remainsRetry: true,
    },
    {
      name: "keeps retrying when an old pending action is absent from the returned snapshot",
      command: {
        type: "set-action-status",
        actionId: "action-000001",
        revision: 5,
        businessDate: "2026-08-09",
        status: "pending",
      },
      remainsRetry: true,
    },
  ])("$name", async ({ command, remainsRetry }) => {
    const user = userEvent.setup();
    localStorage.setItem("life-pivot:planning-drafts:v1", JSON.stringify({
      version: 1,
      drafts: {},
      pending: { command, idempotencyKey: "missing-action-retry-key" },
    }));
    const request = mockRequest(async () => Response.json(snapshot()));

    render(
      <PlanningWorkspace
        businessDate={businessDate}
        initialSnapshot={snapshot()}
        request={request}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "使用原提交重试" }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    const [, init] = request.mock.calls[0] ?? [];
    expect(commandFrom(init)).toEqual(command);

    if (remainsRetry) {
      expect(screen.getByRole("button", { name: "使用原提交重试" })).toBeEnabled();
    } else {
      await waitFor(() => expect(screen.queryByRole("button", { name: "使用原提交重试" })).not.toBeInTheDocument());
      expect(screen.getByRole("status")).toHaveTextContent("已保存");
    }
  });

  it.each([
    { name: "confirms an action at revision N", returnedAction: action({ status: "completed", revision: 5 }), remainsRetry: false },
    { name: "confirms an action at revision N plus one", returnedAction: action({ status: "completed", revision: 6 }), remainsRetry: false },
    { name: "rejects an action at revision N plus two", returnedAction: action({ status: "completed", revision: 7 }), remainsRetry: true },
    { name: "rejects an action with a mismatched business date", returnedAction: action({ status: "completed", revision: 6, businessDate: "2026-08-09" }), remainsRetry: true },
  ])("$name", async ({ returnedAction, remainsRetry }) => {
    const user = userEvent.setup();
    const command = {
      type: "set-action-status",
      actionId: "action-000001",
      revision: 5,
      businessDate,
      status: "completed",
    };
    localStorage.setItem("life-pivot:planning-drafts:v1", JSON.stringify({
      version: 1,
      drafts: {},
      pending: { command, idempotencyKey: "existing-action-retry-key" },
    }));
    const request = mockRequest(async () => Response.json(snapshot({
      todayActions: [returnedAction],
    })));

    render(
      <PlanningWorkspace
        businessDate={businessDate}
        initialSnapshot={snapshot({ todayActions: [action({ revision: 5 })] })}
        request={request}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "使用原提交重试" }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    if (remainsRetry) {
      expect(screen.getByRole("button", { name: "使用原提交重试" })).toBeEnabled();
    } else {
      await waitFor(() => expect(screen.queryByRole("button", { name: "使用原提交重试" })).not.toBeInTheDocument());
      expect(screen.getByRole("status")).toHaveTextContent("已保存");
    }
  });

  it("derives a today action from a weekly action and then disables the duplicate control", async () => {
    const user = userEvent.setup();
    const weekly = action({
      id: "weekly-000001",
      actionType: "weekly",
      businessDate: null,
      title: "整理本周笔记",
      priority: "high",
      estimatedMinutes: 45,
      notes: "早上完成",
    });
    const derived = action({
      id: "generated-00000001",
      parentActionId: weekly.id,
      title: weekly.title,
      priority: weekly.priority,
      estimatedMinutes: weekly.estimatedMinutes,
      notes: weekly.notes,
    });
    const request = mockRequest(async () => Response.json(snapshot({
      weeklyActions: [weekly],
      todayActions: [derived],
    })));

    render(
      <PlanningWorkspace
        businessDate={businessDate}
        createId={ids()}
        initialSnapshot={snapshot({ weeklyActions: [weekly] })}
        request={request}
      />,
    );

    const schedule = screen.getByRole("button", { name: "安排到今天：整理本周笔记" });
    await user.click(schedule);

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    const [, init] = request.mock.calls[0] ?? [];
    expect(commandFrom(init)).toEqual({
      type: "create-action",
      id: "generated-00000001",
      goalId: weekly.goalId,
      parentActionId: weekly.id,
      actionType: "today",
      businessDate,
      title: weekly.title,
      priority: weekly.priority,
      estimatedMinutes: weekly.estimatedMinutes,
      notes: weekly.notes,
    });
    const scheduled = await screen.findByRole("button", { name: "已安排到今天：整理本周笔记" });
    expect(scheduled).toBeDisabled();
  });

  it("only offers scheduling for pending undated weekly actions", () => {
    const pending = action({
      id: "weekly-pending",
      actionType: "weekly",
      businessDate: null,
      title: "Pending weekly action",
    });
    const completed = action({
      id: "weekly-completed",
      actionType: "weekly",
      businessDate: null,
      status: "completed",
      title: "Completed weekly action",
    });
    const skipped = action({
      id: "weekly-skipped",
      actionType: "weekly",
      businessDate: null,
      status: "skipped",
      title: "Skipped weekly action",
    });
    const legacyDated = action({
      id: "weekly-legacy-dated",
      actionType: "weekly",
      businessDate: "2026-08-01",
      title: "Legacy dated weekly action",
    });

    render(
      <PlanningWorkspace
        businessDate={businessDate}
        initialSnapshot={snapshot({ weeklyActions: [pending, completed, skipped, legacyDated] })}
      />,
    );

    expect(screen.getByRole("button", { name: "安排到今天：Pending weekly action" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "安排到今天：Completed weekly action" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "安排到今天：Skipped weekly action" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "安排到今天：Legacy dated weekly action" })).not.toBeInTheDocument();
  });

  it("keeps the original body and idempotency key for an explicit retry after a 5xx response", async () => {
    const user = userEvent.setup();
    const savedGoal: PlanningSnapshot["goals"][number] = {
      id: "generated-00000001",
      lifeAreaId: "area-000001",
      parentGoalId: null,
      goalType: "long-term",
      title: "安全重试的目标",
      description: "",
      status: "active",
      progressPercent: 0,
      revision: 1,
    };
    const request = mockRequest(async () => {
      if (request.mock.calls.length === 1) {
        return Response.json({ message: "服务暂时不可用" }, { status: 500 });
      }
      return Response.json(snapshot({ goals: [savedGoal] }));
    });

    render(
      <PlanningWorkspace
        businessDate={businessDate}
        createId={ids()}
        initialSnapshot={snapshot()}
        request={request}
      />,
    );

    await user.type(screen.getByLabelText("长期目标名称"), savedGoal.title);
    await user.click(screen.getByRole("button", { name: "创建长期目标" }));

    const retry = await screen.findByRole("button", { name: "使用原提交重试" });
    const [, firstInit] = request.mock.calls[0] ?? [];
    await user.click(retry);

    await screen.findAllByText(savedGoal.title);
    expect(request).toHaveBeenCalledTimes(2);
    const [, secondInit] = request.mock.calls[1] ?? [];
    expect(secondInit?.body).toBe(firstInit?.body);
    expect(secondInit?.headers).toEqual(firstInit?.headers);
  });

  it("keeps the editor draft after a 409 conflict without replaying it automatically", async () => {
    const user = userEvent.setup();
    const request = mockRequest(async () => Response.json(
      { message: "Planning command conflicts with current state." },
      { status: 409 },
    ));

    render(
      <PlanningWorkspace
        businessDate={businessDate}
        createId={ids()}
        initialSnapshot={snapshot()}
        request={request}
      />,
    );

    await user.type(screen.getByLabelText("长期目标名称"), "需要保留的草稿");
    await user.click(screen.getByRole("button", { name: "创建长期目标" }));

    expect(await screen.findByText(/冲突/)).toBeVisible();
    expect(screen.getByLabelText("长期目标名称")).toHaveValue("需要保留的草稿");
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "使用原提交重试" })).not.toBeInTheDocument();
  });

  it("keeps a validation-rejected draft editable without treating it as a safe retry", async () => {
    const user = userEvent.setup();
    const request = mockRequest(async () => Response.json(
      { message: "Invalid planning command." },
      { status: 422 },
    ));

    render(
      <PlanningWorkspace
        businessDate={businessDate}
        createId={ids()}
        initialSnapshot={snapshot()}
        request={request}
      />,
    );

    await user.type(screen.getByLabelText("长期目标名称"), "需要修改的草稿");
    await user.click(screen.getByRole("button", { name: "创建长期目标" }));

    expect(await screen.findByText("提交未被接受，草稿已保留")).toBeVisible();
    expect(screen.getByLabelText("长期目标名称")).toHaveValue("需要修改的草稿");
    expect(screen.queryByRole("button", { name: "使用原提交重试" })).not.toBeInTheDocument();
  });

  it("keeps a frozen submission when a successful response cannot confirm its snapshot", async () => {
    const user = userEvent.setup();
    const request = mockRequest(async () => new Response("not-json", { status: 200 }));

    render(
      <PlanningWorkspace
        businessDate={businessDate}
        createId={ids()}
        initialSnapshot={snapshot()}
        request={request}
      />,
    );

    await user.type(screen.getByLabelText("长期目标名称"), "结果待确认");
    await user.click(screen.getByRole("button", { name: "创建长期目标" }));

    expect(await screen.findByRole("button", { name: "使用原提交重试" })).toBeEnabled();
  });

  it("rejects a 200 snapshot with invalid nested elements and retries the frozen submission", async () => {
    const user = userEvent.setup();
    const savedGoal: PlanningSnapshot["goals"][number] = {
      id: "generated-00000001",
      lifeAreaId: "area-000001",
      parentGoalId: null,
      goalType: "long-term",
      title: "嵌套结构待确认",
      description: "",
      status: "active",
      progressPercent: 0,
      revision: 1,
    };
    const request = mockRequest(async () => {
      if (request.mock.calls.length === 1) {
        return Response.json(snapshot({ goals: [null] as unknown as PlanningSnapshot["goals"] }));
      }
      return Response.json(snapshot({ goals: [savedGoal] }));
    });

    render(
      <PlanningWorkspace
        businessDate={businessDate}
        createId={ids()}
        initialSnapshot={snapshot()}
        request={request}
      />,
    );

    await user.type(screen.getByLabelText("长期目标名称"), savedGoal.title);
    await user.click(screen.getByRole("button", { name: "创建长期目标" }));

    const retry = await screen.findByRole("button", { name: "使用原提交重试" });
    expect(screen.getByLabelText("长期目标名称")).toHaveValue(savedGoal.title);
    const [, firstInit] = request.mock.calls[0] ?? [];
    await user.click(retry);

    await screen.findAllByText(savedGoal.title);
    const [, secondInit] = request.mock.calls[1] ?? [];
    expect(secondInit?.body).toBe(firstInit?.body);
    expect(secondInit?.headers).toEqual(firstInit?.headers);
  });

  it("rejects a valid 200 snapshot that does not contain the created command id", async () => {
    const user = userEvent.setup();
    const request = mockRequest(async () => Response.json(snapshot()));

    render(
      <PlanningWorkspace
        businessDate={businessDate}
        createId={ids()}
        initialSnapshot={snapshot()}
        request={request}
      />,
    );

    await user.type(screen.getByLabelText("长期目标名称"), "缺少命令标识的结果");
    await user.click(screen.getByRole("button", { name: "创建长期目标" }));

    expect(await screen.findByRole("button", { name: "使用原提交重试" })).toBeEnabled();
    expect(screen.getByLabelText("长期目标名称")).toHaveValue("缺少命令标识的结果");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("persists the frozen body and key before starting a new request", async () => {
    const user = userEvent.setup();
    let envelopeAtRequest: string | null = null;
    const request = mockRequest(async () => {
      envelopeAtRequest = localStorage.getItem("life-pivot:planning-drafts:v1");
      return new Promise<Response>(() => undefined);
    });

    render(
      <PlanningWorkspace
        businessDate={businessDate}
        createId={ids()}
        initialSnapshot={snapshot()}
        request={request}
      />,
    );

    await user.type(screen.getByLabelText("长期目标名称"), "刷新也安全");
    await user.click(screen.getByRole("button", { name: "创建长期目标" }));

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(JSON.parse(envelopeAtRequest ?? "null")).toMatchObject({
      version: 1,
      pending: {
        idempotencyKey: "generated-00000002",
        command: { type: "create-goal", title: "刷新也安全" },
      },
    });
  });

  it("restores a frozen cross-refresh submission only for explicit same-key retry", async () => {
    const user = userEvent.setup();
    const frozenCommand = {
      type: "create-goal",
      id: "goal-reload-01",
      lifeAreaId: "area-000001",
      parentGoalId: null,
      goalType: "long-term",
      title: "刷新后恢复",
      description: "",
      startDate: null,
      targetDate: null,
    };
    localStorage.setItem("life-pivot:planning-drafts:v1", JSON.stringify({
      version: 1,
      drafts: { longTerm: { title: frozenCommand.title, lifeAreaId: frozenCommand.lifeAreaId } },
      pending: { command: frozenCommand, idempotencyKey: "reload-key-0000001" },
    }));
    const request = mockRequest(async () => Response.json(snapshot({
      goals: [{
        id: frozenCommand.id,
        lifeAreaId: frozenCommand.lifeAreaId,
        parentGoalId: null,
        goalType: "long-term",
        title: frozenCommand.title,
        description: "",
        status: "active",
        progressPercent: 0,
        revision: 1,
      }],
    })));

    render(
      <PlanningWorkspace
        businessDate={businessDate}
        initialSnapshot={snapshot()}
        request={request}
      />,
    );

    const retry = await screen.findByRole("button", { name: "使用原提交重试" });
    expect(request).not.toHaveBeenCalled();
    await user.click(retry);

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    const [, init] = request.mock.calls[0] ?? [];
    expect(commandFrom(init)).toEqual(frozenCommand);
    expect(init?.headers).toMatchObject({ "idempotency-key": "reload-key-0000001" });
  });

  it("shows legacy dated weekly and unassigned actions without inventing unsupported repairs", () => {
    const legacyWeekly = action({
      id: "weekly-legacy",
      actionType: "weekly",
      businessDate: "2026-08-01",
      title: "旧版周行动",
    });
    const unassigned = action({
      id: "today-unassigned",
      goalId: null,
      businessDate: null,
      title: "历史未分配任务",
    });

    render(
      <PlanningWorkspace
        businessDate={businessDate}
        initialSnapshot={snapshot({
          weeklyActions: [legacyWeekly],
          unassignedActions: [unassigned],
        })}
      />,
    );

    expect(screen.getByText("旧版周行动")).toBeVisible();
    expect(screen.getByText("历史日期：2026-08-01")).toBeVisible();
    const legacyArea = screen.getByLabelText("历史未分配行动");
    expect(within(legacyArea).getByText("历史未分配任务")).toBeVisible();
    expect(within(legacyArea).queryByRole("button")).not.toBeInTheDocument();
  });
});
