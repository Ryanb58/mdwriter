import "@wdio/tauri-service"

type TauriEventApi = {
  listen<T>(
    event: string,
    handler: (event: { payload: T }) => void,
  ): Promise<() => void>
}

declare global {
  interface Window {
    __TAURI__?: { event?: TauriEventApi }
    __mdwriterVaultChanges?: string[]
    __mdwriterStopVaultListener?: () => void
  }
}
