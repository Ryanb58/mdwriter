export type DiffLine =
  | { kind: "equal"; text: string }
  | { kind: "add"; text: string }
  | { kind: "remove"; text: string }

/**
 * Classic Myers-style line diff via LCS, simplified. Output is a flat list of
 * line ops in source order — equal lines surface in context, add/remove are
 * the diff. Suitable for the small payloads that fit in a chat reply; not
 * optimised for files in the megabyte range.
 *
 * Both inputs are split on `\n`. A trailing empty line caused by a final
 * newline is normalised away so two semantically-equal documents diff empty.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before)
  const b = splitLines(after)
  const n = a.length
  const m = b.length

  // LCS DP table.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "equal", text: a[i] })
      i++; j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: "remove", text: a[i] })
      i++
    } else {
      out.push({ kind: "add", text: b[j] })
      j++
    }
  }
  while (i < n) out.push({ kind: "remove", text: a[i++] })
  while (j < m) out.push({ kind: "add", text: b[j++] })
  return out
}

function splitLines(s: string): string[] {
  const parts = s.split("\n")
  // Drop the trailing "" produced by a terminal newline so files-with-newline
  // and files-without don't diff as a phantom add/remove.
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop()
  return parts
}
