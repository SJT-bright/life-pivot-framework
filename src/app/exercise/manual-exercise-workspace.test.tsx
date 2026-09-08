// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  freezeSimpleSubmission,
  storeSimpleSubmission,
} from "@/app/accumulation/frozen-submission";
import type { ManualExerciseSnapshot } from "@/modules/manual-exercise/service";
import type { ManualExerciseCommand, ManualExerciseTemplateDayDto } from "@/modules/manual-exercise/contracts";

import { ManualExerciseWorkspace as Workspace } from "./manual-exercise-workspace";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

const fixedNow = () => new Date("2026-08-13T01:11:00.000Z");
const laterNow = () => new Date("2026-08-15T01:11:00.000Z");

function ManualExerciseWorkspace(props: ComponentProps<typeof Workspace>) {
  return <Workspace now={fixedNow} {...props} />;
}

function storedSubmission() {
  for (let index = 0; index < localStorage.length; index += 1) {
    const raw = localStorage.getItem(localStorage.key(index)!);
    if (raw && JSON.parse(raw).purpose === "manual-exercise") return raw;
  }
  return null;
}

const baseSnapshot: ManualExerciseSnapshot = {
  businessDate: "2026-08-13",
  template: {
    id: "manual-default",
    name: "固定循环",
    revision: 2,
    versionId: "template-version-0002",
    effectiveFrom: "2026-08-01",
    changeNote: "初始循环",
    days: [
      {
        dayKey: "shoulder",
        name: "肩日",
        bodyPart: "肩",
        isRest: false,
        note: null,
        actions: [
          {
            actionKey: "press",
            name: "哑铃推举",
            plannedSets: 4,
            plannedRepsText: "10 次",
            plannedWeightText: "12 kg",
            targetText: "稳定完成",
            note: null,
          },
        ],
      },
      { dayKey: "leg", name: "腿日", bodyPart: "腿", isRest: false, note: null, actions: [] },
      { dayKey: "back", name: "背日", bodyPart: "背", isRest: false, note: null, actions: [] },
      { dayKey: "rest", name: "休息", bodyPart: null, isRest: true, note: "主动休息", actions: [] },
    ],
  },
  cycle: { templateId: "manual-default", currentDayKey: "shoulder", revision: 5 },
  selectedDay: {
    id: "exercise-day-0001",
    businessDate: "2026-08-13",
    materialized: true,
    templateVersionId: "template-version-0002",
    dayKey: "shoulder",
    name: "肩日",
    bodyPart: "肩",
    isRest: false,
    status: "in-progress",
    revision: 3,
    actions: [
      {
        actionKey: "press",
        name: "哑铃推举",
        planned: { sets: 4, repsText: "10 次", weightText: "12 kg", targetText: "稳定完成", note: null },
        actual: { sets: 0, repsText: null, weightText: null, text: null, completion: false, note: null },
        previousActualReference: { businessDate: "2026-08-09", sets: 3, repsText: "8 次", weightText: "10 kg", text: null },
      },
    ],
    timer: {
      startedAt: "2026-08-13T01:00:00.000Z",
      pausedAt: null,
      accumulatedPauseSeconds: 60,
      endedAt: null,
      elapsedSeconds: 540,
      calculatedDurationMinutes: 9,
      confirmedDurationMinutes: null,
    },
    supplements: { creatineTaken: null, proteinPowderTaken: null, note: null },
    note: null,
    completionText: null,
  },
  history: [
    {
      businessDate: "2026-08-12",
      dayKey: "rest",
      name: "休息",
      status: "skipped",
      calculatedDurationMinutes: 0,
      confirmedDurationMinutes: null,
    },
  ],
  templateHistory: [
    {
      templateId: "manual-default",
      name: "固定循环",
      revision: 2,
      effectiveFrom: "2026-08-01",
      changeNote: "初始循环",
      createdAt: "2026-08-01T00:00:00.000Z",
    },
  ],
};

function snapshot(overrides: Partial<ManualExerciseSnapshot> = {}): ManualExerciseSnapshot {
  return { ...baseSnapshot, ...overrides };
}

function saveResponse(current: ManualExerciseSnapshot, command: Extract<ManualExerciseCommand, { type: "save-training" }>): ManualExerciseSnapshot {
  const day = current.selectedDay!;
  return { ...current, selectedDay: {
    ...day,
    revision: day.revision + 1,
    status: day.status === "completed" ? "completed" : command.status,
    note: command.note,
    actions: day.actions.map((action) => {
      const saved = command.actions.find((candidate) => candidate.actionKey === action.actionKey)!;
      return { ...action, actual: {
        sets: saved.actualSets, repsText: saved.actualRepsText, weightText: saved.actualWeightText,
        text: saved.actualText, completion: saved.completion, note: saved.note,
      } };
    }),
    supplements: { creatineTaken: command.creatineTaken, proteinPowderTaken: command.proteinPowderTaken, note: command.supplementNote },
  } };
}

function sequenceIds(...ids: string[]) {
  let index = 0;
  return () => ids[index++] ?? `manual-generated-${String(index).padStart(4, "0")}`;
}

beforeEach(() => {
  window.localStorage.clear();
  navigation.push.mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ManualExerciseWorkspace", () => {
  it("creates the first training template with a day and action", async () => {
    const user = userEvent.setup();
    const empty = snapshot({
      template: null,
      cycle: null,
      selectedDay: null,
      history: [],
      templateHistory: [],
    });
    let current = empty;
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        const command = JSON.parse(String(init.body)) as {
          templateId: string;
          name: string;
          effectiveFrom: string;
          changeNote: string;
          days: ManualExerciseTemplateDayDto[];
        };
        current = snapshot({
          template: {
            id: command.templateId,
            name: command.name,
            revision: 1,
            versionId: "template-version-created",
            effectiveFrom: command.effectiveFrom,
            changeNote: command.changeNote,
            days: command.days,
          },
          cycle: { templateId: command.templateId, currentDayKey: command.days[0]!.dayKey, revision: 1 },
          selectedDay: null,
          history: [],
          templateHistory: [],
        });
      }
      return Response.json(current);
    });
    render(
      <ManualExerciseWorkspace
        createId={sequenceIds("day-one", "action-one", "template-one", "submission-key-0001")}
        initial={empty}
        request={request}
        storage={localStorage}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "训练日模板" }));
    expect(screen.getByText("还没有训练日模板。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "创建第一份训练日模板" }));
    expect(screen.getByLabelText("模板名称")).toHaveValue("我的训练循环");
    await user.clear(screen.getByLabelText("训练日名称"));
    await user.type(screen.getByLabelText("训练日名称"), "肩部训练");
    await user.type(screen.getByLabelText("训练部位"), "肩");
    await user.click(screen.getByRole("button", { name: "添加动作" }));
    await user.clear(screen.getByLabelText("肩部训练动作 1 名称"));
    await user.type(screen.getByLabelText("肩部训练动作 1 名称"), "哑铃推举");
    await user.clear(screen.getByLabelText("计划组数"));
    await user.type(screen.getByLabelText("计划组数"), "4");
    await user.click(screen.getByRole("button", { name: "创建训练日模板" }));

    await waitFor(() => expect(request.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1));
    expect(JSON.parse(String(request.mock.calls[0]![1]!.body))).toMatchObject({
      type: "replace-template",
      name: "我的训练循环",
      expectedTemplateRevision: 0,
      changeNote: "首次创建训练日模板",
      days: [{ name: "肩部训练", bodyPart: "肩", actions: [{ name: "哑铃推举", plannedSets: 4 }] }],
    });
  });

  it("switches today to another template day without following the order", async () => {
    const user = userEvent.setup();
    const switched = snapshot({
      cycle: { ...baseSnapshot.cycle!, currentDayKey: "leg", revision: 6 },
      selectedDay: {
        ...baseSnapshot.selectedDay!,
        dayKey: "leg",
        name: "腿日",
        status: "not-started",
        revision: 1,
      },
    });
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return Response.json(switched);
      return Response.json(switched);
    });
    render(
      <ManualExerciseWorkspace
        createId={sequenceIds("manual-switch-key-0001")}
        initial={baseSnapshot}
        request={request}
        storage={localStorage}
      />,
    );

    await user.click(screen.getByText("改练其他部位"));
    await user.selectOptions(screen.getByLabelText("改练哪个训练日"), "leg");
    await user.type(screen.getByLabelText(/原因备注/), "肩部受伤，改练腿");
    await user.click(screen.getByRole("button", { name: "切换到这个训练日" }));

    await waitFor(() => expect(request.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1));
    expect(JSON.parse(String(request.mock.calls.find(([, init]) => init?.method === "POST")![1]!.body))).toEqual({
      type: "select-cycle-day",
      templateId: "manual-default",
      businessDate: "2026-08-13",
      dayKey: "leg",
      note: "肩部受伤，改练腿",
      expectedCycleRevision: 5,
    });
    await screen.findByText("已切换到「腿日」，按新部位记录训练。");
    expect(screen.getByText(/计划第 2 \/ 4 练/)).toBeInTheDocument();
  });

  it("shows the four tabs, cycle position, ordered manual fields, and timestamp-derived timer", async () => {
    render(
      <ManualExerciseWorkspace
        initial={baseSnapshot}
        now={() => new Date("2026-08-13T01:11:00.000Z")}
      />,
    );

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "今日训练",
      "训练日模板",
      "训练历史",
      "模板更新记录",
    ]);
    expect(screen.getByRole("heading", { name: "肩日" })).toBeInTheDocument();
    expect(screen.getByText(/计划第 1 \/ 4 练/)).toBeInTheDocument();
    expect(screen.getByLabelText("哑铃推举实际组数")).toHaveValue(null);
    expect(screen.getByLabelText("哑铃推举实际组数")).toHaveAttribute("placeholder", "3");
    expect(screen.getByLabelText("哑铃推举实际次数（每组）")).toHaveValue("");
    expect(screen.getByLabelText("哑铃推举实际次数（每组）")).toHaveAttribute("placeholder", "8 次");
    expect(screen.getByLabelText("哑铃推举实际重量")).toHaveValue("");
    expect(screen.getByLabelText("哑铃推举实际重量")).toHaveAttribute("placeholder", "10");
    expect(screen.getByLabelText("训练计时")).toHaveTextContent("00:10:00");

  });

  it("saves manual facts and supplement tri-states before POST, then GET-refreshes without advancing partial work", async () => {
    const user = userEvent.setup();
    let frozenAtPost: string | null = null;
    const saved = snapshot({
      selectedDay: {
        ...baseSnapshot.selectedDay!,
        status: "partial",
        revision: 4,
        actions: [{
          ...baseSnapshot.selectedDay!.actions[0]!,
          actual: { sets: 5, repsText: "8 次", weightText: "10kg", text: null, completion: true, note: null },
        }],
        supplements: { creatineTaken: true, proteinPowderTaken: null, note: null },
      },
    });
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        frozenAtPost = storedSubmission();
        return Response.json(saved);
      }
      return Response.json(saved);
    });
    render(
      <ManualExerciseWorkspace
        createId={sequenceIds("manual-save-key-0001")}
        initial={baseSnapshot}
        now={() => new Date("2026-08-13T01:11:00.000Z")}
        request={request}
        storage={localStorage}
      />,
    );

    await user.click(screen.getByLabelText("哑铃推举完成情况"));
    await user.clear(screen.getByLabelText("哑铃推举实际组数"));
    await user.type(screen.getByLabelText("哑铃推举实际组数"), "5");
    await user.click(screen.getByLabelText("肌酸"));
    await user.click(screen.getByRole("button", { name: "保存训练记录" }));

    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    const post = request.mock.calls[0]![1]!;
    expect(JSON.parse(String(post.body))).toMatchObject({
      type: "save-training",
      status: "in-progress",
      creatineTaken: true,
      proteinPowderTaken: null,
      supplementNote: null,
      actions: [{
        actualSets: 5,
        actualRepsText: "8 次",
        actualWeightText: "10kg",
        actualText: null,
        note: null,
        completion: true,
      }],
    });
    expect(JSON.parse(frozenAtPost ?? "null")).toMatchObject({ purpose: "manual-exercise", status: "uncertain" });
    expect(request.mock.calls.some(([, init]) => JSON.parse(String(init?.body ?? "{}"))?.type === "finish-and-advance")).toBe(false);
    expect(screen.getByText("已完成 · 5 组")).toBeInTheDocument();
  });

  it("finishes training only after explicit recording and does not navigate beyond today", async () => {
    const user = userEvent.setup();
    const saved = snapshot({ selectedDay: { ...baseSnapshot.selectedDay!, revision: 4, actions: [{
      ...baseSnapshot.selectedDay!.actions[0]!,
      actual: { ...baseSnapshot.selectedDay!.actions[0]!.actual, sets: 3, repsText: "8 次", weightText: "10kg", completion: true },
    }] } });
    const completed = snapshot({
      cycle: { ...baseSnapshot.cycle!, currentDayKey: "leg", revision: 6 },
      selectedDay: { ...saved.selectedDay!, status: "completed", revision: 5 },
    });
    let current = saved;
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) return Response.json(current);
      const type = JSON.parse(String(init.body)).type as string;
      current = type === "save-training" ? saved : completed;
      return Response.json(current);
    });
    render(<ManualExerciseWorkspace createId={sequenceIds("manual-complete-save-0001", "manual-complete-finish-0001")} initial={baseSnapshot} request={request} storage={localStorage} />);

    expect(screen.getByRole("button", { name: "完成今天训练" })).toBeDisabled();
    await user.click(screen.getByLabelText("哑铃推举完成情况"));
    expect(screen.getByRole("button", { name: "完成今天训练" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "完成今天训练" }));

    await waitFor(() => expect(request.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2));
    const commands = request.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(String(init!.body)).type);
    expect(commands).toEqual(["save-training", "finish-and-advance"]);
    await screen.findByText(/训练已保存。已到今天/);
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it.each([
    ["rest", "休息一天", "休息原因", "身体疲劳"],
    ["skipped", "跳过这一天", "跳过原因", "临时有事"],
    ["unrecorded", "练过，记不清", "补记说明", "只记得部分动作"],
  ] as const)("resolves historical %s without moving the current cycle and opens the next actual date", async (outcome, choice, reasonLabel, note) => {
    const user = userEvent.setup();
    const skipped = snapshot({
      selectedDay: { ...baseSnapshot.selectedDay!, status: "skipped", revision: 4, resolution: { outcome, note, cycleAdvanced: false } },
      history: [{ businessDate: "2026-08-13", dayKey: "shoulder", name: "肩日", status: "skipped", calculatedDurationMinutes: 10, confirmedDurationMinutes: null }],
    });
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method ? Response.json(skipped) : Response.json(skipped));
    render(<ManualExerciseWorkspace now={laterNow} createId={sequenceIds("manual-resolve-key-0001")} initial={baseSnapshot} request={request} storage={localStorage} />);

    await user.click(screen.getByRole("button", { name: choice }));
    expect(request).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText(reasonLabel));
    await user.type(screen.getByLabelText(reasonLabel), note);
    await user.click(screen.getByRole("button", { name: "保存并到下一天" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/exercise?date=2026-08-14", { scroll: false }));
    expect(JSON.parse(String(request.mock.calls[0]![1]!.body))).toMatchObject({
      type: "resolve-day", businessDate: "2026-08-13", outcome, note, advanceCycle: false,
      expectedDailyRevision: 3, expectedCycleRevision: 5,
    });
    expect(skipped.cycle?.revision).toBe(baseSnapshot.cycle?.revision);
    expect(storedSubmission()).toBeNull();
  });

  it("starts, pauses, and resumes the persisted total timer", async () => {
    const user = userEvent.setup();
    const notStarted = snapshot({ selectedDay: { ...baseSnapshot.selectedDay!, status: "not-started", revision: 0, timer: { startedAt: null, pausedAt: null, accumulatedPauseSeconds: 0, endedAt: null, elapsedSeconds: 0, calculatedDurationMinutes: 0, confirmedDurationMinutes: null } } });
    let current = notStarted;
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        const command = JSON.parse(String(init.body)) as ManualExerciseCommand;
        if (command.type === "save-training") {
          current = saveResponse(current, command);
          return Response.json(current);
        }
        const type = command.type;
        const previous = current.selectedDay!;
        current = snapshot({ selectedDay: {
          ...previous,
          status: "in-progress",
          revision: previous.revision + 1,
          timer: {
            ...previous.timer,
            startedAt: previous.timer.startedAt ?? "2026-08-13T01:00:00.000Z",
            pausedAt: type === "pause-training" ? "2026-08-13T01:05:00.000Z" : null,
          },
        } });
      }
      return Response.json(current);
    });
    render(<ManualExerciseWorkspace createId={sequenceIds("manual-start-key-0001", "manual-pause-key-0001", "manual-resume-key-0001")} initial={notStarted} request={request} storage={localStorage} />);

    await user.click(screen.getByText("训练计时（可选）"));
    await user.click(screen.getByRole("button", { name: "开始计时" }));
    await screen.findByRole("button", { name: "暂停计时" });
    await user.click(screen.getByRole("button", { name: "暂停计时" }));
    await screen.findByRole("button", { name: "继续计时" });
    await user.click(screen.getByRole("button", { name: "继续计时" }));
    await waitFor(() => expect(request.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(String(init!.body)).type)).toEqual(["save-training", "start-training", "save-training", "pause-training", "save-training", "resume-training"]));
  });

  it("replaces the editable manual template while history stays read-only", async () => {
    const user = userEvent.setup();
    const replaced = snapshot({ template: { ...baseSnapshot.template!, revision: 3, name: "我的循环", changeNote: "调整推举", days: baseSnapshot.template!.days.map((day, index) => index === 0 ? { ...day, actions: [{ ...day.actions[0]!, name: "坐姿推举" }] } : day) } });
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => Response.json(replaced));
    render(<ManualExerciseWorkspace createId={sequenceIds("manual-template-key-0001")} initial={baseSnapshot} request={request} storage={localStorage} />);

    await user.click(screen.getByRole("tab", { name: "训练日模板" }));
    await user.clear(screen.getByLabelText("模板名称"));
    await user.type(screen.getByLabelText("模板名称"), "我的循环");
    await user.clear(screen.getByLabelText("肩日动作 1 名称"));
    await user.type(screen.getByLabelText("肩日动作 1 名称"), "坐姿推举");
    await user.type(screen.getByLabelText("模板更新说明"), "调整推举");
    await user.click(screen.getByRole("button", { name: "保存模板新版本" }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    const command = JSON.parse(String(request.mock.calls[0]![1]!.body)) as {
      type: string;
      expectedTemplateRevision: number;
      changeNote: string;
      days: Array<{ dayKey: string; actions: Array<{ name: string }> }>;
    };
    expect(command).toMatchObject({
      type: "replace-template",
      expectedTemplateRevision: 2,
      changeNote: "调整推举",
    });
    expect(command.days[0]).toMatchObject({ dayKey: "shoulder" });
    expect(command.days[0]!.actions[0]).toMatchObject({ name: "坐姿推举" });
    await user.click(screen.getByRole("tab", { name: "训练历史" }));
    expect(screen.getByText("2026-08-12")).toBeInTheDocument();
    const historyRow = screen.getByRole("row", { name: /2026-08-12 休息 已跳过/ });
    expect(within(historyRow).getByRole("link", { name: "打开 2026-08-12 的训练记录" })).toHaveAttribute("href", "/exercise?date=2026-08-12");
    expect(within(screen.getByRole("tabpanel")).queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("restores uncertain bytes without auto-POST, retries them exactly, and freezes failures", async () => {
    const command = JSON.stringify({ type: "pause-training", businessDate: "2026-08-13", expectedDailyRevision: 3 });
    const frozen = freezeSimpleSubmission({
      purpose: "manual-exercise",
      endpoint: "/api/v1/manual-exercise",
      operation: "pause-training",
      ownerId: "2026-08-13",
      localRevision: 4,
      idempotencyKey: "manual-recovery-key-0001",
      body: command,
      expected: { businessDate: "2026-08-13", operation: "pause-training" },
      createdAt: "2026-08-13T01:05:00.000Z",
    });
    expect(storeSimpleSubmission(localStorage, frozen).kind).toBe("stored");
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ message: "conflict" }, { status: 409 }));
    const user = userEvent.setup();
    render(<ManualExerciseWorkspace initial={baseSnapshot} request={request} storage={localStorage} />);

    const retry = await screen.findByRole("button", { name: "重试原提交" });
    expect(request).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "保存训练记录" })).toBeDisabled();
    await user.click(retry);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(request.mock.calls[0]![1]!.body).toBe(command);
    expect(screen.getByText(/提交失败，原提交已冻结/)).toBeInTheDocument();
    expect(JSON.parse(storedSubmission()!)).toMatchObject({ purpose: "manual-exercise" });
  });

  it("edits historical completed facts without advancing the current plan", async () => {
    const user = userEvent.setup();
    const finalized = snapshot({
      selectedDay: {
        ...baseSnapshot.selectedDay!,
        status: "completed",
        revision: 8,
        timer: {
          ...baseSnapshot.selectedDay!.timer,
          endedAt: "2026-08-13T01:12:00.000Z",
          confirmedDurationMinutes: 12,
        },
      },
    });
    let current = finalized;
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") current = saveResponse(current, JSON.parse(String(init.body)));
      return Response.json(current);
    });
    render(<ManualExerciseWorkspace now={laterNow} initial={finalized} request={request} storage={localStorage} />);
    expect(screen.getByLabelText("哑铃推举实际组数")).toBeEnabled();
    expect(screen.getByLabelText("肌酸")).toBeEnabled();
    await user.type(screen.getByLabelText("哑铃推举实际组数"), "4");
    await user.type(screen.getByLabelText("哑铃推举实际重量"), "14 kg");
    await user.click(screen.getByRole("button", { name: "保存训练记录" }));
    await screen.findByText("2026-08-13 的训练记录已保存。");
    expect(JSON.parse(String(request.mock.calls[0]![1]!.body))).toMatchObject({
      type: "save-training", businessDate: "2026-08-13", expectedDailyRevision: 8,
      actions: [{ actualSets: 4, actualWeightText: "14 kg" }],
    });
    expect(current.selectedDay?.status).toBe("completed");
    expect(current.cycle?.revision).toBe(5);
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("keeps manually entered numbers when the action is not marked complete", async () => {
    const user = userEvent.setup();
    let current = baseSnapshot;
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") current = saveResponse(current, JSON.parse(String(init.body)));
      return Response.json(current);
    });
    render(<ManualExerciseWorkspace initial={baseSnapshot} request={request} storage={localStorage} />);
    await user.type(screen.getByLabelText("哑铃推举实际组数"), "2");
    await user.type(screen.getByLabelText("哑铃推举实际次数（每组）"), "6 次");
    await user.type(screen.getByLabelText("哑铃推举实际重量"), "8 kg");
    expect(screen.getByLabelText("哑铃推举完成情况")).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "保存训练记录" }));
    await screen.findByText("2026-08-13 的训练记录已保存。");
    expect(JSON.parse(String(request.mock.calls[0]![1]!.body))).toMatchObject({
      actions: [{ actualSets: 2, actualRepsText: "6 次", actualWeightText: "8 kg", completion: false }],
    });
  });

  it("keeps the selected date and retryable reason when resolving fails", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ message: "conflict" }, { status: 409 }));
    render(<ManualExerciseWorkspace now={laterNow} initial={baseSnapshot} request={request} storage={localStorage} />);
    await user.click(screen.getByRole("button", { name: "休息一天" }));
    await user.click(screen.getByRole("button", { name: "身体疲劳" }));
    await user.click(screen.getByRole("button", { name: "保存并到下一天" }));
    await screen.findByText(/提交失败，原提交已冻结/);
    expect(navigation.push).not.toHaveBeenCalled();
    expect(screen.getByLabelText("休息原因")).toHaveValue("身体疲劳");
    expect(screen.getByRole("button", { name: "重试原提交" })).toBeInTheDocument();
  });

  it("records today's rest without opening a future date or consuming the plan", async () => {
    const user = userEvent.setup();
    const resolved = snapshot({ selectedDay: {
      ...baseSnapshot.selectedDay!, status: "skipped", revision: 4,
      resolution: { outcome: "rest", note: "身体疲劳", cycleAdvanced: false },
    } });
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json(resolved));
    render(<ManualExerciseWorkspace initial={baseSnapshot} request={request} storage={localStorage} />);
    await user.click(screen.getByRole("button", { name: "休息一天" }));
    await user.click(screen.getByRole("button", { name: "身体疲劳" }));
    await user.click(screen.getByRole("button", { name: "保存今天的状态" }));
    await screen.findByText(/已记为休息。已到今天/);
    expect(navigation.push).not.toHaveBeenCalled();
    expect(JSON.parse(String(request.mock.calls[0]![1]!.body))).toMatchObject({ type: "resolve-day", advanceCycle: false });
  });

  it("restores each date's draft when moving between dates without mixing the entered numbers", async () => {
    const user = userEvent.setup();
    const nextDate = snapshot({ businessDate: "2026-08-14", selectedDay: { ...baseSnapshot.selectedDay!, businessDate: "2026-08-14" } });
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json(baseSnapshot));
    const { rerender } = render(<ManualExerciseWorkspace now={laterNow} initial={baseSnapshot} request={request} storage={localStorage} />);
    await user.type(screen.getByLabelText("哑铃推举实际组数"), "2");
    await user.type(screen.getByLabelText("当天备注"), "前一天的数据");
    await user.click(screen.getByRole("button", { name: "下一天" }));
    expect(navigation.push).toHaveBeenCalledWith("/exercise?date=2026-08-14", { scroll: false });
    rerender(<ManualExerciseWorkspace now={laterNow} initial={nextDate} request={request} storage={localStorage} />);
    await waitFor(() => expect(screen.getByLabelText("哑铃推举实际组数")).toHaveValue(null));
    expect(screen.getByLabelText("当天备注")).toHaveValue("");
    await user.type(screen.getByLabelText("哑铃推举实际组数"), "5");
    await user.click(screen.getByRole("button", { name: "上一天" }));
    rerender(<ManualExerciseWorkspace now={laterNow} initial={baseSnapshot} request={request} storage={localStorage} />);
    await waitFor(() => expect(screen.getByLabelText("哑铃推举实际组数")).toHaveValue(2));
    expect(screen.getByLabelText("当天备注")).toHaveValue("前一天的数据");
    await user.click(screen.getByRole("button", { name: "下一天" }));
    rerender(<ManualExerciseWorkspace now={laterNow} initial={nextDate} request={request} storage={localStorage} />);
    await waitFor(() => expect(screen.getByLabelText("哑铃推举实际组数")).toHaveValue(5));
    expect(request).not.toHaveBeenCalled();
  });

});
