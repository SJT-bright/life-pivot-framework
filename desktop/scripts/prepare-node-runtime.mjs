import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptRoot, "..", "..");
const runtimeRoot = join(projectRoot, "desktop", "runtime");
const targetRoot = join(runtimeRoot, "node");
const supportedTargets = new Set(["win32-x64", "darwin-x64", "darwin-arm64"]);
const targetArgument = process.argv
  .slice(2)
  .find((argument) => argument.startsWith("--target="));
const requestedTarget =
  targetArgument?.slice("--target=".length) ?? `${process.platform}-${process.arch}`;

if (!supportedTargets.has(requestedTarget)) {
  throw new Error(`Unsupported desktop runtime target: ${requestedTarget}`);
}
const [targetPlatform, targetArch] = requestedTarget.split("-");
if (targetPlatform !== process.platform || targetArch !== process.arch) {
  throw new Error(
    `Runtime ${requestedTarget} must be prepared on a matching computer; current host is ${process.platform}-${process.arch}`,
  );
}
const major = Number(process.versions.node.split(".")[0]);
if (major < 24) throw new Error("Node.js 24 or newer is required");

rmSync(targetRoot, { recursive: true, force: true });
mkdirSync(targetRoot, { recursive: true });
const executableName = targetPlatform === "win32" ? "node.exe" : "node";
const executablePath = join(targetRoot, executableName);
copyFileSync(process.execPath, executablePath);
if (targetPlatform === "darwin") chmodSync(executablePath, 0o755);

const licenseUrl = `https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`;
const licenseUrls = [
  licenseUrl,
  `https://cdn.jsdelivr.net/gh/nodejs/node@v${process.versions.node}/LICENSE`,
];
let licenseText = null;
for (const candidate of [
  join(dirname(process.execPath), "LICENSE"),
  join(dirname(process.execPath), "LICENSE.txt"),
  join(dirname(dirname(process.execPath)), "LICENSE"),
  join(dirname(dirname(process.execPath)), "LICENSE.txt"),
]) {
  if (existsSync(candidate)) {
    licenseText = readFileSync(candidate, "utf8");
    break;
  }
}
for (const url of licenseUrls) {
  for (let attempt = 0; attempt < 3 && licenseText === null; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (response.ok) licenseText = await response.text();
    } catch {
      // A transient reset is common on Windows; retry, then use the tagged mirror.
    }
  }
}
if (licenseText === null) throw new Error("Could not download the official Node.js license");
writeFileSync(
  join(targetRoot, "NODE-LICENSE.txt"),
  licenseText,
  "utf8",
);
writeFileSync(
  join(targetRoot, "runtime.json"),
  `${JSON.stringify(
    {
      arch: process.arch,
      modules: process.versions.modules,
      platform: process.platform,
      source: "Official Node.js runtime copied from the build host",
      license: licenseUrl,
      target: requestedTarget,
      version: process.versions.node,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
console.log(`Prepared Node.js ${process.versions.node} at ${targetRoot}`);
