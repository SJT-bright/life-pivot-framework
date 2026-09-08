const path = require("node:path");

const serverEntry = process.argv[2];

if (!serverEntry || !path.isAbsolute(serverEntry) || !process.connected) {
  throw new Error("The desktop server watchdog received invalid arguments");
}

process.once("disconnect", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
require(serverEntry);
