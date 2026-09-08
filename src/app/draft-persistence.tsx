"use client";

import { useEffect, useState } from "react";

type DraftControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

interface StoredField {
  readonly kind: "value" | "checked";
  readonly value: string | boolean;
}

interface DraftEnvelope {
  readonly version: 1;
  readonly savedAt: string;
  readonly fields: Readonly<Record<string, StoredField>>;
}

const STORAGE_PREFIX = "life-pivot:page-draft:v1:";
const MAX_FIELD_LENGTH = 50_000;
const MAX_DRAFT_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const CONTROL_SELECTOR = "input, textarea, select";

function normalizeSearch(raw: string | undefined): string {
  if (!raw) return "";
  const clean = raw.startsWith("?") ? raw.slice(1) : raw;
  const normalized = new URLSearchParams(clean);
  normalized.sort();
  return normalized.toString();
}

function storageKey(pathname: string, search: string | undefined): string {
  const normalizedSearch = normalizeSearch(search);
  return `${STORAGE_PREFIX}${pathname}${normalizedSearch ? `?${normalizedSearch}` : ""}`;
}

function eligible(control: Element): control is DraftControl {
  if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)) return false;
  if (control.closest('[data-draft-ignore="true"]')) return false;
  if (control instanceof HTMLInputElement) {
    return !["button", "file", "hidden", "image", "password", "reset", "submit"].includes(control.type);
  }
  return true;
}

function controls(): DraftControl[] {
  return Array.from(document.querySelectorAll(CONTROL_SELECTOR)).filter(eligible);
}

function baseIdentity(control: DraftControl): string {
  const type = control instanceof HTMLInputElement ? control.type : control.tagName.toLowerCase();
  const stable = control.dataset.draftKey
    ?? control.id
    ?? control.getAttribute("name")
    ?? control.getAttribute("aria-label")
    ?? control.getAttribute("placeholder")
    ?? "field";
  return `${control.tagName.toLowerCase()}:${type}:${stable}`;
}

function controlIdentity(control: DraftControl, pageControls: readonly DraftControl[]): string {
  const base = baseIdentity(control);
  let occurrence = 0;
  for (const candidate of pageControls) {
    if (candidate === control) break;
    if (baseIdentity(candidate) === base) occurrence += 1;
  }
  return `${base}#${occurrence}`;
}

function readField(control: DraftControl): StoredField {
  if (control instanceof HTMLInputElement && (control.type === "checkbox" || control.type === "radio")) {
    return { kind: "checked", value: control.checked };
  }
  return { kind: "value", value: control.value.slice(0, MAX_FIELD_LENGTH) };
}

function applyField(control: DraftControl, field: StoredField): void {
  if (field.kind === "checked" && control instanceof HTMLInputElement && typeof field.value === "boolean") {
    if (control.checked !== field.value) control.click();
    return;
  }
  if (field.kind !== "value" || typeof field.value !== "string") return;
  const prototype = control instanceof HTMLInputElement
    ? HTMLInputElement.prototype
    : control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLSelectElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(control, field.value);
  control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

function decodeEnvelope(raw: string | null): DraftEnvelope | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<DraftEnvelope>;
    if (value.version !== 1 || typeof value.savedAt !== "string" || !value.fields || typeof value.fields !== "object") return null;
    const savedAt = Date.parse(value.savedAt);
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > MAX_DRAFT_AGE_MS) return null;
    return value as DraftEnvelope;
  } catch {
    return null;
  }
}

export function DraftPersistence({
  pathname,
  search,
  storage: providedStorage,
}: {
  readonly pathname: string;
  readonly search?: string;
  readonly storage?: DraftStorage | null;
}) {
  const [status, setStatus] = useState<"ready" | "saved" | "restored" | "unavailable">("ready");

  useEffect(() => {
    const storage = providedStorage === undefined ? window.localStorage : providedStorage;
    if (!storage) {
      setStatus("unavailable");
      return;
    }
    const key = storageKey(pathname, search);
    let restoring = true;
    let statusTimer: number | undefined;

    const showStatus = (next: "saved" | "restored") => {
      window.clearTimeout(statusTimer);
      setStatus(next);
      statusTimer = window.setTimeout(() => setStatus("ready"), 1800);
    };

    const readCurrent = (): DraftEnvelope => decodeEnvelope(storage.getItem(key)) ?? {
      version: 1,
      savedAt: new Date().toISOString(),
      fields: {},
    };

    const writeFields = (targets: readonly DraftControl[]) => {
      const pageControls = controls();
      const current = readCurrent();
      const fields: Record<string, StoredField> = { ...current.fields };
      for (const control of targets) fields[controlIdentity(control, pageControls)] = readField(control);
      storage.setItem(key, JSON.stringify({ version: 1, savedAt: new Date().toISOString(), fields } satisfies DraftEnvelope));
    };

    try {
      const pageControls = controls();
      const stored = decodeEnvelope(storage.getItem(key));
      if (!stored && storage.getItem(key)) storage.removeItem(key);
      if (stored) {
        let restoredCount = 0;
        for (const control of pageControls) {
          const field = stored.fields[controlIdentity(control, pageControls)];
          if (!field) continue;
          applyField(control, field);
          restoredCount += 1;
        }
        if (restoredCount > 0) showStatus("restored");
      }
    } catch {
      setStatus("unavailable");
      return;
    } finally {
      restoring = false;
    }

    const onFieldChange = (event: Event) => {
      const target = event.target;
      if (restoring || !(target instanceof Element) || !eligible(target)) return;
      try {
        writeFields([target]);
        showStatus("saved");
      } catch {
        setStatus("unavailable");
      }
    };

    const onSubmit = (event: Event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      window.setTimeout(() => {
        if (!form.isConnected) return;
        try {
          writeFields(Array.from(form.querySelectorAll(CONTROL_SELECTOR)).filter(eligible));
        } catch {
          setStatus("unavailable");
        }
      }, 600);
    };

    document.addEventListener("input", onFieldChange, true);
    document.addEventListener("change", onFieldChange, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      window.clearTimeout(statusTimer);
      document.removeEventListener("input", onFieldChange, true);
      document.removeEventListener("change", onFieldChange, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, [pathname, search, providedStorage]);

  const label = {
    ready: "临时保存已开启",
    saved: "草稿已保存",
    restored: "已恢复本页草稿",
    unavailable: "临时保存不可用",
  }[status];

  return <span aria-live="polite" className="draft-save-indicator" data-state={status}>{label}</span>;
}
