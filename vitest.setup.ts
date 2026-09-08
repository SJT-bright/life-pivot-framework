// vitest 的 jsdom 环境不会把 localStorage/sessionStorage 拷到全局
// （jsdom 把它们放在原型 getter 上），而 Node 26 的实验性 localStorage
// 又需要 --localstorage-file 才可用。这里提供一个行为一致的内存实现。
class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();

  get length(): number {
    return this.#values.size;
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, String(value));
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }

  clear(): void {
    this.#values.clear();
  }
}

for (const name of ["localStorage", "sessionStorage"] as const) {
  Object.defineProperty(globalThis, name, {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}
