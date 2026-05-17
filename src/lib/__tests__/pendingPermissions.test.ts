import { beforeEach, describe, expect, it } from "vitest"
import { useStore } from "../store"

function reset() {
  useStore.setState({ pendingPermissions: {}, pendingPermissionOrder: [] })
}

const baseReq = {
  tool: "Read",
  input: { file_path: "/x" },
  toolUseId: null,
}

describe("pendingPermissions reducer", () => {
  beforeEach(reset)

  it("addPendingPermission inserts and preserves order", () => {
    useStore.getState().addPendingPermission({ id: "a", ...baseReq })
    useStore.getState().addPendingPermission({ id: "b", ...baseReq, tool: "Edit" })
    useStore.getState().addPendingPermission({ id: "c", ...baseReq, tool: "Bash" })
    const s = useStore.getState()
    expect(s.pendingPermissionOrder).toEqual(["a", "b", "c"])
    expect(s.pendingPermissions.a.tool).toBe("Read")
    expect(s.pendingPermissions.b.tool).toBe("Edit")
    expect(s.pendingPermissions.c.tool).toBe("Bash")
  })

  it("addPendingPermission is idempotent on duplicate ids", () => {
    useStore.getState().addPendingPermission({ id: "a", ...baseReq })
    useStore.getState().addPendingPermission({ id: "a", ...baseReq, tool: "Edit" })
    const s = useStore.getState()
    expect(s.pendingPermissionOrder).toEqual(["a"])
    expect(s.pendingPermissions.a.tool).toBe("Read")
  })

  it("resolvePendingPermission removes the entry from both map and order", () => {
    useStore.getState().addPendingPermission({ id: "a", ...baseReq })
    useStore.getState().addPendingPermission({ id: "b", ...baseReq })
    useStore.getState().resolvePendingPermission("a")
    const s = useStore.getState()
    expect(s.pendingPermissionOrder).toEqual(["b"])
    expect(s.pendingPermissions.a).toBeUndefined()
    expect(s.pendingPermissions.b).toBeDefined()
  })

  it("resolvePendingPermission on a missing id is a no-op", () => {
    useStore.getState().addPendingPermission({ id: "a", ...baseReq })
    useStore.getState().resolvePendingPermission("nope")
    expect(useStore.getState().pendingPermissionOrder).toEqual(["a"])
  })

  it("clearPendingPermissions empties everything", () => {
    useStore.getState().addPendingPermission({ id: "a", ...baseReq })
    useStore.getState().addPendingPermission({ id: "b", ...baseReq })
    useStore.getState().clearPendingPermissions()
    const s = useStore.getState()
    expect(s.pendingPermissionOrder).toEqual([])
    expect(s.pendingPermissions).toEqual({})
  })

  it("receivedAt is set on add and survives resolve of other entries", () => {
    useStore.getState().addPendingPermission({ id: "a", ...baseReq })
    const at = useStore.getState().pendingPermissions.a.receivedAt
    expect(typeof at).toBe("number")
    useStore.getState().addPendingPermission({ id: "b", ...baseReq })
    useStore.getState().resolvePendingPermission("b")
    expect(useStore.getState().pendingPermissions.a.receivedAt).toBe(at)
  })
})
