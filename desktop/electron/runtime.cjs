const net = require("node:net");
const path = require("node:path");

function resolveDataRoot(environment, platform = process.platform) {
  const override = environment.LIFE_OS_DATA_ROOT?.trim();
  const pathApi =
    platform === "win32" ? path.win32 : platform === "darwin" ? path.posix : null;
  if (!pathApi) {
    throw new Error(`Unsupported desktop platform: ${platform}`);
  }
  if (override) {
    if (!pathApi.isAbsolute(override)) {
      throw new Error("LIFE_OS_DATA_ROOT must be an absolute path");
    }
    return pathApi.normalize(override);
  }

  if (platform === "win32") {
    const localAppData = environment.LOCALAPPDATA?.trim();
    if (!localAppData || !path.win32.isAbsolute(localAppData)) {
      throw new Error("LOCALAPPDATA must be an absolute path");
    }
    return path.win32.join(localAppData, "LifePivot");
  }

  const home = environment.HOME?.trim();
  if (!home || !path.posix.isAbsolute(home)) {
    throw new Error("HOME must be an absolute path");
  }
  return path.posix.join(home, "Library", "Application Support", "LifePivot");
}

function getDesktopRuntimeInfo(platform = process.platform, arch = process.arch) {
  const target = `${platform}-${arch}`;
  if (!["win32-x64", "darwin-x64", "darwin-arm64"].includes(target)) {
    throw new Error(`Unsupported desktop runtime target: ${target}`);
  }
  return {
    arch,
    executableName: platform === "win32" ? "node.exe" : "node",
    platform,
    target,
  };
}

function assertRuntimeManifest(manifest, platform = process.platform, arch = process.arch) {
  const runtime = getDesktopRuntimeInfo(platform, arch);
  if (
    !manifest ||
    manifest.platform !== runtime.platform ||
    manifest.arch !== runtime.arch ||
    manifest.target !== runtime.target
  ) {
    throw new Error(
      `Bundled Node.js runtime does not match this computer (expected ${runtime.target})`,
    );
  }
  return runtime;
}

function isAllowedNavigation(candidate, allowedOrigin) {
  try {
    return new URL(candidate).origin === allowedOrigin;
  } catch {
    return false;
  }
}

function normalizeMainLocation(candidate, allowedOrigin) {
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > 8192) {
    return null;
  }
  if (!candidate.startsWith("/") && !/^https?:\/\//iu.test(candidate)) return null;
  try {
    const allowedUrl = new URL(allowedOrigin);
    const candidateUrl = new URL(candidate, allowedUrl);
    if (candidateUrl.origin !== allowedUrl.origin) return null;
    const pathname = candidateUrl.pathname;
    if (
      pathname === "/api" ||
      pathname.startsWith("/api/") ||
      pathname === "/_next" ||
      pathname.startsWith("/_next/") ||
      pathname === "/companion" ||
      pathname.startsWith("/companion/")
    ) {
      return null;
    }
    return `${pathname === "/" ? "/today" : pathname}${candidateUrl.search}`;
  } catch {
    return null;
  }
}

function parseMainLocationPreference(value, allowedOrigin) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.version !== 1 ||
    typeof value.location !== "string"
  ) {
    return null;
  }
  return normalizeMainLocation(value.location, allowedOrigin);
}

const DEFAULT_COMPANION_ANCHOR_RATIO = 0.5;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeCompanionAnchorRatio(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, 0, 1)
    : DEFAULT_COMPANION_ANCHOR_RATIO;
}

function companionSize(workArea, expanded) {
  // Keep roughly 70% of the former on-screen area while preserving enough room
  // for readable controls: 360×520 -> 300×436 and 52×190 -> 44×160.
  return {
    width: Math.min(expanded ? 300 : 44, Math.max(1, workArea.width)),
    height: Math.min(expanded ? 436 : 160, Math.max(1, workArea.height)),
  };
}

function companionAnchorRange(workArea) {
  const expandedHeight = companionSize(workArea, true).height;
  const halfHeight = expandedHeight / 2;
  return {
    maximum: workArea.y + workArea.height - halfHeight,
    minimum: workArea.y + halfHeight,
  };
}

function calculateCompanionBounds(
  workArea,
  expanded,
  verticalAnchorRatio = DEFAULT_COMPANION_ANCHOR_RATIO,
) {
  const { width, height } = companionSize(workArea, expanded);
  const anchorRatio = normalizeCompanionAnchorRatio(verticalAnchorRatio);
  const anchorRange = companionAnchorRange(workArea);
  const centerY = clamp(
    workArea.y + workArea.height * anchorRatio,
    anchorRange.minimum,
    anchorRange.maximum,
  );
  return {
    x: workArea.x + workArea.width - width,
    y: Math.round(centerY - height / 2),
    width,
    height,
  };
}

function companionAnchorRatioFromBounds(workArea, bounds) {
  if (!workArea || !bounds || workArea.height <= 0) {
    return DEFAULT_COMPANION_ANCHOR_RATIO;
  }
  return normalizeCompanionAnchorRatio(
    (bounds.y + bounds.height / 2 - workArea.y) / workArea.height,
  );
}

function calculateDraggedCompanionBounds(workArea, expanded, startY, deltaY) {
  const base = calculateCompanionBounds(workArea, expanded);
  const anchorRange = companionAnchorRange(workArea);
  const centerY = clamp(
    startY + base.height / 2 + deltaY,
    anchorRange.minimum,
    anchorRange.maximum,
  );
  const y = Math.round(centerY - base.height / 2);
  const bounds = { ...base, y };
  return {
    bounds,
    verticalAnchorRatio: companionAnchorRatioFromBounds(workArea, bounds),
  };
}

function parseCompanionPosition(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.version !== 1 ||
    typeof value.verticalAnchorRatio !== "number" ||
    !Number.isFinite(value.verticalAnchorRatio) ||
    value.verticalAnchorRatio < 0 ||
    value.verticalAnchorRatio > 1
  ) {
    return null;
  }
  return {
    version: 1,
    verticalAnchorRatio: value.verticalAnchorRatio,
  };
}

function tryPort(port, host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host, port, exclusive: true }, () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function requireAvailablePort(host, preferredPort) {
  try {
    return await tryPort(preferredPort, host);
  } catch (error) {
    if (error?.code !== "EADDRINUSE" && error?.code !== "EACCES") throw error;
    throw new Error(
      `Port ${preferredPort} is already in use. Close the other Personal Library window first.`,
    );
  }
}

async function waitForHealth(url, hasServerExited, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (hasServerExited()) throw new Error("The local server exited before it became ready");
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      if (response.ok) {
        const snapshot = await response.json();
        if (
          snapshot?.checks?.database?.status === "ok" &&
          snapshot?.checks?.schema?.status === "ok" &&
          snapshot?.checks?.dataRoot?.status === "ok"
        ) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          if (hasServerExited()) {
            throw new Error("The local server exited before it became ready");
          }
          return snapshot;
        }
      }
    } catch {
      // The server may still be starting or applying an existing migration.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("Timed out waiting for the local server health check");
}

module.exports = {
  assertRuntimeManifest,
  calculateDraggedCompanionBounds,
  calculateCompanionBounds,
  companionAnchorRatioFromBounds,
  getDesktopRuntimeInfo,
  isAllowedNavigation,
  normalizeMainLocation,
  normalizeCompanionAnchorRatio,
  parseMainLocationPreference,
  parseCompanionPosition,
  requireAvailablePort,
  resolveDataRoot,
  waitForHealth,
};
