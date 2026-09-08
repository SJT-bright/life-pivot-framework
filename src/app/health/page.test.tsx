// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApplicationDatabase: vi.fn(),
  materialize: vi.fn(),
  toHealthChecklistBusinessDate: vi.fn(),
  workspace: vi.fn(),
}));

vi.mock("@/core/db/application-database", () => ({
  getApplicationDatabase: mocks.getApplicationDatabase,
}));
vi.mock("@/core/time/business-date", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/core/time/business-date")>();
  return {
    ...original,
    toHealthChecklistBusinessDate: mocks.toHealthChecklistBusinessDate,
  };
});
vi.mock("@/modules/health-checklist/service", () => ({
  materializeHealthChecklistDay: mocks.materialize,
}));
vi.mock("./health-workspace", () => ({
  HealthWorkspace: (props: unknown) => {
    mocks.workspace(props);
    return <output data-testid="health-workspace" />;
  },
}));

import HealthPage from "./page";

afterEach(() => cleanup());
beforeEach(() => {
  vi.clearAllMocks();
  mocks.toHealthChecklistBusinessDate.mockReturnValue("2026-08-12");
  mocks.getApplicationDatabase.mockReturnValue({ sqlite: { marker: "sqlite" } });
  mocks.materialize.mockResolvedValue({ businessDate: "2026-08-12", items: [] });
});

describe("HealthPage", () => {
  it("loads the selected date and renders the health workspace", async () => {
    render(await HealthPage({ searchParams: Promise.resolve({ date: "2026-08-11" }) }));
    expect(screen.getByLabelText("清单日期")).toBeInTheDocument();
    expect(screen.getByTestId("health-workspace")).toBeInTheDocument();
    expect(mocks.materialize).toHaveBeenCalledWith({ marker: "sqlite" }, "2026-08-11");
    expect(mocks.workspace).toHaveBeenCalledWith(expect.objectContaining({
      autoRollover: false,
      initial: expect.objectContaining({ status: "ready" }),
    }));
  });

  it("uses the 07:00 health date and enables automatic rollover without a selected date", async () => {
    render(await HealthPage({ searchParams: Promise.resolve({}) }));
    expect(mocks.materialize).toHaveBeenCalledWith({ marker: "sqlite" }, "2026-08-12");
    expect(mocks.workspace).toHaveBeenCalledWith(expect.objectContaining({
      autoRollover: true,
    }));
  });

  it("contains database or materialization failures as unavailable without using system health", async () => {
    mocks.getApplicationDatabase.mockImplementation(() => {
      throw new Error("C:\\private\\health.sqlite");
    });
    render(await HealthPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByLabelText("清单日期")).toBeInTheDocument();
    expect(mocks.workspace).toHaveBeenCalledWith(expect.objectContaining({
      initial: { status: "unavailable" },
    }));
  });
});
