// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BackupButton } from "./backup-button";

afterEach(() => cleanup());

describe("BackupButton", () => {
  it("announces progress and verified completion", async () => {
    const user = userEvent.setup();
    let finish: ((response: Response) => void) | undefined;
    const request = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    render(<BackupButton request={request} />);

    await user.click(screen.getByRole("button", { name: "立即创建备份" }));
    expect(screen.getByRole("button", { name: "正在验证备份" })).toBeDisabled();
    finish?.(
      Response.json({
        status: "verified",
        backupId: "backup-1",
        createdAt: "2026-08-09T12:00:00.000Z",
      }),
    );

    await waitFor(() => expect(screen.getByText("备份已验证，可以用于恢复")).toBeInTheDocument());
  });

  it("offers retry without claiming a failed backup succeeded", async () => {
    const user = userEvent.setup();
    render(<BackupButton request={vi.fn().mockResolvedValue(Response.json({ message: "备份失败，请稍后重试" }, { status: 500 }))} />);

    await user.click(screen.getByRole("button", { name: "立即创建备份" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("备份失败，请稍后重试");
    expect(screen.getByRole("button", { name: "重新创建备份" })).toBeEnabled();
  });
});
