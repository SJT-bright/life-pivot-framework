import { describe, expect, it } from "vitest";

import { getSystemHealth } from "./get-health";

const now = () => new Date("2026-08-09T12:00:00.000Z");

describe("getSystemHealth", () => {
  it("reports database, schema, data root and backup separately", () => {
    const snapshot = getSystemHealth({
      now,
      checkDatabase: () => undefined,
      getSchemaVersion: () => "1",
      checkDataRoot: () => undefined,
      getLatestBackup: () => null,
    });

    expect(snapshot).toEqual({
      overall: "warning",
      checkedAt: "2026-08-09T12:00:00.000Z",
      checks: {
        database: { status: "ok", message: "数据库可以正常读写" },
        schema: { status: "ok", message: "数据库结构版本 1" },
        dataRoot: { status: "ok", message: "数据目录可以正常访问" },
        backup: { status: "warning", message: "还没有经过验证的备份" },
      },
    });
  });

  it("keeps one failed check from hiding the remaining results", () => {
    const snapshot = getSystemHealth({
      now,
      checkDatabase: () => {
        throw new Error("database unavailable");
      },
      getSchemaVersion: () => "1",
      checkDataRoot: () => undefined,
      getLatestBackup: () => ({ completedAt: "2026-08-08T12:00:00.000Z" }),
    });

    expect(snapshot.overall).toBe("error");
    expect(snapshot.checks.database).toEqual({
      status: "error",
      message: "数据库暂时无法访问",
    });
    expect(snapshot.checks.backup.status).toBe("ok");
  });
});
