type ExclusiveWork<T> = () => T | Promise<T>

function createExclusiveRunner() {
  let tail = Promise.resolve()

  return async function runExclusive<T>(work: ExclusiveWork<T>): Promise<T> {
    const previous = tail
    let release!: () => void
    tail = new Promise<void>((resolve) => {
      release = resolve
    })

    await previous
    try {
      return await work()
    } finally {
      release()
    }
  }
}

/** Keep folder-switch snapshots and rollback targets ordered. */
export const runFolderSwitchExclusive = createExclusiveRunner()

/**
 * `listTree` also establishes Rust's active-vault scope, so every frontend
 * listing must share one ordering boundary with folder switches.
 */
export const runVaultListingExclusive = createExclusiveRunner()
