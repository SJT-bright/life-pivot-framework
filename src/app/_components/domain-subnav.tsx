import Link from "next/link";

import styles from "./domain-subnav.module.css";

export interface DomainSubnavItem {
  readonly key: string;
  readonly label: string;
  readonly href: string;
}

export interface DomainSubnavProps {
  readonly label: string;
  readonly activeKey: string;
  readonly date?: string;
  readonly items: readonly DomainSubnavItem[];
}

function withDate(href: string, date: string | undefined): string {
  if (!date) return href;
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}date=${encodeURIComponent(date)}`;
}

/**
 * Stable route-level navigation for a domain workspace.
 *
 * The active item is supplied by the server route instead of inferred from
 * client state, so a refresh and a direct shared URL render the same state.
 */
export function DomainSubnav({ label, activeKey, date, items }: DomainSubnavProps) {
  return (
    <nav aria-label={`${label}分区`} className={styles.nav}>
      <ul>
        {items.map((item) => {
          const active = item.key === activeKey;
          return (
            <li key={item.key}>
              <Link
                aria-current={active ? "page" : undefined}
                className={active ? styles.activeLink : styles.link}
                href={withDate(item.href, date)}
                prefetch
                scroll={false}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
