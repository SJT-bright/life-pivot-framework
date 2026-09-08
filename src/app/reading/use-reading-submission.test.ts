// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useReadingSubmission } from "./use-reading-submission";

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("useReadingSubmission hydration", () => {
  it("keeps the server and client hydration frame read-only until browser recovery finishes", async () => {
    function Probe() {
      const submission = useReadingSubmission();
      return createElement("button", { disabled: !submission.canWrite }, "保存");
    }

    expect(renderToString(createElement(Probe))).toContain("disabled");

    const container = document.createElement("div");
    container.innerHTML = renderToString(createElement(Probe));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let root: Root | null = null;
    await act(async () => {
      root = hydrateRoot(container, createElement(Probe));
    });
    await waitFor(() => expect((container.querySelector("button") as HTMLButtonElement).disabled)
      .toBe(false));
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/hydration|didn't match/i);
    await act(async () => root?.unmount());

    const { result } = renderHook(() => useReadingSubmission());
    await waitFor(() => expect(result.current.canWrite).toBe(true));
    expect(result.current.status).toBe("idle");
  });
});
