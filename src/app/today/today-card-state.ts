export type TodayCardState<T> =
  | { status: "ready"; data: T }
  | { status: "unavailable" };
