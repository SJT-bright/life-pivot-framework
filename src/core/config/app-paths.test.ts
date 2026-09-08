import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveAppPaths, resolveStorageKey } from "./app-paths";

describe("resolveAppPaths", () => {
  it("places production data under the Windows local application directory", () => {
    const paths = resolveAppPaths({
      LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
    }, "win32");

    expect(paths.dataRoot).toBe(
      path.win32.join("C:\\Users\\me\\AppData\\Local", "LifePivot"),
    );
    expect(paths.databaseFile).toBe(path.win32.join(paths.dataRoot, "life-pivot.sqlite"));
  });

  it("allows an absolute test data-root override", () => {
    const paths = resolveAppPaths(
      { LIFE_OS_DATA_ROOT: "D:\\isolated-test-data" },
      "win32",
    );

    expect(paths.dataRoot).toBe("D:\\isolated-test-data");
  });

  it("rejects a relative test data-root override", () => {
    expect(() =>
      resolveAppPaths({ LIFE_OS_DATA_ROOT: ".data" }, "win32"),
    ).toThrow("数据目录必须是绝对路径");
  });

  it("places macOS data under the user's Application Support directory", () => {
    const paths = resolveAppPaths({ HOME: "/Users/friend" }, "darwin");

    expect(paths.dataRoot).toBe(
      "/Users/friend/Library/Application Support/LifePivot",
    );
    expect(paths.databaseFile).toBe(
      "/Users/friend/Library/Application Support/LifePivot/life-pivot.sqlite",
    );
  });

  it("requires an absolute macOS home directory", () => {
    expect(() => resolveAppPaths({ HOME: "Users/friend" }, "darwin")).toThrow(
      "无法确定 macOS 用户目录",
    );
  });

  it("keeps POSIX semantics when a macOS folder name contains a backslash", () => {
    const paths = resolveAppPaths(
      { LIFE_OS_DATA_ROOT: "/Users/friend/Notes\\2026" },
      "darwin",
    );

    expect(paths.dataRoot).toBe("/Users/friend/Notes\\2026");
    expect(paths.databaseFile).toBe(
      "/Users/friend/Notes\\2026/life-pivot.sqlite",
    );
    expect(
      resolveStorageKey(paths.dataRoot, "assets/photo-1.jpg"),
    ).toBe("/Users/friend/Notes\\2026/assets/photo-1.jpg");
  });

  it("rejects unsupported desktop platforms", () => {
    expect(() => resolveAppPaths({}, "linux")).toThrow("不支持的桌面平台");
  });
});

describe("resolveStorageKey", () => {
  it("resolves an opaque storage key inside the data root", () => {
    expect(resolveStorageKey("C:\\safe", "assets/2026/photo-1.jpg")).toBe(
      "C:\\safe\\assets\\2026\\photo-1.jpg",
    );
  });

  it("resolves an opaque storage key inside a POSIX data root", () => {
    expect(resolveStorageKey("/Users/friend/LifePivot", "assets/photo-1.jpg")).toBe(
      "/Users/friend/LifePivot/assets/photo-1.jpg",
    );
  });

  it.each([
    "../secret",
    "assets/../secret",
    "assets\\photo.jpg",
    "C:\\secret",
    "\\\\server\\share\\a.jpg",
    "/absolute/photo.jpg",
    "assets//photo.jpg",
  ])("rejects unsafe storage key %s", (key) => {
    expect(() => resolveStorageKey("C:\\safe", key)).toThrow("非法附件路径");
  });
});
