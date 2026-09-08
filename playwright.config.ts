import path from "node:path";

import { defineConfig } from "@playwright/test";

const port = 3200;
const baseURL = `http://127.0.0.1:${port}`;
const dataRoot = path.resolve(process.cwd(), ".data", `e2e-${process.pid}`);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  outputDir: ".data/e2e-results",
  use: {
    baseURL,
    channel: "chrome",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: process.env.PLAYWRIGHT_EXTERNAL_SERVER === "1" ? undefined : {
    command: `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port ${port}`,
    env: { LIFE_OS_DATA_ROOT: dataRoot },
    reuseExistingServer: false,
    timeout: 120_000,
    url: baseURL,
  },
});
