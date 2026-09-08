"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { PRIMARY_NAV_ITEMS } from "./navigation";

function isCurrentPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PrimaryNav() {
  const pathname = usePathname() ?? "/today";
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const current = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!current || typeof current.scrollIntoView !== "function") return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    current.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [pathname]);

  return (
    <nav aria-label="主要导航" className="primary-nav" ref={navRef}>
      <ul>
        {PRIMARY_NAV_ITEMS.map((item) => {
          const current = isCurrentPath(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                aria-current={current ? "page" : undefined}
                href={item.href}
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
