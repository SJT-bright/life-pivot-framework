// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DailySleepRecord } from "@/modules/daily-sleep/contracts";

import { SimpleSleepForm } from "./simple-sleep-form";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const savedRecord: DailySleepRecord = {
  id: "sleep-record-0001",
  recordDate: "2026-08-12",
  asleepTime: "23:30",
  wakeTime: "07:00",
  calculatedDurationMinutes: 450,
  confirmedDurationMinutes: null,
  finalDurationMinutes: 450,
  deepSleepMinutes: 90,
  lightSleepMinutes: 270,
  remSleepMinutes: 90,
  awakeEpisodes: null,
  awakeMinutes: null,
  morningFeeling: 4,
  qualityScore: 91,
  sleepVariabilityMinutes: null,
  score: {
    finalScore: 91,
    durationScore: 100,
    variabilityScore: 50,
    stageConsistencyScore: 100,
    morningFeelingScore: 75,
    bedVariabilityMinutes: null,
    wakeVariabilityMinutes: null,
    averageVariabilityMinutes: null,
    usedPreviousNaturalDay: false,
    disclaimer: "个人趋势分，非医疗诊断",
  },
  qualityText: "自动质量分 91/100",
  note: "晚间备注",
  revision: 1,
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function fillForm() {
  fireEvent.change(screen.getByLabelText("入睡时间"), { target: { value: "23:30" } });
  fireEvent.change(screen.getByLabelText("起床时间"), { target: { value: "07:00" } });
  fireEvent.change(screen.getByLabelText("睡眠质量分"), { target: { value: "91" } });
  fireEvent.change(screen.getByLabelText("深睡（小时）"), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("深睡（分钟）"), { target: { value: "30" } });
  fireEvent.change(screen.getByLabelText("浅睡（小时）"), { target: { value: "4" } });
  fireEvent.change(screen.getByLabelText("浅睡（分钟）"), { target: { value: "30" } });
  fireEvent.change(screen.getByLabelText("REM（小时）"), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("REM（分钟）"), { target: { value: "30" } });
  fireEvent.change(screen.getByRole("slider", { name: "醒后感受" }), {
    target: { value: "4" },
  });
}

describe("SimpleSleepForm", () => {
  it("loads an existing historical date without submitting it", async () => {
    const historical = { ...savedRecord, recordDate: "2026-08-10", revision: 2 };
    const request = vi.fn(async () => Response.json({ record: historical }));
    render(<SimpleSleepForm
      businessDate="2026-08-12"
      initialRecord={null}
      request={request}
      storage={new MemoryStorage()}
      onRefresh={vi.fn()}
    />);

    fireEvent.change(screen.getByLabelText("日期"), { target: { value: "2026-08-10" } });
    await waitFor(() => expect(request).toHaveBeenCalledWith(
      "/api/v1/daily-sleep?date=2026-08-10",
      { cache: "no-store" },
    ));
    expect(screen.getByLabelText("入睡时间")).toHaveValue("23:30");
    expect(screen.getByLabelText("深睡（小时）")).toHaveValue(1);
    expect(screen.getByLabelText("深睡（分钟）")).toHaveValue(30);
    expect(screen.getByLabelText("睡眠质量分")).toHaveValue(91);
    expect(screen.getByRole("slider", { name: "醒后感受" })).toHaveValue("4");
    expect(screen.getByText("4 / 5")).toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("omits the duration summary, freezes the slider value before POST, then refreshes", async () => {
    const storage = new MemoryStorage();
    const ids = ["sleep-record-0001", "daily-sleep-key-0001"];
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") {
        expect(storage.length).toBe(1);
        expect(JSON.parse(String(init.body))).toMatchObject({
          confirmedDurationMinutes: null,
          deepSleepMinutes: 90,
          lightSleepMinutes: 270,
          remSleepMinutes: 90,
          awakeEpisodes: null,
          awakeMinutes: null,
          morningFeeling: 4,
          qualityScore: 91,
          expectedRevision: 0,
        });
        return Response.json({ result: savedRecord });
      }
      if (url.includes("view=history")) {
        return Response.json({ history: { items: [savedRecord] } });
      }
      return Response.json({ record: savedRecord });
    });
    const onRefresh = vi.fn();
    render(<SimpleSleepForm
      businessDate="2026-08-12"
      initialRecord={null}
      request={request}
      createId={() => ids.shift()!}
      storage={storage}
      onRefresh={onRefresh}
    />);

    expect(screen.getByLabelText("日期")).toHaveValue("2026-08-12");
    expect(screen.getByText("备注", { selector: "summary" }).closest("details"))
      .not.toHaveAttribute("open");
    expect(screen.queryByRole("button", { name: "手动修正时长" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("手动修正时长（分钟）")).not.toBeInTheDocument();
    expect(screen.queryByText("睡眠时长")).not.toBeInTheDocument();
    expect(screen.queryByText("待填写")).not.toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "醒后感受" })).toHaveAttribute("min", "1");
    expect(screen.getByRole("slider", { name: "醒后感受" })).toHaveAttribute("max", "5");
    expect(screen.getByRole("slider", { name: "醒后感受" })).toHaveAttribute("step", "1");
    fillForm();
    expect(screen.getByText("4 / 5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存睡眠记录" }));

    await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    expect(storage.length).toBe(0);
    expect(onRefresh).toHaveBeenCalledWith(savedRecord, { items: [savedRecord] });
    expect(screen.getByText("已保存", { selector: ".sleep-form-status" })).toBeInTheDocument();
  });

  it("assigns the native range continuously, clears it to null, and submits null", async () => {
    const storage = new MemoryStorage();
    const ids = ["sleep-record-0004", "daily-sleep-key-0004"];
    let submittedBody: Record<string, unknown> | null = null;
    const clearedRecord = {
      ...savedRecord,
      id: "sleep-record-0004",
      awakeEpisodes: null,
      awakeMinutes: null,
      morningFeeling: null,
    };
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        submittedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Response.json({ result: clearedRecord });
      }
      if (String(input).includes("view=history")) {
        return Response.json({ history: { items: [clearedRecord] } });
      }
      return Response.json({ record: clearedRecord });
    });
    render(<SimpleSleepForm
      businessDate="2026-08-12"
      initialRecord={null}
      request={request}
      createId={() => ids.shift()!}
      storage={storage}
      onRefresh={vi.fn()}
    />);

    const slider = screen.getByRole("slider", { name: "醒后感受" });
    expect(slider).toHaveValue("3");
    expect(slider).toHaveAttribute("aria-valuetext", expect.stringContaining("暂不记录"));

    fireEvent.pointerDown(slider);
    expect(screen.getByText("3 / 5")).toBeInTheDocument();
    fireEvent.change(slider, { target: { value: "5" } });
    expect(slider).toHaveValue("5");
    expect(screen.getByText("5 / 5")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "暂不记录" }));
    expect(screen.getByRole("button", { name: "暂不记录" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(slider).toHaveAttribute("aria-valuetext", expect.stringContaining("暂不记录"));

    fireEvent.change(screen.getByLabelText("入睡时间"), { target: { value: "23:30" } });
    fireEvent.change(screen.getByLabelText("起床时间"), { target: { value: "07:00" } });
    fireEvent.change(screen.getByLabelText("睡眠质量分"), { target: { value: "91" } });
    fireEvent.click(screen.getByRole("button", { name: "保存睡眠记录" }));

    await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    expect(submittedBody).toMatchObject({ morningFeeling: null });
  });

  it("keeps an editable draft after 422", async () => {
    const storage = new MemoryStorage();
    const ids = ["sleep-record-0002", "daily-sleep-key-0002"];
    render(<SimpleSleepForm
      businessDate="2026-08-12"
      initialRecord={null}
      request={vi.fn(async () => Response.json({ message: "invalid" }, { status: 422 }))}
      createId={() => ids.shift()!}
      storage={storage}
      onRefresh={vi.fn()}
    />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "保存睡眠记录" }));
    await screen.findByText("内容未通过校验，请修改后再保存");
    expect(screen.getByLabelText("深睡（分钟）")).toBeEnabled();
    expect(screen.getByLabelText("深睡（小时）")).toHaveValue(1);
    expect(screen.getByLabelText("深睡（分钟）")).toHaveValue(30);
    expect(screen.getByLabelText("睡眠质量分")).toHaveValue(91);
    expect(storage.length).toBe(0);
  });

  it("recovers an uncertain exact submission after reload without sending it", async () => {
    const storage = new MemoryStorage();
    const ids = ["sleep-record-0003", "daily-sleep-key-0003"];
    const failingRequest = vi.fn(async () => {
      throw new TypeError("network unavailable");
    });
    const first = render(<SimpleSleepForm
      businessDate="2026-08-12"
      initialRecord={null}
      request={failingRequest}
      createId={() => ids.shift()!}
      storage={storage}
      onRefresh={vi.fn()}
    />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "保存睡眠记录" }));
    await screen.findByText("保存结果不确定，只能重试原提交或放弃");
    expect(screen.getByRole("button", { name: "重试原提交" })).toBeInTheDocument();
    first.unmount();

    const reloadRequest = vi.fn();
    render(<SimpleSleepForm
      businessDate="2026-08-12"
      initialRecord={null}
      request={reloadRequest}
      storage={storage}
      onRefresh={vi.fn()}
    />);
    await screen.findByText("保存结果不确定，只能重试原提交或放弃");
    expect(reloadRequest).not.toHaveBeenCalled();
    expect(screen.getByLabelText("深睡（小时）")).toHaveValue(1);
    expect(screen.getByLabelText("深睡（分钟）")).toHaveValue(30);
    expect(screen.getByLabelText("深睡（分钟）")).toBeDisabled();
    expect(screen.getByRole("button", { name: "放弃并保留表单草稿" })).toBeInTheDocument();
  });
});
