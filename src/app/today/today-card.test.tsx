// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TodayCard } from "./today-card";

afterEach(() => cleanup());

describe("TodayCard", () => {
  it("renders ready data through a stateless card frame", () => {
    render(
      <TodayCard
        detailHref="/knowledge"
        detailLabel="打开知识体系"
        state={{ status: "ready", data: { count: 3 } }}
        title="快速收集 / 待整理"
      >
        {(data) => <p>{data.count} 条可用事实</p>}
      </TodayCard>,
    );

    expect(screen.getByRole("heading", { name: "快速收集 / 待整理" })).toBeInTheDocument();
    expect(screen.getByText("3 条可用事实")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开知识体系" })).toHaveAttribute("href", "/knowledge");
  });

  it("uses an explicit unavailable state without rendering a false empty value", () => {
    const renderReady = vi.fn(() => <p>0 条</p>);
    render(
      <TodayCard
        detailHref="/sleep"
        detailLabel="打开睡眠记录"
        state={{ status: "unavailable" }}
        title="睡眠记录"
      >
        {renderReady}
      </TodayCard>,
    );

    expect(screen.getByText("暂时无法读取")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开睡眠记录" })).toHaveAttribute("href", "/sleep");
    expect(screen.queryByText("0 条")).not.toBeInTheDocument();
    expect(screen.queryByText("未记录")).not.toBeInTheDocument();
    expect(renderReady).not.toHaveBeenCalled();
  });
});
