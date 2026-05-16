import { beforeEach, describe, expect, it } from "vitest"
import { useStore, deriveChatTitle } from "../store"

function resetStore() {
  useStore.setState({
    chats: {},
    activeChatId: null,
    aiMessages: [],
    aiAgent: "claude-code",
  })
}

describe("chat store", () => {
  beforeEach(resetStore)

  it("appendAiMessage auto-creates a chat when none is active", () => {
    useStore.getState().appendAiMessage({ role: "user", text: "hello there" })
    const { chats, activeChatId, aiMessages } = useStore.getState()
    expect(activeChatId).toBeTruthy()
    expect(aiMessages).toHaveLength(1)
    expect(activeChatId && chats[activeChatId].messages).toHaveLength(1)
  })

  it("titles a chat from its first user message", () => {
    useStore.getState().appendAiMessage({ role: "user", text: "Summarise these notes" })
    const { activeChatId, chats } = useStore.getState()
    expect(chats[activeChatId!].title).toBe("Summarise these notes")
  })

  it("preserves an existing title once one is set", () => {
    useStore.getState().appendAiMessage({ role: "user", text: "first question" })
    const id = useStore.getState().activeChatId!
    useStore.getState().renameChat(id, "Important thread")
    useStore.getState().appendAiMessage({ role: "user", text: "another question" })
    expect(useStore.getState().chats[id].title).toBe("Important thread")
  })

  it("createChat activates the new chat by default", () => {
    const id = useStore.getState().createChat()
    expect(useStore.getState().activeChatId).toBe(id)
  })

  it("setActiveChat switches messages and agent", () => {
    const a = useStore.getState().createChat()
    useStore.getState().appendAiMessage({ role: "user", text: "in chat a" })
    const b = useStore.getState().createChat()
    useStore.getState().appendAiMessage({ role: "user", text: "in chat b" })
    useStore.getState().setActiveChat(a)
    expect(useStore.getState().aiMessages).toHaveLength(1)
    expect((useStore.getState().aiMessages[0] as { text: string }).text).toBe("in chat a")
    expect(useStore.getState().activeChatId).toBe(a)
    expect(b).not.toBe(a)
  })

  it("deleteChat removes and falls back to the most recent remaining chat", () => {
    const a = useStore.getState().createChat()
    useStore.getState().appendAiMessage({ role: "user", text: "older" })
    const b = useStore.getState().createChat()
    useStore.getState().appendAiMessage({ role: "user", text: "newer" })
    useStore.getState().deleteChat(b)
    expect(useStore.getState().chats[b]).toBeUndefined()
    expect(useStore.getState().activeChatId).toBe(a)
  })

  it("deleteChat on the last chat clears active", () => {
    const a = useStore.getState().createChat()
    useStore.getState().deleteChat(a)
    expect(useStore.getState().activeChatId).toBeNull()
    expect(useStore.getState().aiMessages).toEqual([])
  })

  it("setChatSystemPrompt updates the chat only", () => {
    const id = useStore.getState().createChat()
    useStore.getState().setChatSystemPrompt(id, "be terse")
    expect(useStore.getState().chats[id].systemPrompt).toBe("be terse")
  })

  it("setChats falls back to the most recently updated chat when active is dropped", () => {
    useStore.setState({
      chats: {
        old: makeChat("old", 1, "older"),
        fresh: makeChat("fresh", 100, "fresher"),
      },
      activeChatId: "missing",
    })
    useStore.getState().setChats({
      old: makeChat("old", 1, "older"),
      fresh: makeChat("fresh", 100, "fresher"),
    })
    expect(useStore.getState().activeChatId).toBe("fresh")
  })
})

describe("deriveChatTitle", () => {
  it("returns the first line", () => {
    expect(deriveChatTitle("first\nsecond")).toBe("first")
  })

  it("truncates long lines", () => {
    const long = "a".repeat(120)
    const out = deriveChatTitle(long)
    expect(out.length).toBeLessThan(long.length)
    expect(out.endsWith("…")).toBe(true)
  })

  it("falls back to a default for empty input", () => {
    expect(deriveChatTitle("   ")).toBe("New chat")
  })
})

function makeChat(id: string, updatedAt: number, title: string) {
  return {
    id,
    title,
    agent: "claude-code" as const,
    messages: [],
    systemPrompt: "",
    createdAt: 0,
    updatedAt,
  }
}
