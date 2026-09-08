export type HealthStatus = "ok" | "warning" | "error";

export interface HealthCheck {
  status: HealthStatus;
  message: string;
}

export interface SystemHealthSnapshot {
  overall: HealthStatus;
  checkedAt: string;
  checks: {
    database: HealthCheck;
    schema: HealthCheck;
    dataRoot: HealthCheck;
    backup: HealthCheck;
  };
}

interface LatestBackup {
  completedAt: string;
}

interface SystemHealthDependencies {
  now: () => Date;
  checkDatabase: () => void;
  getSchemaVersion: () => string;
  checkDataRoot: () => void;
  getLatestBackup: () => LatestBackup | null;
}

function runCheck(check: () => void, success: string, failure: string): HealthCheck {
  try {
    check();
    return { status: "ok", message: success };
  } catch {
    return { status: "error", message: failure };
  }
}

export function getSystemHealth(
  dependencies: SystemHealthDependencies,
): SystemHealthSnapshot {
  const database = runCheck(
    dependencies.checkDatabase,
    "数据库可以正常读写",
    "数据库暂时无法访问",
  );

  let schema: HealthCheck;
  try {
    const version = dependencies.getSchemaVersion();
    schema = version
      ? { status: "ok", message: `数据库结构版本 ${version}` }
      : { status: "error", message: "无法识别数据库结构版本" };
  } catch {
    schema = { status: "error", message: "无法读取数据库结构版本" };
  }

  const dataRoot = runCheck(
    dependencies.checkDataRoot,
    "数据目录可以正常访问",
    "数据目录暂时无法访问",
  );

  let backup: HealthCheck;
  try {
    const latest = dependencies.getLatestBackup();
    backup = latest
      ? { status: "ok", message: `最近验证备份：${latest.completedAt}` }
      : { status: "warning", message: "还没有经过验证的备份" };
  } catch {
    backup = { status: "error", message: "无法读取备份状态" };
  }

  const checks = { database, schema, dataRoot, backup };
  const statuses = Object.values(checks).map((check) => check.status);
  const overall: HealthStatus = statuses.includes("error")
    ? "error"
    : statuses.includes("warning")
      ? "warning"
      : "ok";

  return {
    overall,
    checkedAt: dependencies.now().toISOString(),
    checks,
  };
}
