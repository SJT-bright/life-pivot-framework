import Link from "next/link";

import { getRuntimeHealth } from "@/modules/system-health/get-runtime-health";
import { resolveAppPaths } from "@/core/config/app-paths";
import { listRestoreCandidates } from "@/core/backup/restore-backup";

import { BackupButton } from "./backup-button";
import { RestorePanel } from "./restore-panel";

export const dynamic = "force-dynamic";

const labels = {
  database: "数据库",
  schema: "结构版本",
  dataRoot: "数据目录",
  backup: "备份",
} as const;

const statusLabels = {
  ok: "正常",
  warning: "需要处理",
  error: "异常",
} as const;

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export default function DataSettingsPage() {
  const health = getRuntimeHealth();
  let backups: Awaited<ReturnType<typeof listRestoreCandidates>> = [];
  let backupsError: string | null = null;
  try {
    const paths = resolveAppPaths(process.env);
    backups = listRestoreCandidates(paths.backupsRoot);
  } catch {
    backupsError = "暂时无法读取备份目录";
  }

  return (
    <main className="page-shell narrow-shell data-settings-page">
      <nav aria-label="返回导航" className="back-nav">
        <Link href="/">返回首页</Link>
      </nav>
      <section aria-labelledby="health-heading" className="health-section">
        <div className="section-heading">
          <h2 id="health-heading">当前检查结果</h2>
          <p>检查时间：{new Date(health.checkedAt).toLocaleString("zh-CN")}</p>
        </div>
        <dl className="health-list">
          {Object.entries(health.checks).map(([key, check]) => (
            <div key={key}>
              <dt>{labels[key as keyof typeof labels]}</dt>
              <dd>
                <strong data-status={check.status}>{statusLabels[check.status]}</strong>
                <span>{check.message}</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="backup-heading" className="health-section">
        <div className="section-heading">
          <h2 id="backup-heading">创建本地备份</h2>
        </div>
        <BackupButton />
      </section>

      <section aria-labelledby="backup-list-heading" className="health-section">
        <div className="section-heading">
          <h2 id="backup-list-heading">可用备份</h2>
        </div>
        {backupsError ? <p role="alert">{backupsError}</p> : null}
        {!backupsError && backups.length === 0 ? (
          <p>暂无可用备份。</p>
        ) : null}
        {backups.length > 0 ? (
          <ul className="backup-list">
            {backups.map((backup) => (
              <li key={backup.backupId}>
                <span>{new Date(backup.createdAt).toLocaleString("zh-CN")}</span>
                <span>{formatBytes(backup.databaseBytes)}</span>
                <span>结构版本 {backup.schemaVersion}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-labelledby="restore-heading" className="health-section">
        <div className="section-heading">
          <div>
            <h2 id="restore-heading">从备份恢复</h2>
            <p>
              恢复会把数据整体回退到备份时刻。
            </p>
          </div>
        </div>
        <RestorePanel />
      </section>

      <section aria-labelledby="export-heading" className="health-section">
        <div className="section-heading">
          <h2 id="export-heading">导出数据</h2>
        </div>
        <div className="export-actions">
          <a href="/api/v1/export?format=json">下载 JSON 完整导出</a>
          <a href="/api/v1/export?format=markdown">下载 Markdown 摘要</a>
        </div>
      </section>

    </main>
  );
}
