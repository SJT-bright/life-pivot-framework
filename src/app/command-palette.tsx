"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { toShanghaiBusinessDate } from "@/core/time/business-date";
import { PRIMARY_NAV_ITEMS } from "./navigation";

interface SearchHit {
  type: string;
  id: string;
  title: string;
  snippet: string;
  businessDate: string | null;
  href: string;
}

interface PaletteItem {
  key: string;
  label: string;
  hint: string;
  href: string;
}

const TYPE_LABELS: Record<string, string> = {
  capture: "随手记",
  learning: "学习",
  review: "复盘",
  reading: "读书",
  reminder: "提醒",
  goal: "目标",
  action: "行动",
  health: "健康清单",
};

const CLOSE_KEYS = new Set(["Escape", "Esc"]);

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const trimmed = query.trim();

  const navItems: PaletteItem[] = PRIMARY_NAV_ITEMS.filter((item) => {
    if (!trimmed) return true;
    return item.label.includes(trimmed) || item.href.includes(trimmed.toLowerCase());
  }).map((item) => ({
    key: `nav:${item.href}`,
    label: item.label,
    hint: "打开页面",
    href: item.href,
  }));

  const hitItems: PaletteItem[] = hits.map((hit) => ({
    key: `hit:${hit.type}:${hit.id}`,
    label: hit.title,
    hint: `${TYPE_LABELS[hit.type] ?? hit.type}${hit.businessDate ? ` · ${hit.businessDate}` : ""}`,
    href: hit.href,
  }));

  const items = [...hitItems, ...navItems];

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setHits([]);
    setActiveIndex(0);
    setSaveState("idle");
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && (event.key === "k" || event.key === "K")) {
        event.preventDefault();
        setOpen((current) => !current);
        return;
      }
      if (!open) return;
      if (CLOSE_KEYS.has(event.key)) {
        event.preventDefault();
        close();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, open]);

  useEffect(() => {
    if (open) {
      const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(focusTimer);
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    if (!trimmed) {
      setHits([]);
      setSearching(false);
      return () => controller.abort();
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      fetch(`/api/v1/search?q=${encodeURIComponent(trimmed)}`, {
        signal: controller.signal,
        cache: "no-store",
      })
        .then((response) => (response.ok ? response.json() : { hits: [] }))
        .then((result: { hits?: SearchHit[] }) => {
          setHits(result.hits ?? []);
          setActiveIndex(0);
        })
        .catch(() => undefined)
        .finally(() => setSearching(false));
    }, 200);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, trimmed]);

  useEffect(() => {
    setActiveIndex(0);
  }, [trimmed]);

  function activate(item: PaletteItem | undefined) {
    if (!item) return;
    close();
    router.push(item.href, { scroll: false });
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, items.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      activate(items[activeIndex]);
    }
  }

  async function quickCapture() {
    if (!trimmed || saveState === "saving") return;
    setSaveState("saving");
    try {
      const response = await fetch("/api/v1/today/sections", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `palette-capture-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          section: "entry",
          draftId: `palette-${crypto.randomUUID()}`,
          businessDate: toShanghaiBusinessDate(new Date()),
          occurredAt: new Date().toISOString(),
          value: { text: trimmed },
        }),
      });
      if (!response.ok) throw new Error();
      setSaveState("saved");
      setQuery("");
      setHits([]);
      window.setTimeout(() => {
        setSaveState("idle");
      }, 1500);
    } catch {
      setSaveState("failed");
    }
  }

  if (!open) {
    return (
      <button
        aria-label="打开搜索与快速跳转（Cmd+K）"
        className="command-palette-trigger"
        onClick={() => setOpen(true)}
        type="button"
      >
        搜索
        <kbd aria-hidden="true">⌘K</kbd>
      </button>
    );
  }

  return (
    <div
      aria-hidden={false}
      className="command-palette-backdrop"
      onClick={(event) => {
        if (!dialogRef.current?.contains(event.target as Node)) close();
      }}
      onKeyDown={onKeyDown}
    >
      <div
        aria-label="搜索与快速跳转"
        aria-modal="true"
        className="command-palette"
        ref={dialogRef}
        role="dialog"
      >
        <input
          aria-label="搜索或写下要记的事"
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索随手记、学习、复盘、读书……或直接输入后按下方按钮记录"
          ref={inputRef}
          value={query}
        />
        <ul aria-label="结果" className="command-palette-list" role="listbox">
          {searching ? <li aria-live="polite" className="command-palette-note">搜索中…</li> : null}
          {!searching && trimmed && hitItems.length === 0 ? (
            <li className="command-palette-note">没有匹配的记录；可以按下面按钮把这句话记到今天。</li>
          ) : null}
          {items.map((item, index) => (
            <li
              aria-selected={index === activeIndex}
              className={index === activeIndex ? "is-active" : undefined}
              key={item.key}
              onClick={() => activate(item)}
              onMouseEnter={() => setActiveIndex(index)}
              role="option"
              tabIndex={-1}
            >
              <span className="command-item-label">{item.label}</span>
              <span className="command-item-hint">{item.hint}</span>
            </li>
          ))}
        </ul>
        <div className="command-palette-footer">
          <button
            disabled={!trimmed || saveState === "saving"}
            onClick={() => void quickCapture()}
            type="button"
          >
            {saveState === "saving"
              ? "正在记录"
              : saveState === "saved"
                ? "已记到今天 ✓"
                : saveState === "failed"
                  ? "记录失败，请重试"
                  : "把这句话记到今天"}
          </button>
          <span className="command-palette-tip">↑↓ 选择 · Enter 打开 · Esc 关闭</span>
          <button onClick={close} type="button">关闭</button>
        </div>
      </div>
    </div>
  );
}
