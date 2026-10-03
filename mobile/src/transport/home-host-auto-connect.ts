import type { ConnectionState, HostProfile } from './types'

export const HOME_AUTO_CONNECT_CONCURRENCY = 3

export type HomeAutoConnectProgress = Readonly<{
  candidateIds: readonly string[]
  started: readonly string[]
  pending: readonly string[]
  failed: readonly string[]
  retrying: readonly string[]
  nextIndex: number
  skipStarted: ReadonlySet<string>
}>

export const EMPTY_HOME_AUTO_CONNECT_PROGRESS: HomeAutoConnectProgress = {
  candidateIds: [],
  started: [],
  pending: [],
  failed: [],
  retrying: [],
  nextIndex: 0,
  skipStarted: new Set()
}

export function selectHomeAutoConnectHostIds(hosts: readonly HostProfile[]): string[] {
  const seen = new Set<string>()
  return [...hosts]
    .filter(
      (host) => host.accountRuntime || (host.deviceToken.length > 0 && host.publicKeyB64.length > 0)
    )
    .sort(
      (left, right) => right.lastConnected - left.lastConnected || left.id.localeCompare(right.id)
    )
    .map((host) => host.id)
    .filter((id) => {
      if (seen.has(id)) {
        return false
      }
      seen.add(id)
      return true
    })
}

export function advanceHomeAutoConnectProgress(
  candidates: readonly string[],
  previous: HomeAutoConnectProgress,
  stateOf: (hostId: string) => ConnectionState | null
): HomeAutoConnectProgress {
  const candidatesChanged = candidates !== previous.candidateIds
  const candidateSet = candidatesChanged ? new Set(candidates) : null
  const started = candidateSet
    ? previous.started.filter((id) => candidateSet.has(id))
    : previous.started
  const pending = candidateSet
    ? previous.pending.filter((id) => candidateSet.has(id))
    : previous.pending
  const keepRetrying = new Set(candidates.slice(0, HOME_AUTO_CONNECT_CONCURRENCY))
  const failed = candidateSet
    ? previous.failed.filter((id) => candidateSet.has(id) && !keepRetrying.has(id))
    : previous.failed
  const retrying = candidateSet
    ? previous.retrying.filter((id) => candidateSet.has(id) && keepRetrying.has(id))
    : previous.retrying
  const newlyFailed: string[] = []
  const newlyRetrying: string[] = []
  if (candidateSet) {
    const failedSet = new Set(failed)
    for (const id of previous.retrying) {
      if (candidateSet.has(id) && !keepRetrying.has(id)) {
        const state = stateOf(id)
        if (state !== 'connected' && state !== 'auth-failed' && !failedSet.has(id)) {
          newlyFailed.push(id)
          failedSet.add(id)
        }
      }
    }
    for (const id of previous.failed) {
      if (keepRetrying.has(id)) {
        newlyRetrying.push(id)
      }
    }
  }
  const skipStarted = candidateSet ? new Set(started) : previous.skipStarted
  const stillPending: string[] = []
  for (const id of pending) {
    const state = stateOf(id)
    if (state === 'connecting' || state === 'handshaking') {
      stillPending.push(id)
    } else if (state === null || state === 'disconnected' || state === 'reconnecting') {
      if (keepRetrying.has(id)) {
        newlyRetrying.push(id)
      } else {
        newlyFailed.push(id)
      }
    }
  }
  const stillRetrying = retrying.filter((id) => {
    const state = stateOf(id)
    return state !== 'connected' && state !== 'auth-failed'
  })
  let nextIndex = candidatesChanged ? 0 : previous.nextIndex
  const additions: string[] = []
  while (
    stillPending.length + additions.length < HOME_AUTO_CONNECT_CONCURRENCY &&
    nextIndex < candidates.length
  ) {
    const id = candidates[nextIndex++]!
    if (!skipStarted.has(id)) {
      additions.push(id)
    }
  }
  if (
    !candidatesChanged &&
    stillPending.length === pending.length &&
    stillRetrying.length === retrying.length &&
    newlyFailed.length === 0 &&
    newlyRetrying.length === 0 &&
    additions.length === 0 &&
    nextIndex === previous.nextIndex
  ) {
    return previous
  }
  return {
    candidateIds: candidates,
    started: additions.length > 0 ? [...started, ...additions] : started,
    pending: [...stillPending, ...additions],
    failed: newlyFailed.length > 0 ? [...failed, ...newlyFailed] : failed,
    retrying: newlyRetrying.length > 0 ? [...stillRetrying, ...newlyRetrying] : stillRetrying,
    nextIndex,
    skipStarted
  }
}

export function resolveHomeHostConnectionState(
  hostId: string,
  state: ConnectionState | undefined,
  autoConnectHostIds: readonly string[]
): ConnectionState {
  return state ?? (autoConnectHostIds.includes(hostId) ? 'connecting' : 'disconnected')
}
