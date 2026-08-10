export type DirectoryRequestToken = symbol

export class DirectoryRequestGuards {
  private readonly current = new Map<string, DirectoryRequestToken>()

  begin(key: string): DirectoryRequestToken {
    const token = Symbol(key)
    this.current.set(key, token)
    return token
  }

  isCurrent(key: string, token: DirectoryRequestToken): boolean {
    return this.current.get(key) === token
  }

  finish(key: string, token: DirectoryRequestToken): boolean {
    if (!this.isCurrent(key, token)) return false
    this.current.delete(key)
    return true
  }

  invalidateRoot(root: string): void {
    const prefix = `${root}\0`
    for (const key of this.current.keys()) {
      if (key.startsWith(prefix)) this.current.delete(key)
    }
  }
}
