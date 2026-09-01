import {
  activateClaimedHiveRuntimeCloudPresence,
  type ActivationResult
} from './hive-runtime-cloud-activation'
import {
  ClaimPendingPresenceError,
  FatalPresenceError,
  type PresenceClient,
  type PresenceDependencies
} from './hive-runtime-cloud-presence-support'
import type { HiveRuntimeCloudRegistrationState } from './hive-runtime-cloud-state-store'

type ActivationRunnerOptions = Readonly<{
  client: PresenceClient | null
  userDataPath: string
  bootId: string
  dependencies: PresenceDependencies
  signal: AbortSignal
  assertCurrent: () => void
  saveState: (state: HiveRuntimeCloudRegistrationState) => void
}>

export async function runHiveRuntimeCloudActivation(
  options: ActivationRunnerOptions
): Promise<ActivationResult> {
  if (!options.client) {
    throw new FatalPresenceError('client_unavailable')
  }
  const loadedIdentity = options.dependencies.loadIdentity(options.userDataPath)
  if (loadedIdentity.status !== 'ok') {
    throw new FatalPresenceError('identity_unavailable')
  }
  const stored = options.dependencies.readState(options.userDataPath)
  if (stored.status === 'unavailable' || stored.status === 'unreadable') {
    throw new FatalPresenceError('registration_state_unavailable')
  }
  if (stored.status !== 'ok' || stored.value.status !== 'CLAIMED') {
    throw new ClaimPendingPresenceError('runtime_claim_required')
  }
  return activateClaimedHiveRuntimeCloudPresence({
    client: options.client,
    identity: loadedIdentity.identity,
    stored: stored.value,
    bootId: options.bootId,
    signal: options.signal,
    randomUuid: options.dependencies.randomUuid,
    assertCurrent: options.assertCurrent,
    saveState: options.saveState
  })
}

export function persistHiveRuntimeCloudRegistrationState(
  dependencies: PresenceDependencies,
  userDataPath: string,
  state: HiveRuntimeCloudRegistrationState
): void {
  if (!dependencies.saveState(userDataPath, state)) {
    throw new FatalPresenceError('registration_state_write_failed')
  }
}
