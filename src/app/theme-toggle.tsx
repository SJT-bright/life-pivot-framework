"use client";

import { useLayoutEffect } from "react";

import {
  THEME_STORAGE_KEY,
  isColorTheme,
  type ColorTheme,
} from "./theme";

const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

function readStoredTheme(): ColorTheme | null {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isColorTheme(stored) ? stored : null;
  } catch {
    return null;
  }
}

function readSystemTheme(): ColorTheme {
  return typeof window.matchMedia === "function" && window.matchMedia(DARK_MEDIA_QUERY).matches
    ? "dark"
    : "light";
}

function applyTheme(theme: ColorTheme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

function currentTheme(): ColorTheme {
  const active = document.documentElement.dataset.theme;
  return isColorTheme(active) ? active : (readStoredTheme() ?? readSystemTheme());
}

function SunIcon() {
  return (
    <svg aria-hidden="true" className="theme-toggle-sun" focusable="false" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="3.35" />
      <path d="M12 2.2v2.15M12 19.65v2.15M2.2 12h2.15M19.65 12h2.15M5.07 5.07l1.52 1.52M17.41 17.41l1.52 1.52M18.93 5.07l-1.52 1.52M6.59 17.41l-1.52 1.52" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg aria-hidden="true" className="theme-toggle-moon" focusable="false" viewBox="0 0 24 24">
      <path d="M18.92 15.24A7.55 7.55 0 0 1 8.76 5.08a7.57 7.57 0 1 0 10.16 10.16Z" />
      <path className="theme-toggle-moon-glint" d="M16.85 5.05v2.1M15.8 6.1h2.1" />
    </svg>
  );
}

export function ThemeToggle() {
  useLayoutEffect(() => {
    applyTheme(readStoredTheme() ?? readSystemTheme());

    const media = typeof window.matchMedia === "function"
      ? window.matchMedia(DARK_MEDIA_QUERY)
      : null;
    const handleSystemChange = (event: MediaQueryListEvent) => {
      if (readStoredTheme() === null) applyTheme(event.matches ? "dark" : "light");
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      applyTheme(isColorTheme(event.newValue) ? event.newValue : readSystemTheme());
    };

    media?.addEventListener("change", handleSystemChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      media?.removeEventListener("change", handleSystemChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  function toggleTheme(): void {
    const next = currentTheme() === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // The visual theme still changes when private storage is unavailable.
    }
  }

  return (
    <button
      aria-label="切换昼夜主题"
      className="theme-toggle"
      onClick={toggleTheme}
      title="切换浅色与深色外观"
      type="button"
    >
      <span aria-hidden="true" className="theme-toggle-track">
        <span className="theme-toggle-thumb" />
        <SunIcon />
        <MoonIcon />
      </span>
    </button>
  );
}
