import type Database from "better-sqlite3";

import {
  type IdempotentCommandOptions,
  runIdempotentCommand,
} from "@/core/db/idempotent-command";

import {
  type DailySleepRecord,
  parseDailySleepCommand,
} from "./contracts";
import { calculateSleepMinutes } from "./duration";
import {
  calculateSleepWellnessScore,
  previousCalendarDate,
  type SleepWellnessRaw,
} from "./scoring";

export interface DailySleepServiceOptions {
  now?: () => Date;
  writeBarrier?: IdempotentCommandOptions["writeBarrier"];
}

export interface DailySleepService {
  execute(command: unknown, idempotencyKey: string): Promise<DailySleepRecord>;
}

export class DailySleepConflictError extends Error {
  constructor(message = "The daily sleep record conflicts with current state.") {
    super(message);
    this.name = "DailySleepConflictError";
  }
}

export interface DailySleepRow {
  id: string;
  record_date: string;
  asleep_time: string;
  wake_time: string;
  calculated_duration_minutes: number;
  confirmed_duration_minutes: number | null;
  deep_sleep_minutes: number | null;
  light_sleep_minutes: number | null;
  rem_sleep_minutes: number | null;
  morning_feeling: number | null;
  manual_quality_score: number | null;
  awake_episodes: number | null;
  awake_minutes: number | null;
  quality_text: string;
  note: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

function scoringRaw(row: DailySleepRow): SleepWellnessRaw {
  return {
    recordDate: row.record_date,
    asleepTime: row.asleep_time,
    wakeTime: row.wake_time,
    durationMinutes: row.confirmed_duration_minutes ?? row.calculated_duration_minutes,
    deepSleepMinutes: row.deep_sleep_minutes,
    lightSleepMinutes: row.light_sleep_minutes,
    remSleepMinutes: row.rem_sleep_minutes,
    morningFeeling: row.morning_feeling,
  };
}

const LEGACY_QUALITY_PLACEHOLDER = "未记录主观评价";

export function dailySleepRecordFromRow(
  row: DailySleepRow,
  previousRow?: DailySleepRow | null,
): DailySleepRecord {
  const score = calculateSleepWellnessScore(
    scoringRaw(row),
    previousRow ? scoringRaw(previousRow) : null,
  );
  return {
    id: row.id,
    recordDate: row.record_date,
    asleepTime: row.asleep_time,
    wakeTime: row.wake_time,
    calculatedDurationMinutes: row.calculated_duration_minutes,
    confirmedDurationMinutes: row.confirmed_duration_minutes,
    finalDurationMinutes:
      row.confirmed_duration_minutes ?? row.calculated_duration_minutes,
    deepSleepMinutes: row.deep_sleep_minutes,
    lightSleepMinutes: row.light_sleep_minutes,
    remSleepMinutes: row.rem_sleep_minutes,
    awakeEpisodes: row.awake_episodes,
    awakeMinutes: row.awake_minutes,
    morningFeeling: row.morning_feeling,
    qualityScore: row.manual_quality_score,
    sleepVariabilityMinutes: score.averageVariabilityMinutes,
    score,
    qualityText: row.quality_text,
    note: row.note,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_RECORD = `select id, record_date, asleep_time, wake_time,
  calculated_duration_minutes, confirmed_duration_minutes,
  deep_sleep_minutes, light_sleep_minutes, rem_sleep_minutes, morning_feeling,
  manual_quality_score, awake_episodes, awake_minutes, quality_text, note,
  revision, created_at, updated_at from sleep_daily_records`;

function findById(sqlite: Database.Database, id: string): DailySleepRow | undefined {
  return sqlite.prepare(`${SELECT_RECORD} where id = ?`).get(id) as DailySleepRow | undefined;
}

function findByDate(
  sqlite: Database.Database,
  recordDate: string,
): DailySleepRow | undefined {
  return sqlite.prepare(`${SELECT_RECORD} where record_date = ?`).get(recordDate) as
    | DailySleepRow
    | undefined;
}

function findPreviousNaturalDay(
  sqlite: Database.Database,
  recordDate: string,
): DailySleepRow | undefined {
  const previousDate = previousCalendarDate(recordDate);
  return previousDate ? findByDate(sqlite, previousDate) : undefined;
}

export function createDailySleepService(
  sqlite: Database.Database,
  options: DailySleepServiceOptions = {},
): DailySleepService {
  const now = options.now ?? (() => new Date());

  return {
    execute(rawCommand, idempotencyKey) {
      let acceptedAt: Date | undefined;
      const stableNow = () => {
        acceptedAt ??= now();
        return acceptedAt;
      };

      return runIdempotentCommand(
        sqlite,
        {
          operation: "daily-sleep.command",
          idempotencyKey,
          now: stableNow,
          writeBarrier: options.writeBarrier,
        },
        rawCommand,
        () => {
          const command = parseDailySleepCommand(rawCommand);
          const byId = findById(sqlite, command.recordId);
          const byDate = findByDate(sqlite, command.recordDate);
          const calculatedDuration = calculateSleepMinutes(
            command.asleepTime,
            command.wakeTime,
          );
          // `quality_text` was user-authored in v0.4. A modern form omits it,
          // so edits must preserve the historical text instead of replacing it
          // with a derived score summary. Scores are calculated dynamically.
          const qualityText = command.qualityText
            ?? byId?.quality_text
            ?? LEGACY_QUALITY_PLACEHOLDER;
          const timestamp = stableNow().toISOString();

          if (command.expectedRevision === 0) {
            if (byId || byDate) throw new DailySleepConflictError();
            sqlite.prepare(
              `insert into sleep_daily_records
                (id, record_date, asleep_time, wake_time, calculated_duration_minutes,
                 confirmed_duration_minutes, deep_sleep_minutes, light_sleep_minutes,
                 rem_sleep_minutes, morning_feeling, manual_quality_score,
                 awake_episodes, awake_minutes, quality_text, note,
                 revision, created_at, updated_at)
               values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
            ).run(
              command.recordId,
              command.recordDate,
              command.asleepTime,
              command.wakeTime,
              calculatedDuration,
              command.confirmedDurationMinutes,
              command.deepSleepMinutes,
              command.lightSleepMinutes,
              command.remSleepMinutes,
              command.morningFeeling,
              command.qualityScore,
              command.awakeEpisodes,
              command.awakeMinutes,
              qualityText,
              command.note,
              timestamp,
              timestamp,
            );
          } else {
            if (
              !byId ||
              !byDate ||
              byId.id !== byDate.id ||
              byId.record_date !== command.recordDate ||
              byId.revision !== command.expectedRevision
            ) {
              throw new DailySleepConflictError();
            }
            sqlite.prepare(
              `update sleep_daily_records
               set asleep_time = ?, wake_time = ?, calculated_duration_minutes = ?,
                   confirmed_duration_minutes = ?, deep_sleep_minutes = ?,
                   light_sleep_minutes = ?, rem_sleep_minutes = ?, morning_feeling = ?,
                   manual_quality_score = ?, awake_episodes = ?, awake_minutes = ?,
                   quality_text = ?, note = ?,
                   revision = revision + 1, updated_at = ?
               where id = ?`,
            ).run(
              command.asleepTime,
              command.wakeTime,
              calculatedDuration,
              command.confirmedDurationMinutes,
              command.deepSleepMinutes,
              command.lightSleepMinutes,
              command.remSleepMinutes,
              command.morningFeeling,
              command.qualityScore,
              command.awakeEpisodes,
              command.awakeMinutes,
              qualityText,
              command.note,
              timestamp,
              command.recordId,
            );
          }

          return dailySleepRecordFromRow(
            findById(sqlite, command.recordId)!,
            findPreviousNaturalDay(sqlite, command.recordDate),
          );
        },
      );
    },
  };
}
