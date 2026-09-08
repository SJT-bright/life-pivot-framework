import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

const desktopRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(desktopRoot, "..", "..");
const require = createRequire(import.meta.url);
const runtime = require("./runtime.cjs");

test("desktop data remains in the existing LifePivot root", () => {
  assert.equal(
    runtime.resolveDataRoot(
      { LOCALAPPDATA: "C:\\Users\\friend\\AppData\\Local" },
      "win32",
    ),
    "C:\\Users\\friend\\AppData\\Local\\LifePivot",
  );
  assert.equal(
    runtime.resolveDataRoot(
      {
        LOCALAPPDATA: "C:\\ignored",
        LIFE_OS_DATA_ROOT: "D:\\PersonalData",
      },
      "win32",
    ),
    "D:\\PersonalData",
  );
  assert.throws(
    () => runtime.resolveDataRoot({ LIFE_OS_DATA_ROOT: "relative" }, "win32"),
    /absolute/i,
  );
});

test("macOS desktop data uses the user's Application Support directory", () => {
  assert.equal(
    runtime.resolveDataRoot({ HOME: "/Users/friend" }, "darwin"),
    "/Users/friend/Library/Application Support/LifePivot",
  );
  assert.equal(
    runtime.resolveDataRoot(
      {
        HOME: "/Users/ignored",
        LIFE_OS_DATA_ROOT: "/Volumes/Private/LifePivot",
      },
      "darwin",
    ),
    "/Volumes/Private/LifePivot",
  );
  assert.throws(
    () => runtime.resolveDataRoot({ HOME: "Users/friend" }, "darwin"),
    /absolute/i,
  );
});

test("desktop runtime selection only accepts shipped Windows and macOS targets", () => {
  assert.deepEqual(runtime.getDesktopRuntimeInfo("win32", "x64"), {
    arch: "x64",
    executableName: "node.exe",
    platform: "win32",
    target: "win32-x64",
  });
  assert.deepEqual(runtime.getDesktopRuntimeInfo("darwin", "arm64"), {
    arch: "arm64",
    executableName: "node",
    platform: "darwin",
    target: "darwin-arm64",
  });
  assert.throws(
    () => runtime.getDesktopRuntimeInfo("linux", "x64"),
    /unsupported desktop runtime target/i,
  );
  assert.throws(
    () => runtime.getDesktopRuntimeInfo("win32", "arm64"),
    /unsupported desktop runtime target/i,
  );
  assert.throws(
    () => runtime.getDesktopRuntimeInfo("darwin", "ia32"),
    /unsupported desktop runtime target/i,
  );
  assert.throws(
    () => runtime.assertRuntimeManifest(null, "darwin", "arm64"),
    /does not match/i,
  );
  assert.throws(
    () => runtime.assertRuntimeManifest(
      { platform: "darwin", arch: "x64" },
      "darwin",
      "arm64",
    ),
    /does not match/i,
  );
  assert.throws(
    () => runtime.assertRuntimeManifest(
      { platform: "darwin", arch: "arm64", target: "darwin-x64" },
      "darwin",
      "arm64",
    ),
    /does not match/i,
  );
  assert.deepEqual(
    runtime.assertRuntimeManifest(
      { platform: "darwin", arch: "arm64", target: "darwin-arm64" },
      "darwin",
      "arm64",
    ),
    runtime.getDesktopRuntimeInfo("darwin", "arm64"),
  );
});

test("desktop scripts reject unsupported and cross-host package targets", () => {
  const prepareScript = join(projectRoot, "desktop", "scripts", "prepare-node-runtime.mjs");
  const stageScript = join(projectRoot, "desktop", "scripts", "stage-server.mjs");
  const unsupported = spawnSync(
    process.execPath,
    [prepareScript, "--target=linux-x64"],
    { encoding: "utf8" },
  );
  assert.notEqual(unsupported.status, 0);
  assert.match(unsupported.stderr, /unsupported desktop runtime target/i);

  const otherHostTarget =
    process.platform === "darwin" ? "win32-x64" : "darwin-arm64";
  const mismatched = spawnSync(
    process.execPath,
    [stageScript, `--target=${otherHostTarget}`],
    { encoding: "utf8" },
  );
  assert.notEqual(mismatched.status, 0);
  assert.match(mismatched.stderr, /must be staged on a matching computer/i);
});

test("desktop navigation stays inside its exact loopback origin", () => {
  const origin = "http://127.0.0.1:3216";
  assert.equal(runtime.isAllowedNavigation(`${origin}/today`, origin), true);
  assert.equal(runtime.isAllowedNavigation("http://127.0.0.1:3217/today", origin), false);
  assert.equal(runtime.isAllowedNavigation("https://example.com", origin), false);
  assert.equal(runtime.isAllowedNavigation("not a url", origin), false);
});

test("desktop restores only safe app pages with their search parameters", () => {
  const origin = "http://127.0.0.1:3216";
  assert.equal(
    runtime.normalizeMainLocation("/reading?status=reading&page=2#notes", origin),
    "/reading?status=reading&page=2",
  );
  assert.equal(
    runtime.normalizeMainLocation(`${origin}/exercise?date=2026-09-04`, origin),
    "/exercise?date=2026-09-04",
  );
  assert.equal(runtime.normalizeMainLocation("/", origin), "/today");
  for (const unsafe of [
    "https://example.com/reading",
    "//example.com/reading",
    "/api/v1/health",
    "/_next/static/chunk.js",
    "/companion",
    "not a url",
  ]) {
    assert.equal(runtime.normalizeMainLocation(unsafe, origin), null);
  }
  assert.equal(
    runtime.parseMainLocationPreference(
      { version: 1, location: "/goals?view=tomorrow" },
      origin,
    ),
    "/goals?view=tomorrow",
  );
  assert.equal(
    runtime.parseMainLocationPreference(
      { version: 2, location: "/goals" },
      origin,
    ),
    null,
  );
});

test("desktop companion stays pinned to the right edge while expanding", () => {
  const workArea = { x: 20, y: 40, width: 1440, height: 900 };
  assert.deepEqual(runtime.calculateCompanionBounds(workArea, false), {
    x: 1416,
    y: 410,
    width: 44,
    height: 160,
  });
  assert.deepEqual(runtime.calculateCompanionBounds(workArea, true), {
    x: 1160,
    y: 272,
    width: 300,
    height: 436,
  });

  assert.deepEqual(runtime.calculateCompanionBounds(workArea, false, 0.25), {
    x: 1416,
    y: 185,
    width: 44,
    height: 160,
  });
  assert.deepEqual(runtime.calculateCompanionBounds(workArea, true, 0.25), {
    x: 1160,
    y: 47,
    width: 300,
    height: 436,
  });
});

test("desktop companion vertical dragging clamps inside the work area and never changes x", () => {
  const workArea = { x: 20, y: 40, width: 1440, height: 900 };
  const moved = runtime.calculateDraggedCompanionBounds(workArea, false, 410, 100);
  assert.deepEqual(moved.bounds, {
    x: 1416,
    y: 510,
    width: 44,
    height: 160,
  });
  assert.equal(moved.verticalAnchorRatio, 550 / 900);

  assert.deepEqual(
    runtime.calculateDraggedCompanionBounds(workArea, false, 410, -10_000).bounds,
    { x: 1416, y: 178, width: 44, height: 160 },
  );
  assert.deepEqual(
    runtime.calculateDraggedCompanionBounds(workArea, true, 272, 10_000).bounds,
    { x: 1160, y: 504, width: 300, height: 436 },
  );

  assert.deepEqual(
    runtime.calculateCompanionBounds({ x: 10, y: 20, width: 40, height: 100 }, true, 0.5),
    { x: 10, y: 20, width: 40, height: 100 },
  );
});

test("desktop companion keeps one screen-space grab anchor when expanding at either limit", () => {
  const workArea = { x: 20, y: 40, width: 1440, height: 900 };
  for (const deltaY of [-10_000, 10_000]) {
    const collapsed = runtime.calculateDraggedCompanionBounds(
      workArea,
      false,
      410,
      deltaY,
    );
    const expanded = runtime.calculateCompanionBounds(
      workArea,
      true,
      collapsed.verticalAnchorRatio,
    );
    assert.equal(
      collapsed.bounds.y + collapsed.bounds.height / 2,
      expanded.y + expanded.height / 2,
    );
  }
});

test("desktop companion position persistence accepts only the versioned anchor ratio", () => {
  assert.deepEqual(runtime.parseCompanionPosition({
    version: 1,
    verticalAnchorRatio: 0.75,
  }), {
    version: 1,
    verticalAnchorRatio: 0.75,
  });
  for (const invalid of [
    null,
    {},
    { version: 2, verticalAnchorRatio: 0.5 },
    { version: 1, verticalAnchorRatio: -0.1 },
    { version: 1, verticalAnchorRatio: 1.1 },
    { version: 1, verticalAnchorRatio: "0.5" },
  ]) {
    assert.equal(runtime.parseCompanionPosition(invalid), null);
  }
});

test("desktop refuses to open a second service on the same fixed port", async () => {
  const blocker = net.createServer();
  await new Promise((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen({ host: "127.0.0.1", port: 0 }, resolve);
  });
  const address = blocker.address();
  try {
    await assert.rejects(
      runtime.requireAvailablePort("127.0.0.1", address.port),
      /already in use/i,
    );
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
  }
});

test("Electron main process uses isolated renderer settings and an external Node child", () => {
  const main = readFileSync(join(desktopRoot, "main.cjs"), "utf8");
  const preload = readFileSync(join(desktopRoot, "preload.cjs"), "utf8");
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /createCompanionWindow/);
  assert.match(main, /alwaysOnTop:\s*true/);
  assert.match(main, /setVisibleOnAllWorkspaces/);
  assert.match(main, /life-pivot:set-companion-expanded/);
  assert.match(main, /life-pivot:move-companion/);
  assert.match(main, /calculateDraggedCompanionBounds/);
  assert.match(main, /companion-position\.json/);
  assert.match(main, /movable:\s*false/);
  assert.match(main, /setBounds\(target, false\)/);
  assert.doesNotMatch(main, /setBounds\(companionBounds\(expanded\), true\)/);
  assert.doesNotMatch(main, /["']will-move["']/);
  assert.match(preload, /life-pivot:move-companion/);
  assert.match(preload, /Number\.isFinite\(command\.screenY\)/);
  assert.match(main, /life-pivot:notify-reminder/);
  assert.match(main, /event\.sender !== companionWindow\?\.webContents/);
  assert.match(main, /Notification\.isSupported\(\)/);
  assert.match(main, /sound:\s*"default"/);
  assert.match(main, /shell\.beep\(\)/);
  assert.match(main, /dock\?\.bounce\("informational"\)/);
  assert.match(main, /backgroundThrottling:\s*false/);
  assert.match(main, /preload\.cjs/);
  assert.match(main, /requestSingleInstanceLock/);
  assert.match(main, /spawn\(nodeExecutable/);
  assert.match(main, /NODE_PATH:\s*path\.join\(serverRoot,\s*"server-node-modules"\)/);
  assert.match(main, /watchdogEntry, serverEntry/);
  assert.match(main, /stdio:\s*\["ignore", stdout, stderr, "ipc"\]/);
  assert.match(main, /await window\.loadURL/);
  assert.match(main, /serverFailureNotified/);
  assert.match(main, /process\.resourcesPath,\s*"app-server"/);
  assert.match(main, /path\.join\(process\.resourcesPath,\s*"node"\)/);
  assert.match(main, /runtime\.json/);
  assert.match(main, /runtimeInfo\.executableName/);
  assert.match(main, /process\.platform !== "darwin"/);
  assert.match(main, /app\.on\("activate"/);
  assert.match(main, /main-location\.json/);
  assert.match(main, /loadMainLocation\(origin\)/);
  assert.match(main, /loadURL\(new URL\(initialLocation, origin\)\.href\)/);
  assert.match(main, /did-navigate-in-page/);
  assert.match(main, /if \(!isMainFrame\) return/);
  assert.match(main, /life-pivot:remember-main-location/);
  assert.match(main, /async function reopenWindow\(pathname\)/);
  assert.doesNotMatch(main, /async function reopenWindow\(pathname = ["']\/today["']\)/);
  assert.match(preload, /rememberMainLocation/);
  assert.match(main, /app\.setLoginItemSettings/);
  assert.match(main, /openAtLogin:\s*true/);
  assert.match(main, /type:\s*"mainAppService"/);
  assert.match(main, /startupPromise = app\.whenReady\(\)\.then\(startDesktop\)/);
  assert.match(main, /async function reopenWindow\([^)]*\) \{\s*await beginDesktopStartup\(\)/);
  assert.doesNotMatch(main, /ELECTRON_RUN_AS_NODE/);
});

test("server watchdog exits cleanly when its Electron IPC channel disconnects", async () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "lifepivot-watchdog-"));
  const serverEntry = join(fixtureRoot, "server-entry.cjs");
  const watchdogEntry = join(desktopRoot, "server-watchdog.cjs");
  writeFileSync(
    serverEntry,
    'process.send?.("ready"); setInterval(() => {}, 1000);\n',
    "utf8",
  );

  const child = spawn(process.execPath, [watchdogEntry, serverEntry], {
    cwd: fixtureRoot,
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    windowsHide: true,
  });

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("server watchdog did not signal readiness"));
      }, 3000);
      const cleanup = () => {
        clearTimeout(timer);
        child.off("error", onError);
        child.off("exit", onExit);
      };
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      const onExit = (code, signal) => {
        cleanup();
        reject(new Error(`server watchdog exited before ready (${code}, ${signal})`));
      };
      child.once("error", onError);
      child.once("exit", onExit);
      child.once("message", (message) => {
        cleanup();
        assert.equal(message, "ready");
        resolve();
      });
    });

    assert.equal(child.connected, true);
    child.disconnect();
    const [code, signal] = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("server watchdog did not exit after disconnect")), 3000);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (exitCode, exitSignal) => {
        clearTimeout(timer);
        resolve([exitCode, exitSignal]);
      });
    });
    assert.equal(code, 0);
    assert.equal(signal, null);
  } finally {
    if (child.exitCode === null && !child.killed) {
      child.kill();
    }
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("packaging keeps the server and native runtime outside asar", () => {
  const builder = readFileSync(join(projectRoot, "electron-builder.yml"), "utf8");
  const nextConfig = readFileSync(join(projectRoot, "next.config.ts"), "utf8");
  const stageScript = readFileSync(join(projectRoot, "desktop", "scripts", "stage-server.mjs"), "utf8");
  assert.match(nextConfig, /output:\s*["']standalone["']/);
  assert.match(builder, /from:\s*desktop\/build\/server/);
  assert.match(builder, /to:\s*app-server/);
  assert.match(builder, /from:\s*desktop\/runtime\/node/);
  assert.match(builder, /desktop\/electron\/preload\.cjs/);
  assert.match(builder, /to:\s*node/);
  assert.match(builder, /NODE-LICENSE\.txt/);
  assert.match(builder, /runtime\.json/);
  assert.match(stageScript, /renameSync\(standaloneNodeModules, packagedNodeModules\)/);
  assert.match(stageScript, /"server-node-modules"/);
  assert.match(stageScript, /lstatSync\(aliasPath\)\.isSymbolicLink\(\)/);
  assert.match(stageScript, /cpSync\(packageSource, aliasPath/);
  assert.match(stageScript, /rmSync\(join\(stageRoot, "发布包"\)/);
  assert.match(builder, /mac:/);
  assert.match(builder, /public\.app-category\.productivity/);
  assert.match(builder, /target:\s*dmg/);
  assert.match(builder, /macOS-\$\{arch\}\.\$\{ext\}/);
  assert.match(builder, /arm64/);
  assert.match(builder, /x64/);
  assert.match(builder, /perMachine:\s*false/);
});
