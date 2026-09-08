"use client";

import { useEffect, useState } from "react";

export interface ResolvedSubmissionStorage {
  /** False during SSR and the matching client hydration frame. */
  readonly ready: boolean;
  readonly storage: Storage | null;
}

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Keeps implicit browser storage out of render. The server and the first
 * client render therefore share the same read-only state; local recovery is
 * resolved only after hydration.
 */
export function useResolvedSubmissionStorage(
  providedStorage: Storage | null | undefined,
): ResolvedSubmissionStorage {
  const [browserState, setBrowserState] = useState<ResolvedSubmissionStorage>({
    ready: false,
    storage: null,
  });

  useEffect(() => {
    if (providedStorage !== undefined) return;
    setBrowserState({ ready: true, storage: browserStorage() });
  }, [providedStorage]);

  return providedStorage === undefined
    ? browserState
    : { ready: true, storage: providedStorage };
}
