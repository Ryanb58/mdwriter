import { useEffect } from "react"
import { Robot } from "@phosphor-icons/react"
import { useStore } from "./lib/store"
import { EmptyFolderState } from "./features/folder/EmptyFolderState"
import { useStartupRestore } from "./features/folder/useStartupRestore"
import { TreePane } from "./features/tree/TreePane"
import { useTreeShortcuts } from "./features/tree/useTreeShortcuts"
import { DndModals } from "./features/tree/DndModals"
import { EditorPane } from "./features/editor/EditorPane"
import { AiPanel } from "./features/ai/AiPanel"
import { useAiSession } from "./features/ai/useAiSession"
import { useChatPersistence } from "./features/ai/useChatPersistence"
import { useAiShortcuts } from "./features/ai/useAiShortcuts"
import { StatusBar } from "./features/statusbar/StatusBar"
import { CommandPalette } from "./features/palette/CommandPalette"
import { SettingsPanel } from "./features/settings/SettingsPanel"
import { ShortcutsModal } from "./features/help/ShortcutsModal"
import { useTheme } from "./features/settings/useTheme"
import { useExternalChanges } from "./features/watcher/useExternalChanges"
import { useUpdates } from "./features/updates/useUpdates"
import { UpdateBanner } from "./features/updates/UpdateBanner"
import { usePasteDiagnostic } from "./lib/pasteDiagnostic"
import { useShowWindowOnReady } from "./lib/useShowWindowOnReady"
import { LayoutShell, useLayout } from "./layout/LayoutShell"
import { Toasts } from "./components/Toasts"
import "./App.css"

export default function App() {
  useShowWindowOnReady()
  useStartupRestore()
  useExternalChanges()
  useTheme()
  useTreeShortcuts()
  usePasteDiagnostic()
  useAiSession()
  useChatPersistence()
  useAiShortcuts()
  const updates = useUpdates()
  const rootPath = useStore((s) => s.rootPath)
  const startupRestoring = useStore((s) => s.startupRestoring)

  // Warm the heavy editor-vendor chunk (BlockNote + markdown rendering)
  // right after first paint so it's ready by the time a document opens.
  // It's lazy-imported (EditorPane / ChatView) to stay off the critical path.
  useEffect(() => {
    void import("./features/editor/BlockEditor")
  }, [])

  if (!rootPath) {
    // While startup restore is still deciding whether a recent vault can be
    // reopened, render a neutral surface instead of flashing "Open a folder"
    // at someone whose vault is about to appear.
    if (startupRestoring) {
      return <div className="h-screen bg-bg" />
    }
    return (
      <>
        <EmptyFolderState />
        <SettingsPanel />
        <DndModals />
        <UpdateBanner status={updates.status} onInstall={updates.install} onDismiss={updates.dismiss} />
      </>
    )
  }

  return (
    <>
      <div className="flex flex-col h-screen bg-bg text-text">
        <LayoutShell
          leftLabel="File panel"
          rightLabel="Assistant"
          left={<TreePane />}
          right={<AiPanel />}
          rightRail={<RightRail />}
        >
          <EditorPane />
        </LayoutShell>
        <StatusBar />
      </div>
      <CommandPalette />
      <SettingsPanel />
      <ShortcutsModal />
      <DndModals />
      <UpdateBanner status={updates.status} onInstall={updates.install} onDismiss={updates.dismiss} />
      <Toasts />
    </>
  )
}

// Collapsed-rail affordance for the assistant panel. The right pane hosts
// only the assistant now — properties moved into the editor as a collapsible
// section (PropertiesSection), so the old tab strip and dual rail buttons
// are gone.
function RightRail() {
  const { setPanelState } = useLayout()
  return (
    <div className="flex flex-col items-center gap-1 pt-2">
      <button
        type="button"
        onClick={() => setPanelState("right", "open")}
        title="Assistant"
        aria-label="Assistant"
        className="w-9 h-9 flex items-center justify-center rounded text-text-subtle hover:text-text hover:bg-elevated/60 transition-colors"
      >
        <Robot size={16} />
      </button>
    </div>
  )
}
