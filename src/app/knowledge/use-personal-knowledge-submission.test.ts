// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  freezeSimpleSubmission,
  storeSimpleSubmission,
} from "@/app/accumulation/frozen-submission";
import type {
  PersonalKnowledgeCommand,
  PersonalKnowledgeSnapshot,
} from "@/modules/personal-knowledge/contracts";

import { usePersonalKnowledgeSubmission } from "./use-personal-knowledge-submission";

const emptySnapshot: PersonalKnowledgeSnapshot = {
  businessDate: "2026-08-13",
  modules: [],
  dailyNotes: [],
};

const command: PersonalKnowledgeCommand = {
  type: "save-module",
  moduleId: "module-0001",
  parentModuleId: null,
  name: "导演思维",
  goal: "",
  currentFocus: "",
  description: "",
  status: "learning",
  ordinal: 0,
  expectedModuleRevision: 0,
  expectedParentRevision: 0,
};

beforeEach(() => window.localStorage.clear());

describe("usePersonalKnowledgeSubmission", () => {
  it("renders the server hydration frame read-only before browser storage is resolved", () => {
    function Probe() {
      const submission = usePersonalKnowledgeSubmission();
      return createElement("button", { disabled: !submission.canWrite }, "保存");
    }
    expect(renderToString(createElement(Probe))).toContain("disabled");
  });

  it("recovers without auto-POST and treats a retried 409 as a local reload lock", async () => {
    const body = JSON.stringify(command);
    const frozen = freezeSimpleSubmission({
      purpose: "personal-knowledge",
      endpoint: "/api/v1/personal-knowledge",
      operation: command.type,
      ownerId: command.moduleId,
      localRevision: 1,
      idempotencyKey: "personal-knowledge-retry-0001",
      body,
      expected: {
        operation: command.type,
        ownerId: command.moduleId,
        ownerRevision: 1,
        businessDate: null,
      },
      createdAt: "2026-08-13T01:00:00.000Z",
    });
    expect(storeSimpleSubmission(localStorage, frozen).kind).toBe("stored");
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ error: "conflict" }, { status: 409 }));
    const { result } = renderHook(() => usePersonalKnowledgeSubmission({ request, storage: localStorage }));

    await waitFor(() => expect(result.current.status).toBe("uncertain"));
    expect(request).not.toHaveBeenCalled();
    await act(async () => { await result.current.retry(); });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![1]).toMatchObject({ method: "POST", body });
    expect(result.current.status).toBe("reload-required");
    expect(localStorage.length).toBe(1);
  });

  it("clears only an exact CAS confirmation and then performs an explicit GET refresh", async () => {
    const refreshed = { ...emptySnapshot, businessDate: "2026-08-13" };
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Response.json({
          result: {
            snapshot: emptySnapshot,
            applied: {
              operation: command.type,
              ownerId: command.moduleId,
              ownerRevision: 1,
              businessDate: null,
            },
          },
        });
      }
      return Response.json({ snapshot: refreshed });
    });
    const { result } = renderHook(() => usePersonalKnowledgeSubmission({
      request,
      storage: localStorage,
      createId: () => "personal-knowledge-submit-0001",
      now: () => new Date("2026-08-13T01:00:00.000Z"),
    }));

    let snapshot: PersonalKnowledgeSnapshot | null = null;
    await act(async () => { snapshot = await result.current.submit(command, "2026-08-13"); });

    expect(snapshot).toEqual(refreshed);
    expect(request.mock.calls.map(([, init]) => init?.method)).toEqual(["POST", "GET"]);
    expect(String(request.mock.calls[1]![0])).toContain("date=2026-08-13");
    expect(localStorage.length).toBe(0);
    expect(result.current.status).toBe("idle");
  });

  it("confirms an archived note with the selected business date before clearing and refreshing", async () => {
    const archiveCommand: PersonalKnowledgeCommand = {
      type: "archive-daily-learning-note",
      noteId: "daily-note-0001",
      expectedNoteRevision: 1,
    };
    const refreshed = { ...emptySnapshot, businessDate: "2026-08-13" };
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Response.json({
          result: {
            snapshot: emptySnapshot,
            applied: {
              operation: archiveCommand.type,
              ownerId: archiveCommand.noteId,
              ownerRevision: 2,
              businessDate: "2026-08-13",
            },
          },
        });
      }
      return Response.json({ snapshot: refreshed });
    });
    const { result } = renderHook(() => usePersonalKnowledgeSubmission({
      request,
      storage: localStorage,
      createId: () => "personal-knowledge-archive-note-0001",
      now: () => new Date("2026-08-13T01:00:00.000Z"),
    }));

    let returned: PersonalKnowledgeSnapshot | null = null;
    await act(async () => {
      returned = await result.current.submit(archiveCommand, "2026-08-13");
    });

    expect(returned).toEqual(refreshed);
    expect(request.mock.calls.map(([, init]) => init?.method)).toEqual(["POST", "GET"]);
    expect(String(request.mock.calls[1]![0])).toContain("date=2026-08-13");
    expect(localStorage.length).toBe(0);
    expect(result.current.status).toBe("idle");
  });
});
