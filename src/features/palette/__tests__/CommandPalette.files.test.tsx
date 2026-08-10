import { act, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.stubGlobal("ResizeObserver", class {
  observe() {}
  unobserve() {}
  disconnect() {}
})
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
})

vi.mock("../../../lib/vaultNotes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/vaultNotes")>()
  return {
    ...actual,
    useVaultNotes: () => [],
    useOnDemandVaultNotes: () => ({
      notes: [
        {
          name: "Unloaded note",
          path: "/vault/deep/unloaded.md",
          rel: "deep/unloaded.md",
        },
      ],
      status: "ready",
      error: null,
    }),
  }
})

import { useStore } from "../../../lib/store"
import { CommandPalette } from "../CommandPalette"
import { openPalette } from "../openPalette"

describe("file palette", () => {
  beforeEach(() => {
    useStore.setState({
      rootPath: "/vault",
      tree: {
        kind: "dir",
        name: "vault",
        path: "/vault",
        loaded: true,
        children: [
          { kind: "dir", name: "deep", path: "/vault/deep", loaded: false, children: [] },
        ],
      },
    })
  })

  it("shows notes from folders that have not been expanded", async () => {
    render(<CommandPalette />)
    act(() => openPalette("file"))

    expect(await screen.findByText("Unloaded note")).toBeInTheDocument()
  })
})
