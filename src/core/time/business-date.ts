const shanghaiDate = new Intl.DateTimeFormat("en", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const SHANGHAI_OFFSET_MILLISECONDS = 8 * 60 * 60 * 1000;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
export const HEALTH_CHECKLIST_ROLLOVER_HOUR = 7;

export function isBusinessDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function toShanghaiBusinessDate(date: Date): string {
  const parts = shanghaiDate.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("无法计算记录日期");
  }

  return `${year}-${month}-${day}`;
}

/**
 * 健康清单以早上 07:00（Asia/Shanghai）作为一天的边界。
 * 例如 8 月 30 日 06:59 仍属于 8 月 29 日的清单；07:00 才生成新清单。
 */
export function toHealthChecklistBusinessDate(date: Date): string {
  const shifted = new Date(
    date.getTime() + SHANGHAI_OFFSET_MILLISECONDS -
      HEALTH_CHECKLIST_ROLLOVER_HOUR * 60 * 60 * 1000,
  );
  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/** 返回距离下一次上海时间 07:00 的毫秒数，供页面安排无漂移换日。 */
export function millisecondsUntilHealthChecklistRollover(date: Date): number {
  const shanghaiNow = new Date(date.getTime() + SHANGHAI_OFFSET_MILLISECONDS);
  let target = Date.UTC(
    shanghaiNow.getUTCFullYear(),
    shanghaiNow.getUTCMonth(),
    shanghaiNow.getUTCDate(),
    HEALTH_CHECKLIST_ROLLOVER_HOUR,
  );
  if (target <= shanghaiNow.getTime()) target += DAY_MILLISECONDS;
  return target - shanghaiNow.getTime();
}
