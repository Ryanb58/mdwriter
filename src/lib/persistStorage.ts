import type { PersistStorage, StorageValue } from "zustand/middleware"

/**
 * Multi-window-safe backing store for zustand's `persist`.
 *
 * ## Why this exists
 *
 * Every mdwriter window is a webview on the same `tauri://localhost` origin, so
 * they all share one `localStorage`. zustand's persist middleware writes the
 * *entire* partialized slice on **every** `setState` — not just when a persisted
 * field changes (`node_modules/zustand/middleware.js`: `api.setState` is wrapped
 * to call `setItem()` unconditionally). With one blob under one key that makes
 * persistence continuous last-writer-wins at keystroke frequency: window A
 * toggles a setting, window B's user types one character, B rewrites its stale
 * copy of the whole slice, and A's change is gone from disk.
 *
 * Three properties fix that, and this module implements all three:
 *
 * 1. **One storage entry per persisted key**, split by *scope*. App-global keys
 *    live under `mdwriter:shared:<key>`; genuinely per-window UI state lives
 *    under `mdwriter:window:<label>:<key>` so it can never leak between windows.
 * 2. **Write only what changed.** Each entry is compared (as serialized text)
 *    against what this window last read or wrote, so the keystroke-frequency
 *    rewrite becomes zero writes.
 * 3. **Three-way merge on write.** If another window changed a shared entry
 *    since we last read it, we compare our value against `base` — the common
 *    ancestor. Unchanged means we have nothing to contribute and their value
 *    stands; changed on both sides hands off to a `resolver`, which merges
 *    field-by-field. This holds even if cross-window notification is delayed or
 *    lost, which is what keeps the guarantee from resting on it — see the note
 *    on `base` below for the invariant that makes that true, and `Normalizer`
 *    for why an entry is canonicalized on read before it can serve as `base`.
 *
 * Notification (so an app-global change becomes *visible* in other windows
 * without a relaunch) is a separate concern — see `sharedPersistSync.ts`.
 */

/** The slice of the `Storage` API this module needs. */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">

/**
 * `shared` — app-global, one entry for the whole installation (settings).
 * `window` — per-window UI state, one entry per window label.
 */
export type PersistScope = "shared" | "window"

/**
 * Reconcile a shared key another window wrote since we last read it.
 *
 * `base` is the common ancestor — the value this window's in-memory state is
 * known to agree with — so `mine !== base` identifies the fields *we* actually
 * changed. Everything else should defer to `disk`. Called with the same `base`
 * until this window adopts the merged result, so it must be idempotent:
 * `f(mine, f(mine, disk, base), base)` has to equal `f(mine, disk, base)`.
 */
export type ConflictResolver<V> = (mine: V, disk: V, base: V | undefined) => V

/** Every persisted key must declare a scope — adding one is then a compile error until classified. */
export type ScopeMap<S> = { readonly [K in keyof S]-?: PersistScope }

export type ResolverMap<S> = { readonly [K in keyof S]?: ConflictResolver<S[K]> }

/**
 * Canonicalize a value read from storage into the form the owner's in-memory
 * state will hold once it adopts the entry.
 *
 * This is not validation for its own sake — it is what keeps `base` honest.
 * The store re-merges what it loads (settings against their defaults, lists
 * against their caps), so the raw text on disk and the value the window
 * actually holds are *not* the same string whenever the entry predates a field
 * being added. A `base` seeded from the raw text would then claim every
 * default-filled field as a local edit, and the resolver would push this
 * window's defaults over another window's real choice. Normalizing here — and
 * writing the canonical form back — makes disk, `base` and memory one value.
 */
export type Normalizer<V> = (value: unknown) => V

export type NormalizerMap<S> = { readonly [K in keyof S]?: Normalizer<S[K]> }

export const SHARED_PREFIX = "mdwriter:shared:"
export const WINDOW_PREFIX = "mdwriter:window:"
/** Pre-split single-blob key. Read once, migrated per-key, then dropped. */
export const LEGACY_STORE_KEY = "mdwriter:store"
export const VERSION_KEY = "mdwriter:persist-version"
/** Most-recent-first list of window labels that still own scoped entries. */
export const WINDOW_INDEX_KEY = "mdwriter:window-index"
/**
 * How many windows' worth of per-window state to keep. Every window opened at
 * runtime gets a *randomly generated* label (`window_lifecycle.rs`), so without
 * a cap the per-window entries would accumulate one per window ever opened.
 * Past this many, the least recently launched labels are dropped; a window that
 * outlives its slot simply re-writes its entry the next time it changes.
 */
export const MAX_REMEMBERED_WINDOWS = 12

/**
 * Storage key for a per-window entry. Anything a window keeps to itself must
 * be namespaced this way — including state held outside the store (panel
 * collapse, panel widths), which otherwise silently shares one entry across
 * every window and lands on last-writer-wins.
 */
export function windowScopedKey(label: string, name: string): string {
  return `${WINDOW_PREFIX}${label}:${name}`
}

export type ScopedPersistStorage<S> = Omit<PersistStorage<S>, "getItem"> & {
  /** Narrowed to the synchronous form — `localStorage` never returns a promise. */
  getItem: (name: string) => StorageValue<S> | null
  /**
   * Re-read every shared entry from storage, refreshing this window's write
   * cache so the next write treats the on-disk values as the merge base.
   * Returns the parsed values for the caller to apply to its state.
   */
  readShared: () => Partial<S>
  /** Storage key for a persisted field, for tests and diagnostics. */
  storageKey: (key: keyof S) => string
}

export type ScopedPersistOptions<S> = {
  scopes: ScopeMap<S>
  /** Tauri window label; namespaces the `window`-scoped entries. */
  windowLabel: string
  storage: StorageLike
  resolvers?: ResolverMap<S>
  /**
   * Per key, the canonical form of a stored value — see `Normalizer`. Must
   * agree with what the owner adopts into memory, and must be idempotent.
   */
  normalizers?: NormalizerMap<S>
  /**
   * Names of extra per-window entries this module does not manage but should
   * evict along with the scoped ones (`usePanelStates`, `usePanelWidths`).
   * Without this they would accumulate one set per window ever opened, since
   * runtime windows get random labels.
   */
  extraWindowKeys?: readonly string[]
  /**
   * Translate the pre-split `mdwriter:store` blob into the current key shape
   * (including any legacy key renames) during the one-time migration.
   */
  migrateLegacy?: (legacyState: Record<string, unknown>) => Partial<S>
  /** Called after a write changed one or more shared entries. */
  onSharedWrite?: (keys: string[]) => void
  /**
   * Called when a write had to merge in another window's changes. The owner
   * should adopt the merged values into its state (otherwise its in-memory copy
   * stays behind the disk copy it just wrote, and the next merge base lies).
   */
  onMergedWrite?: () => void
}

export function createScopedPersistStorage<S extends object>(
  options: ScopedPersistOptions<S>,
): ScopedPersistStorage<S> {
  const { scopes, windowLabel, storage, resolvers, normalizers, migrateLegacy } = options
  const keys = Object.keys(scopes) as (keyof S & string)[]
  /**
   * Common ancestor per storage key: the text this window's *in-memory* state
   * is known to agree with.
   *
   * The invariant is "never advance past what we hold in memory", and it is
   * load-bearing. A merged or deferred write puts more on disk than this window
   * holds — adoption of that result happens later and asynchronously
   * (`onMergedWrite`). If the entry were rebased onto the on-disk text here, the
   * *next* write in the same synchronous task would see `disk === base`, skip
   * reconciliation entirely, and overwrite the other window's change with the
   * stale in-memory value. So `base` only moves to text this window's state
   * actually holds; anything else keeps the pre-merge ancestor, and the later
   * stale write re-enters the merge against it (which is idempotent).
   *
   * The same invariant is why every read goes through `canonicalize`: the text
   * on disk is only a valid ancestor once it *is* the text this window holds.
   */
  const base = new Map<string, string>()

  const read = (key: string): string | null => {
    try {
      return storage.getItem(key)
    } catch {
      return null
    }
  }
  const write = (key: string, value: string) => {
    try {
      storage.setItem(key, value)
    } catch {
      // Storage is best-effort: a quota or private-mode failure must not
      // propagate out of a `setState`.
    }
  }
  const drop = (key: string) => {
    try {
      storage.removeItem(key)
    } catch {
      /* see write() */
    }
  }

  const storageKey = (key: keyof S): string =>
    scopes[key] === "window"
      ? windowScopedKey(windowLabel, String(key))
      : `${SHARED_PREFIX}${String(key)}`

  const serialize = (value: unknown): string | null => {
    if (value === undefined) return null
    try {
      const text = JSON.stringify(value)
      return text === undefined ? null : text
    } catch {
      return null
    }
  }

  const parse = (text: string): unknown => {
    try {
      return JSON.parse(text)
    } catch {
      return undefined
    }
  }

  /**
   * Turn a value just read from storage into the pair the caller needs: the
   * value to hand to the owner, and the text to record as the ancestor. Both
   * come from the *normalized* value, so they cannot disagree — see
   * `Normalizer` for why seeding the ancestor from raw text loses data.
   */
  const canonicalize = <K extends keyof S & string>(
    key: K,
    value: unknown,
  ): { value: S[K]; text: string | null } => {
    const normalizer = normalizers?.[key]
    const next = (normalizer ? normalizer(value) : value) as S[K]
    return { value: next, text: serialize(next) }
  }

  /**
   * Adopt an entry: hand the canonical value back, rewrite the entry when the
   * stored text is not already canonical, and record it as the ancestor.
   *
   * The rewrite is what keeps disk, memory and `base` a single value. Skipping
   * it would leave every later write reconciling a difference that is not a
   * change at all — the deferral branch would hand this window back the same
   * non-canonical text forever, re-arming `onMergedWrite` on every write.
   */
  const adopt = <K extends keyof S & string>(
    sk: string,
    key: K,
    parsed: unknown,
    raw: string | null,
    state: Partial<S>,
  ): boolean => {
    const { value, text } = canonicalize(key, parsed)
    if (text === null) return false
    state[key] = value
    if (text !== raw) write(sk, text)
    base.set(sk, text)
    return true
  }

  const readVersion = (): number | undefined => {
    const raw = read(VERSION_KEY)
    if (raw === null) return undefined
    const parsed = parse(raw)
    return typeof parsed === "number" ? parsed : undefined
  }

  /** Read the pre-split blob, if this installation still has one. */
  const readLegacy = (): { state: Partial<S>; version?: number } | null => {
    const raw = read(LEGACY_STORE_KEY)
    if (raw === null) return null
    const parsed = parse(raw)
    if (!parsed || typeof parsed !== "object") return null
    const envelope = parsed as { state?: unknown; version?: unknown }
    const legacyState = envelope.state
    if (!legacyState || typeof legacyState !== "object") return null
    const record = legacyState as Record<string, unknown>
    return {
      state: migrateLegacy ? migrateLegacy(record) : (record as Partial<S>),
      version: typeof envelope.version === "number" ? envelope.version : undefined,
    }
  }

  /**
   * Claim this window's slot in the recency index and evict the entries of
   * labels that fell off the end. Runs once, at hydration.
   *
   * KNOWN DEFECT (not fixed here): this is a read-modify-write of one shared
   * cell, and `localStorage` offers no atomic form of that. Two windows
   * hydrating in the same instant both read the old index and both write their
   * own label onto it, so the second write drops the first window's label. That
   * window's per-window entries are then unreachable by the eviction sweep —
   * and since this runs only at hydration, nothing re-claims the slot for the
   * life of the window, so those entries leak permanently. The blast radius is
   * bounded (a few stale per-window keys, no user data), which is why it is
   * recorded rather than papered over: a real fix needs the index to stop being
   * a single shared cell — one self-owned marker entry per label, with eviction
   * enumerating keys by prefix — which requires `Storage.key`/`length` on
   * `StorageLike`.
   */
  const claimWindowSlot = () => {
    const windowKeys: string[] = [
      ...keys.filter((key) => scopes[key] === "window"),
      ...(options.extraWindowKeys ?? []),
    ]
    if (windowKeys.length === 0) return
    const stored = read(WINDOW_INDEX_KEY)
    const parsed = stored === null ? undefined : parse(stored)
    const known = Array.isArray(parsed) ? parsed.filter((l): l is string => typeof l === "string") : []
    const ordered = [windowLabel, ...known.filter((l) => l !== windowLabel)]
    for (const label of ordered.slice(MAX_REMEMBERED_WINDOWS)) {
      for (const key of windowKeys) drop(windowScopedKey(label, key))
    }
    const kept = serialize(ordered.slice(0, MAX_REMEMBERED_WINDOWS))
    if (kept !== null && kept !== stored) write(WINDOW_INDEX_KEY, kept)
  }

  const getItem = (): StorageValue<S> | null => {
    claimWindowSlot()
    const legacy = readLegacy()
    const state: Partial<S> = {}
    let found = false

    for (const key of keys) {
      const sk = storageKey(key)
      const raw = read(sk)
      if (raw !== null) {
        const value = parse(raw)
        if (value !== undefined && adopt(sk, key, value, raw, state)) {
          found = true
          continue
        }
      }
      // No per-key entry: adopt the legacy value and write it through, so a
      // window that migrates without ever changing anything still hands the
      // value on to the next window. It goes through the same canonicalization
      // as any other read — a pre-split blob is exactly the case where the
      // stored shape lags the current one.
      if (legacy && key in legacy.state) {
        if (adopt(sk, key, legacy.state[key], null, state)) found = true
      }
    }

    if (legacy) {
      // Superseded by the per-key entries written above.
      drop(LEGACY_STORE_KEY)
    }

    const version = readVersion() ?? legacy?.version
    if (!found && version === undefined) return null
    return { state: state as S, version }
  }

  const setItem = (_name: string, value: StorageValue<S>) => {
    const changedShared: string[] = []
    let merged = false

    for (const key of keys) {
      const sk = storageKey(key)
      const mineText = serialize(value.state?.[key])
      const diskText = read(sk)
      // No ancestor yet (the entry was absent when this window hydrated): the
      // value we are holding right now is the honest one, because the first
      // write after hydration carries exactly the hydrated state. Seeding it
      // *before* reconciling is what lets a later change in the same task be
      // recognised as ours and merged, instead of being deferred away as
      // "no evidence of a local change" forever.
      if (!base.has(sk) && mineText !== null) base.set(sk, mineText)
      const baseText = base.has(sk) ? (base.get(sk) as string) : null

      let nextText = mineText
      // Reconcile only when the entry on disk is not what we last saw — a plain
      // string compare, so the common no-op write stays cheap.
      if (scopes[key] === "shared" && diskText !== null && diskText !== baseText) {
        const resolver = resolvers?.[key]
        if (mineText === baseText || baseText === null || mineText === null) {
          // We have no local change to contribute — or, with no base, no
          // evidence of one — so the window that wrote is better informed.
          // Deferring is the safe direction: it can never discard their change.
          if (diskText !== mineText) {
            nextText = diskText
            merged = true
          }
        } else if (resolver) {
          // Both sides changed. `base` says which fields are ours; the rest
          // stays theirs.
          const diskValue = parse(diskText)
          if (diskValue !== undefined) {
            const resolved = resolver(
              value.state[key],
              diskValue as S[typeof key],
              parse(baseText) as S[typeof key] | undefined,
            )
            const resolvedText = serialize(resolved)
            if (resolvedText !== null && resolvedText !== mineText) {
              nextText = resolvedText
              merged = true
            }
          }
        }
        // No resolver and a genuine change on both sides: last writer wins,
        // which for a scalar (the chosen agent, say) is all it can mean.
      }

      // `nextText !== mineText` means we settled on a value this window does not
      // hold in memory yet, so it cannot become our ancestor — see `base`.
      const holdsInMemory = nextText === mineText

      if (nextText !== diskText) {
        // Not already correct on disk (the usual case is that it is, because
        // nothing changed at all).
        if (nextText === null) drop(sk)
        else write(sk, nextText)
        if (scopes[key] === "shared") changedShared.push(String(key))
      }
      if (holdsInMemory) {
        if (nextText === null) base.delete(sk)
        else base.set(sk, nextText)
      }
    }

    if (value.version !== undefined) {
      const versionText = serialize(value.version)
      if (versionText !== null && versionText !== read(VERSION_KEY)) write(VERSION_KEY, versionText)
    }

    if (changedShared.length > 0) options.onSharedWrite?.(changedShared)
    if (merged) options.onMergedWrite?.()
  }

  const removeItem = () => {
    for (const key of keys) {
      const sk = storageKey(key)
      drop(sk)
      base.delete(sk)
    }
    drop(LEGACY_STORE_KEY)
    drop(VERSION_KEY)
    drop(WINDOW_INDEX_KEY)
  }

  const readShared = (): Partial<S> => {
    const out: Partial<S> = {}
    for (const key of keys) {
      if (scopes[key] !== "shared") continue
      const sk = storageKey(key)
      const raw = read(sk)
      if (raw === null) {
        base.delete(sk)
        continue
      }
      const value = parse(raw)
      if (value === undefined) continue
      adopt(sk, key, value, raw, out)
    }
    return out
  }

  return { getItem, setItem, removeItem, readShared, storageKey }
}

/**
 * Three-way merge of two flat records (settings, or per-vault maps): a key we
 * changed relative to `base` is ours, anything else defers to `disk`. Handles
 * deletions on both sides.
 *
 * "Ours wins" is only safe when the value is *atomic* — a scalar setting, where
 * the last explicit choice is the whole truth. For a value that is itself a
 * collection two windows can both append to, use `mergeRecordsWith`: taking the
 * key wholesale there discards the other window's additions to the same key.
 */
export function mergeRecords<V extends Record<string, unknown>>(
  mine: V,
  disk: V,
  base: V | undefined,
): V {
  return mergeRecordsWith(mine, disk, base, (mineValue) => mineValue)
}

/**
 * `mergeRecords` with a second level: when *both* windows changed the same key,
 * `mergeValue` reconciles the two values instead of ours simply winning.
 *
 * The outer level is unchanged, and that is what keeps cross-key deferral
 * intact — a key we never touched still defers to `disk` wholesale, so a window
 * can never clobber a vault it never opened. `mergeValue` is reached only for a
 * key both sides genuinely edited, which is exactly the case a per-key merge
 * cannot resolve without losing one side.
 *
 * Inherits `ConflictResolver`'s idempotency requirement, so `mergeValue` must
 * be idempotent too.
 */
export function mergeRecordsWith<V extends Record<string, unknown>>(
  mine: V,
  disk: V,
  base: V | undefined,
  mergeValue: (mine: V[string], disk: V[string], base: V[string] | undefined) => V[string],
): V {
  if (!isRecord(mine) || !isRecord(disk)) return mine
  const out: Record<string, unknown> = { ...disk }
  const baseRecord: Record<string, unknown> = isRecord(base) ? base : {}
  const allKeys = new Set([...Object.keys(mine), ...Object.keys(baseRecord)])
  for (const key of allKeys) {
    const changedHere = !sameJson(mine[key], baseRecord[key])
    if (!changedHere) {
      // We never touched it — if we still hold it and disk dropped it, our copy
      // is the stale one, so leaving `disk`'s absence in place is correct.
      continue
    }
    if (!(key in mine)) {
      delete out[key]
      continue
    }
    const changedThere = key in disk && !sameJson(disk[key], baseRecord[key])
    // Only a key changed on *both* sides needs the value-level merge. If they
    // left it alone (or dropped it while we were editing it), ours stands.
    out[key] = changedThere
      ? mergeValue(mine[key] as V[string], disk[key] as V[string], baseRecord[key] as V[string])
      : mine[key]
  }
  return out as V
}

/**
 * Three-way merge of a string list used as an ordered set (pinned paths):
 * additions we made are appended, removals we made are honored, and everything
 * else keeps the on-disk contents and order.
 */
export function mergeStringSets(mine: string[], disk: string[], base: string[] | undefined): string[] {
  if (!Array.isArray(mine) || !Array.isArray(disk)) return mine
  const baseList = Array.isArray(base) ? base : []
  const mineSet = new Set(mine)
  const baseSet = new Set(baseList)
  const removedHere = baseList.filter((v) => !mineSet.has(v))
  const out = disk.filter((v) => !removedHere.includes(v))
  for (const value of mine) {
    // Only *our* additions get appended; a value we still hold that disk
    // dropped was removed by the other window after we last read.
    if (!baseSet.has(value) && !out.includes(value)) out.push(value)
  }
  return out
}

/**
 * Three-way merge of a most-recent-first recency list (a vault's recently
 * opened files), capped at `limit`.
 *
 * Unlike `mergeStringSets`, order carries meaning here: index 0 is what session
 * restore reopens, so an entry merged in at the wrong end is nearly as bad as
 * one lost. The rule:
 *
 * - Entries we dropped since `base` (a deleted or renamed file) are honored,
 *   the same as an unpin.
 * - Everything else keeps `disk`'s contents and relative order — their opens
 *   are as real as ours.
 * - Our own entries are woven in *ahead* of the entry they precede in `mine`,
 *   so a file we just opened lands at the front rather than after their list.
 *   Between our addition and theirs we have no timestamps to compare, and the
 *   window doing the writing is the one whose open happened most recently as of
 *   this write, so preferring ours is the better guess.
 *
 * Idempotent: re-merging the result against the same `mine`/`base` reproduces
 * it, because every entry of the result is already anchored in `mine`'s order
 * or `disk`'s, and the cap always cuts the same tail.
 */
export function mergeRecencyLists(
  mine: string[],
  disk: string[],
  base: string[] | undefined,
  limit: number,
): string[] {
  if (!Array.isArray(mine) || !Array.isArray(disk)) return mine
  const baseList = Array.isArray(base) ? base : []
  const mineSet = new Set(mine)
  const removedHere = new Set(baseList.filter((path) => !mineSet.has(path)))
  const theirs = disk.filter((path) => !removedHere.has(path))

  const out: string[] = []
  const taken = new Set<string>()
  const push = (path: string) => {
    if (taken.has(path)) return
    taken.add(path)
    out.push(path)
  }

  // Walk our list; each entry we share with theirs is an anchor, and everything
  // of theirs up to that anchor gets flushed in their order first.
  let next = 0
  for (const path of mine) {
    const anchor = theirs.indexOf(path, next)
    if (anchor === -1) {
      // Ours alone (or already flushed as part of an earlier anchor's run).
      push(path)
      continue
    }
    for (let i = next; i <= anchor; i += 1) push(theirs[i])
    next = anchor + 1
  }
  for (let i = next; i < theirs.length; i += 1) push(theirs[i])

  return out.slice(0, limit)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}
