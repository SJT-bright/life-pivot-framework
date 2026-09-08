import path from "node:path";

const APP_DIRECTORY_NAME = "LifePivot";
const STORAGE_SEGMENT = /^[A-Za-z0-9._-]+$/;

export interface AppPaths {
  dataRoot: string;
  databaseFile: string;
  attachmentsRoot: string;
  backupsRoot: string;
  tempRoot: string;
}

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

function pathApiForPlatform(
  platform: NodeJS.Platform,
): typeof path.win32 | typeof path.posix {
  if (platform === "win32") return path.win32;
  if (platform === "darwin") return path.posix;
  throw new Error(`不支持的桌面平台：${platform}`);
}

function pathApiFor(candidate: string): typeof path.win32 | typeof path.posix {
  if (path.posix.isAbsolute(candidate)) return path.posix;
  return path.win32.isAbsolute(candidate) || candidate.includes("\\")
    ? path.win32
    : path.posix;
}

export function resolveAppPaths(
  environment: RuntimeEnvironment,
  platform: NodeJS.Platform = process.platform,
): AppPaths {
  const override = environment.LIFE_OS_DATA_ROOT?.trim();
  const platformPath = pathApiForPlatform(platform);
  let dataRoot: string;

  if (override) {
    if (!platformPath.isAbsolute(override)) {
      throw new Error("数据目录必须是绝对路径");
    }
    dataRoot = platformPath.normalize(override);
  } else if (platform === "win32") {
    const localAppData = environment.LOCALAPPDATA?.trim();
    if (!localAppData || !path.win32.isAbsolute(localAppData)) {
      throw new Error("无法确定 Windows 本地数据目录");
    }
    dataRoot = path.win32.join(localAppData, APP_DIRECTORY_NAME);
  } else {
    const home = environment.HOME?.trim();
    if (!home || !path.posix.isAbsolute(home)) {
      throw new Error("无法确定 macOS 用户目录");
    }
    dataRoot = path.posix.join(
      home,
      "Library",
      "Application Support",
      APP_DIRECTORY_NAME,
    );
  }

  return {
    dataRoot,
    databaseFile: platformPath.join(dataRoot, "life-pivot.sqlite"),
    attachmentsRoot: platformPath.join(dataRoot, "attachments"),
    backupsRoot: platformPath.join(dataRoot, "backups"),
    tempRoot: platformPath.join(dataRoot, "temp"),
  };
}

export function resolveStorageKey(dataRoot: string, storageKey: string): string {
  if (
    !storageKey ||
    storageKey.includes("\\") ||
    path.win32.isAbsolute(storageKey) ||
    path.posix.isAbsolute(storageKey)
  ) {
    throw new Error("非法附件路径");
  }

  const segments = storageKey.split("/");
  if (
    segments.some(
      (segment) =>
        !segment || segment === "." || segment === ".." || !STORAGE_SEGMENT.test(segment),
    )
  ) {
    throw new Error("非法附件路径");
  }

  const pathApi = pathApiFor(dataRoot);
  const normalizedRoot = pathApi.resolve(dataRoot);
  const resolved = pathApi.resolve(normalizedRoot, ...segments);
  const relative = pathApi.relative(normalizedRoot, resolved);

  if (!relative || relative === ".." || relative.startsWith(`..${pathApi.sep}`) || pathApi.isAbsolute(relative)) {
    throw new Error("非法附件路径");
  }

  return resolved;
}
