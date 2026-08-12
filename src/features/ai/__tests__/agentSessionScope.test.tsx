import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/ipc")>()
  return {
    ...actual,
    ipc: {
      ...actual.ipc,
      detectAgents: vi.fn(async () => []),
      startAiSession: vi.fn(async () => {}),
      listSkills: vi.fn(async () => []),
    },
  }
})

// The whole point of the receiver-side fix: these hooks must subscribe through
// `listenForThisWindow`, never a bare `listen`.
const listenForThisWindow = vi.fn(async (_event: string, _handler: unknown) => () => {})
vi.mock("../../../lib/windowEvents", async (importOriginal) => ({
  // Partial mock: the store reads `currentWindowLabel` at module load to
  // namespace its per-window persisted entries, so the rest of the module has
  // to stay real.
  ...(await importOriginal<typeof import("../../../lib/windowEvents")>()),
  listenForThisWindow: (event: string, handler: unknown) => listenForThisWindow(event, handler),
  emitToThisWindow: vi.fn(async () => {}),
}))

import { agentBusyDetail, ipc } from "../../../lib/ipc"
import { useStore } from "../../../lib/store"
import { agentBusyMessage, sendPrompt, useAiSession, vaultName } from "../useAiSession"

const startAiSession = vi.mocked(ipc.startAiSession)

/** What Tauri rejects an `AppError::AgentBusy` command with. */
const busyRejection = {
  kind: "AgentBusy",
  message: { ownerLabel: "w-second", ownerVault: "/Users/me/other-vault" },
}

beforeEach(() => {
  listenForThisWindow.mockClear()
  startAiSession.mockReset()
  startAiSession.mockResolvedValue(undefined)
  useStore.setState({
    rootPath: "/vault",
    chats: {},
    activeChatId: null,
    aiMessages: [],
    aiRunning: false,
    aiBusy: null,
    editorSelection: null,
    openDoc: null,
    selectedPath: null,
  })
})

describe("agentBusyDetail", () => {
  it("reads the owning window off a rejected session command", () => {
    expect(agentBusyDetail(busyRejection)).toEqual({
      ownerLabel: "w-second",
      ownerVault: "/Users/me/other-vault",
    })
  })

  it("tolerates an owner window with no vault open", () => {
    expect(
      agentBusyDetail({ kind: "AgentBusy", message: { ownerLabel: "w-2", ownerVault: null } }),
    ).toEqual({ ownerLabel: "w-2", ownerVault: null })
  })

  it("ignores every other rejection shape", () => {
    // Anything unrecognized has to fall through to generic error handling —
    // treating it as "busy" would disable the composer for an unrelated failure.
    expect(agentBusyDetail(null)).toBeNull()
    expect(agentBusyDetail("boom")).toBeNull()
    expect(agentBusyDetail({ kind: "Io", message: "claude not found" })).toBeNull()
    expect(agentBusyDetail({ kind: "AgentBusy", message: "w-second" })).toBeNull()
    expect(agentBusyDetail({ kind: "AgentBusy", message: { ownerLabel: "" } })).toBeNull()
  })
})

describe("useAiSession subscriptions", () => {
  it("scopes both agent channels to this window", async () => {
    // Rust addresses `ai-stream` / `ai-permission` with `emit_to(owner)`. A bare
    // `listen()` registers EventTarget::Any, which Tauri delivers to regardless
    // of the address — so this window would render another window's tokens and,
    // worse, its approval cards.
    renderHook(() => useAiSession())

    await waitFor(() => expect(listenForThisWindow).toHaveBeenCalledTimes(2))
    const events = listenForThisWindow.mock.calls.map((call) => call[0])
    expect(events).toContain("ai-stream")
    expect(events).toContain("ai-permission")
  })
})

describe("sendPrompt when another window owns the agent", () => {
  it("records the busy state instead of surfacing a raw error", async () => {
    startAiSession.mockRejectedValue(busyRejection)

    await sendPrompt("summarize my notes")

    const state = useStore.getState()
    expect(state.aiBusy).toEqual({
      ownerLabel: "w-second",
      ownerVault: "/Users/me/other-vault",
    })
    // The turn is finished, not left spinning, and the transcript names the
    // vault rather than dumping a serialized Rust error.
    expect(state.aiRunning).toBe(false)
    const last = state.aiMessages[state.aiMessages.length - 1]
    expect(last.role).toBe("assistant")
    expect(last.text).toContain("other-vault")
    expect(last.text).not.toContain("AgentBusy")
  })

  it("clears a stale busy notice once a send succeeds", async () => {
    useStore.setState({ aiBusy: { ownerLabel: "w-second", ownerVault: "/other" } })

    await sendPrompt("try again")

    expect(useStore.getState().aiBusy).toBeNull()
  })

  it("still reports unrelated failures as errors", async () => {
    startAiSession.mockRejectedValue({ kind: "Io", message: "claude not found" })

    await sendPrompt("hello")

    expect(useStore.getState().aiBusy).toBeNull()
    const msgs = useStore.getState().aiMessages
    expect(msgs[msgs.length - 1].text).toContain("Error")
  })
})

describe("busy notice wording", () => {
  it("names the busy vault by its folder name", () => {
    expect(agentBusyMessage({ ownerLabel: "w", ownerVault: "/Users/me/Notes" })).toContain("Notes")
  })

  it("degrades gracefully when the owner has no vault", () => {
    const text = agentBusyMessage({ ownerLabel: "w", ownerVault: null })
    expect(text).toContain("another window")
    expect(text).not.toContain("**null**")
  })

  it("vaultName ignores trailing separators and falls back to the input", () => {
    expect(vaultName("/Users/me/Notes/")).toBe("Notes")
    expect(vaultName("Notes")).toBe("Notes")
    expect(vaultName("/")).toBe("/")
  })
})
