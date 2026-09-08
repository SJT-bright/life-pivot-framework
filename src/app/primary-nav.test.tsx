// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  pathname: "/today",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

import { PRIMARY_NAV_ITEMS } from "./navigation";
import { PrimaryNav } from "./primary-nav";

afterEach(() => {
  cleanup();
});

describe("PrimaryNav", () => {
  it("publishes the exact approved navigation items", () => {
    expect(PRIMARY_NAV_ITEMS).toEqual([
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
  });

  it.each([
    ["/today", "/today"],
    ["/knowledge/topics/one", "/knowledge"],
  ])("marks only the matching route current for %s", (pathname, currentHref) => {
    navigation.pathname = pathname;
    render(<PrimaryNav />);

    const current = screen.getAllByRole("link").filter(
      (link) => link.getAttribute("aria-current") === "page",
    );
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("href", currentHref);
  });

  it("does not select a primary item for an auxiliary route", () => {
    navigation.pathname = "/settings/data";
    render(<PrimaryNav />);

    expect(screen.getAllByRole("link").some(
      (link) => link.getAttribute("aria-current") === "page",
    )).toBe(false);
  });

  it("centres the active route in the horizontal rail", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    navigation.pathname = "/review";

    render(<PrimaryNav />);

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  });
});
