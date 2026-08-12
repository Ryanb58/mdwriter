import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  createScopedPersistStorage,
  LEGACY_STORE_KEY,
  MAX_REMEMBERED_WINDOWS,
  SHARED_PREFIX,
  WINDOW_PREFIX,
  windowScopedKey,
  type StorageLike,
} from "../persistStorage"
import { LAYOUT_WIDTHS_KEY, LAYOUT_WINDOW_KEYS } from "../../layout/panelStorage"
import {
  DEFAULT_SETTINGS,
  MAX_RECENT_FILES,
  PERSIST_NORMALIZERS,
  PERSIST_RESOLVERS,
  PERSIST_SCOPES,
  PERSIST_WINDOW_LABEL,
  legacyPersistedSlice,
  persistedStorageForTests,
  syncSharedPersistedState,
  useStore,
  type PersistedSlice,
} from "../store"

/**
 * Every mdwriter window is a webview on one origin, so they all read and write
 * the *same* localStorage. These tests model that literally: two scoped storage
 * realms — window A and window B — over one shared backing map, which is the
 * only setup that can catch one window discarding another's persisted change.
 */
function sharedBacking() {
  const map = new Map<string, string>()
  const storage: StorageLike & { writes: number; map: Map<string, string> } = {
    map,
    writes: 0,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.writes += 1
      map.set(key, value)
    },
    removeItem: (key: string) => void map.delete(key),
  }
  return storage
}

/**
 * A window: its own storage realm over the shared backing store. Configured
 * exactly like the real one — normalizers included, since a realm that skips
 * them is precisely the realm that cannot reproduce the ancestor bug.
 */
function windowRealm(label: string, storage: StorageLike, onMergedWrite = () => {}) {
  return createScopedPersistStorage<PersistedSlice>({
    scopes: PERSIST_SCOPES,
    resolvers: PERSIST_RESOLVERS,
    normalizers: PERSIST_NORMALIZERS,
    windowLabel: label,
    storage,
    extraWindowKeys: LAYOUT_WINDOW_KEYS,
    migrateLegacy: legacyPersistedSlice,
    onMergedWrite,
  })
}

const baseSlice = (over: Partial<PersistedSlice> = {}): PersistedSlice => ({
  settings: DEFAULT_SETTINGS,
  rightPaneTab: "properties",
  aiAgent: "claude-code",
  aiPermissionMode: "accept-edits",
  pinnedPaths: [],
  recentFilesByVault: {},
  ...over,
})

function readShared<K extends keyof PersistedSlice>(
  storage: StorageLike,
  key: K,
): PersistedSlice[K] | null {
  const raw = storage.getItem(`${SHARED_PREFIX}${key}`)
  return raw === null ? null : (JSON.parse(raw) as PersistedSlice[K])
}

describe("persisted key scoping", () => {
  it("keeps per-window UI state out of the app-global scope", () => {
    // If a key is mis-scoped, either it leaks between windows or it silently
    // stops following the user across windows. Pin the classification down.
    expect(PERSIST_SCOPES).toEqual({
      settings: "shared",
      aiAgent: "shared",
      aiPermissionMode: "shared",
      pinnedPaths: "shared",
      recentFilesByVault: "shared",
      rightPaneTab: "window",
    })
  })
})

describe("two windows over one localStorage", () => {
  it("does not rewrite untouched entries (the keystroke case)", () => {
    const storage = sharedBacking()
    const a = windowRealm("w-a", storage)
    a.setItem("mdwriter", { state: baseSlice(), version: 0 })
    const writesAfterFirst = storage.writes

    // zustand's persist calls setItem on *every* setState, including ones that
    // touch nothing persisted — typing a character in the editor, for example.
    for (let i = 0; i < 20; i += 1) {
      a.setItem("mdwriter", { state: baseSlice(), version: 0 })
    }

    expect(storage.writes).toBe(writesAfterFirst)
  })

  it("keeps window A's setting when window B saves its own stale slice", () => {
    const storage = sharedBacking()
    const a = windowRealm("w-a", storage)
    const b = windowRealm("w-b", storage)
    a.setItem("mdwriter", { state: baseSlice(), version: 0 })
    // Both windows have read the same starting point.
    a.getItem("mdwriter")
    b.getItem("mdwriter")

    // A turns the theme dark.
    a.setItem("mdwriter", {
      state: baseSlice({ settings: { ...DEFAULT_SETTINGS, theme: "dark" } }),
      version: 0,
    })
    // B's user types a character: persist rewrites B's whole slice, which still
    // has the old theme. This is the exact sequence that used to lose A's edit.
    b.setItem("mdwriter", { state: baseSlice(), version: 0 })

    expect(readShared(storage, "settings")?.theme).toBe("dark")
  })

  it("keeps a scalar entry window A changed, which has no field-level merge", () => {
    // aiAgent/aiPermissionMode are opaque values — there is nothing to merge,
    // so the only thing protecting them is B noticing it never changed its own.
    const storage = sharedBacking()
    const a = windowRealm("w-a", storage)
    const b = windowRealm("w-b", storage)
    a.setItem("mdwriter", { state: baseSlice(), version: 0 })
    a.getItem("mdwriter")
    b.getItem("mdwriter")

    a.setItem("mdwriter", { state: baseSlice({ aiPermissionMode: "plan" }), version: 0 })
    // B changes something else entirely; persist rewrites every entry.
    b.setItem("mdwriter", { state: baseSlice({ pinnedPaths: ["/vault/note.md"] }), version: 0 })

    expect(readShared(storage, "aiPermissionMode")).toBe("plan")
    expect(readShared(storage, "pinnedPaths")).toEqual(["/vault/note.md"])
  })

  it("defers to the window that has an entry this one never saw", () => {
    const storage = sharedBacking()
    const b = windowRealm("w-b", storage)
    // B starts with empty storage, so it has no baseline for any entry.
    b.getItem("mdwriter")
    // A writes before B does.
    windowRealm("w-a", storage).setItem("mdwriter", {
      state: baseSlice({ aiAgent: "codex" }),
      version: 0,
    })

    b.setItem("mdwriter", { state: baseSlice(), version: 0 })

    expect(readShared(storage, "aiAgent")).toBe("codex")
  })

  it("merges concurrent edits to different fields of the same entry", () => {
    const storage = sharedBacking()
    const merged = vi.fn()
    const a = windowRealm("w-a", storage)
    const b = windowRealm("w-b", storage, merged)
    a.setItem("mdwriter", { state: baseSlice(), version: 0 })
    a.getItem("mdwriter")
    b.getItem("mdwriter")

    a.setItem("mdwriter", {
      state: baseSlice({ settings: { ...DEFAULT_SETTINGS, theme: "dark" } }),
      version: 0,
    })
    // B never learned about A's write, and changes a different field.
    b.setItem("mdwriter", {
      state: baseSlice({ settings: { ...DEFAULT_SETTINGS, showPdfs: true } }),
      version: 0,
    })

    expect(readShared(storage, "settings")).toMatchObject({ theme: "dark", showPdfs: true })
    // B wrote more than it holds in memory, so it must be told to catch up.
    expect(merged).toHaveBeenCalled()
  })

  /**
   * The cases below all run *more than one* write from the window that is
   * behind. That is the whole point: a window recovers from a merge by
   * re-reading the shared entries, and that recovery is asynchronous
   * (`onMergedWrite` defers to a microtask), while real call sites mutate the
   * store several times in one synchronous task — creating a file expands a
   * folder, sets the pending cursor and sets the selection, and every one of
   * those makes zustand rewrite the whole slice. If the first write rebased
   * this window onto disk, the second one would look conflict-free and put the
   * stale in-memory value straight over the other window's change.
   */
  it("keeps window A's setting through a burst of writes from B, not just the first", () => {
    const storage = sharedBacking()
    const a = windowRealm("w-a", storage)
    const b = windowRealm("w-b", storage)
    a.setItem("mdwriter", { state: baseSlice(), version: 0 })
    a.getItem("mdwriter")
    b.getItem("mdwriter")

    a.setItem("mdwriter", {
      state: baseSlice({ settings: { ...DEFAULT_SETTINGS, theme: "dark" } }),
      version: 0,
    })
    // B never learns about it, and writes three times in the same task. Its
    // slice still carries the old theme every time.
    for (let i = 0; i < 3; i += 1) {
      b.setItem("mdwriter", { state: baseSlice({ pinnedPaths: [`/vault/${i}.md`] }), version: 0 })
    }

    expect(readShared(storage, "settings")?.theme).toBe("dark")
  })

  it("re-merges on every later write, not only the one that first saw the conflict", () => {
    const storage = sharedBacking()
    const a = windowRealm("w-a", storage)
    const b = windowRealm("w-b", storage)
    a.setItem("mdwriter", { state: baseSlice(), version: 0 })
    a.getItem("mdwriter")
    b.getItem("mdwriter")

    a.setItem("mdwriter", {
      state: baseSlice({ settings: { ...DEFAULT_SETTINGS, theme: "dark" } }),
      version: 0,
    })
    // B toggles a different field, then writes again before it has adopted the
    // merged result. The second write must merge against the same ancestor.
    const bSettings = { ...DEFAULT_SETTINGS, showPdfs: true }
    b.setItem("mdwriter", { state: baseSlice({ settings: bSettings }), version: 0 })
    b.setItem("mdwriter", { state: baseSlice({ settings: bSettings }), version: 0 })

    expect(readShared(storage, "settings")).toMatchObject({ theme: "dark", showPdfs: true })
  })

  it("keeps another window's recent files through a burst of writes", () => {
    // Losing an entry here loses a window's document on relaunch, so it has to
    // survive the repeat write as well as the first one.
    const storage = sharedBacking()
    const a = windowRealm("w-a", storage)
    const b = windowRealm("w-b", storage)
    a.setItem("mdwriter", { state: baseSlice(), version: 0 })
    a.getItem("mdwriter")
    b.getItem("mdwriter")

    a.setItem("mdwriter", {
      state: baseSlice({ recentFilesByVault: { "/vault-a": ["/vault-a/note.md"] } }),
      version: 0,
    })
    const bRecents = { "/vault-b": ["/vault-b/todo.md"] }
    b.setItem("mdwriter", { state: baseSlice({ recentFilesByVault: bRecents }), version: 0 })
    b.setItem("mdwriter", { state: baseSlice({ recentFilesByVault: bRecents }), version: 0 })

    expect(readShared(storage, "recentFilesByVault")).toEqual({
      "/vault-a": ["/vault-a/note.md"],
      "/vault-b": ["/vault-b/todo.md"],
    })
  })

  it("merges a change made by a window that hydrated before the entry existed", () => {
    // Fresh install: B has no ancestor for the entry at all. Its first write
    // carries the hydrated defaults, so deferring to A is right — but that
    // must not turn into "B may never contribute to this entry again".
    const storage = sharedBacking()
    const b = windowRealm("w-b", storage)
    b.getItem("mdwriter")
    windowRealm("w-a", storage).setItem("mdwriter", {
      state: baseSlice({ settings: { ...DEFAULT_SETTINGS, theme: "dark" } }),
      version: 0,
    })

    // B's post-hydration write: nothing of its own to contribute.
    b.setItem("mdwriter", { state: baseSlice(), version: 0 })
    // Then B's user changes a setting, still unaware of A's theme.
    b.setItem("mdwriter", {
      state: baseSlice({ settings: { ...DEFAULT_SETTINGS, showPdfs: true } }),
      version: 0,
    })

    expect(readShared(storage, "settings")).toMatchObject({ theme: "dark", showPdfs: true })
  })

  it("keeps each window's recent files when the windows hold different vaults", () => {
    // recentFilesByVault is what multi-window session restore reads back, so
    // losing an entry here loses a window's document on relaunch.
    const storage = sharedBacking()
    const a = windowRealm("w-a", storage)
    const b = windowRealm("w-b", storage)
    a.setItem("mdwriter", { state: baseSlice(), version: 0 })
    a.getItem("mdwriter")
    b.getItem("mdwriter")

    a.setItem("mdwriter", {
      state: baseSlice({ recentFilesByVault: { "/vault-a": ["/vault-a/note.md"] } }),
      version: 0,
    })
    b.setItem("mdwriter", {
      state: baseSlice({ recentFilesByVault: { "/vault-b": ["/vault-b/todo.md"] } }),
      version: 0,
    })

    expect(readShared(storage, "recentFilesByVault")).toEqual({
      "/vault-a": ["/vault-a/note.md"],
      "/vault-b": ["/vault-b/todo.md"],
    })
  })

  /**
   * Two windows on the *same* vault. S1.5 normally focuses the existing window
   * instead of opening a second one, but that check is best-effort —
   * `vaultWindow` swallows every lookup failure and returns null — so this state
   * is reachable, and it is the one case where the per-vault split in the
   * resolver does nothing: both windows are editing the same key.
   */
  describe("two windows on the same vault", () => {
    it("keeps the document A opened when B opens one of its own", () => {
      const storage = sharedBacking()
      const a = windowRealm("w-a", storage)
      const b = windowRealm("w-b", storage)
      const start = { "/v": ["/v/orig.md"] }
      a.setItem("mdwriter", { state: baseSlice({ recentFilesByVault: start }), version: 0 })
      a.getItem("mdwriter")
      b.getItem("mdwriter")

      // A opens a.md, pushing it onto the front of the vault's list.
      a.setItem("mdwriter", {
        state: baseSlice({ recentFilesByVault: { "/v": ["/v/a.md", "/v/orig.md"] } }),
        version: 0,
      })
      // B, which never learned about that, opens b.md on top of the list as it
      // loaded it. Resolving per vault key would take B's list wholesale and
      // a.md would be gone from disk for good — and since restore reads index 0,
      // window A would reopen *B's* document on relaunch.
      b.setItem("mdwriter", {
        state: baseSlice({ recentFilesByVault: { "/v": ["/v/b.md", "/v/orig.md"] } }),
        version: 0,
      })

      const onDisk = readShared(storage, "recentFilesByVault")
      expect(onDisk?.["/v"]).toContain("/v/a.md")
      // B wrote last and its open is the most recent event at that point, so it
      // leads; A's document keeps its place ahead of the shared history.
      expect(onDisk).toEqual({ "/v": ["/v/b.md", "/v/a.md", "/v/orig.md"] })
    })

    it("still leaves a vault it never opened entirely to the other window", () => {
      // The inner merge must not cost the cross-vault deferral that already
      // works: B has no business contributing to a vault it has never held.
      const storage = sharedBacking()
      const a = windowRealm("w-a", storage)
      const b = windowRealm("w-b", storage)
      a.setItem("mdwriter", {
        state: baseSlice({ recentFilesByVault: { "/v": ["/v/orig.md"] } }),
        version: 0,
      })
      a.getItem("mdwriter")
      b.getItem("mdwriter")

      a.setItem("mdwriter", {
        state: baseSlice({
          recentFilesByVault: { "/v": ["/v/a.md", "/v/orig.md"], "/other": ["/other/x.md"] },
        }),
        version: 0,
      })
      b.setItem("mdwriter", {
        state: baseSlice({ recentFilesByVault: { "/v": ["/v/b.md", "/v/orig.md"] } }),
        version: 0,
      })

      expect(readShared(storage, "recentFilesByVault")?.["/other"]).toEqual(["/other/x.md"])
    })

    it("honors a removal on one side while merging the other's open", () => {
      // Deleting a file drops it from the recency list. That removal has to
      // survive the merge, or the deleted path comes back and restore points at
      // a file that no longer exists.
      const storage = sharedBacking()
      const a = windowRealm("w-a", storage)
      const b = windowRealm("w-b", storage)
      const start = { "/v": ["/v/gone.md", "/v/orig.md"] }
      a.setItem("mdwriter", { state: baseSlice({ recentFilesByVault: start }), version: 0 })
      a.getItem("mdwriter")
      b.getItem("mdwriter")

      a.setItem("mdwriter", {
        state: baseSlice({ recentFilesByVault: { "/v": ["/v/a.md", "/v/gone.md", "/v/orig.md"] } }),
        version: 0,
      })
      // B deletes gone.md.
      b.setItem("mdwriter", {
        state: baseSlice({ recentFilesByVault: { "/v": ["/v/orig.md"] } }),
        version: 0,
      })

      expect(readShared(storage, "recentFilesByVault")).toEqual({ "/v": ["/v/a.md", "/v/orig.md"] })
    })

    it("re-merges on B's later writes instead of undoing the first merge", () => {
      // Same reason as the settings burst above: B's adoption of the merged
      // result is asynchronous, while real call sites write several times in one
      // synchronous task.
      const storage = sharedBacking()
      const a = windowRealm("w-a", storage)
      const b = windowRealm("w-b", storage)
      a.setItem("mdwriter", {
        state: baseSlice({ recentFilesByVault: { "/v": ["/v/orig.md"] } }),
        version: 0,
      })
      a.getItem("mdwriter")
      b.getItem("mdwriter")

      a.setItem("mdwriter", {
        state: baseSlice({ recentFilesByVault: { "/v": ["/v/a.md", "/v/orig.md"] } }),
        version: 0,
      })
      const bRecents = { "/v": ["/v/b.md", "/v/orig.md"] }
      for (let i = 0; i < 3; i += 1) {
        b.setItem("mdwriter", { state: baseSlice({ recentFilesByVault: bRecents }), version: 0 })
      }

      expect(readShared(storage, "recentFilesByVault")).toEqual({
        "/v": ["/v/b.md", "/v/a.md", "/v/orig.md"],
      })
    })

    it("caps the merged list at the same length a single window would keep", () => {
      const storage = sharedBacking()
      const a = windowRealm("w-a", storage)
      const b = windowRealm("w-b", storage)
      const full = Array.from({ length: MAX_RECENT_FILES }, (_, i) => `/v/${i}.md`)
      a.setItem("mdwriter", { state: baseSlice({ recentFilesByVault: { "/v": full } }), version: 0 })
      a.getItem("mdwriter")
      b.getItem("mdwriter")

      const open = (path: string) => [path, ...full.filter((p) => p !== path)].slice(0, MAX_RECENT_FILES)
      a.setItem("mdwriter", {
        state: baseSlice({ recentFilesByVault: { "/v": open("/v/a.md") } }),
        version: 0,
      })
      b.setItem("mdwriter", {
        state: baseSlice({ recentFilesByVault: { "/v": open("/v/b.md") } }),
        version: 0,
      })

      const merged = readShared(storage, "recentFilesByVault")?.["/v"] as string[]
      expect(merged).toHaveLength(MAX_RECENT_FILES)
      expect(merged.slice(0, 2)).toEqual(["/v/b.md", "/v/a.md"])
      // The stored list is already in the shape a window holds, so it is a valid
      // merge ancestor for whoever reads it next.
      expect(new Set(merged).size).toBe(merged.length)
    })
  })

  it("applies a pin from one window and an unpin from the other", () => {
    const storage = sharedBacking()
    const a = windowRealm("w-a", storage)
    const b = windowRealm("w-b", storage)
    a.setItem("mdwriter", { state: baseSlice({ pinnedPaths: ["/vault/old.md"] }), version: 0 })
    a.getItem("mdwriter")
    b.getItem("mdwriter")

    // A pins a new path; B unpins the one they both started with.
    a.setItem("mdwriter", {
      state: baseSlice({ pinnedPaths: ["/vault/old.md", "/vault/new.md"] }),
      version: 0,
    })
    b.setItem("mdwriter", { state: baseSlice({ pinnedPaths: [] }), version: 0 })

    expect(readShared(storage, "pinnedPaths")).toEqual(["/vault/new.md"])
  })

  it("gives each window its own right-pane tab", () => {
    const storage = sharedBacking()
    const a = windowRealm("w-a", storage)
    const b = windowRealm("w-b", storage)

    a.setItem("mdwriter", { state: baseSlice({ rightPaneTab: "ai" }), version: 0 })
    b.setItem("mdwriter", { state: baseSlice({ rightPaneTab: "properties" }), version: 0 })

    expect(storage.getItem(`${WINDOW_PREFIX}w-a:rightPaneTab`)).toBe('"ai"')
    expect(storage.getItem(`${WINDOW_PREFIX}w-b:rightPaneTab`)).toBe('"properties"')
    expect(a.getItem("mdwriter")?.state.rightPaneTab).toBe("ai")
    expect(b.getItem("mdwriter")?.state.rightPaneTab).toBe("properties")
    // Per-window state must not show up in the app-global re-read either.
    expect(a.readShared()).not.toHaveProperty("rightPaneTab")
  })

  it("hands app-global values to a window that opens later", () => {
    const storage = sharedBacking()
    const a = windowRealm("w-a", storage)
    a.setItem("mdwriter", {
      state: baseSlice({ settings: { ...DEFAULT_SETTINGS, hideGitignored: true } }),
      version: 0,
    })

    const late = windowRealm("w-late", storage)

    expect(late.getItem("mdwriter")?.state.settings.hideGitignored).toBe(true)
    // …but not the other window's per-window chrome.
    expect(late.getItem("mdwriter")?.state.rightPaneTab).toBeUndefined()
  })

  it("bounds per-window entries instead of leaking one per window ever opened", () => {
    // Runtime windows get randomly generated labels, so nothing else would ever
    // reclaim these entries.
    const storage = sharedBacking()
    const labels = Array.from({ length: MAX_REMEMBERED_WINDOWS + 3 }, (_, i) => `w-${i}`)
    for (const label of labels) {
      const realm = windowRealm(label, storage)
      realm.getItem("mdwriter")
      realm.setItem("mdwriter", { state: baseSlice({ rightPaneTab: "ai" }), version: 0 })
    }

    const windowEntries = [...storage.map.keys()].filter((k) => k.startsWith(WINDOW_PREFIX))
    expect(windowEntries).toHaveLength(MAX_REMEMBERED_WINDOWS)
    // The most recent windows are the ones kept.
    expect(windowEntries).toContain(`${WINDOW_PREFIX}${labels.at(-1)}:rightPaneTab`)
    expect(windowEntries).not.toContain(`${WINDOW_PREFIX}w-0:rightPaneTab`)
    // Shared state is untouched by the eviction.
    expect(readShared(storage, "settings")).toEqual(DEFAULT_SETTINGS)
  })

  it("migrates the pre-split blob once, then serves it from the scoped entries", () => {
    const storage = sharedBacking()
    storage.setItem(
      LEGACY_STORE_KEY,
      JSON.stringify({
        state: {
          settings: { theme: "dark" },
          pinnedPaths: ["/vault/pinned.md"],
          lastFileByVault: { "/vault": "/vault/note.md" },
          aiPanelVisible: true,
        },
        version: 0,
      }),
    )

    const a = windowRealm("w-a", storage)
    const restored = a.getItem("mdwriter")

    // Migrated in the shape the window holds, not verbatim — see the
    // older-shape cases above for why that difference is load-bearing.
    expect(restored?.state.settings).toEqual({ ...DEFAULT_SETTINGS, theme: "dark" })
    expect(restored?.state.pinnedPaths).toEqual(["/vault/pinned.md"])
    expect(restored?.state.recentFilesByVault).toEqual({ "/vault": ["/vault/note.md"] })
    expect(restored?.state.rightPaneTab).toBe("ai")
    expect(storage.getItem(LEGACY_STORE_KEY)).toBeNull()

    // A window that starts after the migration sees the same app-global values
    // even though A never changed anything.
    const late = windowRealm("w-late", storage)
    expect(late.getItem("mdwriter")?.state.pinnedPaths).toEqual(["/vault/pinned.md"])
    // The migrated tab belongs to the window that migrated it.
    expect(late.getItem("mdwriter")?.state.rightPaneTab).toBeUndefined()
  })

  /**
   * The cases below start from an entry that is *not* already in the shape the
   * store holds — the normal state of affairs after any release that adds a
   * setting, and after the pre-split migration. The window fills the missing
   * fields in on load, so if the merge ancestor were the text on disk rather
   * than the value the window actually holds, every defaulted field would look
   * like a local edit and the resolver would push it over the other window's
   * real choice. That is a silent overwrite at keystroke frequency, so it is
   * worth a test per shape of "stale on disk".
   */
  describe("an entry stored in an older shape", () => {
    /** Settings as an earlier release wrote them: no `showPdfs` key at all. */
    const olderSettings = () => {
      const { showPdfs: _dropped, ...rest } = DEFAULT_SETTINGS
      return rest
    }

    it("keeps a setting window A turned on when B rewrites its slice", () => {
      const storage = sharedBacking()
      storage.setItem(`${SHARED_PREFIX}settings`, JSON.stringify(olderSettings()))
      const a = windowRealm("w-a", storage)
      const b = windowRealm("w-b", storage)
      // Both windows load it and fill in the field the stored entry predates.
      a.getItem("mdwriter")
      b.getItem("mdwriter")

      // A's user turns the new setting on.
      a.setItem("mdwriter", {
        state: baseSlice({ settings: { ...DEFAULT_SETTINGS, showPdfs: true } }),
        version: 0,
      })
      // B's user types a character. B's slice carries `showPdfs: false` — but
      // that is a default it filled in, not a choice its user made.
      b.setItem("mdwriter", { state: baseSlice(), version: 0 })

      expect(readShared(storage, "settings")?.showPdfs).toBe(true)
    })

    it("stores the entry in the shape the window holds, so the ancestor is honest", () => {
      // The mechanism behind the case above: loading an entry rewrites it in
      // canonical form, which is what keeps disk, ancestor and memory one value.
      const storage = sharedBacking()
      storage.setItem(`${SHARED_PREFIX}settings`, JSON.stringify(olderSettings()))

      windowRealm("w-a", storage).getItem("mdwriter")

      expect(readShared(storage, "settings")).toEqual(DEFAULT_SETTINGS)
    })

    it("keeps a setting window A changed right after the pre-split migration", () => {
      // The migrated blob is the extreme case: one key out of a dozen.
      const storage = sharedBacking()
      storage.setItem(
        LEGACY_STORE_KEY,
        JSON.stringify({ state: { settings: { theme: "dark" } }, version: 0 }),
      )
      const a = windowRealm("w-a", storage)
      const b = windowRealm("w-b", storage)
      a.getItem("mdwriter")
      b.getItem("mdwriter")

      a.setItem("mdwriter", {
        state: baseSlice({ settings: { ...DEFAULT_SETTINGS, theme: "dark", hideGitignored: true } }),
        version: 0,
      })
      b.setItem("mdwriter", {
        state: baseSlice({ settings: { ...DEFAULT_SETTINGS, theme: "dark" } }),
        version: 0,
      })

      expect(readShared(storage, "settings")).toMatchObject({
        theme: "dark",
        hideGitignored: true,
      })
    })

    it("keeps the document A just opened when the stored recents exceed the cap", () => {
      // Same ancestor bug on the entry multi-window session restore reads: the
      // store truncates an over-long list on load, so the raw text is not what
      // either window holds, and both windows are on the same vault — so the
      // per-vault split in the resolver does not save them.
      const storage = sharedBacking()
      const overLong = Array.from({ length: MAX_RECENT_FILES + 3 }, (_, i) => `/vault/${i}.md`)
      storage.setItem(`${SHARED_PREFIX}recentFilesByVault`, JSON.stringify({ "/vault": overLong }))
      const a = windowRealm("w-a", storage)
      const b = windowRealm("w-b", storage)
      const truncated = overLong.slice(0, MAX_RECENT_FILES)
      a.getItem("mdwriter")
      b.getItem("mdwriter")

      // A opens a document, which pushes it onto the front of the vault's list.
      const withNew = ["/vault/new.md", ...truncated].slice(0, MAX_RECENT_FILES)
      a.setItem("mdwriter", {
        state: baseSlice({ recentFilesByVault: { "/vault": withNew } }),
        version: 0,
      })
      // B's user types a character; B still holds the list as it loaded it.
      b.setItem("mdwriter", {
        state: baseSlice({ recentFilesByVault: { "/vault": truncated } }),
        version: 0,
      })

      expect(readShared(storage, "recentFilesByVault")).toEqual({ "/vault": withNew })
    })
  })

  it("evicts a retired window's layout chrome along with its store entries", () => {
    // The panel hooks keep their state outside the store, so the eviction sweep
    // has to know about them or they leak one entry per window ever opened.
    const storage = sharedBacking()
    const labels = Array.from({ length: MAX_REMEMBERED_WINDOWS + 1 }, (_, i) => `w-${i}`)
    for (const label of labels) {
      storage.setItem(windowScopedKey(label, LAYOUT_WIDTHS_KEY), JSON.stringify({ left: 300 }))
      windowRealm(label, storage).getItem("mdwriter")
    }

    expect(storage.getItem(windowScopedKey("w-0", LAYOUT_WIDTHS_KEY))).toBeNull()
    expect(storage.getItem(windowScopedKey(labels.at(-1) as string, LAYOUT_WIDTHS_KEY))).not.toBeNull()
  })

  it("survives a storage backend that throws", () => {
    const hostile: StorageLike = {
      getItem: () => {
        throw new Error("nope")
      },
      setItem: () => {
        throw new Error("nope")
      },
      removeItem: () => {
        throw new Error("nope")
      },
    }
    const a = windowRealm("w-a", hostile)

    // A quota or private-mode failure inside setState must not reach the UI.
    expect(() => a.setItem("mdwriter", { state: baseSlice(), version: 0 })).not.toThrow()
    expect(() => a.getItem("mdwriter")).not.toThrow()
  })
})

describe("the live store against another window's writes", () => {
  beforeEach(() => {
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS },
      pinnedPaths: [],
      recentFilesByVault: {},
      rightPaneTab: "properties",
      rootPath: null,
    })
    persistedStorageForTests.removeItem("mdwriter")
    // Re-seed this window's baseline the way a first write would.
    useStore.setState({ settings: { ...DEFAULT_SETTINGS } })
  })

  /** Stand in for another window writing an app-global entry. */
  function otherWindowWrites<K extends keyof PersistedSlice>(key: K, value: PersistedSlice[K]) {
    localStorage.setItem(`${SHARED_PREFIX}${key}`, JSON.stringify(value))
  }

  it("adopts an app-global change made in another window", () => {
    otherWindowWrites("settings", { ...DEFAULT_SETTINGS, theme: "dark", showPdfs: true })

    syncSharedPersistedState()

    expect(useStore.getState().settings).toMatchObject({ theme: "dark", showPdfs: true })
  })

  it("re-reads without churning state that already matches", () => {
    // Every cross-window notification triggers a re-read, so it has to be free
    // when nothing actually differs.
    otherWindowWrites("settings", { ...DEFAULT_SETTINGS, theme: "dark" })
    syncSharedPersistedState()
    const adopted = useStore.getState().settings

    syncSharedPersistedState()

    expect(useStore.getState().settings).toBe(adopted)
  })

  it("ignores another window's right-pane tab", () => {
    useStore.setState({ rightPaneTab: "properties" })
    localStorage.setItem(`${WINDOW_PREFIX}w-other:rightPaneTab`, '"ai"')

    syncSharedPersistedState()

    expect(useStore.getState().rightPaneTab).toBe("properties")
  })

  it("does not lose another window's change when this one writes a setting", async () => {
    otherWindowWrites("settings", { ...DEFAULT_SETTINGS, theme: "dark" })

    // This window knows nothing about that yet and changes a different field.
    useStore.getState().setSetting("showPdfs", true)

    const onDisk = JSON.parse(
      localStorage.getItem(`${SHARED_PREFIX}settings`) as string,
    ) as typeof DEFAULT_SETTINGS
    expect(onDisk).toMatchObject({ theme: "dark", showPdfs: true })
    // …and the window catches up to what it just wrote.
    await vi.waitFor(() =>
      expect(useStore.getState().settings).toMatchObject({ theme: "dark", showPdfs: true }),
    )
  })

  it("keeps another window's recent files when this one records a document", async () => {
    otherWindowWrites("recentFilesByVault", { "/other-vault": ["/other-vault/note.md"] })

    useStore.setState({ recentFilesByVault: { "/my-vault": ["/my-vault/note.md"] } })

    expect(
      JSON.parse(localStorage.getItem(`${SHARED_PREFIX}recentFilesByVault`) as string),
    ).toEqual({
      "/other-vault": ["/other-vault/note.md"],
      "/my-vault": ["/my-vault/note.md"],
    })
    await vi.waitFor(() =>
      expect(useStore.getState().recentFilesByVault).toHaveProperty("/other-vault"),
    )
  })

  it("survives two ordinary store mutations in one task", async () => {
    // Neither of these touches a persisted field, but persist rewrites the
    // whole slice on every `set()`, so both reach storage. Real code does this
    // constantly — `useTreeActions` mutates three fields in a row after
    // creating a file, `useChatPersistence` two on a vault switch — and the
    // catch-up after a merge only runs on a later microtask.
    otherWindowWrites("settings", { ...DEFAULT_SETTINGS, theme: "dark" })

    useStore.setState({ rootPath: "/vault" })
    useStore.setState({ rootPath: "/vault-2" })

    expect(
      JSON.parse(localStorage.getItem(`${SHARED_PREFIX}settings`) as string),
    ).toMatchObject({ theme: "dark" })
    // The window still catches up rather than sitting on its stale copy.
    await vi.waitFor(() => expect(useStore.getState().settings.theme).toBe("dark"))
  })

  it("keeps another window's change while this one writes repeatedly", async () => {
    otherWindowWrites("settings", { ...DEFAULT_SETTINGS, theme: "dark" })

    // A merged first write, then more writes before the adoption microtask.
    useStore.getState().setSetting("showPdfs", true)
    useStore.setState({ rootPath: "/vault" })
    useStore.setState({ rootPath: "/vault-2" })

    expect(
      JSON.parse(localStorage.getItem(`${SHARED_PREFIX}settings`) as string),
    ).toMatchObject({ theme: "dark", showPdfs: true })
    await vi.waitFor(() =>
      expect(useStore.getState().settings).toMatchObject({ theme: "dark", showPdfs: true }),
    )
  })

  it("keeps another window's change to a setting the stored entry predates", async () => {
    // End to end, through the real store: storage holds settings from before
    // `showPdfs` existed, so hydration fills it in. If the ancestor were the
    // stored text, that filled-in default would count as this window's edit and
    // a single unrelated setState would push it over the other window's choice.
    const { showPdfs: _dropped, ...older } = DEFAULT_SETTINGS
    localStorage.setItem(`${SHARED_PREFIX}settings`, JSON.stringify(older))
    await useStore.persist.rehydrate()
    otherWindowWrites("settings", { ...DEFAULT_SETTINGS, showPdfs: true })

    // A keystroke-class mutation: touches nothing persisted, but persist still
    // rewrites the whole slice.
    useStore.setState({ selectedPath: "/vault/note.md" })

    expect(
      JSON.parse(localStorage.getItem(`${SHARED_PREFIX}settings`) as string),
    ).toMatchObject({ showPdfs: true })
    await vi.waitFor(() => expect(useStore.getState().settings.showPdfs).toBe(true))
  })

  it("writes the right-pane tab under this window's own label", () => {
    useStore.getState().setRightPaneTab("ai")

    expect(localStorage.getItem(`${WINDOW_PREFIX}${PERSIST_WINDOW_LABEL}:rightPaneTab`)).toBe('"ai"')
    expect(localStorage.getItem(`${SHARED_PREFIX}rightPaneTab`)).toBeNull()
  })
})
