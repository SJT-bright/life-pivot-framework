function toMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours! * 60 + minutes!;
}

export function calculateSleepMinutes(asleepTime: string, wakeTime: string): number {
  const asleep = toMinutes(asleepTime);
  const wake = toMinutes(wakeTime);
  return wake >= asleep ? wake - asleep : 1440 - asleep + wake;
}
