/**
 * 本机草稿暂存：表单内容在停顿后写入 localStorage，页面切换或刷新后可恢复；
 * 保存成功后由调用方清除。所有 keys 都带固定前缀，避免和其他本机数据混淆。
 */
const DRAFT_PREFIX = "page-draft:";

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readLocalDraft<T>(key: string): T | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(DRAFT_PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeLocalDraft(key: string, value: unknown): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(DRAFT_PREFIX + key, JSON.stringify(value));
  } catch {
    // 本机存储不可用时静默跳过。
  }
}

export function clearLocalDraft(key: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(DRAFT_PREFIX + key);
  } catch {
    // 忽略本机存储异常。
  }
}

/**
 * 在输入停顿后写入草稿；返回清除定时器的函数。
 * 所有文本字段的值都必须是 string，读取方负责校验。
 */
export function scheduleDraftWrite(key: string, value: unknown, delayMs = 500): () => void {
  const timer = window.setTimeout(() => writeLocalDraft(key, value), delayMs);
  return () => window.clearTimeout(timer);
}
