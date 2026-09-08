const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain, Notification, screen, shell } = require("electron");

const {
  assertRuntimeManifest,
  calculateDraggedCompanionBounds,
  calculateCompanionBounds,
  isAllowedNavigation,
  normalizeMainLocation,
  parseMainLocationPreference,
  parseCompanionPosition,
  requireAvailablePort,
  resolveDataRoot,
  waitForHealth,
} = require("./runtime.cjs");

const APP_NAME = "个人积累库";
const LOOPBACK_HOST = "127.0.0.1";
const PREFERRED_PORT = 3216;
const REMINDER_ID = /^[A-Za-z0-9_-]{8,128}$/u;
const REMINDER_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

let mainWindow = null;
let companionWindow = null;
let nodeServer = null;
let nodeServerExited = false;
let quitting = false;
let serverFailureNotified = false;
let localOrigin = null;
let startupPromise = null;
let companionExpanded = false;
let companionAnchorRatio = 0.5;
let companionDrag = null;

const projectRoot = path.resolve(__dirname, "..", "..");
const dataRoot = resolveDataRoot(process.env);
app.setName(APP_NAME);
app.setPath("userData", path.join(dataRoot, "desktop-runtime", "electron"));
const companionPositionFile = path.join(app.getPath("userData"), "companion-position.json");
const mainLocationFile = path.join(app.getPath("userData"), "main-location.json");

function loadMainLocation(origin) {
  try {
    return parseMainLocationPreference(
      JSON.parse(fs.readFileSync(mainLocationFile, "utf8")),
      origin,
    ) ?? "/today";
  } catch {
    return "/today";
  }
}

function persistMainLocation(candidate, origin = localOrigin) {
  if (!origin) return null;
  const location = normalizeMainLocation(candidate, origin);
  if (!location) return null;
  try {
    fs.mkdirSync(path.dirname(mainLocationFile), { recursive: true });
    fs.writeFileSync(
      mainLocationFile,
      `${JSON.stringify({ version: 1, location }, null, 2)}\n`,
      "utf8",
    );
  } catch {
    // Navigation history is a convenience; never block the main window for it.
  }
  return location;
}

function loadCompanionPosition() {
  try {
    const parsed = parseCompanionPosition(
      JSON.parse(fs.readFileSync(companionPositionFile, "utf8")),
    );
    return parsed?.verticalAnchorRatio ?? 0.5;
  } catch {
    return 0.5;
  }
}

function persistCompanionPosition() {
  try {
    fs.mkdirSync(path.dirname(companionPositionFile), { recursive: true });
    fs.writeFileSync(
      companionPositionFile,
      `${JSON.stringify({ version: 1, verticalAnchorRatio: companionAnchorRatio }, null, 2)}\n`,
      "utf8",
    );
  } catch {
    // Position is a non-critical preference; never prevent reminders from running.
  }
}

companionAnchorRatio = loadCompanionPosition();

function requireFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} is missing: ${filePath}`);
  }
  return filePath;
}

function startNodeServer(port) {
  const serverRoot = app.isPackaged
    ? path.join(process.resourcesPath, "app-server")
    : path.join(projectRoot, "desktop", "build", "server");
  const serverEntry = requireFile(path.join(serverRoot, "server.js"), "Next standalone server");
  const watchdogEntry = requireFile(
    path.join(serverRoot, "desktop-server.cjs"),
    "Desktop server watchdog",
  );
  const runtimeRoot = app.isPackaged
    ? path.join(process.resourcesPath, "node")
    : path.join(projectRoot, "desktop", "runtime", "node");
  const runtimeManifestPath = requireFile(
    path.join(runtimeRoot, "runtime.json"),
    "Bundled Node.js runtime manifest",
  );
  const runtimeManifest = JSON.parse(fs.readFileSync(runtimeManifestPath, "utf8"));
  const runtimeInfo = assertRuntimeManifest(
    runtimeManifest,
    process.platform,
    process.arch,
  );
  const nodeExecutable = requireFile(
    path.join(runtimeRoot, runtimeInfo.executableName),
    "Bundled Node.js runtime",
  );

  const logRoot = path.join(dataRoot, "desktop-runtime", "logs");
  fs.mkdirSync(logRoot, { recursive: true });
  const stdout = fs.openSync(path.join(logRoot, "electron-server.log"), "a");
  const stderr = fs.openSync(path.join(logRoot, "electron-server-error.log"), "a");

  try {
    nodeServer = spawn(nodeExecutable, [watchdogEntry, serverEntry], {
      cwd: serverRoot,
      env: {
        ...process.env,
        HOSTNAME: LOOPBACK_HOST,
        LIFE_OS_DATA_ROOT: dataRoot,
        NODE_ENV: "production",
        NODE_PATH: path.join(serverRoot, "server-node-modules"),
        PORT: String(port),
      },
      shell: false,
      stdio: ["ignore", stdout, stderr, "ipc"],
      windowsHide: process.platform === "win32",
    });
  } finally {
    fs.closeSync(stdout);
    fs.closeSync(stderr);
  }

  nodeServerExited = false;
  const handleServerExit = () => {
    nodeServerExited = true;
    if (quitting || serverFailureNotified) return;
    serverFailureNotified = true;
    mainWindow?.hide();
    companionWindow?.hide();
    dialog.showErrorBox(
      `${APP_NAME}本地服务已停止`,
      `请重新打开应用。日志目录：${path.join(dataRoot, "desktop-runtime", "logs")}`,
    );
    app.quit();
  };
  nodeServer.once("exit", handleServerExit);
  nodeServer.once("error", handleServerExit);
  return nodeServer;
}

function stopNodeServer() {
  if (!nodeServer || nodeServerExited) return;
  const ownedServer = nodeServer;
  nodeServer = null;
  try {
    ownedServer.kill();
  } catch {
    // The exact child may already have exited. Never kill by image name or a reused PID.
  }
}

function secureWindowNavigation(window, origin) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAllowedNavigation(url, origin) && /^https?:/i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (isAllowedNavigation(url, origin)) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) void shell.openExternal(url);
  });
}

async function createWindow(origin, requestedLocation = null) {
  const window = new BrowserWindow({
    backgroundColor: "#f6f5f1",
    height: 900,
    minHeight: 620,
    minWidth: 860,
    show: false,
    title: APP_NAME,
    webPreferences: {
      contextIsolation: true,
      devTools: !app.isPackaged,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
    },
    width: 1440,
  });

  secureWindowNavigation(window, origin);
  window.webContents.on("did-navigate", (_event, url) => {
    persistMainLocation(url, origin);
  });
  window.webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (!isMainFrame) return;
    persistMainLocation(url, origin);
  });
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  const initialLocation = normalizeMainLocation(requestedLocation, origin)
    ?? loadMainLocation(origin);
  await window.loadURL(new URL(initialLocation, origin).href);
  return window;
}

function boundsEqual(left, right) {
  return left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height;
}

function companionDisplay() {
  const currentBounds = companionWindow?.getBounds();
  return currentBounds
    ? screen.getDisplayMatching(currentBounds)
    : screen.getPrimaryDisplay();
}

function companionBounds(expanded = companionExpanded) {
  return calculateCompanionBounds(
    companionDisplay().workArea,
    expanded,
    companionAnchorRatio,
  );
}

function applyCompanionBounds(expanded = companionExpanded) {
  if (!companionWindow || companionWindow.isDestroyed()) return null;
  const target = companionBounds(expanded);
  if (!boundsEqual(companionWindow.getBounds(), target)) {
    companionWindow.setBounds(target, false);
  }
  return target;
}

function setCompanionExpanded(expanded) {
  if (!companionWindow || companionWindow.isDestroyed()) return;
  const nextExpanded = expanded === true;
  const stateChanged = companionExpanded !== nextExpanded;
  companionExpanded = nextExpanded;
  const target = applyCompanionBounds(nextExpanded);
  if (stateChanged && companionDrag && target) {
    // Keep an active pointer gesture continuous if a due reminder expands it.
    companionDrag.startScreenY = companionDrag.lastScreenY;
    companionDrag.startY = target.y;
  }
}

function displayForCompanionDrag() {
  if (companionDrag) {
    const retained = screen.getAllDisplays().find(
      (display) => String(display.id) === String(companionDrag.displayId),
    );
    if (retained) return retained;
  }
  return companionDisplay();
}

function setDraggedCompanionPosition(screenY) {
  if (!companionDrag || !companionWindow || companionWindow.isDestroyed()) return;
  companionDrag.lastScreenY = screenY;
  const display = displayForCompanionDrag();
  const result = calculateDraggedCompanionBounds(
    display.workArea,
    companionExpanded,
    companionDrag.startY,
    screenY - companionDrag.startScreenY,
  );
  companionAnchorRatio = result.verticalAnchorRatio;
  if (!boundsEqual(companionWindow.getBounds(), result.bounds)) {
    companionWindow.setBounds(result.bounds, false);
  }
}

function isFiniteCoordinate(value) {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 10_000_000;
}

function moveCompanion(command) {
  if (!command || typeof command !== "object") return;
  if (command.phase === "start" && isFiniteCoordinate(command.screenY)) {
    if (!companionWindow || companionWindow.isDestroyed()) return;
    const current = applyCompanionBounds() ?? companionWindow.getBounds();
    const display = companionDisplay();
    companionDrag = {
      displayId: display.id,
      lastScreenY: command.screenY,
      startScreenY: command.screenY,
      startY: current.y,
    };
    return;
  }
  if (command.phase === "move" && isFiniteCoordinate(command.screenY)) {
    setDraggedCompanionPosition(command.screenY);
    return;
  }
  if (command.phase === "end") {
    if (!companionDrag) return;
    companionDrag = null;
    persistCompanionPosition();
    return;
  }
  if (
    command.phase === "nudge" &&
    typeof command.deltaY === "number" &&
    Number.isFinite(command.deltaY) &&
    Math.abs(command.deltaY) <= 200 &&
    companionWindow &&
    !companionWindow.isDestroyed()
  ) {
    const current = companionWindow.getBounds();
    const display = companionDisplay();
    const result = calculateDraggedCompanionBounds(
      display.workArea,
      companionExpanded,
      current.y,
      command.deltaY,
    );
    companionAnchorRatio = result.verticalAnchorRatio;
    if (!boundsEqual(current, result.bounds)) companionWindow.setBounds(result.bounds, false);
    persistCompanionPosition();
  }
}

function isReminderAlert(value) {
  return value !== null
    && typeof value === "object"
    && REMINDER_ID.test(value.id)
    && typeof value.title === "string"
    && value.title.trim().length >= 1
    && value.title.length <= 240
    && REMINDER_TIME.test(value.scheduledTime);
}

function showReminderAlert(reminder) {
  setCompanionExpanded(true);
  companionWindow?.showInactive();
  shell.beep();
  app.dock?.bounce("informational");
  if (!Notification.isSupported()) return;
  const notification = new Notification({
    id: reminder.id,
    groupId: "life-pivot-today-reminders",
    title: `到时间了 · ${reminder.scheduledTime}`,
    body: reminder.title.trim(),
    silent: false,
    sound: "default",
  });
  notification.on("click", () => {
    void reopenWindow("/today").catch(handleStartupFailure);
  });
  notification.show();
}

async function createCompanionWindow(origin) {
  companionExpanded = false;
  companionDrag = null;
  const window = new BrowserWindow({
    ...calculateCompanionBounds(
      screen.getPrimaryDisplay().workArea,
      false,
      companionAnchorRatio,
    ),
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    frame: false,
    fullscreenable: false,
    hasShadow: false,
    maximizable: false,
    minimizable: false,
    movable: false,
    resizable: false,
    show: false,
    skipTaskbar: true,
    title: `${APP_NAME} · 今日提醒`,
    transparent: true,
    vibrancy: "under-window",
    visualEffectState: "active",
    type: "panel",
    webPreferences: {
      contextIsolation: true,
      devTools: !app.isPackaged,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  secureWindowNavigation(window, origin);
  window.setAlwaysOnTop(true, "floating");
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.once("ready-to-show", () => window.showInactive());
  window.on("closed", () => {
    if (companionWindow === window) {
      companionWindow = null;
      companionDrag = null;
    }
  });
  await window.loadURL(`${origin}/companion`);
  return window;
}

function registerDesktopIpc() {
  ipcMain.on("life-pivot:notify-reminder", (event, reminder) => {
    if (event.sender !== companionWindow?.webContents || !isReminderAlert(reminder)) return;
    showReminderAlert(reminder);
  });
  ipcMain.on("life-pivot:set-companion-expanded", (event, expanded) => {
    if (event.sender !== companionWindow?.webContents || typeof expanded !== "boolean") return;
    setCompanionExpanded(expanded);
  });
  ipcMain.on("life-pivot:move-companion", (event, command) => {
    if (event.sender !== companionWindow?.webContents) return;
    moveCompanion(command);
  });
  ipcMain.on("life-pivot:open-main-window", (event, pathname) => {
    const trustedSender = event.sender === companionWindow?.webContents
      || event.sender === mainWindow?.webContents;
    if (!trustedSender || pathname !== "/today") return;
    void reopenWindow(pathname).catch(handleStartupFailure);
  });
  ipcMain.on("life-pivot:remember-main-location", (event, location) => {
    if (event.sender !== mainWindow?.webContents || typeof location !== "string") return;
    persistMainLocation(location);
  });
}

async function startDesktop() {
  if (process.platform === "darwin" && app.isPackaged) {
    app.setLoginItemSettings({
      openAtLogin: true,
      type: "mainAppService",
    });
  }
  const port = await requireAvailablePort(LOOPBACK_HOST, PREFERRED_PORT);
  localOrigin = `http://${LOOPBACK_HOST}:${port}`;
  startNodeServer(port);
  await waitForHealth(`${localOrigin}/api/v1/health`, () => nodeServerExited);
  mainWindow = await createWindow(localOrigin);
  companionWindow = await createCompanionWindow(localOrigin);
  const repinCompanion = () => {
    companionDrag = null;
    applyCompanionBounds();
  };
  screen.on("display-metrics-changed", repinCompanion);
  screen.on("display-removed", repinCompanion);
}

function beginDesktopStartup() {
  if (!startupPromise) {
    startupPromise = app.whenReady().then(startDesktop);
  }
  return startupPromise;
}

async function reopenWindow(pathname) {
  await beginDesktopStartup();
  const requestedLocation = localOrigin
    ? normalizeMainLocation(pathname, localOrigin)
    : null;
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (requestedLocation) {
      const currentLocation = normalizeMainLocation(
        mainWindow.webContents.getURL(),
        localOrigin,
      );
      if (currentLocation !== requestedLocation) {
        await mainWindow.loadURL(new URL(requestedLocation, localOrigin).href);
      }
    }
    mainWindow.show();
    mainWindow.focus();
  } else if (localOrigin) {
    mainWindow = await createWindow(localOrigin, requestedLocation);
  }
  if (!companionWindow && localOrigin) {
    companionWindow = await createCompanionWindow(localOrigin);
  }
}

function handleStartupFailure(error) {
  if (serverFailureNotified) return;
  serverFailureNotified = true;
  stopNodeServer();
  dialog.showErrorBox(
    `${APP_NAME}启动失败`,
    `${error instanceof Error ? error.message : String(error)}\n\n日志目录：${path.join(dataRoot, "desktop-runtime", "logs")}`,
  );
  app.quit();
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    void reopenWindow().catch(handleStartupFailure);
  });
  app.on("before-quit", () => {
    quitting = true;
    companionWindow?.destroy();
    stopNodeServer();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin" && !quitting) app.quit();
  });
  app.on("activate", () => {
    void reopenWindow().catch(handleStartupFailure);
  });
  registerDesktopIpc();
  void beginDesktopStartup().catch(handleStartupFailure);
}
