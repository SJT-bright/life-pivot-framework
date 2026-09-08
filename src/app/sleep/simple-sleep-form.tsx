"use client";

import { useEffect, useRef, useState } from "react";

import {
  joinHoursMinutes,
  splitHoursMinutes,
} from "@/core/time/format-duration";

import {
  type SimpleRecovery,
  type StoredSimpleSubmission,
  clearConfirmedSimpleSubmission,
  freezeSimpleSubmission,
  markSimpleSubmissionUncertain,
  recoverSimpleSubmissions,
  storeSimpleSubmission,
} from "@/app/accumulation/frozen-submission";
import type { DailySleepRecord } from "@/modules/daily-sleep/contracts";
import type { DailySleepHistory } from "@/modules/daily-sleep/query";

export interface SimpleSleepFormProps {
  businessDate: string;
  initialRecord: DailySleepRecord | null;
  request?: typeof fetch;
  createId?: () => string;
  storage?: Storage;
  onRefresh: (record: DailySleepRecord | null, history: DailySleepHistory) => void;
}

interface Draft {
  recordDate: string;
  asleepTime: string;
  wakeTime: string;
  deepSleepMinutes: string;
  lightSleepMinutes: string;
  remSleepMinutes: string;
  awakeEpisodes: string;
  awakeMinutes: string;
  morningFeeling: number | null;
  qualityScore: string;
  note: string;
}

function draftFromRecord(
  businessDate: string,
  record: DailySleepRecord | null,
): Draft {
  return {
    recordDate: record?.recordDate ?? businessDate,
    asleepTime: record?.asleepTime ?? "",
    wakeTime: record?.wakeTime ?? "",
    deepSleepMinutes: record?.deepSleepMinutes == null
      ? ""
      : String(record.deepSleepMinutes),
    lightSleepMinutes: record?.lightSleepMinutes == null
      ? ""
      : String(record.lightSleepMinutes),
    remSleepMinutes: record?.remSleepMinutes == null
      ? ""
      : String(record.remSleepMinutes),
    awakeEpisodes: record?.awakeEpisodes == null
      ? ""
      : String(record.awakeEpisodes),
    awakeMinutes: record?.awakeMinutes == null
      ? ""
      : String(record.awakeMinutes),
    morningFeeling: record?.morningFeeling ?? null,
    qualityScore: record?.qualityScore == null ? "" : String(record.qualityScore),
    note: record?.note ?? "",
  };
}

function storageOrNull(provided?: Storage): Storage | null {
  if (provided) return provided;
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function draftFromFrozen(stored: StoredSimpleSubmission): Draft | null {
  try {
    const body = JSON.parse(stored.submission.body) as Record<string, unknown>;
    return {
      recordDate: String(body.recordDate ?? ""),
      asleepTime: String(body.asleepTime ?? ""),
      wakeTime: String(body.wakeTime ?? ""),
      deepSleepMinutes: typeof body.deepSleepMinutes === "number"
        ? String(body.deepSleepMinutes)
        : "",
      lightSleepMinutes: typeof body.lightSleepMinutes === "number"
        ? String(body.lightSleepMinutes)
        : "",
      remSleepMinutes: typeof body.remSleepMinutes === "number"
        ? String(body.remSleepMinutes)
        : "",
      awakeEpisodes: typeof body.awakeEpisodes === "number"
        ? String(body.awakeEpisodes)
        : "",
      awakeMinutes: typeof body.awakeMinutes === "number"
        ? String(body.awakeMinutes)
        : "",
      morningFeeling: typeof body.morningFeeling === "number"
        ? body.morningFeeling
        : null,
      qualityScore: typeof body.qualityScore === "number"
        ? String(body.qualityScore)
        : "",
      note: String(body.note ?? ""),
    };
  } catch {
    return null;
  }
}

function isExpectedResult(
  result: unknown,
  expected: StoredSimpleSubmission["submission"]["expected"],
): result is DailySleepRecord {
  if (typeof result !== "object" || result === null) return false;
  const record = result as Partial<DailySleepRecord>;
  return record.id === expected.recordId &&
    record.recordDate === expected.recordDate &&
    record.revision === expected.revision;
}

/**
 * 「小时 + 分钟」双输入框：内部仍以总分钟数存取（0–1439），
 * 输入过程中未组成合法值时只在本地保留文字，不回写草稿。
 */
function StagePairInput({
  disabled,
  label,
  onChange,
  value,
}: {
  disabled: boolean;
  label: string;
  onChange: (minutes: string) => void;
  value: string;
}) {
  const [fields, setFields] = useState(() =>
    splitHoursMinutes(value === "" ? null : Number(value)));
  const lastSyncedValue = useRef(value);
  if (lastSyncedValue.current !== value) {
    lastSyncedValue.current = value;
    const joined = joinHoursMinutes(fields[0], fields[1]);
    const incoming = value === "" ? null : Number(value);
    if (joined !== incoming) {
      const next = splitHoursMinutes(value === "" ? null : Number(value));
      setFields(next);
    }
  }

  function commit(nextHours: string, nextMinutes: string): void {
    setFields([nextHours, nextMinutes]);
    const joined = joinHoursMinutes(nextHours, nextMinutes);
    if (joined === undefined) return;
    onChange(joined === null ? "" : String(joined));
  }

  return (
    <label className="sleep-form-field sleep-stage-pair">
      {label}
      <span className="sleep-stage-pair-inputs">
        <input
          aria-label={`${label}（小时）`}
          disabled={disabled}
          inputMode="numeric"
          max={23}
          min={0}
          onChange={(event) => commit(event.target.value, fields[1])}
          placeholder="0"
          step={1}
          type="number"
          value={fields[0]}
        />
        <span aria-hidden="true" className="sleep-stage-pair-unit">小时</span>
        <input
          aria-label={`${label}（分钟）`}
          disabled={disabled}
          inputMode="numeric"
          max={59}
          min={0}
          onChange={(event) => commit(fields[0], event.target.value)}
          placeholder="0"
          step={1}
          type="number"
          value={fields[1]}
        />
        <span aria-hidden="true" className="sleep-stage-pair-unit">分钟</span>
      </span>
    </label>
  );
}

function minutesBetween(asleepTime: string, wakeTime: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(asleepTime) || !/^\d{2}:\d{2}$/.test(wakeTime)) return null;
  const [asleepHour, asleepMinute] = asleepTime.split(":").map(Number);
  const [wakeHour, wakeMinute] = wakeTime.split(":").map(Number);
  const asleep = asleepHour! * 60 + asleepMinute!;
  const wake = wakeHour! * 60 + wakeMinute!;
  const span = wake - asleep;
  return span <= 0 ? span + 1440 : span;
}

/** 总睡眠 =（起床 − 入睡）− 清醒分钟；只在入睡/起床有效时显示。 */
function TotalSleepHint({ asleepTime, awakeMinutes, wakeTime }: {
  asleepTime: string;
  awakeMinutes: number | null;
  wakeTime: string;
}) {
  const span = minutesBetween(asleepTime, wakeTime);
  if (span === null) return null;
  const awake = awakeMinutes ?? 0;
  const total = Math.max(0, span - awake);
  return (
    <p className="sleep-total-hint" role="status">
      总睡眠 {Math.floor(total / 60)} 小时 {total % 60} 分钟
      {awake > 0 ? `（已扣除清醒 ${awake} 分钟）` : ""}
    </p>
  );
}

export function SimpleSleepForm({
  businessDate,
  initialRecord,
  request = fetch,
  createId = () => crypto.randomUUID(),
  storage: providedStorage,
  onRefresh,
}: SimpleSleepFormProps) {
  const [record, setRecord] = useState(initialRecord);
  const [draft, setDraft] = useState(() => draftFromRecord(businessDate, initialRecord));
  const [active, setActive] = useState<StoredSimpleSubmission | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const locked = active !== null;

  useEffect(() => {
    const storage = storageOrNull(providedStorage);
    if (!storage) return;
    const recovery = recoverSimpleSubmissions("daily-sleep", storage);
    if (recovery.kind !== "recovered") return;
    const recoveredDraft = draftFromFrozen(recovery);
    if (recoveredDraft) setDraft(recoveredDraft);
    setActive(recovery);
    setMessage("保存结果不确定，只能重试原提交或放弃");
  }, [providedStorage]);

  function update<K extends keyof Draft>(key: K, value: Draft[K]): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function selectDate(recordDate: string): Promise<void> {
    update("recordDate", recordDate);
    try {
      const response = await request(
        `/api/v1/daily-sleep?date=${encodeURIComponent(recordDate)}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("date read failed");
      const payload = (await response.json()) as { record: DailySleepRecord | null };
      setRecord(payload.record);
      setDraft(draftFromRecord(recordDate, payload.record));
      setMessage("");
    } catch {
      setRecord(null);
      setMessage("暂时无法读取所选日期");
    }
  }

  async function refreshSelectedDate(recordDate: string): Promise<void> {
    const [recordResponse, historyResponse] = await Promise.all([
      request(`/api/v1/daily-sleep?date=${encodeURIComponent(recordDate)}`, {
        cache: "no-store",
      }),
      request("/api/v1/daily-sleep?view=history&limit=30", { cache: "no-store" }),
    ]);
    if (!recordResponse.ok || !historyResponse.ok) {
      setMessage("已保存，但刷新失败");
      return;
    }
    const selected = (await recordResponse.json()) as { record: DailySleepRecord | null };
    const history = (await historyResponse.json()) as { history: DailySleepHistory };
    setRecord(selected.record);
    setDraft(draftFromRecord(recordDate, selected.record));
    onRefresh(selected.record, history.history);
    setMessage("已保存");
  }

  async function send(stored: StoredSimpleSubmission): Promise<void> {
    const storage = storageOrNull(providedStorage);
    if (!storage) {
      setMessage("本机恢复存储不可用，未发送");
      return;
    }
    setSaving(true);
    try {
      const response = await request(stored.submission.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": stored.submission.idempotencyKey,
        },
        body: stored.submission.body,
        cache: "no-store",
      });
      if (!response.ok) {
        if (response.status === 400 || response.status === 409 || response.status === 415 || response.status === 422) {
          const uncertain = markSimpleSubmissionUncertain(storage, stored);
          const clearTarget = uncertain.kind === "recovered" ? uncertain : stored;
          const cleared = uncertain.kind === "recovered"
            ? clearConfirmedSimpleSubmission(storage, clearTarget)
            : uncertain;
          if (!("kind" in cleared) || cleared.kind !== "cleared") {
            if (uncertain.kind === "recovered") setActive(uncertain);
            setMessage("本机提交状态已变化，请保留当前页面");
            return;
          }
          setActive(null);
          setMessage(response.status === 422
            ? "内容未通过校验，请修改后再保存"
            : response.status === 409
              ? "记录已变化，请刷新后再保存"
              : "请求未被接受，请修改后再保存");
          return;
        }
        throw new Error("uncertain response");
      }
      const payload = (await response.json()) as { result?: unknown };
      if (!isExpectedResult(payload.result, stored.submission.expected)) {
        throw new Error("unexpected confirmation");
      }
      const uncertain = markSimpleSubmissionUncertain(storage, stored);
      if (uncertain.kind !== "recovered") throw new Error("submission evidence changed");
      const cleared = clearConfirmedSimpleSubmission(storage, uncertain);
      if (cleared.kind !== "cleared") throw new Error("submission evidence not cleared");
      setActive(null);
      await refreshSelectedDate(payload.result.recordDate);
    } catch {
      const uncertain: SimpleRecovery = markSimpleSubmissionUncertain(storage, stored);
      if (uncertain.kind === "recovered") setActive(uncertain);
      setMessage("保存结果不确定，只能重试原提交或放弃");
    } finally {
      setSaving(false);
    }
  }

  async function submit(): Promise<void> {
    const storage = storageOrNull(providedStorage);
    if (!storage || locked || saving) {
      if (!storage) setMessage("本机恢复存储不可用，未发送");
      return;
    }
    const selectedRecord = record?.recordDate === draft.recordDate ? record : null;
    const stageDrafts = [draft.deepSleepMinutes, draft.lightSleepMinutes, draft.remSleepMinutes];
    const suppliedStageCount = stageDrafts.filter((value) => value !== "").length;
    if (suppliedStageCount !== 0 && suppliedStageCount !== stageDrafts.length) {
      setMessage("深睡、浅睡和 REM 时长需要全部填写或全部留空");
      return;
    }
    const parsedStages = stageDrafts.map((value) => value === "" ? null : Number(value));
    if (parsedStages.some((value) => value !== null && (
      !Number.isInteger(value) || value < 0 || value > 1440
    ))) {
      setMessage("睡眠阶段时长需要按小时和分钟填写（例如 1 小时 30 分钟）");
      return;
    }
    const parseCount = (value: string, maximum: number): number | null | "error" => {
      if (value.trim() === "") return null;
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > maximum) return "error";
      return parsed;
    };
    const awakeEpisodes = parseCount(draft.awakeEpisodes, 100);
    const awakeMinutes = parseCount(draft.awakeMinutes, 720);
    if (awakeEpisodes === "error" || awakeMinutes === "error") {
      setMessage("清醒次数需要 0–100 次，清醒分钟需要 0–720 分钟");
      return;
    }
    const qualityScore = Number(draft.qualityScore);
    if (!Number.isInteger(qualityScore) || qualityScore < 60 || qualityScore > 100) {
      setMessage("请填写 60–100 的睡眠质量分");
      return;
    }
    const recordId = selectedRecord?.id ?? createId();
    const idempotencyKey = createId();
    const body = JSON.stringify({
      type: "save-daily-sleep",
      recordId,
      recordDate: draft.recordDate,
      asleepTime: draft.asleepTime,
      wakeTime: draft.wakeTime,
      confirmedDurationMinutes: null,
      deepSleepMinutes: parsedStages[0],
      lightSleepMinutes: parsedStages[1],
      remSleepMinutes: parsedStages[2],
      awakeEpisodes,
      awakeMinutes,
      morningFeeling: draft.morningFeeling,
      qualityScore,
      note: draft.note,
      expectedRevision: selectedRecord?.revision ?? 0,
    });
    let frozen;
    try {
      frozen = freezeSimpleSubmission({
        purpose: "daily-sleep",
        endpoint: "/api/v1/daily-sleep",
        operation: "save-daily-sleep",
        ownerId: recordId,
        localRevision: (selectedRecord?.revision ?? 0) + 1,
        idempotencyKey,
        body,
        expected: {
          recordId,
          recordDate: draft.recordDate,
          revision: (selectedRecord?.revision ?? 0) + 1,
        },
        createdAt: new Date().toISOString(),
      });
    } catch {
      setMessage("请完整填写有效的睡眠记录");
      return;
    }
    const stored = storeSimpleSubmission(storage, frozen);
    if (stored.kind !== "stored") {
      setMessage(stored.kind === "storage-unavailable"
        ? "本机恢复存储不可用，未发送"
        : "已有待确认的睡眠提交");
      return;
    }
    setActive(stored);
    await send(stored);
  }

  function abandon(): void {
    const storage = storageOrNull(providedStorage);
    if (!storage || !active) return;
    const uncertain = active.submission.status === "uncertain"
      ? { kind: "recovered" as const, ...active }
      : markSimpleSubmissionUncertain(storage, active);
    if (uncertain.kind !== "recovered") return;
    if (clearConfirmedSimpleSubmission(storage, uncertain).kind !== "cleared") return;
    setActive(null);
    setMessage("已放弃原提交，表单草稿仍保留");
  }

  return (
    <form className="sleep-entry-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label className="sleep-form-field sleep-date-field">日期<input aria-label="日期" disabled={locked} onChange={(event) => void selectDate(event.target.value)} required type="date" value={draft.recordDate} /></label>
      <label className="sleep-form-field sleep-time-field">入睡时间<input aria-label="入睡时间" disabled={locked} onChange={(event) => update("asleepTime", event.target.value)} required step={60} type="time" value={draft.asleepTime} /></label>
      <label className="sleep-form-field sleep-time-field">起床时间<input aria-label="起床时间" disabled={locked} onChange={(event) => update("wakeTime", event.target.value)} required step={60} type="time" value={draft.wakeTime} /></label>
      <TotalSleepHint
        asleepTime={draft.asleepTime}
        awakeMinutes={draft.awakeMinutes === "" ? null : Number(draft.awakeMinutes)}
        wakeTime={draft.wakeTime}
      />
      <label className="sleep-form-field sleep-quality-field">睡眠质量分（60–100）<input aria-label="睡眠质量分" disabled={locked} inputMode="numeric" max={100} min={60} onChange={(event) => update("qualityScore", event.target.value)} placeholder="例如：85" required step={1} type="number" value={draft.qualityScore} /></label>
      <fieldset className="sleep-stage-fields" disabled={locked}>
        <legend>睡眠阶段（可选，按小时和分钟填写；需全部填写）</legend>
        <StagePairInput
          disabled={locked}
          label="深睡"
          onChange={(minutes) => update("deepSleepMinutes", minutes)}
          value={draft.deepSleepMinutes}
        />
        <StagePairInput
          disabled={locked}
          label="浅睡"
          onChange={(minutes) => update("lightSleepMinutes", minutes)}
          value={draft.lightSleepMinutes}
        />
        <StagePairInput
          disabled={locked}
          label="REM"
          onChange={(minutes) => update("remSleepMinutes", minutes)}
          value={draft.remSleepMinutes}
        />
        <label className="sleep-form-field sleep-stage-pair">
          清醒
          <span className="sleep-stage-pair-inputs">
            <input
              aria-label="清醒（次数）"
              disabled={locked}
              inputMode="numeric"
              max={100}
              min={0}
              onChange={(event) => update("awakeEpisodes", event.target.value)}
              placeholder="0"
              step={1}
              type="number"
              value={draft.awakeEpisodes}
            />
            <span aria-hidden="true" className="sleep-stage-pair-unit">次</span>
            <input
              aria-label="清醒（分钟）"
              disabled={locked}
              inputMode="numeric"
              max={720}
              min={0}
              onChange={(event) => update("awakeMinutes", event.target.value)}
              placeholder="0"
              step={1}
              type="number"
              value={draft.awakeMinutes}
            />
            <span aria-hidden="true" className="sleep-stage-pair-unit">分钟</span>
          </span>
        </label>
      </fieldset>
      <fieldset className="sleep-feeling-field" disabled={locked}>
        <legend>醒后感受</legend>
        <div
          className="sleep-feeling-slider"
        >
          <div className="sleep-feeling-slider-control">
            <div className="sleep-feeling-slider-heading">
              <span id="morning-feeling-hint">
                1 较差 · 5 很好
              </span>
              <output
                aria-live="polite"
                htmlFor="morning-feeling-range"
              >
                {draft.morningFeeling === null ? "暂不记录" : `${draft.morningFeeling} / 5`}
              </output>
            </div>
            <input
              aria-describedby="morning-feeling-hint"
              aria-label="醒后感受"
              aria-valuetext={draft.morningFeeling === null
                ? "暂不记录，滑动后开始记录"
                : `${draft.morningFeeling} 分，满分 5 分`}
              data-unset={draft.morningFeeling === null ? "true" : undefined}
              id="morning-feeling-range"
              max={5}
              min={1}
              onChange={(event) => update("morningFeeling", Number(event.target.value))}
              onPointerDown={(event) => {
                if (draft.morningFeeling === null) {
                  update("morningFeeling", Number(event.currentTarget.value));
                }
              }}
              step={1}
              style={{
                "--sleep-feeling-progress": `${((draft.morningFeeling ?? 3) - 1) * 25}%`,
              } as React.CSSProperties}
              type="range"
              value={draft.morningFeeling ?? 3}
            />
            <div aria-hidden="true" className="sleep-feeling-scale">
              {[1, 2, 3, 4, 5].map((value) => <span key={value}>{value}</span>)}
            </div>
          </div>
          <button
            aria-pressed={draft.morningFeeling === null}
            className="sleep-feeling-clear"
            onClick={() => update("morningFeeling", null)}
            type="button"
          >
            暂不记录
          </button>
        </div>
      </fieldset>
      <details className="sleep-note-disclosure"><summary>备注</summary><label className="sleep-form-field sleep-note-field">备注<textarea aria-label="备注" disabled={locked} maxLength={4000} onChange={(event) => update("note", event.target.value)} value={draft.note} /></label></details>
      {!locked && <button className="sleep-form-primary-action" disabled={saving} type="submit">保存睡眠记录</button>}
      {locked && <div className="sleep-form-actions">
        <button className="sleep-form-retry-action" disabled={saving} onClick={() => void send(active)} type="button">重试原提交</button>
        <button className="sleep-form-abandon-action" disabled={saving} onClick={abandon} type="button">放弃并保留表单草稿</button>
      </div>}
      {message && <p className="sleep-form-status" role="status">{message}</p>}
    </form>
  );
}
