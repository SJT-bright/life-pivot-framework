import Link from "next/link";
import type { ReactNode } from "react";

import type { TodayCardState } from "./today-card-state";

interface TodayCardProps<T> {
  children: (data: T) => ReactNode;
  className?: string;
  detailHref?: string;
  detailLabel?: string;
  state: TodayCardState<T>;
  title: string;
  unavailableHref?: string;
  unavailableLabel?: string;
  unavailableMessage?: string;
}

export function TodayCard<T>({
  children,
  className,
  detailHref,
  detailLabel,
  state,
  title,
  unavailableHref,
  unavailableLabel,
  unavailableMessage = "暂时无法读取",
}: TodayCardProps<T>) {
  const classes = ["today-card", className].filter(Boolean).join(" ");
  const unavailableLinkHref = detailHref ?? unavailableHref;
  const unavailableLinkLabel = detailLabel ?? unavailableLabel;

  return (
    <section aria-label={title} className={classes}>
      <header className="today-card-heading">
        <h2>{title}</h2>
        {state.status === "ready" && detailHref && detailLabel
          ? <Link href={detailHref}>{detailLabel}</Link>
          : null}
      </header>
      {state.status === "ready" ? children(state.data) : (
        <div className="today-card-unavailable" role="status">
          <p>{unavailableMessage}</p>
          {unavailableLinkHref && unavailableLinkLabel
            ? <Link href={unavailableLinkHref}>{unavailableLinkLabel}</Link>
            : null}
        </div>
      )}
    </section>
  );
}
