import { describe, expect, it } from "vitest"
import {
  isLinkActivationModifier,
  modifierClickLabel,
  wikilinkTooltip,
} from "../linkAffordance"

describe("link affordances", () => {
  it("uses Cmd-click on Apple platforms", () => {
    expect(modifierClickLabel("MacIntel")).toBe("Cmd-click")
    expect(modifierClickLabel("iPad")).toBe("Cmd-click")
    expect(isLinkActivationModifier({ metaKey: true, ctrlKey: false }, "MacIntel")).toBe(true)
    expect(isLinkActivationModifier({ metaKey: false, ctrlKey: true }, "MacIntel")).toBe(false)
  })

  it("uses Ctrl-click on non-Apple platforms", () => {
    expect(modifierClickLabel("Win32")).toBe("Ctrl-click")
    expect(modifierClickLabel("Linux x86_64")).toBe("Ctrl-click")
    expect(isLinkActivationModifier({ metaKey: false, ctrlKey: true }, "Win32")).toBe(true)
    expect(isLinkActivationModifier({ metaKey: true, ctrlKey: false }, "Win32")).toBe(false)
  })

  it("includes the resolved vault-relative path and the platform gesture", () => {
    expect(wikilinkTooltip("Example", "notes/example.md", "MacIntel")).toBe(
      "Open notes/example.md (Cmd-click)",
    )
    expect(wikilinkTooltip("Example", "notes/example.md", "Win32")).toBe(
      "Open notes/example.md (Ctrl-click)",
    )
  })

  it("describes an unresolved target without offering navigation", () => {
    expect(wikilinkTooltip("missing target", null, "MacIntel")).toBe(
      "Note not found: missing target",
    )
  })
})
