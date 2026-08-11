import { browser } from "@wdio/globals"

export async function invoke<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return browser.tauri.execute(
    ({ core }, name, payload) => core.invoke<T>(name, payload),
    command,
    args,
  )
}
