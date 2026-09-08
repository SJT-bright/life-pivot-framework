const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lifePivotDesktop", Object.freeze({
  notifyReminder(reminder) {
    ipcRenderer.send("life-pivot:notify-reminder", {
      id: typeof reminder?.id === "string" ? reminder.id : "",
      scheduledTime: typeof reminder?.scheduledTime === "string" ? reminder.scheduledTime : "",
      title: typeof reminder?.title === "string" ? reminder.title : "",
    });
  },
  openMainWindow(pathname = "/today") {
    ipcRenderer.send("life-pivot:open-main-window", pathname);
  },
  rememberMainLocation(pathname, search = "") {
    if (typeof pathname !== "string" || typeof search !== "string") return;
    ipcRenderer.send("life-pivot:remember-main-location", `${pathname}${search}`);
  },
  moveCompanion(command) {
    if (!command || typeof command !== "object") return;
    if (
      (command.phase === "start" || command.phase === "move") &&
      typeof command.screenY === "number" &&
      Number.isFinite(command.screenY)
    ) {
      ipcRenderer.send("life-pivot:move-companion", {
        phase: command.phase,
        screenY: command.screenY,
      });
      return;
    }
    if (command.phase === "end") {
      ipcRenderer.send("life-pivot:move-companion", { phase: "end" });
      return;
    }
    if (
      command.phase === "nudge" &&
      typeof command.deltaY === "number" &&
      Number.isFinite(command.deltaY)
    ) {
      ipcRenderer.send("life-pivot:move-companion", {
        phase: "nudge",
        deltaY: command.deltaY,
      });
    }
  },
  setCompanionExpanded(expanded) {
    ipcRenderer.send("life-pivot:set-companion-expanded", expanded === true);
  },
}));
