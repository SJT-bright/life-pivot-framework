// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connection: vi.fn(async () => undefined),
  getApplicationDatabase: vi.fn(),
  getDailySleepRecord: vi.fn(),
  getDailySleepHistory: vi.fn(),
  countDailySleepHistory: vi.fn(),
}));

vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("@/core/db/application-database", () => ({
  getApplicationDatabase: mocks.getApplicationDatabase,
}));
vi.mock("@/modules/daily-sleep/query", () => ({
  getDailySleepRecord: mocks.getDailySleepRecord,
  getDailySleepHistory: mocks.getDailySleepHistory,
  countDailySleepHistory: mocks.countDailySleepHistory,
}));

import SleepPage from "./page";

afterEach(cleanup);
beforeEach(() => {
  mocks.getApplicationDatabase.mockReturnValue({ sqlite: {} });
  mocks.getDailySleepRecord.mockReturnValue(null);
  mocks.getDailySleepHistory.mockReturnValue({ items: [] });
  mocks.countDailySleepHistory.mockReturnValue(0);
});

describe("SleepPage", () => {
  it("loads only the lightweight daily sleep readers", async () => {
    render(await SleepPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByLabelText("日期")).toBeInTheDocument();
    expect(mocks.getDailySleepRecord).toHaveBeenCalledTimes(1);
    expect(mocks.getDailySleepHistory).toHaveBeenCalledWith({}, { limit: 30 });
  });

  it("requests the next history page with an offset", async () => {
    mocks.countDailySleepHistory.mockReturnValue(75);
    render(await SleepPage({ searchParams: Promise.resolve({ page: "2" }) }));
    expect(mocks.getDailySleepHistory).toHaveBeenCalledWith(
      {},
      { limit: 30, offset: 30 },
    );
  });

  it("renders explicit unavailable states when database initialization fails", async () => {
    mocks.getApplicationDatabase.mockImplementationOnce(() => {
      throw new Error("database unavailable");
    });
    render(await SleepPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getAllByText("暂时无法读取")).toHaveLength(3);
  });
});
