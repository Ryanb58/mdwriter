import { describe, it, expect } from "vitest"
import { describeUpdateError } from "../useUpdates"

describe("describeUpdateError", () => {
  it("maps signature/verification failures to a safety message", () => {
    for (const raw of [
      "signature verification failed",
      "Error: the update could not be verified",
      "untrusted comment mismatch",
      "minisign: invalid signature",
    ]) {
      expect(describeUpdateError(raw)).toContain("could not be verified")
    }
  })

  it("maps network/transport failures to a connection message", () => {
    for (const raw of [
      "error sending request for url",
      "failed to connect to host",
      "dns error: no such host",
      "operation timed out",
      "tcp connect error: Connection refused (os error 61)",
    ]) {
      expect(describeUpdateError(raw)).toContain("update server")
    }
  })

  it("passes through an unrecognized message unchanged", () => {
    expect(describeUpdateError("something weird happened")).toBe(
      "something weird happened",
    )
  })

  it("unwraps Error instances and falls back for empty input", () => {
    expect(describeUpdateError(new Error("signature bad"))).toContain(
      "could not be verified",
    )
    expect(describeUpdateError("")).toBe("Update failed for an unknown reason.")
  })
})
