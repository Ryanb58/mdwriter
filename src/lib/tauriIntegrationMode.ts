export const TAURI_INTEGRATION_TEST =
  import.meta.env.VITE_TAURI_INTEGRATION_TEST === "1"

type GuestLoader = () => Promise<unknown>

export async function loadTauriIntegrationGuest(
  enabled: boolean,
  loader: GuestLoader = () => import("@wdio/tauri-plugin"),
): Promise<void> {
  if (enabled) await loader()
}

export function shouldScheduleSilentUpdateCheck(
  integrationTest: boolean,
): boolean {
  return !integrationTest
}
