import { create } from "zustand"

export type CollisionChoice = "skip" | "rename" | "cancel"

export type CollisionRequest = {
  name: string
  targetDir: string
  suggestedRename: string
  remaining: number // how many more conflicts after this one
  resolve: (choice: { choice: CollisionChoice; applyToRest: boolean }) => void
}

export type ConfirmRequest = {
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  details?: string[]
  resolve: (ok: boolean) => void
}

type PromptState = {
  collision: CollisionRequest | null
  confirm: ConfirmRequest | null
  setCollision(r: CollisionRequest | null): void
  setConfirm(r: ConfirmRequest | null): void
}

export const usePromptStore = create<PromptState>((set) => ({
  collision: null,
  confirm: null,
  setCollision: (r) => set({ collision: r }),
  setConfirm: (r) => set({ confirm: r }),
}))

/**
 * Promise-returning wrapper for the confirm modal. Resolves true if the
 * user clicks the primary button, false on cancel or Esc.
 */
export function requestConfirm(
  req: Omit<ConfirmRequest, "resolve">,
): Promise<boolean> {
  return new Promise((resolve) => {
    usePromptStore.getState().setConfirm({ ...req, resolve })
  })
}

/**
 * Promise-returning wrapper for one collision. Resolves with the user's
 * choice and whether to apply it to all remaining conflicts.
 */
export function requestCollision(
  req: Omit<CollisionRequest, "resolve">,
): Promise<{ choice: CollisionChoice; applyToRest: boolean }> {
  return new Promise((resolve) => {
    usePromptStore.getState().setCollision({ ...req, resolve })
  })
}
