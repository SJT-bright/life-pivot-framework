// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "./app-shell";

const navigation = { pathname: "/today", search: "" };
const rememberMainLocation = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search ?? ""),
  useRouter: () => ({ push: () => undefined }),
}));

beforeEach(() => {
  window.lifePivotDesktop = {
    moveCompanion: vi.fn(),
    notifyReminder: vi.fn(),
    openMainWindow: vi.fn(),
    rememberMainLocation,
    setCompanionExpanded: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  navigation.pathname = "/today";
  navigation.search = "";
  rememberMainLocation.mockReset();
  window.history.replaceState(null, "", "/");
  delete window.lifePivotDesktop;
});

it("renders the data settings link in the auxiliary navigation", () => {
  render(<AppShell><div /></AppShell>);
  const auxiliary = screen.getByRole("navigation", { name: "辅助导航" });
  expect(within(auxiliary).getByRole("link", { name: "数据与设置" }))
    .toHaveAttribute("href", "/settings/data");
});

describe("AppShell", () => {
  it("keeps the approved primary routes and separate auxiliary links", () => {
    render(<AppShell><div>内容</div></AppShell>);

    const primary = screen.getByRole("navigation", { name: "主要导航" });
    expect(within(primary).getAllByRole("link").map((link) => ({
      href: link.getAttribute("href"),
      label: link.textContent,
    }))).toEqual([
      { href: "/today", label: "今日" },
      { href: "/goals", label: "目标与行动" },
      { href: "/knowledge", label: "知识体系" },
      { href: "/wisdom", label: "提醒" },
      { href: "/reading", label: "读书" },
      { href: "/exercise", label: "运动健身" },
      { href: "/sleep", label: "睡眠记录" },
      { href: "/skincare", label: "护肤记录" },
      { href: "/health", label: "健康清单" },
      { href: "/daily-review", label: "每日复盘" },
      { href: "/review-map", label: "复盘地图" },
      { href: "/review", label: "周回顾" },
      { href: "/stats", label: "成长统计" },
    ]);
    expect(within(primary).queryByRole("link", { name: "首页" })).not.toBeInTheDocument();
    expect(within(primary).queryByRole("link", { name: "数据与设置" })).not.toBeInTheDocument();

    const auxiliary = screen.getByRole("navigation", { name: "辅助导航" });
    expect(within(auxiliary).getByRole("link", { name: "数据与设置" })).toHaveAttribute("href", "/settings/data");
    expect(screen.getByRole("link", { name: "个人积累库" })).toHaveAttribute("href", "/today");
    expect(screen.getByRole("button", { name: "切换昼夜主题" })).toBeInTheDocument();
    expect(screen.getByText("内容")).toBeInTheDocument();
  });

  it("removes the application chrome from the floating companion route", () => {
    navigation.pathname = "/companion";
    render(<AppShell><div>悬浮内容</div></AppShell>);

    expect(screen.getByText("悬浮内容")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "个人积累库" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "切换昼夜主题" })).not.toBeInTheDocument();
    expect(rememberMainLocation).not.toHaveBeenCalled();
  });

  it("persists the current app pathname and search for the desktop window", () => {
    navigation.pathname = "/reading";
    navigation.search = "status=reading&page=2";
    window.history.replaceState(null, "", "/reading?status=reading&page=2");

    render(<AppShell><div>读书</div></AppShell>);

    expect(rememberMainLocation).toHaveBeenCalledWith(
      "/reading",
      "?status=reading&page=2",
    );
  });

  it("gives review map its own artwork surface and marks settings current", () => {
    navigation.pathname = "/review-map";
    const { container, rerender } = render(<AppShell><div>地图</div></AppShell>);
    expect(container.querySelector(".app-shell")).toHaveAttribute("data-surface", "review-map");

    navigation.pathname = "/settings/data";
    rerender(<AppShell><div>设置</div></AppShell>);
    expect(screen.getByRole("link", { name: "数据与设置" })).toHaveAttribute("aria-current", "page");
  });
});
