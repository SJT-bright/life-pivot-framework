"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, type ReactNode } from "react";

import { BackToTop } from "./back-to-top";
import { CommandPalette } from "./command-palette";
import { DraftPersistence } from "./draft-persistence";
import { PrimaryNav } from "./primary-nav";
import { ThemeToggle } from "./theme-toggle";

type AppSurface =
  | "today"
  | "goals"
  | "knowledge"
  | "wisdom"
  | "reading"
  | "exercise"
  | "sleep"
  | "skincare"
  | "health"
  | "daily-review"
  | "review-map"
  | "weekly-review"
  | "stats"
  | "settings";

function getAppSurface(pathname: string): AppSurface {
  if (pathname === "/" || pathname.startsWith("/today")) return "today";
  if (pathname.startsWith("/goals")) return "goals";
  if (pathname.startsWith("/knowledge")) return "knowledge";
  if (pathname.startsWith("/wisdom")) return "wisdom";
  if (pathname.startsWith("/reading")) return "reading";
  if (pathname.startsWith("/exercise")) return "exercise";
  if (pathname.startsWith("/sleep")) return "sleep";
  if (pathname.startsWith("/skincare")) return "skincare";
  if (pathname.startsWith("/health")) return "health";
  if (pathname.startsWith("/daily-review")) return "daily-review";
  if (pathname.startsWith("/review-map")) return "review-map";
  if (pathname.startsWith("/review")) return "weekly-review";
  if (pathname.startsWith("/stats")) return "stats";
  if (pathname.startsWith("/settings")) return "settings";
  return "today";
}

function PageMemory({ pathname }: {pathname: string}) {
  const searchParams = useSearchParams();
  const locationSearch = searchParams.toString();
  useEffect(() => {
    if (pathname === "/companion") return;
    window.lifePivotDesktop?.rememberMainLocation(pathname, locationSearch ? `?${locationSearch}` : "");
  }, [pathname, locationSearch]);
  return <DraftPersistence pathname={pathname} search={locationSearch} />;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/today";
  if (pathname === "/companion") {
    return <div className="app-shell companion-shell">{children}</div>;
  }
  const surface = getAppSurface(pathname);
  return (
    <div className="app-shell" data-surface={surface}>
      <ThemeToggle />
      <div aria-hidden="true" className="surface-art" key={surface} />
      <div aria-hidden="true" className="surface-wash" />
      <header className="app-header">
        <div className="app-header-topline">
            <Link className="app-brand" href="/today" prefetch scroll={false}>个人积累库</Link>
          <nav aria-label="辅助导航" className="auxiliary-nav">
            <Link
              aria-current={pathname.startsWith("/settings") ? "page" : undefined}
              href="/settings/data"
              prefetch
              scroll={false}
            >
              数据与设置
            </Link>
            <Suspense fallback={<span className="draft-save-indicator">临时保存</span>}>
              <PageMemory pathname={pathname} />
            </Suspense>
            <CommandPalette />
          </nav>
        </div>
        <PrimaryNav />
      </header>
      {children}
      <BackToTop />
    </div>
  );
}
