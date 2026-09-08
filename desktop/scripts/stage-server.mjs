import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptRoot, "..", "..");
const buildRoot = join(projectRoot, "desktop", "build");
const stageRoot = join(buildRoot, "server");
const standaloneRoot = join(projectRoot, ".next", "standalone");
const runtimeRoot = join(projectRoot, "desktop", "runtime", "node");
const runtimeManifestPath = join(runtimeRoot, "runtime.json");
const supportedTargets = new Set(["win32-x64", "darwin-x64", "darwin-arm64"]);
const targetArgument = process.argv
  .slice(2)
  .find((argument) => argument.startsWith("--target="));
const requestedTarget =
  targetArgument?.slice("--target=".length) ?? `${process.platform}-${process.arch}`;

if (!stageRoot.startsWith(`${buildRoot}${sep}`)) {
  throw new Error("Unsafe desktop stage path");
}
if (!supportedTargets.has(requestedTarget)) {
  throw new Error(`Unsupported desktop stage target: ${requestedTarget}`);
}
const [targetPlatform, targetArch] = requestedTarget.split("-");
if (targetPlatform !== process.platform || targetArch !== process.arch) {
  throw new Error(
    `Desktop target ${requestedTarget} must be staged on a matching computer; current host is ${process.platform}-${process.arch}`,
  );
}
if (!existsSync(runtimeManifestPath)) {
  throw new Error("Bundled Node.js runtime is missing; prepare the runtime first");
}
const runtimeManifest = JSON.parse(readFileSync(runtimeManifestPath, "utf8"));
if (
  runtimeManifest.platform !== targetPlatform ||
  runtimeManifest.arch !== targetArch ||
  runtimeManifest.target !== requestedTarget
) {
  throw new Error(
    `Bundled Node.js runtime does not match the requested target ${requestedTarget}`,
  );
}
if (!existsSync(join(standaloneRoot, "server.js"))) {
  throw new Error("Next standalone output is missing; run npm run build first");
}

rmSync(stageRoot, { recursive: true, force: true });
mkdirSync(stageRoot, { recursive: true });
cpSync(standaloneRoot, stageRoot, { dereference: true, recursive: true });

// electron-builder intentionally filters a top-level directory named node_modules
// from extraResources. Give the standalone dependencies a packaging-safe name and
// expose it through NODE_PATH when the bundled server starts.
const standaloneNodeModules = join(stageRoot, "node_modules");
const packagedNodeModules = join(stageRoot, "server-node-modules");
if (!existsSync(standaloneNodeModules)) {
  throw new Error("Next standalone dependencies are missing");
}
renameSync(standaloneNodeModules, packagedNodeModules);

// Next/Turbopack emits hashed aliases under .next/node_modules as symlinks back
// into the standalone node_modules directory. Shipping those links would tie the
// installed app to the source checkout path, so replace them with real folders.
const tracedExternalRoot = join(stageRoot, ".next", "node_modules");
if (existsSync(tracedExternalRoot)) {
  for (const alias of readdirSync(tracedExternalRoot)) {
    const aliasPath = join(tracedExternalRoot, alias);
    if (!lstatSync(aliasPath).isSymbolicLink()) continue;

    const match = /^(.*)-[0-9a-f]{16}$/u.exec(alias);
    if (!match) {
      throw new Error(`Unsupported traced external alias: ${alias}`);
    }
    const packageSource = join(packagedNodeModules, match[1]);
    if (!existsSync(packageSource)) {
      throw new Error(`Staged external dependency is missing: ${match[1]}`);
    }
    rmSync(aliasPath, { force: true });
    cpSync(packageSource, aliasPath, { dereference: true, recursive: true });
  }
}

// Next output tracing can see artifacts from a previous desktop build because they
// live under the project root. They are never runtime dependencies and must not be
// copied recursively into the next package.
rmSync(join(stageRoot, "发布包"), { recursive: true, force: true });
rmSync(join(stageRoot, "desktop", "build"), { recursive: true, force: true });

const staticRoot = join(projectRoot, ".next", "static");
if (existsSync(staticRoot)) {
  mkdirSync(join(stageRoot, ".next"), { recursive: true });
  cpSync(staticRoot, join(stageRoot, ".next", "static"), {
    dereference: true,
    recursive: true,
  });
}
const publicRoot = join(projectRoot, "public");
if (existsSync(publicRoot)) {
  cpSync(publicRoot, join(stageRoot, "public"), { dereference: true, recursive: true });
}
cpSync(join(projectRoot, "drizzle"), join(stageRoot, "drizzle"), {
  dereference: true,
  recursive: true,
});
cpSync(
  join(projectRoot, "desktop", "electron", "server-watchdog.cjs"),
  join(stageRoot, "desktop-server.cjs"),
);

function findSqliteModule(root, moduleName) {
  for (const name of readdirSync(root)) {
    const candidate = join(root, name);
    const stat = statSync(candidate);
    if (stat.isDirectory()) {
      const found = findSqliteModule(candidate, moduleName);
      if (found) return found;
    } else if (
      name === moduleName &&
      candidate.toLowerCase().includes("better-sqlite3")
    ) {
      return candidate;
    }
  }
  return null;
}

const nativeModuleName = `${targetPlatform}-${targetArch}.node`;
const nativeModule = findSqliteModule(stageRoot, nativeModuleName);
if (!nativeModule) {
  throw new Error(
    `The staged server is missing the ${requestedTarget} better-sqlite3 module`,
  );
}

const buildId = readFileSync(join(projectRoot, ".next", "BUILD_ID"), "utf8").trim();
writeFileSync(
  join(stageRoot, "desktop-stage.json"),
  `${JSON.stringify(
    {
      buildId,
      nativeModule: relative(stageRoot, nativeModule).replaceAll("\\", "/"),
      stagedAt: new Date().toISOString(),
      target: requestedTarget,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
console.log(`Staged Next server ${buildId} at ${stageRoot}`);
