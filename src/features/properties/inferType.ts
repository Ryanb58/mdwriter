export type PropertyType = "string" | "number" | "boolean" | "date" | "list" | "nested" | "null"

export function inferType(value: unknown): PropertyType {
  if (value === null || value === undefined) return "null"
  if (typeof value === "boolean") return "boolean"
  if (typeof value === "number") return "number"
  if (Array.isArray(value)) return "list"
  if (typeof value === "object") return "nested"
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value)) return "date"
    return "string"
  }
  return "string"
}
