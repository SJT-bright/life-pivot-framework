import { describe, expect, it } from "vitest";

import { WriteBarrier } from "./write-barrier";

describe("WriteBarrier", () => {
  it("waits for an active write and rejects new writes during backup", async () => {
    const barrier = new WriteBarrier();
    let releaseWrite: (() => void) | undefined;
    let backupStarted = false;
    const activeWrite = barrier.runWrite(
      () =>
        new Promise<void>((resolve) => {
          releaseWrite = resolve;
        }),
    );

    const backup = barrier.runBackup(async () => {
      backupStarted = true;
    });
    await Promise.resolve();

    expect(backupStarted).toBe(false);
    await expect(barrier.runWrite(async () => undefined)).rejects.toThrow(
      "系统正在备份，请稍后再保存",
    );

    releaseWrite?.();
    await activeWrite;
    await backup;
    expect(backupStarted).toBe(true);
  });

  it("opens writes again when backup fails", async () => {
    const barrier = new WriteBarrier();

    await expect(
      barrier.runBackup(async () => {
        throw new Error("backup failed");
      }),
    ).rejects.toThrow("backup failed");

    await expect(barrier.runWrite(async () => "saved")).resolves.toBe("saved");
  });
});
