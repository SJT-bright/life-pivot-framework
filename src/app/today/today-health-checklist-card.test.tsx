// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { HealthChecklistDay } from "@/modules/health-checklist/contracts";

import { TodayHealthChecklistCard } from "./today-health-checklist-card";

const day: HealthChecklistDay = {
  id: "health-day-0001",
  businessDate: "2026-08-12",
  templateId: "health-template-0001",
  templateVersionId: "health-version-0001",
  templateRevision: 1,
  templateName: "每日健康",
  note: "",
  revision: 1,
  persistentItemKeys: [],
  items: [{
    id: "health-item-0001",
    itemKey: "breakfast-item",
    groupKey: "breakfast",
    groupLabel: "早餐",
    name: "吃早餐",
    targetText: "",
    note: "",
    ordinal: 0,
    completed: false,
    completedAt: null,
  }, {
    id: "health-item-0002",
    itemKey: "vitamin-item",
    groupKey: "vitamin",
    groupLabel: "全天维生素",
    name: "补充维生素",
    targetText: "",
    note: "",
    ordinal: 1,
    completed: true,
    completedAt: "2026-08-12T02:00:00.000Z",
  }],
};

afterEach(() => cleanup());

describe("TodayHealthChecklistCard", () => {
  it("shows completion count and card-mode item controls without template editing", () => {
    render(<TodayHealthChecklistCard businessDate="2026-08-12" day={day} />);

    expect(screen.getByText("今日完成 1 / 2 项")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "完成 吃早餐" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "完成 补充维生素" })).toBeChecked();
    expect(screen.queryByRole("button", { name: "编辑当天清单" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "从今天起更新模板" })).not.toBeInTheDocument();
  });

  it("keeps the top add form available inside Today", () => {
    render(<TodayHealthChecklistCard businessDate="2026-08-12" day={day} />);

    expect(screen.getByLabelText("任务名称")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
