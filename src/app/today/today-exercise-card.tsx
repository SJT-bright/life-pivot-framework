import { TodayCard } from "./today-card";

export type TodayExerciseTrainingStatus =
  | "not-started"
  | "in-progress"
  | "partial"
  | "completed"
  | "skipped";

export type TodayExerciseTimerStatus =
  | "idle"
  | "running"
  | "paused"
  | "finished";

export interface TodayExerciseCardData {
  businessDate: string;
  currentDayName: string;
  bodyPart: string;
  isRest: boolean;
  trainingStatus: TodayExerciseTrainingStatus;
  completedActions: number;
  totalActions: number;
  timerStatus: TodayExerciseTimerStatus;
  calculatedMinutes: number;
  confirmedMinutes: number | null;
  creatineTaken: boolean | null;
  proteinPowderTaken: boolean | null;
}

export type TodayExerciseCardState =
  | { status: "unavailable" }
  | { status: "ready"; data: TodayExerciseCardData };

export interface TodayExerciseCardProps {
  state: TodayExerciseCardState;
}

const trainingStatusLabels: Record<TodayExerciseTrainingStatus, string> = {
  "not-started": "未开始",
  "in-progress": "进行中",
  partial: "部分完成",
  completed: "已完成",
  skipped: "已跳过",
};

const timerStatusLabels: Record<Exclude<TodayExerciseTimerStatus, "finished">, string> = {
  idle: "尚未开始",
  running: "进行中",
  paused: "已暂停",
};

function supplementLabel(value: boolean | null): string {
  if (value === true) return "已摄入";
  if (value === false) return "未摄入";
  return "未记录";
}

function detailLabel(data: TodayExerciseCardData): string {
  if (data.isRest) return "查看休息日";
  if (data.trainingStatus === "not-started") return "开始训练";
  if (data.trainingStatus === "in-progress" || data.trainingStatus === "partial") {
    return "继续训练";
  }
  return "查看训练记录";
}

function timerCopy(data: TodayExerciseCardData): string {
  if (data.timerStatus === "finished") {
    const minutes = data.confirmedMinutes ?? data.calculatedMinutes;
    const confirmation = data.confirmedMinutes === null ? "" : "（已确认）";
    return `最终时长：${minutes} 分钟${confirmation}`;
  }

  return `计时：${timerStatusLabels[data.timerStatus]} · ${data.calculatedMinutes} 分钟`;
}

export function TodayExerciseCard({ state }: TodayExerciseCardProps) {
  const data = state.status === "ready" ? state.data : null;

  return (
    <TodayCard<TodayExerciseCardData>
      className="today-domain-card"
      detailHref={data ? `/exercise?date=${encodeURIComponent(data.businessDate)}` : "/exercise/template"}
      detailLabel={data ? detailLabel(data) : undefined}
      state={state}
      title="今日运动"
      unavailableHref="/exercise/template"
      unavailableLabel="去建立训练日模板"
      unavailableMessage="还没有训练计划；建立模板后每天会自动出现当天的训练。"
    >
      {(exercise) => (
        <>
          <p className="today-domain-card-summary">
            当前训练日：{exercise.currentDayName} · {exercise.isRest ? "休息日" : exercise.bodyPart}
          </p>
          <p>训练状态：{trainingStatusLabels[exercise.trainingStatus]}</p>
          <p>
            动作进度：{exercise.isRest
              ? "休息日，无训练动作"
              : `${exercise.completedActions} / ${exercise.totalActions}`}
          </p>
          <p>{timerCopy(exercise)}</p>
          <details>
            <summary>补剂记录</summary>
            <p>肌酸：{supplementLabel(exercise.creatineTaken)}</p>
            <p>蛋白粉：{supplementLabel(exercise.proteinPowderTaken)}</p>
          </details>
        </>
      )}
    </TodayCard>
  );
}
