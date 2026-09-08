// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ManualSkincareSnapshot } from "@/modules/manual-skincare/contracts";

const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  getApplicationDatabase: vi.fn(),
  materializeManualSkincareDay: vi.fn(),
  toShanghaiBusinessDate: vi.fn(),
  workspace: vi.fn(),
}));

vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("@/core/db/application-database", () => ({ getApplicationDatabase: mocks.getApplicationDatabase }));
vi.mock("@/core/time/business-date", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/time/business-date")>();
  return { ...actual, toShanghaiBusinessDate: mocks.toShanghaiBusinessDate };
});
vi.mock("@/modules/manual-skincare/service", () => ({ materializeManualSkincareDay: mocks.materializeManualSkincareDay }));
vi.mock("./manual-skincare-workspace", () => ({
  ManualSkincareWorkspace: (props: unknown) => { mocks.workspace(props); return <div data-testid="manual-workspace" />; },
}));

import SkincarePage from "./page";

const snapshot: ManualSkincareSnapshot = {
  businessDate: "2026-08-12", products: [], latestRoutineRevision: 0, activationSequence: 0,
  selectedDay: null, recoveryPlans: [], history: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connection.mockResolvedValue(undefined);
  mocks.toShanghaiBusinessDate.mockReturnValue("2026-08-13");
  mocks.getApplicationDatabase.mockReturnValue({ sqlite: { marker: "sqlite" } });
  mocks.materializeManualSkincareDay.mockResolvedValue(snapshot);
});
afterEach(() => cleanup());

describe("SkincarePage", () => {
  it("materializes one requested nonfuture business date into the manual workspace", async () => {
    render(await SkincarePage({ searchParams: Promise.resolve({ date: "2026-08-12" }) }));

    expect(screen.getByRole("heading", { name: "护肤记录" })).toBeInTheDocument();
    expect(mocks.materializeManualSkincareDay).toHaveBeenCalledWith({ marker: "sqlite" }, "2026-08-12");
    expect(mocks.workspace).toHaveBeenCalledWith(expect.objectContaining({ initial: snapshot, today: "2026-08-13" }));
  });

  it.each([
    ["invalid", { date: "2026-02-30" }],
    ["future", { date: "2026-08-14" }],
    ["duplicate", { date: ["2026-08-12", "2026-08-13"] }],
  ])("contains an %s date as one generic unavailable state without database work", async (_label, query) => {
    render(await SkincarePage({ searchParams: Promise.resolve(query) }));

    expect(screen.getByRole("status")).toHaveTextContent("护肤记录暂时无法读取");
    expect(mocks.getApplicationDatabase).not.toHaveBeenCalled();
    expect(mocks.materializeManualSkincareDay).not.toHaveBeenCalled();
    expect(screen.queryByTestId("manual-workspace")).not.toBeInTheDocument();
  });

  it("contains materialization failures without exposing private details", async () => {
    mocks.materializeManualSkincareDay.mockRejectedValue(new Error("C:\\private\\manual-skincare.db SQL"));
    render(await SkincarePage({ searchParams: Promise.resolve({ date: "2026-08-12" }) }));

    expect(screen.getByRole("status")).toHaveTextContent("护肤记录暂时无法读取");
    expect(screen.queryByText(/private|SQL|manual-skincare\.db/)).not.toBeInTheDocument();
  });
});
