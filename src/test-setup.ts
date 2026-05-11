import "@testing-library/jest-dom"

// Vitest 4 with jsdom no longer wires a writable localStorage, but our
// zustand store uses persist middleware that initializes storage at
// module load. Shim before any module imports the store.
if (typeof localStorage === "undefined" || typeof localStorage.setItem !== "function") {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
      key: (i: number) => Array.from(mem.keys())[i] ?? null,
      get length() { return mem.size },
    },
  })
}
