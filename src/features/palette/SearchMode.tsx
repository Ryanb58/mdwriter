import { useEffect, useMemo, useRef, useState } from "react"
import { MagnifyingGlass, FileText, Warning } from "@phosphor-icons/react"
import { ipc, type SearchHit, type SearchResult } from "../../lib/ipc"
import { useStore } from "../../lib/store"
import { basename } from "../../lib/paths"
import { debounce } from "../../lib/debounce"

const DEBOUNCE_MS = 180
const MIN_QUERY = 2

type Group = { path: string; rel: string; name: string; hits: SearchHit[] }

export function SearchMode({
  initialQuery,
  onQueryChange,
  close,
}: {
  initialQuery: string
  onQueryChange: (q: string) => void
  close: () => void
}) {
  const rootPath = useStore((s) => s.rootPath)
  const setSelected = useStore((s) => s.setSelected)
  const setPendingScroll = useStore((s) => s.setPendingScroll)
  const [query, setQuery] = useState(initialQuery)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle")
  const [error, setError] = useState<string | null>(null)
  const [activeIdx, setActiveIdx] = useState(0)
  // Latest in-flight search token — used to discard stale results when a
  // newer query has been dispatched while an `await` is still resolving.
  const tokenRef = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)

  const runSearch = useMemo(
    () =>
      debounce(async (root: string, q: string) => {
        const token = ++tokenRef.current
        try {
          const r = await ipc.searchVault(root, q)
          if (token !== tokenRef.current) return
          setResult(r)
          setStatus("idle")
          setError(null)
          setActiveIdx(0)
        } catch (e) {
          if (token !== tokenRef.current) return
          setStatus("error")
          setError(String(e))
        }
      }, DEBOUNCE_MS),
    [],
  )

  useEffect(() => {
    if (!rootPath) return
    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY) {
      runSearch.cancel()
      setResult(null)
      setStatus("idle")
      return
    }
    setStatus("loading")
    runSearch.call(rootPath, trimmed)
    return () => runSearch.cancel()
  }, [query, rootPath, runSearch])

  const groups = useMemo<Group[]>(() => {
    if (!result) return []
    const byPath = new Map<string, SearchHit[]>()
    for (const h of result.hits) {
      const arr = byPath.get(h.path) ?? []
      arr.push(h)
      byPath.set(h.path, arr)
    }
    return [...byPath.entries()].map(([path, hits]) => ({
      path,
      rel: relativePath(path, rootPath),
      name: basename(path),
      hits,
    }))
  }, [result, rootPath])

  // Flat list for keyboard nav + a hit→index map so FileGroup doesn't run an
  // O(n) `flat.indexOf(h)` on every render of every row (which compounded to
  // O(hits²) at large result sizes).
  const { flat, flatIndex } = useMemo(() => {
    const flat = groups.flatMap((g) => g.hits)
    const flatIndex = new Map<SearchHit, number>()
    flat.forEach((h, i) => flatIndex.set(h, i))
    return { flat, flatIndex }
  }, [groups])

  function openHit(hit: SearchHit) {
    const matchText = hit.snippet.slice(hit.colStart, hit.colEnd)
    const fileGroup = groups.find((g) => g.path === hit.path)
    const occurrence = fileGroup ? Math.max(0, fileGroup.hits.indexOf(hit)) : 0
    setPendingScroll({ path: hit.path, line: hit.line, matchText, occurrence })
    setSelected(hit.path)
    close()
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (flat.length === 0) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIdx((i) => (i + 1) % flat.length)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIdx((i) => (i - 1 + flat.length) % flat.length)
    } else if (e.key === "Enter") {
      e.preventDefault()
      openHit(flat[Math.min(activeIdx, flat.length - 1)])
    }
  }

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const el = list.querySelector<HTMLElement>(`[data-hit-idx="${activeIdx}"]`)
    if (el) el.scrollIntoView({ block: "nearest" })
  }, [activeIdx])

  return (
    <div
      className="rounded-xl bg-elevated border border-border-strong overflow-hidden"
      style={{ boxShadow: "0 24px 48px -12px oklch(0 0 0 / 0.6), 0 4px 8px oklch(0 0 0 / 0.3)" }}
    >
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border">
        <MagnifyingGlass size={14} className="text-text-subtle flex-none" />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            const v = e.target.value
            setQuery(v)
            onQueryChange(v)
          }}
          onKeyDown={onKey}
          placeholder="Search the vault…"
          className="flex-1 bg-transparent outline-none text-[14px] placeholder:text-text-subtle"
        />
        {status === "loading" && (
          <span className="text-[11px] text-text-subtle">searching…</span>
        )}
        <kbd className="text-[10px] font-mono text-text-subtle border border-border rounded px-1.5 py-0.5">esc</kbd>
      </div>

      <div ref={listRef} className="max-h-[420px] overflow-y-auto py-1.5">
        {!rootPath && (
          <EmptyState message="Open a vault to search its contents." />
        )}
        {rootPath && query.trim().length < MIN_QUERY && (
          <EmptyState message="Type at least 2 characters." />
        )}
        {rootPath && status === "error" && (
          <div className="px-4 py-6 text-[12px] text-danger flex items-center gap-2">
            <Warning size={14} /> {error ?? "Search failed."}
          </div>
        )}
        {rootPath &&
          query.trim().length >= MIN_QUERY &&
          status !== "error" &&
          result &&
          result.hits.length === 0 && (
            <EmptyState
              message={`No matches in ${result.filesScanned.toLocaleString()} files.`}
            />
          )}
        {groups.length > 0 &&
          groups.map((g) => (
            <FileGroup
              key={g.path}
              group={g}
              flatIndex={flatIndex}
              activeIdx={activeIdx}
              onHover={setActiveIdx}
              onSelect={openHit}
            />
          ))}
        {result?.truncated && (
          <div className="px-4 py-2 text-[11px] text-text-subtle italic text-center">
            More results truncated — refine your query.
          </div>
        )}
      </div>
      <div className="px-4 py-2 text-[11px] text-text-subtle border-t border-border flex items-center gap-3">
        <span>
          <kbd className="font-mono">↑↓</kbd> navigate
        </span>
        <span>
          <kbd className="font-mono">Enter</kbd> open
        </span>
        {result && result.hits.length > 0 && (
          <span className="ml-auto">
            {result.hits.length} {result.hits.length === 1 ? "match" : "matches"} in{" "}
            {groups.length} {groups.length === 1 ? "file" : "files"}
          </span>
        )}
      </div>
    </div>
  )
}

function FileGroup({
  group,
  flatIndex,
  activeIdx,
  onHover,
  onSelect,
}: {
  group: Group
  flatIndex: Map<SearchHit, number>
  activeIdx: number
  onHover: (i: number) => void
  onSelect: (h: SearchHit) => void
}) {
  return (
    <div className="mb-1.5">
      <div className="px-3 pt-2 pb-1 flex items-center gap-1.5 text-[11px] text-text-subtle font-mono">
        <FileText size={11} className="flex-none" />
        <span className="truncate">{group.rel || group.name}</span>
        <span className="ml-auto">{group.hits.length}</span>
      </div>
      {group.hits.map((h) => {
        const idx = flatIndex.get(h) ?? -1
        const active = idx === activeIdx
        return (
          <div
            key={`${h.path}:${h.line}:${h.colStart}`}
            data-hit-idx={idx}
            onMouseEnter={() => onHover(idx)}
            onMouseDown={(e) => {
              e.preventDefault()
              onSelect(h)
            }}
            className={
              "mx-1.5 px-2.5 py-1 rounded-md text-[12.5px] cursor-pointer flex items-baseline gap-2.5 " +
              (active ? "bg-accent-soft text-text" : "text-text-muted hover:bg-accent-soft/50")
            }
          >
            <span className="font-mono text-[11px] text-text-subtle min-w-[3ch] text-right">
              {h.line}
            </span>
            <SnippetText snippet={h.snippet} start={h.colStart} end={h.colEnd} />
          </div>
        )
      })}
    </div>
  )
}

function SnippetText({
  snippet,
  start,
  end,
}: {
  snippet: string
  start: number
  end: number
}) {
  // Server is the source of truth on offsets, but a stray off-by-one here
  // would throw `String.slice` — clamp defensively.
  const s = Math.max(0, Math.min(snippet.length, start))
  const e = Math.max(s, Math.min(snippet.length, end))
  return (
    <span className="truncate">
      <span>{snippet.slice(0, s)}</span>
      <span className="bg-accent/30 text-text rounded-sm px-[1px]">{snippet.slice(s, e)}</span>
      <span>{snippet.slice(e)}</span>
    </span>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="px-4 py-6 text-[12px] text-text-subtle text-center">{message}</div>
  )
}

function relativePath(path: string, root: string | null): string {
  if (!root || !path.startsWith(root)) return path
  return path.slice(root.length).replace(/^[\\/]+/, "").replace(/\\/g, "/")
}
