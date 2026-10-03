type DirectoryOperationLane = 'refresh' | 'presence'
const MAXIMUM_PRESENCE_IDS_PER_REFRESH = 500

export type AccountRuntimeDirectoryOperationState = {
  epoch: number
  readonly flights: Record<DirectoryOperationLane, Promise<void> | null>
  readonly controllers: Record<DirectoryOperationLane, AbortController | null>
}

export function createAccountRuntimeDirectoryOperationState(): AccountRuntimeDirectoryOperationState {
  return {
    epoch: 0,
    flights: { refresh: null, presence: null },
    controllers: { refresh: null, presence: null }
  }
}

export function selectAccountRuntimePresenceBatch(
  runtimeRecordIds: readonly string[],
  offset: number
): Readonly<{ runtimeRecordIds: readonly string[]; nextOffset: number }> {
  if (runtimeRecordIds.length === 0) {
    return { runtimeRecordIds: [], nextOffset: 0 }
  }
  const start =
    Number.isSafeInteger(offset) && offset >= 0 && offset < runtimeRecordIds.length ? offset : 0
  const end = Math.min(start + MAXIMUM_PRESENCE_IDS_PER_REFRESH, runtimeRecordIds.length)
  return {
    runtimeRecordIds: runtimeRecordIds.slice(start, end),
    nextOffset: end === runtimeRecordIds.length ? 0 : end
  }
}

export function invalidateAccountRuntimeDirectoryOperations(
  state: AccountRuntimeDirectoryOperationState
): void {
  state.epoch += 1
  state.controllers.refresh?.abort()
  state.controllers.presence?.abort()
  state.flights.refresh = null
  state.flights.presence = null
  state.controllers.refresh = null
  state.controllers.presence = null
}

export function runAccountRuntimeDirectoryOperation(
  state: AccountRuntimeDirectoryOperationState,
  lane: DirectoryOperationLane,
  operation: (isCurrent: () => boolean, signal: AbortSignal) => Promise<void>
): Promise<void> {
  const current = state.flights[lane]
  if (current) {
    return current
  }
  const epoch = state.epoch
  const controller = new AbortController()
  state.controllers[lane] = controller
  let pending: Promise<void>
  try {
    pending = operation(() => state.epoch === epoch, controller.signal)
  } catch (error) {
    if (state.controllers[lane] === controller) {
      state.controllers[lane] = null
    }
    throw error
  }
  // An operation may synchronously trigger an auth/app-state invalidation
  // before returning its Promise. Do not resurrect that cancelled lane.
  if (state.epoch !== epoch || state.controllers[lane] !== controller) {
    controller.abort()
    return pending
  }
  state.flights[lane] = pending
  const finish = () => {
    if (state.flights[lane] === pending) {
      state.flights[lane] = null
      state.controllers[lane] = null
    }
  }
  void pending.then(finish, finish)
  return pending
}
