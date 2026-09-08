// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ManualExerciseProgressSnapshot } from "@/modules/manual-exercise/progress-contracts";

import { useManualExerciseProgress } from "./use-manual-exercise-progress";

function snapshot(asOfDate: string): ManualExerciseProgressSnapshot {
  return {
    asOfDate,
    templateId: null,
    pending: [],
    tracked: [],
    excluded: [],
    actualFacts: [],
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("useManualExerciseProgress", () => {
  it("does not let an older GET overwrite a newer as-of date", async () => {
    const oldResponse = deferred<Response>();
    const newResponse = deferred<Response>();
    const request = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      return url.includes("asOfDate=2026-08-22")
        ? oldResponse.promise
        : newResponse.promise;
    });
    const { result, rerender } = renderHook(
      ({ asOfDate }) => useManualExerciseProgress({
        asOfDate,
        request,
        storage: window.localStorage,
      }),
      { initialProps: { asOfDate: "2026-08-22" } },
    );

    let oldRefresh!: Promise<ManualExerciseProgressSnapshot | null>;
    act(() => {
      oldRefresh = result.current.refresh();
    });
    rerender({ asOfDate: "2026-08-23" });
    let newRefresh!: Promise<ManualExerciseProgressSnapshot | null>;
    act(() => {
      newRefresh = result.current.refresh();
    });

    await act(async () => {
      newResponse.resolve(Response.json(snapshot("2026-08-23")));
      await newRefresh;
    });
    await waitFor(() => {
      expect(result.current.snapshot?.asOfDate).toBe("2026-08-23");
    });

    await act(async () => {
      oldResponse.resolve(Response.json(snapshot("2026-08-22")));
      await oldRefresh;
    });
    expect(result.current.snapshot?.asOfDate).toBe("2026-08-23");
    expect(request).toHaveBeenCalledTimes(2);
  });
});
