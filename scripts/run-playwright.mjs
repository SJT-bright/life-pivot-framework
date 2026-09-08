import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import process from "node:process";

const port = 3200;
const baseURL = `http://127.0.0.1:${port}`;
const dataRoot = path.resolve(process.cwd(), ".data", `e2e-${process.pid}`);
const server = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)],
  {
    cwd: process.cwd(),
    env: { ...process.env, LIFE_OS_DATA_ROOT: dataRoot },
    stdio: "inherit",
    windowsHide: true,
  },
);

let stopped = false;
async function stopServer() {
  if (stopped) return;
  stopped = true;
  if (server.exitCode === null) {
    server.kill();
    await Promise.race([
      once(server, "exit"),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }
  await rm(dataRoot, { force: true, recursive: true });
}

process.once("SIGINT", () => {
  process.exitCode = 130;
  void stopServer();
});
process.once("SIGTERM", () => {
  process.exitCode = 143;
  void stopServer();
});

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Next server exited with ${server.exitCode}`);
    try {
      const response = await fetch(baseURL);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Timed out waiting for the E2E server");
}

try {
  await waitForServer();
  const playwright = spawn(
    process.execPath,
    ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)],
    {
      cwd: process.cwd(),
      env: { ...process.env, PLAYWRIGHT_EXTERNAL_SERVER: "1" },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  const exitCode = await new Promise((resolve) => {
    playwright.once("exit", (code) => resolve(code ?? 1));
  });
  process.exitCode = exitCode;
} finally {
  await stopServer();
}
