// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  freezeSimpleSubmission,
  storeSimpleSubmission,
} from "@/app/accumulation/frozen-submission";
import type { HealthChecklistDay } from "@/modules/health-checklist/contracts";

import { HealthWorkspace } from "./health-workspace";

const baseDay: HealthChecklistDay = {
  id: "health-day-0001",
  businessDate: "2026-08-12",
  templateId: "health-default",
  templateVersionId: "health-version-0002",
  templateRevision: 2,
  templateName: "我的健康清单",
  note: "",
  revision: 3,
  // 维生素来自每日模板（常驻），早餐是之前手动加的今日任务。
  persistentItemKeys: ["vitamin-daily-001"],
  items: [
    {
      id: "day-item-breakfast",
      itemKey: "breakfast-item-001",
      groupKey: "breakfast",
      groupLabel: "早餐",
      name: "早餐元素",
      targetText: "",
      note: "历史遗留字段，界面上不再展示",
      ordinal: 1,
      completed: false,
      completedAt: null,
    },
    {
      id: "day-item-vitamin",
      itemKey: "vitamin-daily-001",
      groupKey: "vitamins",
      groupLabel: "全天维生素",
      name: "维生素",
      targetText: "按自己的计划",
      note: "",
      ordinal: 0,
      completed: true,
      completedAt: "2026-08-12T02:00:00.000Z",
    },
  ],
};

function dayWithItems(items: HealthChecklistDay["items"]): HealthChecklistDay {
  return { ...baseDay, revision: baseDay.revision + 1, items };
}

function inputOf(item: HealthChecklistDay["items"][number], ordinal: number) {
  return {
    itemKey: item.itemKey,
    groupKey: item.groupKey,
    groupLabel: item.groupLabel,
    name: item.name,
    targetText: item.targetText,
    note: item.note,
    ordinal,
  };
}

function ids(...values: string[]) {
  let index = 0;
  return () => values[index++] ?? `generated-health-${String(index).padStart(8, "0")}`;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("HealthWorkspace", () => {
  it("automatically switches to a fresh checklist at 07:00", async () => {
    vi.useFakeTimers();
    let currentTime = new Date("2026-08-12T22:59:59.800Z");
    const nextDay: HealthChecklistDay = {
      ...baseDay,
      id: "health-day-0002",
      businessDate: "2026-08-13",
      revision: 1,
      items: baseDay.items.map((item) => ({
        ...item,
        completed: false,
        completedAt: null,
      })),
    };
    const request = vi.fn(async () => Response.json({ day: nextDay }));
    const view = render(
      <HealthWorkspace
        autoRollover
        initial={{ status: "ready", data: baseDay }}
        now={() => currentTime}
        request={request}
        storage={localStorage}
      />,
    );

    try {
      expect(screen.getByText("每天早上 7:00 自动刷新")).toBeInTheDocument();
      currentTime = new Date("2026-08-12T23:00:00.150Z");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350);
      });
      expect(request).toHaveBeenCalledWith(
        "/api/v1/health-checklist?date=2026-08-13",
        { cache: "no-store" },
      );
      expect(screen.getByText("早上 7 点已刷新为今天的新清单。")).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: "完成 维生素" })).not.toBeChecked();
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it("distinguishes an empty ready list from unavailable data", () => {
    const { rerender } = render(
      <HealthWorkspace
        initial={{ status: "ready", data: { ...baseDay, items: [], persistentItemKeys: [] } }}
      />,
    );
    expect(screen.getByText("暂无任务。")).toBeInTheDocument();
    expect(screen.queryByText("暂时无法读取健康清单")).not.toBeInTheDocument();

    rerender(<HealthWorkspace initial={{ status: "unavailable" }} />);
    expect(screen.getByText("暂时无法读取健康清单")).toBeInTheDocument();
  });

  it("renders one flat list with persistent badges and progress", () => {
    render(<HealthWorkspace initial={{ status: "ready", data: baseDay }} />);
    expect(screen.getByRole("heading", { name: "今日任务" })).toBeInTheDocument();
    expect(screen.getByText(/已完成/).textContent).toBe("已完成 1 / 2");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByTitle("常驻任务，每天自动出现")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "早餐" })).not.toBeInTheDocument();
    expect(screen.queryByText("目标与备注")).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "今日完成进度" })).toHaveAttribute(
      "aria-valuenow",
      "1",
    );
  });

  it("stores one-item completion before POST", async () => {
    const user = userEvent.setup();
    let storedAtPost: string | null = null;
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        const key = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
          .find((value) => value?.includes(":health-checklist:"));
        storedAtPost = key ? localStorage.getItem(key) : null;
        return Response.json({
          result: dayWithItems(baseDay.items.map((item) => item.itemKey === "breakfast-item-001"
            ? { ...item, completed: true, completedAt: "2026-08-12T03:00:00.000Z" }
            : item)),
        });
      }
      return Response.json({ day: baseDay });
    });
    render(
      <HealthWorkspace
        createId={ids("health-toggle-key-0001")}
        initial={{ status: "ready", data: baseDay }}
        request={request}
        storage={localStorage}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "完成 早餐元素" }));

    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    const [, postInit] = request.mock.calls[0] ?? [];
    expect(JSON.parse(String(postInit?.body))).toEqual({
      type: "set-health-checklist-items",
      businessDate: "2026-08-12",
      itemKeys: ["breakfast-item-001"],
      completed: true,
      expectedDayRevision: 3,
    });
    expect(JSON.parse(storedAtPost ?? "null")).toMatchObject({
      purpose: "health-checklist",
      operation: "set-health-checklist-items",
      ownerId: "2026-08-12",
    });
    expect(screen.getByRole("checkbox", { name: "完成 维生素" })).toBeChecked();
  });

  it("adds a routine task into the daily template while keeping today-only tasks", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Response.json({ result: baseDay });
      }
      return Response.json({ day: baseDay });
    });
    render(
      <HealthWorkspace
        createId={ids("health-add-key-00001", "health-add-item-0001")}
        initial={{ status: "ready", data: baseDay }}
        request={request}
        storage={localStorage}
      />,
    );

    await user.type(screen.getByLabelText("任务名称"), "晨间拉伸");
    await user.click(screen.getByRole("button", { name: "添加" }));

    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    const [, postInit] = request.mock.calls[0] ?? [];
    expect(JSON.parse(String(postInit?.body))).toEqual({
      type: "replace-health-checklist",
      templateId: "health-default",
      businessDate: "2026-08-12",
      scope: "today-and-future",
      name: "我的健康清单",
      changeNote: "新增常驻任务：晨间拉伸",
      items: [
        {
          itemKey: "health-add-item-0001",
          groupKey: "custom",
          groupLabel: "清单",
          name: "晨间拉伸",
          targetText: "",
          note: "",
          ordinal: 0,
        },
        inputOf(baseDay.items[1], 1),
        inputOf(baseDay.items[0], 2),
      ],
      templateItemKeys: ["health-add-item-0001", "vitamin-daily-001"],
      expectedTemplateRevision: 2,
      expectedDayRevision: 3,
      confirmedRemovedCompletedItemKeys: [],
    });
  });

  it("adds a one-off task to today only when the routine toggle is off", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Response.json({ result: baseDay });
      }
      return Response.json({ day: baseDay });
    });
    render(
      <HealthWorkspace
        createId={ids("health-once-key-0001", "health-once-item-001")}
        initial={{ status: "ready", data: baseDay }}
        request={request}
        storage={localStorage}
      />,
    );

    await user.click(screen.getByLabelText("设为常驻，每天都出现"));
    expect(screen.getByText("只添加到今天这一天，不会出现在明天。")).toBeInTheDocument();
    await user.type(screen.getByLabelText("任务名称"), "下午体检");
    await user.click(screen.getByRole("button", { name: "添加" }));

    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    const [, postInit] = request.mock.calls[0] ?? [];
    expect(JSON.parse(String(postInit?.body))).toEqual({
      type: "replace-health-checklist",
      templateId: "health-default",
      businessDate: "2026-08-12",
      scope: "today-only",
      name: "我的健康清单",
      changeNote: "新增今日任务：下午体检",
      items: [
        {
          itemKey: "health-once-item-001",
          groupKey: "custom",
          groupLabel: "清单",
          name: "下午体检",
          targetText: "",
          note: "",
          ordinal: 0,
        },
        inputOf(baseDay.items[1], 1),
        inputOf(baseDay.items[0], 2),
      ],
      expectedTemplateRevision: 2,
      expectedDayRevision: 3,
      confirmedRemovedCompletedItemKeys: [],
    });
  });

  it("requires a second click before removing a persistent task", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Response.json({ result: dayWithItems([baseDay.items[0]]) });
      }
      return Response.json({ day: dayWithItems([baseDay.items[0]]) });
    });
    render(
      <HealthWorkspace
        createId={ids("health-remove-key-001")}
        initial={{ status: "ready", data: baseDay }}
        request={request}
        storage={localStorage}
      />,
    );

    const removeButton = screen.getByRole("button", { name: "删除 维生素" });
    await user.click(removeButton);
    expect(request).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /确认删除常驻任务 维生素/ }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    const [, postInit] = request.mock.calls[0] ?? [];
    const command = JSON.parse(String(postInit?.body));
    expect(command.scope).toBe("today-and-future");
    expect(command.changeNote).toBe("删除常驻任务：维生素");
    expect(command.confirmedRemovedCompletedItemKeys).toEqual(["vitamin-daily-001"]);
    expect(command.items).toEqual([inputOf(baseDay.items[0], 0)]);
    expect(command.templateItemKeys).toEqual([]);
  });

  it("removes a today-only task immediately without touching the template", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Response.json({ result: dayWithItems([baseDay.items[1]]) });
      }
      return Response.json({ day: dayWithItems([baseDay.items[1]]) });
    });
    render(
      <HealthWorkspace
        createId={ids("health-remove-today-01")}
        initial={{ status: "ready", data: baseDay }}
        request={request}
        storage={localStorage}
      />,
    );

    await user.click(screen.getByRole("button", { name: "删除 早餐元素" }));

    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    const [, postInit] = request.mock.calls[0] ?? [];
    const command = JSON.parse(String(postInit?.body));
    expect(command.scope).toBe("today-only");
    expect(command.changeNote).toBe("删除今日任务：早餐元素");
    expect(command.items).toEqual([inputOf(baseDay.items[1], 0)]);
    expect(command.templateItemKeys).toBeUndefined();
  });

  it("renames a routine task inline and keeps the rest of the list", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Response.json({ result: baseDay });
      }
      return Response.json({ day: baseDay });
    });
    render(
      <HealthWorkspace
        createId={ids("health-rename-key-01")}
        initial={{ status: "ready", data: baseDay }}
        request={request}
        storage={localStorage}
      />,
    );

    await user.click(screen.getByRole("button", { name: "维生素" }));
    const input = screen.getByLabelText("重命名 维生素");
    await user.clear(input);
    await user.type(input, "维生素D");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    const [, postInit] = request.mock.calls[0] ?? [];
    const command = JSON.parse(String(postInit?.body));
    expect(command.scope).toBe("today-and-future");
    expect(command.changeNote).toBe("重命名常驻任务：维生素 → 维生素D");
    expect(command.items).toEqual([
      { ...inputOf(baseDay.items[1], 0), name: "维生素D" },
      inputOf(baseDay.items[0], 1),
    ]);
    expect(command.templateItemKeys).toEqual(["vitamin-daily-001"]);
  });

  it("recovers an uncertain health submission without auto-sending and locks the workspace", async () => {
    const frozen = freezeSimpleSubmission({
      purpose: "health-checklist",
      endpoint: "/api/v1/health-checklist",
      operation: "save-health-checklist-note",
      ownerId: "2026-08-12",
      localRevision: 4,
      idempotencyKey: "health-recovery-key-0001",
      body: JSON.stringify({
        type: "save-health-checklist-note",
        businessDate: "2026-08-12",
        note: "恢复中的备注",
        expectedDayRevision: 3,
      }),
      expected: { businessDate: "2026-08-12", revision: 4 },
      createdAt: "2026-08-12T02:00:00.000Z",
    });
    expect(storeSimpleSubmission(localStorage, frozen).kind).toBe("stored");
    const request = vi.fn();
    render(
      <HealthWorkspace
        initial={{ status: "ready", data: baseDay }}
        request={request}
        storage={localStorage}
      />,
    );
    expect(await screen.findByRole("button", { name: "重试原提交" })).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "添加" })).toBeDisabled();
  });

  it("requires reload after a 409 before another edit", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async () => Response.json({ message: "conflict" }, { status: 409 }));
    render(
      <HealthWorkspace
        createId={ids("health-conflict-key-0001")}
        initial={{ status: "ready", data: baseDay }}
        request={request}
        storage={localStorage}
      />,
    );
    await user.click(screen.getByRole("checkbox", { name: "完成 早餐元素" }));
    expect(await screen.findByText("清单已变化，请刷新页面后再编辑。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加" })).toBeDisabled();
  });
});
