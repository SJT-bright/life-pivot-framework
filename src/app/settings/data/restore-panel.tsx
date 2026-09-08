"use client";

import { useCallback, useEffect, useState } from "react";

interface RestoreCandidate {
  backupId: string;
  createdAt: string;
  schemaVersion: string;
  applicationVersion: string | null;
  databaseBytes: number;
}

interface RestoreResponse {
  status?: string;
  message?: string;
  restoredBackupId?: string;
  safetySnapshotFile?: string;
}

const CONFIRM_PHRASE = "恢复";

export function RestorePanel({
  request = fetch,
}: {
  request?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}) {
  const [backups, setBackups] = useState<RestoreCandidate[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const loadBackups = useCallback(async () => {
    try {
      const response = await request("/api/v1/backups/list", { cache: "no-store" });
      const result = (await response.json()) as { backups?: RestoreCandidate[] };
      if (!response.ok || !Array.isArray(result.backups)) throw new Error();
      setBackups(result.backups);
      setLoadFailed(false);
      setSelectedId((current) =>
        result.backups!.some((backup) => backup.backupId === current)
          ? current
          : (result.backups![0]?.backupId ?? ""),
      );
    } catch {
      setLoadFailed(true);
    }
  }, [request]);

  useEffect(() => {
    void loadBackups();
  }, [loadBackups]);

  async function restore() {
    if (restoring || !selectedId) return;
    if (confirmText !== CONFIRM_PHRASE) {
      setFailed(true);
      setMessage(`请先在输入框中输入“${CONFIRM_PHRASE}”确认。`);
      return;
    }
    setRestoring(true);
    setMessage(null);
    setFailed(false);
    try {
      const response = await request("/api/v1/backups/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ backupId: selectedId, confirm: confirmText }),
      });
      const result = (await response.json()) as RestoreResponse;
      if (response.ok && result.status === "restored") {
        setMessage("恢复完成，页面即将刷新。");
        window.setTimeout(() => {
          window.location.reload();
        }, 1200);
        return;
      }
      setFailed(true);
      setMessage(result.message ?? "恢复失败，请稍后重试；当前数据未受影响。");
    } catch {
      setFailed(true);
      setMessage("没有收到本地服务的回应；当前数据未受影响，请确认软件仍在运行后重试。");
    } finally {
      setRestoring(false);
    }
  }

  if (loadFailed) {
    return <p role="alert">暂时无法读取备份列表；请确认软件仍在运行。</p>;
  }
  if (backups.length === 0) {
    return <p>还没有可用备份，先创建一个备份后才能恢复。</p>;
  }

  const selected = backups.find((backup) => backup.backupId === selectedId);

  return (
    <div className="restore-panel">
      <label htmlFor="restore-backup-select">选择要恢复的备份</label>
      <select
        id="restore-backup-select"
        onChange={(event) => setSelectedId(event.target.value)}
        value={selectedId}
      >
        {backups.map((backup) => (
          <option key={backup.backupId} value={backup.backupId}>
            {new Date(backup.createdAt).toLocaleString("zh-CN")} · 结构版本 {backup.schemaVersion}
          </option>
        ))}
      </select>
      {selected ? (
        <p className="restore-hint">
          恢复后，{new Date(selected.createdAt).toLocaleString("zh-CN")} 之后记录的内容都会被回退。
        </p>
      ) : null}
      <label htmlFor="restore-confirm-input">
        输入「{CONFIRM_PHRASE}」确认执行恢复
      </label>
      <div className="restore-actions">
        <input
          autoComplete="off"
          id="restore-confirm-input"
          onChange={(event) => setConfirmText(event.target.value)}
          value={confirmText}
        />
        <button disabled={restoring || confirmText !== CONFIRM_PHRASE} onClick={() => void restore()} type="button">
          {restoring ? "正在恢复" : "开始恢复"}
        </button>
      </div>
      {message ? (
        <p aria-live="polite" role={failed ? "alert" : "status"}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
