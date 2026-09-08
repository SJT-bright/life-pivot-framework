// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/system-health/get-runtime-health", () => ({
  getRuntimeHealth: () => ({
    checkedAt: "2026-08-13T08:00:00.000Z",
    checks: {
      database: { status: "ok", message: "ok" },
      schema: { status: "ok", message: "ok" },
      dataRoot: { status: "ok", message: "ok" },
      backup: { status: "ok", message: "ok" },
    },
  }),
}));

vi.mock("./backup-button", () => ({ BackupButton: () => <button>创建备份</button> }));

import DataSettingsPage from "./page";

afterEach(cleanup);

describe("DataSettingsPage", () => {
  it("shows the runtime checks and backup action", () => {
    render(<DataSettingsPage />);

    expect(screen.getByRole("heading", { name: "当前检查结果" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "当前检查结果" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建备份" })).toBeInTheDocument();
  });
});
