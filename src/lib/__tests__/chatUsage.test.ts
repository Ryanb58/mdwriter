import { beforeEach, describe, expect, it } from "vitest"
import { useStore, addUsage, EMPTY_USAGE } from "../store"

describe("addUsage", () => {
  it("sums each field, defaulting missing keys to zero", () => {
    const next = addUsage(
      { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheCreationTokens: 0 },
      { inputTokens: 25, outputTokens: 5 },
    )
    expect(next).toEqual({
      inputTokens: 125,
      outputTokens: 55,
      cacheReadTokens: 10,
      cacheCreationTokens: 0,
    })
  })
})

describe("addChatUsage", () => {
  beforeEach(() => {
    useStore.setState({ chats: {}, activeChatId: null, aiMessages: [] })
  })

  it("accumulates onto the active chat's usage", () => {
    const id = useStore.getState().createChat()
    useStore.getState().addChatUsage({ inputTokens: 200, outputTokens: 50 })
    useStore.getState().addChatUsage({ inputTokens: 100 })
    expect(useStore.getState().chats[id].usage).toEqual({
      inputTokens: 300,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    })
  })

  it("is a no-op without an active chat", () => {
    useStore.getState().addChatUsage({ inputTokens: 100 })
    expect(useStore.getState().chats).toEqual({})
  })

  it("starts new chats at EMPTY_USAGE", () => {
    const id = useStore.getState().createChat()
    expect(useStore.getState().chats[id].usage).toEqual(EMPTY_USAGE)
  })
})
