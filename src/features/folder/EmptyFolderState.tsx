import { useFolderPicker } from "./useFolderPicker"

export function EmptyFolderState() {
  const pick = useFolderPicker()
  return (
    <div className="flex h-screen w-full items-center justify-center bg-bg text-text">
      <div className="max-w-md px-8">
        <div className="text-[11px] uppercase tracking-[0.18em] text-text-subtle mb-6">mdwriter</div>
        <h1 className="text-2xl font-semibold tracking-tight leading-tight mb-3">
          Open a folder to start writing.
        </h1>
        <p className="text-text-muted leading-relaxed mb-8">
          Pick any folder of markdown files. mdwriter reads them in place and
          remembers it for next time.
        </p>
        <button
          onClick={pick}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-accent text-accent-fg font-medium text-sm hover:opacity-90 transition-opacity"
        >
          Choose folder…
        </button>
        <div className="mt-10 text-xs text-text-subtle">
          <span className="font-mono">⌘P</span> to jump between files ·
          <span className="font-mono ml-2">⌘E</span> to view raw markdown
        </div>
      </div>
    </div>
  )
}
