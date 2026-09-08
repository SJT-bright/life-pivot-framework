// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  freezeSimpleSubmission,
  storeSimpleSubmission,
} from "@/app/accumulation/frozen-submission";
import type {
  ManualSkincareCommand,
  ManualSkincareMutationResult,
  ManualSkincareSnapshot,
} from "@/modules/manual-skincare/contracts";

import { useManualSkincareSubmission } from "./use-manual-skincare-submission";

const snapshot: ManualSkincareSnapshot = {
  businessDate: "2026-08-13",
  products: [],
  latestRoutineRevision: 3,
  activationSequence: 4,
  selectedDay: {
    dayId: "day-1",
    businessDate: "2026-08-13",
    materialized: true,
    routineRevision: 3,
    activationSequence: 4,
    recoveryCycle: null,
    morningNote: "",
    eveningNote: "",
    overallNote: "",
    revision: 8,
    morningItems: [],
    eveningItems: [],
  },
  recoveryPlans: [],
  history: [],
};

const command: ManualSkincareCommand = {
  type: "save-day-note",
  businessDate: "2026-08-13",
  section: "morning",
  note: "状态稳定",
  expectedDayRevision: 8,
};

const exactResult: ManualSkincareMutationResult = {
  snapshot: {
    ...snapshot,
    selectedDay: { ...snapshot.selectedDay!, morningNote: "状态稳定", revision: 9 },
  },
  applied: {
    operation: "save-day-note",
    ownerId: "2026-08-13",
    ownerRevision: 9,
    businessDate: "2026-08-13",
    activationSequence: null,
  },
};

function throwingStorage(): Storage {
  return {
    get length(): number { throw new Error("disabled"); },
    clear(): void { throw new Error("disabled"); },
    getItem(_key: string): string | null { throw new Error("disabled"); },
    key(_index: number): string | null { throw new Error("disabled"); },
    removeItem(_key: string): void { throw new Error("disabled"); },
    setItem(_key: string, _value: string): void { throw new Error("disabled"); },
  };
}

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("useManualSkincareSubmission", () => {
  it("keeps the server and client hydration frame read-only until browser recovery finishes", async () => {
    function Probe() {
      const submission = useManualSkincareSubmission();
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

    const { result } = renderHook(() => useManualSkincareSubmission());
    await waitFor(() => expect(result.current.canWrite).toBe(true));
    expect(result.current.status).toBe("idle");
  });

  it("persists and verifies uncertain evidence before POST, then clears only an exact confirmation", async () => {
    let bytesAtFetch: string | null = null;
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const key = localStorage.key(0);
      bytesAtFetch = key ? localStorage.getItem(key) : null;
      expect(init?.body).toBe(JSON.stringify(command));
      expect(init?.headers).toMatchObject({
        "content-type": "application/json",
        "idempotency-key": "manual-skincare-key-0001",
      });
      return Response.json({ result: exactResult });
    });
    const { result } = renderHook(() => useManualSkincareSubmission({
      request,
      storage: localStorage,
      createId: () => "manual-skincare-key-0001",
      now: () => new Date("2026-08-13T01:00:00.000Z"),
    }));

    let submitted: ManualSkincareMutationResult | null = null;
    await act(async () => {
      submitted = await result.current.submit(command);
    });

    expect(JSON.parse(bytesAtFetch ?? "null")).toMatchObject({
      purpose: "manual-skincare",
      endpoint: "/api/v1/manual-skincare",
      operation: "save-day-note",
      ownerId: "2026-08-13",
      localRevision: 9,
      status: "uncertain",
    });
    expect(submitted).toEqual(exactResult);
    expect(result.current.status).toBe("idle");
    expect(localStorage.length).toBe(0);
  });

  it.each([
    ["non-json", () => new Response("not-json", { status: 200 })],
    ["wrong wrapper", () => Response.json(exactResult)],
    ["wrong operation", () => Response.json({ result: { ...exactResult, applied: { ...exactResult.applied, operation: "save-product" } } })],
    ["wrong owner", () => Response.json({ result: { ...exactResult, applied: { ...exactResult.applied, ownerId: "other-day" } } })],
    ["wrong revision", () => Response.json({ result: { ...exactResult, applied: { ...exactResult.applied, ownerRevision: 10 } } })],
  ])("keeps %s success responses uncertain", async (_label, response) => {
    const request = vi.fn(async () => response());
    const { result } = renderHook(() => useManualSkincareSubmission({
      request,
      storage: localStorage,
      createId: () => "manual-skincare-key-0002",
      now: () => new Date("2026-08-13T01:00:00.000Z"),
    }));

    await act(async () => { await result.current.submit(command); });

    expect(result.current.status).toBe("uncertain");
    expect(localStorage.length).toBe(1);
  });

  it("restores without auto-POST and retries the exact frozen body and key; 409 requires reload", async () => {
    const body = JSON.stringify(command);
    const frozen = freezeSimpleSubmission({
      purpose: "manual-skincare",
      endpoint: "/api/v1/manual-skincare",
      operation: command.type,
      ownerId: command.businessDate,
      localRevision: 9,
      idempotencyKey: "manual-skincare-reload-0001",
      body,
      expected: {
        operation: command.type,
        ownerId: command.businessDate,
        ownerRevision: 9,
        businessDate: command.businessDate,
        activationSequence: null,
      },
      createdAt: "2026-08-13T01:00:00.000Z",
    });
    expect(storeSimpleSubmission(localStorage, frozen).kind).toBe("stored");
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ message: "conflict" }, { status: 409 }));
    const { result } = renderHook(() => useManualSkincareSubmission({ request, storage: localStorage }));

    await waitFor(() => expect(result.current.status).toBe("uncertain"));
    expect(request).not.toHaveBeenCalled();
    await act(async () => { await result.current.retry(); });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![0]).toBe("/api/v1/manual-skincare");
    expect(request.mock.calls[0]![1]).toMatchObject({ body });
    expect(request.mock.calls[0]![1]?.headers).toMatchObject({
      "idempotency-key": "manual-skincare-reload-0001",
    });
    expect(result.current.status).toBe("reload-required");
    expect(localStorage.length).toBe(1);
  });

  it("locks on another same-purpose storage change and keeps reads available when storage is unavailable", async () => {
    const first = renderHook(() => useManualSkincareSubmission({ storage: localStorage }));
    await waitFor(() => expect(first.result.current.status).toBe("idle"));
    const second = renderHook(() => useManualSkincareSubmission({ storage: throwingStorage() }));
    await waitFor(() => expect(second.result.current.status).toBe("unavailable"));
    expect(second.result.current.canWrite).toBe(false);

    const request = vi.fn(() => new Promise<Response>(() => undefined));
    first.unmount();
    const active = renderHook(() => useManualSkincareSubmission({
      request,
      storage: localStorage,
      createId: () => "manual-skincare-active-0001",
      now: () => new Date("2026-08-13T01:00:00.000Z"),
    }));
    act(() => {
      void active.result.current.submit(command);
    });
    await waitFor(() => expect(localStorage.length).toBe(1));
    act(() => window.dispatchEvent(new StorageEvent("storage", {
      key: "life-pivot:accumulation:submission:v1:manual-skincare:external-key-0001",
      newValue: "changed",
    })));
    await waitFor(() => expect(active.result.current.status).toBe("reload-required"));
  });
});
