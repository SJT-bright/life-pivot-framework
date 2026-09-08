// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BackToTop } from "./back-to-top";

afterEach(() => cleanup());

function setReducedMotion(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" ? matches : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    })),
  });
}

describe("BackToTop", () => {
  it("隐藏在页面顶部，滚动后浮现", () => {
    const { getByRole } = render(<BackToTop />);
    const button = getByRole("button", { name: "回到顶部" });

    expect(button).toHaveAttribute("data-visible", "false");

    Object.defineProperty(window, "scrollY", { configurable: true, value: 600, writable: true });
    fireEvent.scroll(window);

    expect(button).toHaveAttribute("data-visible", "true");
  });

  it("点击后平滑滚动回顶部", () => {
    setReducedMotion(false);
    const scrollTo = vi.fn();
    Object.defineProperty(window, "scrollTo", { configurable: true, value: scrollTo });
    const { getByRole } = render(<BackToTop />);
    const button = getByRole("button", { name: "回到顶部" });

    Object.defineProperty(window, "scrollY", { configurable: true, value: 900, writable: true });
    fireEvent.scroll(window);
    fireEvent.click(button);

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("减少动态效果时立即滚动回顶部", () => {
    setReducedMotion(true);
    const scrollTo = vi.fn();
    Object.defineProperty(window, "scrollTo", { configurable: true, value: scrollTo });
    const { getByRole } = render(<BackToTop />);

    fireEvent.click(getByRole("button", { name: "回到顶部" }));

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
  });
});
