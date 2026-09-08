/**
 * 把分钟数格式化成「X 小时 Y 分钟」的人类读法。
 * 全应用展示时长一律使用这个格式，不直接展示纯分钟数。
 */
export function formatHoursMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return "—";
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} 分钟`;
  if (rest === 0) return `${hours} 小时`;
  return `${hours} 小时 ${rest} 分钟`;
}

/**
 * 把分钟数拆成 [小时, 分钟]，供「小时 + 分钟」双输入框使用。
 */
export function splitHoursMinutes(minutes: number | null | undefined): [string, string] {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes < 0) {
    return ["", ""];
  }
  const total = Math.round(minutes);
  return [String(Math.floor(total / 60)), String(total % 60)];
}

/**
 * 把「小时 + 分钟」两个输入合并成分钟数；两者都为空时返回 null。
 * 允许只填其中一个（缺省按 0 处理），非法或超范围返回 undefined。
 */
export function joinHoursMinutes(hours: string, minutes: string): number | null | undefined {
  const hoursEmpty = hours.trim() === "";
  const minutesEmpty = minutes.trim() === "";
  if (hoursEmpty && minutesEmpty) return null;
  const hoursValue = hoursEmpty ? 0 : Number(hours);
  const minutesValue = minutesEmpty ? 0 : Number(minutes);
  if (!Number.isInteger(hoursValue) || !Number.isInteger(minutesValue)) return undefined;
  if (hoursValue < 0 || hoursValue > 23 || minutesValue < 0 || minutesValue > 59) return undefined;
  return hoursValue * 60 + minutesValue;
}
