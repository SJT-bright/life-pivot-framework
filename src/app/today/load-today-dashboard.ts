import { getManualExerciseSnapshot } from "@/modules/manual-exercise/queries";
import { listTodayReminders } from "@/modules/today-reminders/query";

import type { TodayCardState } from "./today-card-state";
import type {
  TodayExerciseCardData,
  TodayExerciseCardState,
  TodayExerciseTimerStatus,
} from "./today-exercise-card";

export type TodayDashboardReader<TDatabase, TData = unknown> = (
  database: TDatabase,
  businessDate: string,
) => TData | Promise<TData>;

type ReaderMap<TDatabase> = Record<string, TodayDashboardReader<TDatabase>>;

type ReaderResult<TReader> = TReader extends (...args: never[]) => infer TData
  ? Awaited<TData>
  : never;

export type TodayDashboardStateMap<TReaders> = {
  [Key in keyof TReaders]: TodayCardState<ReaderResult<TReaders[Key]>>;
} & { exercise: TodayExerciseCardState };

type ManualExerciseDatabase = {
  sqlite: Parameters<typeof getManualExerciseSnapshot>[0];
};

export interface TodayDashboardDependencies<
  TDatabase extends ManualExerciseDatabase,
  TReaders extends ReaderMap<TDatabase>,
> {
  openDatabase: () => TDatabase;
  readers: TReaders;
}

function unavailableStates<TReaders extends object>(
  readers: TReaders,
): TodayDashboardStateMap<TReaders> {
  return {
    ...Object.fromEntries(
      Object.keys(readers).map((key) => [key, { status: "unavailable" }]),
    ),
    exercise: { status: "unavailable" },
  } as TodayDashboardStateMap<TReaders>;
}

function exerciseTimerStatus(
  day: NonNullable<ReturnType<typeof getManualExerciseSnapshot>["selectedDay"]>,
): TodayExerciseTimerStatus {
  if (day.timer.endedAt !== null || day.status === "completed" || day.status === "skipped") {
    return "finished";
  }
  if (day.timer.pausedAt !== null) return "paused";
  if (day.timer.startedAt !== null) return "running";
  return "idle";
}

function mapExerciseSnapshot(
  snapshot: ReturnType<typeof getManualExerciseSnapshot>,
): TodayExerciseCardState {
  const day = snapshot.selectedDay;
  if (!day) return { status: "unavailable" };

  const data: TodayExerciseCardData = {
    businessDate: day.businessDate,
    currentDayName: day.name,
    bodyPart: day.bodyPart ?? "",
    isRest: day.isRest,
    trainingStatus: day.status,
    completedActions: day.actions.filter((action) => action.actual.completion).length,
    totalActions: day.actions.length,
    timerStatus: exerciseTimerStatus(day),
    calculatedMinutes: day.timer.calculatedDurationMinutes,
    confirmedMinutes: day.timer.confirmedDurationMinutes,
    creatineTaken: day.supplements.creatineTaken,
    proteinPowderTaken: day.supplements.proteinPowderTaken,
  };
  return { status: "ready", data };
}

export async function loadTodayDashboard<
  TDatabase extends ManualExerciseDatabase,
  TReaders extends ReaderMap<TDatabase>,
>(
  dependencies: TodayDashboardDependencies<TDatabase, TReaders>,
  businessDate: string,
): Promise<TodayDashboardStateMap<TReaders>> {
  let database: TDatabase;
  try {
    database = dependencies.openDatabase();
  } catch {
    return unavailableStates(dependencies.readers);
  }

  const entries = await Promise.all(
    Object.entries(dependencies.readers).map(async ([key, reader]) => {
      try {
        return [key, {
          status: "ready",
          data: await reader(database, businessDate),
        }] as const;
      } catch {
        return [key, { status: "unavailable" }] as const;
      }
    }),
  );

  let exercise: TodayExerciseCardState;
  try {
    exercise = mapExerciseSnapshot(getManualExerciseSnapshot(database.sqlite, {
      businessDate,
      historyLimit: 1,
    }));
  } catch {
    exercise = { status: "unavailable" };
  }

  return {
    ...Object.fromEntries(entries),
    exercise,
  } as TodayDashboardStateMap<TReaders>;
}
