// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PersonalKnowledgeSnapshot } from "@/modules/personal-knowledge/contracts";

const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  getApplicationDatabase: vi.fn(),
  getPersonalKnowledgeSnapshot: vi.fn(),
  toShanghaiBusinessDate: vi.fn(),
  workspace: vi.fn(),
}));

vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, replace: () => undefined, push: () => undefined }),
}));
vi.mock("@/core/db/application-database", () => ({ getApplicationDatabase: mocks.getApplicationDatabase }));
vi.mock("@/core/time/business-date", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/time/business-date")>();
  return { ...actual, toShanghaiBusinessDate: mocks.toShanghaiBusinessDate };
});
vi.mock("@/modules/personal-knowledge/query", () => ({ getPersonalKnowledgeSnapshot: mocks.getPersonalKnowledgeSnapshot }));
vi.mock("./personal-knowledge-workspace", () => ({ PersonalKnowledgeWorkspace: (props: unknown) => { mocks.workspace(props); return <div data-testid="personal-workspace" />; } }));

import KnowledgePage from "./page";

const snapshot: PersonalKnowledgeSnapshot = {
  businessDate: "2026-08-12",
  modules: [],
  dailyNotes: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connection.mockResolvedValue(undefined);
  mocks.toShanghaiBusinessDate.mockReturnValue("2026-08-13");
  mocks.getApplicationDatabase.mockReturnValue({ sqlite: { marker: "sqlite" } });
  mocks.getPersonalKnowledgeSnapshot.mockReturnValue(snapshot);
});
afterEach(() => cleanup());

describe("KnowledgePage", () => {
  it("reads one selected date and renders the personal workspace", async () => {
    render(await KnowledgePage({ searchParams: Promise.resolve({ date: "2026-08-12" }) }));

    expect(mocks.getPersonalKnowledgeSnapshot).toHaveBeenCalledWith({ marker: "sqlite" }, { businessDate: "2026-08-12" });
    expect(mocks.workspace).toHaveBeenCalledWith(expect.objectContaining({ initial: snapshot, today: "2026-08-13" }));
    expect(screen.getByTestId("personal-workspace")).toBeInTheDocument();
  });

  it.each([
    ["invalid", { date: "2026-02-30" }],
    ["future", { date: "2026-08-14" }],
    ["duplicate", { date: ["2026-08-12", "2026-08-13"] }],
  ])("contains an %s date as a generic unavailable page without database work", async (_label, query) => {
    render(await KnowledgePage({ searchParams: Promise.resolve(query) }));

    expect(screen.getByRole("status")).toHaveTextContent("个人知识暂时无法读取");
    expect(mocks.getApplicationDatabase).not.toHaveBeenCalled();
    expect(screen.queryByTestId("personal-workspace")).not.toBeInTheDocument();
  });

  it("contains database and query details behind one generic unavailable page", async () => {
    mocks.getPersonalKnowledgeSnapshot.mockImplementation(() => { throw new Error("D:\\private\\knowledge.db SQL"); });
    render(await KnowledgePage({ searchParams: Promise.resolve({ date: "2026-08-12" }) }));

    expect(screen.getByRole("status")).toHaveTextContent("个人知识暂时无法读取");
    expect(screen.queryByText(/private|SQL|knowledge\.db/)).not.toBeInTheDocument();
  });
});
