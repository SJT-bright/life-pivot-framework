// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/db/application-database", () => ({
  getApplicationDatabase: () => ({ sqlite: {} }),
}));
vi.mock("@/modules/manual-exercise/queries", () => ({
  getManualExerciseSnapshot: () => null,
}));
vi.mock("@/modules/health-checklist/service", () => ({
  materializeHealthChecklistDay: async () => ({ businessDate: "2026-08-13", items: [] }),
}));
vi.mock("./exercise/manual-exercise-workspace", () => ({
  ManualExerciseWorkspace: () => <div data-testid="exercise-workspace" />,
}));
vi.mock("./health/health-workspace", () => ({
  HealthWorkspace: () => <div data-testid="health-workspace" />,
}));

import ExercisePage from "./exercise/page";
import HealthPage from "./health/page";

afterEach(() => cleanup());

describe("accumulation route boundaries", () => {
  it("renders the live manual exercise route", async () => {
    render(await ExercisePage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByTestId("exercise-workspace")).toBeInTheDocument();
  });

  it("renders the live editable health checklist route", async () => {
    render(await HealthPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByTestId("health-workspace")).toBeInTheDocument();
  });
});
