/** Stable editor identity for one loaded buffer; path-only remaps keep it. */
export function documentRenderKey(docRev: number): string {
  return `document:${docRev}`
}
