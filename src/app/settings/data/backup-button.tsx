"use client";

import { useState } from "react";

type BackupState = "idle" | "saving" | "verified" | "failed";

interface BackupButtonProps {
  request?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

interface BackupResponse {
  status?: string;
  message?: string;
}

export function BackupButton({ request = fetch }: BackupButtonProps) {
  const [state, setState] = useState<BackupState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function createBackup() {
    if (state === "saving") return;
    setState("saving");
    setMessage(null);

    try {
      const response = await request("/api/v1/backups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const result = (await response.json()) as BackupResponse;
      if (response.ok && result.status === "verified") {
        setState("verified");
        setMessage("备份已验证，可以用于恢复");
        return;
      }
      setState("failed");
      setMessage(result.message ?? "备份失败，请稍后重试");
    } catch {
      setState("failed");
      setMessage("无法连接到本地服务，请稍后重试");
    }
  }

  return (
    <div className="backup-action">
      <button disabled={state === "saving"} onClick={() => void createBackup()} type="button">
        {state === "saving"
          ? "正在验证备份"
          : state === "failed"
            ? "重新创建备份"
            : "立即创建备份"}
      </button>
      {message ? (
        <p aria-live="polite" role={state === "failed" ? "alert" : "status"}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
