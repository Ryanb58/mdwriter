type ModifierState = Pick<MouseEvent, "metaKey" | "ctrlKey">

function currentPlatform(platform?: string): string {
  if (platform !== undefined) return platform
  return typeof navigator === "undefined" ? "" : navigator.platform
}

function usesCommandKey(platform?: string): boolean {
  return /^(?:Mac|iPhone|iPad|iPod)/i.test(currentPlatform(platform))
}

export function modifierClickLabel(platform?: string): "Cmd-click" | "Ctrl-click" {
  return usesCommandKey(platform) ? "Cmd-click" : "Ctrl-click"
}

export function isLinkActivationModifier(
  event: ModifierState,
  platform?: string,
): boolean {
  return usesCommandKey(platform) ? event.metaKey : event.ctrlKey
}

export function wikilinkTooltip(
  target: string,
  resolvedRel: string | null,
  platform?: string,
): string {
  if (!resolvedRel) return `Note not found: ${target}`
  return `Open ${resolvedRel} (${modifierClickLabel(platform)})`
}
