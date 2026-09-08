import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const launcherRoot = dirname(fileURLToPath(import.meta.url));

test("desktop launcher keeps the app on a fixed loopback origin", () => {
  const manifest = JSON.parse(
    readFileSync(join(launcherRoot, "launch-manifest.json"), "utf8"),
  );

  assert.deepEqual(manifest, {
    appName: "个人积累库",
    host: "127.0.0.1",
    port: 3216,
    healthPath: "/api/v1/health",
    dataRootEnvironmentVariable: "LIFE_OS_DATA_ROOT",
    controlRootEnvironmentVariable: "LIFE_OS_CONTROL_ROOT",
    runtimeDirectoryName: "desktop-runtime",
  });
});

test("PowerShell validation checks the source launcher without starting a server", () => {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      join(launcherRoot, "start-personal-growth.ps1"),
      "-ValidateOnly",
    ],
    { cwd: launcherRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /VALIDATION_OK/);
  assert.match(result.stdout, /127\.0\.0\.1:3216/);
});

test("double-click entry points delegate to their PowerShell scripts", () => {
  const projectRoot = join(launcherRoot, "..", "..");
  const start = readFileSync(join(projectRoot, "启动个人积累库.cmd"), "utf8");
  const stop = readFileSync(join(projectRoot, "停止个人积累库.cmd"), "utf8");

  assert.match(start, /start-personal-growth\.ps1/i);
  assert.match(stop, /stop-personal-growth\.ps1/i);
  assert.doesNotMatch(start, /taskkill/i);
  assert.doesNotMatch(stop, /\/IM\s+node\.exe/i);
});

test("process ownership checks do not require privileged WMI access", () => {
  const start = readFileSync(
    join(launcherRoot, "start-personal-growth.ps1"),
    "utf8",
  );
  const stop = readFileSync(
    join(launcherRoot, "stop-personal-growth.ps1"),
    "utf8",
  );

  assert.doesNotMatch(start, /Get-CimInstance|Win32_Process/);
  assert.doesNotMatch(stop, /Get-CimInstance|Win32_Process/);
  assert.match(start, /StartTime/);
  assert.match(stop, /StartTime/);
  assert.doesNotMatch(start, /Stop-Process\s+-Id/i);
  assert.doesNotMatch(stop, /Stop-Process\s+-Id/i);
  assert.match(start, /\.Kill\(\)/);
  assert.match(stop, /\.Kill\(\)/);
});

test("PID metadata writes are atomic and roll back the owned server on failure", () => {
  const start = readFileSync(
    join(launcherRoot, "start-personal-growth.ps1"),
    "utf8",
  );

  // A partially written server.json must never become the control record.
  assert.match(start, /\$temporaryPidFile\s*=\s*"\$pidFile\.\$PID\.tmp"/);
  assert.match(
    start,
    /ConvertTo-Json\s*\|\s*Set-Content\s+-LiteralPath\s+\$temporaryPidFile[\s\S]*?Move-Item\s+-LiteralPath\s+\$temporaryPidFile\s+-Destination\s+\$pidFile\s+-Force/,
  );

  // If either metadata write or rename fails, the spawned process and both
  // possible metadata paths are cleaned up before the error is re-thrown.
  const rollback = start.match(
    /\}\s*catch\s*\{([\s\S]*?)\n\}\s*\n\s*\$deadline\s*=/,
  );
  assert.ok(rollback, "startup metadata transaction must have a catch block");
  assert.match(rollback[1], /Stop-OwnedProcessObject\s+\$server\s+\$processStartTicks/);
  assert.match(
    rollback[1],
    /Remove-Item\s+-LiteralPath\s+\$temporaryPidFile\s+-Force\s+-ErrorAction\s+SilentlyContinue/,
  );
  assert.match(
    rollback[1],
    /Remove-Item\s+-LiteralPath\s+\$pidFile\s+-Force\s+-ErrorAction\s+SilentlyContinue/,
  );
});
