import { useEffect } from "react"
import { useStore, type Theme } from "../../lib/store"

/**
 * Resolve the user's theme preference to "light" | "dark" and apply the
 * matching class to <html>. Re-runs whenever the user setting changes or
 * the system color scheme changes.
 */
export function useTheme() {
  const theme = useStore((s) => s.settings.theme)

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)")

    function apply() {
      const resolved = resolveTheme(theme, mql.matches ? "dark" : "light")
      const root = document.documentElement
      root.classList.toggle("dark", resolved === "dark")
      root.classList.toggle("light", resolved === "light")
    }

    apply()
    mql.addEventListener("change", apply)
    return () => mql.removeEventListener("change", apply)
  }, [theme])
}

/**
 * Resolved theme for components that need to know the actual mode (e.g. BlockNote).
 */
export function useResolvedTheme(): "light" | "dark" {
  const theme = useStore((s) => s.settings.theme)
  if (theme === "light" || theme === "dark") return theme
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark"
  }
  return "light"
}

function resolveTheme(theme: Theme, system: "light" | "dark"): "light" | "dark" {
  if (theme === "system") return system
  return theme
}
