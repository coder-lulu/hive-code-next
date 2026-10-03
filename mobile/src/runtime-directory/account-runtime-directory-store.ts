import type {
  AccountRuntimeDirectoryEntry,
  AccountRuntimeDirectoryScope,
  AccountRuntimeDirectoryState,
  RuntimePresenceEntry
} from './account-runtime-directory-types'

const EMPTY_STATE: AccountRuntimeDirectoryState = {
  generation: 0,
  scope: null,
  status: 'idle',
  entries: [],
  loadedAt: null,
  error: null
}

export class AccountRuntimeDirectoryStore {
  private state: AccountRuntimeDirectoryState = EMPTY_STATE
  private readonly listeners = new Set<() => void>()
  private latestPresenceSequence = 0
  private readonly presenceLoadedAt = new Map<string, number>()

  isDirectoryFresh(scope: AccountRuntimeDirectoryScope, now = Date.now()): boolean {
    const { loadedAt, status } = this.state
    return (
      status === 'ready' &&
      this.state.scope?.accountId === scope.accountId &&
      this.state.scope.authorityId === scope.authorityId &&
      loadedAt !== null &&
      now >= loadedAt &&
      now - loadedAt < 5 * 60_000
    )
  }

  stalePresenceIds(now = Date.now()): string[] {
    return this.state.entries
      .filter((entry) => {
        const loadedAt = this.presenceLoadedAt.get(entry.runtimeRecordId)
        return loadedAt === undefined || now < loadedAt || now - loadedAt >= 30_000
      })
      .map((entry) => entry.runtimeRecordId)
  }

  getSnapshot = (): AccountRuntimeDirectoryState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  activate(scope: AccountRuntimeDirectoryScope): number {
    const sameScope =
      this.state.scope?.accountId === scope.accountId &&
      this.state.scope.authorityId === scope.authorityId
    const generation = this.state.generation + 1
    this.latestPresenceSequence = 0
    if (!sameScope) {
      this.presenceLoadedAt.clear()
    }
    this.publish({
      generation,
      scope,
      status: sameScope && this.state.entries.length > 0 ? 'refreshing' : 'loading',
      entries: sameScope ? this.state.entries : [],
      loadedAt: sameScope ? this.state.loadedAt : null,
      error: null
    })
    return generation
  }

  complete(
    generation: number,
    entries: readonly AccountRuntimeDirectoryEntry[],
    now: number
  ): void {
    if (generation !== this.state.generation || !this.state.scope) {
      return
    }
    this.presenceLoadedAt.clear()
    for (const entry of entries) {
      this.presenceLoadedAt.set(entry.runtimeRecordId, now)
    }
    this.publish({
      ...this.state,
      status: 'ready',
      entries: [...entries],
      loadedAt: now,
      error: null
    })
  }

  fail(generation: number, error: string): void {
    if (generation !== this.state.generation || !this.state.scope) {
      return
    }
    this.publish({
      ...this.state,
      status: 'error',
      error,
      entries: this.state.entries
    })
  }

  updatePresence(
    generation: number,
    sequence: number,
    presence: readonly RuntimePresenceEntry[],
    now = Date.now()
  ): void {
    if (
      generation !== this.state.generation ||
      !this.state.scope ||
      sequence <= this.latestPresenceSequence
    ) {
      return
    }
    this.latestPresenceSequence = sequence
    const byRuntimeId = new Map(presence.map((entry) => [entry.runtimeRecordId, entry]))
    let changed = false
    const entries = this.state.entries.map((entry) => {
      const current = byRuntimeId.get(entry.runtimeRecordId)
      if (!current) {
        return entry
      }
      this.presenceLoadedAt.set(entry.runtimeRecordId, now)
      const readinessReasonCode = current.readinessReasonCode ?? null
      const freeDiskBytes = current.freeDiskBytes ?? null
      if (
        entry.presence === current.presence &&
        entry.lastHeartbeatAt === current.lastHeartbeatAt &&
        entry.readiness === current.readiness &&
        entry.readinessReasonCode === readinessReasonCode &&
        entry.freeDiskBytes === freeDiskBytes
      ) {
        return entry
      }
      changed = true
      return {
        ...entry,
        presence: current.presence,
        lastHeartbeatAt: current.lastHeartbeatAt,
        readiness: current.readiness,
        readinessReasonCode,
        freeDiskBytes
      }
    })
    if (changed) {
      this.publish({ ...this.state, entries })
    }
  }

  clear(): void {
    this.presenceLoadedAt.clear()
    this.latestPresenceSequence = 0
    this.publish({ ...EMPTY_STATE, generation: this.state.generation + 1 })
  }

  private publish(next: AccountRuntimeDirectoryState): void {
    this.state = next
    for (const listener of this.listeners) {
      listener()
    }
  }
}
