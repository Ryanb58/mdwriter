import { useEffect, useState } from "react"
import { listen, emit } from "@tauri-apps/api/event"
import { getVersion } from "@tauri-apps/api/app"
import { X, Sun, Moon, Monitor, ArrowClockwise } from "@phosphor-icons/react"
import { useStore, type Theme, type ImagesLocation } from "../../lib/store"
import { Toggle } from "./Toggle"
import { refreshTree } from "../tree/useTreeActions"

export function SettingsPanel() {
  const open = useStore((s) => s.settingsOpen)
  const setOpen = useStore((s) => s.setSettingsOpen)
  const settings = useStore((s) => s.settings)
  const setSetting = useStore((s) => s.setSetting)
  const [appVersion, setAppVersion] = useState<string>("")

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {})
  }, [])

  // Cmd+,/Ctrl+, to open (in-window shortcut). The native macOS menu also
  // bridges Settings… → "menu:settings" event, listened to below.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key === ",") {
        e.preventDefault()
        setOpen(!useStore.getState().settingsOpen)
      }
      if (e.key === "Escape" && useStore.getState().settingsOpen) {
        setOpen(false)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [setOpen])

  // Native menu bridge — opens Settings when the user clicks the menu item.
  useEffect(() => {
    const unlistenP = listen("menu:settings", () => setOpen(true))
    return () => { unlistenP.then((u) => u()) }
  }, [setOpen])

  function handle<K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) {
    setSetting(key, value)
    // Tree-affecting toggles re-fetch the tree immediately.
    if (key === "hideGitignored" || key === "showPdfs" || key === "showImages" || key === "showUnsupported") {
      refreshTree().catch(console.error)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-black/45 backdrop-blur-[2px]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-[560px] max-w-[92vw] max-h-[80vh] flex flex-col rounded-xl bg-elevated border border-border-strong overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        style={{ boxShadow: "0 24px 48px -12px oklch(0 0 0 / 0.6), 0 4px 8px oklch(0 0 0 / 0.3)" }}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-[14px] font-semibold text-text">Settings</h2>
          <button
            onClick={() => setOpen(false)}
            className="p-1 rounded text-text-subtle hover:text-text hover:bg-surface transition-colors"
            aria-label="Close"
          >
            <X size={14} weight="bold" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          <Section title="Appearance">
            <div className="flex items-start gap-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-text">Theme</div>
                <div className="text-[12px] text-text-subtle mt-0.5 leading-relaxed">
                  Choose the app color mode used for chrome, editor surfaces, menus, and dialogs.
                </div>
              </div>
              <ThemeSegmented
                value={settings.theme}
                onChange={(v) => setSetting("theme", v)}
              />
            </div>
          </Section>
          <Section title="Vault Content">
            <Toggle
              id="set-autoRename"
              on={settings.autoRenameFromH1}
              onChange={(v) => handle("autoRenameFromH1", v)}
              label="Auto-rename untitled notes from first H1"
              description="When a new untitled note gets a top-level heading, mdwriter renames the file to match."
            />
            <Divider />
            <Toggle
              id="set-hideGitignored"
              on={settings.hideGitignored}
              onChange={(v) => handle("hideGitignored", v)}
              label="Hide files and folders ignored by Git"
              description="Keeps generated and local-only vault files out of notes, search, quick open, and folders."
            />
            <Divider />
            <Toggle
              id="set-showPdfs"
              on={settings.showPdfs}
              onChange={(v) => handle("showPdfs", v)}
              label="Show PDFs"
              description="Show PDF files in the file tree alongside markdown notes."
            />
            <Divider />
            <Toggle
              id="set-showImages"
              on={settings.showImages}
              onChange={(v) => handle("showImages", v)}
              label="Show Images"
              description="Show common image files (png, jpg, gif, svg, webp) in the file tree."
            />
            <Divider />
            <Toggle
              id="set-showUnsupported"
              on={settings.showUnsupported}
              onChange={(v) => handle("showUnsupported", v)}
              label="Show Unsupported Files"
              description="Show other non-markdown files without an in-app preview."
            />
          </Section>
          <Section title="Images">
            <div className="flex items-start gap-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-text">Storage location</div>
                <div className="text-[12px] text-text-subtle mt-0.5 leading-relaxed">
                  Where pasted or dropped images are saved inside the vault.
                </div>
              </div>
              <ImagesLocationSegmented
                value={settings.imagesLocation}
                onChange={(v) => setSetting("imagesLocation", v)}
              />
            </div>
            <Divider />
            <div className="flex flex-col gap-2 py-3">
              <div className="text-[13px] font-medium text-text">Filename template</div>
              <div className="text-[12px] text-text-subtle leading-relaxed">
                Tokens:{" "}
                <code className="font-mono">{"{date}"}</code>{" "}
                <code className="font-mono">{"{time}"}</code>{" "}
                <code className="font-mono">{"{rand}"}</code>{" "}
                <code className="font-mono">{"{note}"}</code>.
                Extension is added automatically from the image type.
              </div>
              <input
                type="text"
                value={settings.imageFilenameTemplate}
                onChange={(e) => setSetting("imageFilenameTemplate", e.target.value)}
                placeholder="{date}-{time}-{rand}"
                className="w-full px-2 py-1 rounded border border-border bg-surface text-[13px] font-mono text-text"
              />
            </div>
          </Section>
          <Section title="About">
            <div className="flex items-center justify-between py-3">
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-text">mdwriter</div>
                <div className="text-[12px] text-text-subtle mt-0.5 font-mono">
                  {appVersion ? `v${appVersion}` : "—"}
                </div>
              </div>
              <button
                onClick={() => emit("menu:check-updates").catch(() => {})}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-surface text-[12px] text-text hover:bg-elevated transition-colors"
              >
                <ArrowClockwise size={12} weight="bold" />
                Check for Updates
              </button>
            </div>
          </Section>
        </div>

        <footer className="px-5 py-2 border-t border-border text-[11px] text-text-subtle flex items-center justify-between">
          <span>Settings are saved automatically.</span>
          <span><kbd className="font-mono px-1.5 py-0.5 rounded border border-border bg-surface">⌘,</kbd> to toggle</span>
        </footer>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-2">
      <div className="text-[10px] uppercase tracking-[0.14em] text-text-subtle pb-1">{title}</div>
      <div>{children}</div>
    </section>
  )
}

function Divider() {
  return <div className="border-t border-border" />
}

function ImagesLocationSegmented({
  value, onChange,
}: { value: ImagesLocation; onChange: (v: ImagesLocation) => void }) {
  const opts: Array<{ value: ImagesLocation; label: string }> = [
    { value: "vault-assets", label: "Vault assets" },
    { value: "sibling-assets", label: "Sibling folder" },
    { value: "same-folder", label: "Same folder" },
  ]
  return (
    <div className="inline-flex rounded-md border border-border bg-surface p-0.5 mt-0.5">
      {opts.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={[
              "px-2.5 h-7 rounded text-[12px] transition-colors",
              active
                ? "bg-accent text-accent-fg"
                : "text-text-subtle hover:text-text hover:bg-elevated",
            ].join(" ")}
            aria-pressed={active}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function ThemeSegmented({ value, onChange }: { value: Theme; onChange: (v: Theme) => void }) {
  const opts: Array<{ value: Theme; label: string; icon: React.ReactNode }> = [
    { value: "light", label: "Light", icon: <Sun size={13} weight="bold" /> },
    { value: "dark", label: "Dark", icon: <Moon size={13} weight="bold" /> },
    { value: "system", label: "System", icon: <Monitor size={13} weight="bold" /> },
  ]
  return (
    <div className="inline-flex rounded-md border border-border bg-surface p-0.5 mt-0.5">
      {opts.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={[
              "flex items-center justify-center w-8 h-7 rounded transition-colors",
              active
                ? "bg-accent text-accent-fg"
                : "text-text-subtle hover:text-text hover:bg-elevated",
            ].join(" ")}
            aria-pressed={active}
            aria-label={o.label}
            title={o.label}
          >
            {o.icon}
          </button>
        )
      })}
    </div>
  )
}
