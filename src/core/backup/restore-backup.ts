import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

import { applicationWriteBarrier, type WriteBarrier } from "./write-barrier";
import {
  type BackupManifest,
  listVerifiedBackups,
} from "./create-backup";

export const RESTORE_CONFIRM_PHRASE = "恢复";

export class RestoreBackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestoreBackupError";
  }
}

export interface RestoreOutcome {
  status: "restored";
  restoredBackupId: string;
  restoredCreatedAt: string;
  safetySnapshotFile: string;
}

export interface RestoreBackupDependencies {
  sqlite: Database.Database;
  databaseFile: string;
  backupsRoot: string;
  onDatabaseReplaced?: () => void;
  writeBarrier?: WriteBarrier;
  now?: () => Date;
  createId?: () => string;
}

function sha256FileSync(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export interface RestoreCandidate {
  backupId: string;
  createdAt: string;
  schemaVersion: string;
  applicationVersion: string | null;
  databaseBytes: number;
}

export function listRestoreCandidates(backupsRoot: string): RestoreCandidate[] {
  return listVerifiedBackups(backupsRoot).map((manifest: BackupManifest) => ({
    backupId: manifest.backupId,
    createdAt: manifest.createdAt,
    schemaVersion: manifest.schemaVersion,
    applicationVersion: manifest.applicationVersion,
    databaseBytes: manifest.databaseBytes,
  }));
}

interface VerifiedBackupTarget {
  manifest: BackupManifest;
  databaseFile: string;
}

function verifyRestoreTarget(backupsRoot: string, backupId: string): VerifiedBackupTarget {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(backupId)) {
    throw new RestoreBackupError("备份标识格式不正确");
  }

  const manifest = listVerifiedBackups(backupsRoot).find((entry) => entry.backupId === backupId);
  if (!manifest) {
    throw new RestoreBackupError("找不到可用的已验证备份");
  }

  const backupDatabaseFile = path.join(backupsRoot, backupId, "life-pivot.sqlite");
  if (!fs.existsSync(backupDatabaseFile)) {
    throw new RestoreBackupError("备份文件缺失，无法恢复");
  }
  if (sha256FileSync(backupDatabaseFile) !== manifest.databaseSha256) {
    throw new RestoreBackupError("备份文件校验失败（内容与记录的哈希不一致）");
  }

  const probe = new Database(backupDatabaseFile, { readonly: true, fileMustExist: true });
  try {
    if (probe.pragma("integrity_check", { simple: true }) !== "ok") {
      throw new RestoreBackupError("备份数据库完整性检查失败");
    }
    const schema = probe
      .prepare("select value from app_meta where key = 'schema_version'")
      .get() as { value: string } | undefined;
    if (!schema?.value) {
      throw new RestoreBackupError("备份缺少结构版本信息");
    }
  } finally {
    probe.close();
  }

  return { manifest, databaseFile: backupDatabaseFile };
}

async function createSafetySnapshot(
  sqlite: Database.Database,
  backupsRoot: string,
  now: () => Date,
  createId: () => string,
): Promise<string> {
  fs.mkdirSync(backupsRoot, { recursive: true });
  const directory = path.join(backupsRoot, `.pre-restore-${createId()}`);
  fs.mkdirSync(directory);
  const snapshotFile = path.join(directory, "life-pivot.sqlite");
  await sqlite.backup(snapshotFile);

  const probe = new Database(snapshotFile, { readonly: true, fileMustExist: true });
  try {
    if (probe.pragma("integrity_check", { simple: true }) !== "ok") {
      throw new RestoreBackupError("恢复前的安全快照完整性检查失败，已中止恢复");
    }
  } finally {
    probe.close();
  }

  fs.writeFileSync(
    path.join(directory, "README.txt"),
    [
      `这是恢复操作前自动创建的当前数据快照，创建于 ${now().toISOString()}。`,
      "如果恢复结果不符合预期，可以把本目录中的 life-pivot.sqlite 覆盖回数据目录。",
      "",
    ].join("\n"),
    "utf8",
  );
  return snapshotFile;
}

export async function restoreFromBackup(
  dependencies: RestoreBackupDependencies,
  input: { backupId: string; confirm: string },
): Promise<RestoreOutcome> {
  if (input.confirm !== RESTORE_CONFIRM_PHRASE) {
    throw new RestoreBackupError("请输入确认文字后再执行恢复");
  }

  const writeBarrier = dependencies.writeBarrier ?? applicationWriteBarrier;
  const now = dependencies.now ?? (() => new Date());
  const createId = dependencies.createId ?? (() => Math.random().toString(36).slice(2, 12));

  return writeBarrier.runBackup(async () => {
    const target = verifyRestoreTarget(dependencies.backupsRoot, input.backupId);

    const safetySnapshotFile = await createSafetySnapshot(
      dependencies.sqlite,
      dependencies.backupsRoot,
      now,
      createId,
    );

    dependencies.sqlite.close();
    dependencies.onDatabaseReplaced?.();

    const restoreTempFile = `${dependencies.databaseFile}.restore-${createId()}`;
    try {
      fs.copyFileSync(target.databaseFile, restoreTempFile);
      for (const sidecar of ["-wal", "-shm"] as const) {
        fs.rmSync(`${dependencies.databaseFile}${sidecar}`, { force: true });
      }
      fs.renameSync(restoreTempFile, dependencies.databaseFile);
    } catch (error) {
      try {
        fs.rmSync(restoreTempFile, { force: true });
      } catch {
        // 清理失败不掩盖原始错误
      }
      throw new RestoreBackupError("替换数据库文件失败；当前数据已保留在安全快照中");
    }

    return {
      status: "restored",
      restoredBackupId: target.manifest.backupId,
      restoredCreatedAt: target.manifest.createdAt,
      safetySnapshotFile,
    };
  });
}
