import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import {
  activateHiveRuntimeCloudPresence,
  type ActivationResult
} from './hive-runtime-cloud-activation'
import {
  FatalPresenceError,
  type PresenceClient,
  type PresenceDependencies,
  type RuntimeSource
} from './hive-runtime-cloud-presence-support'
import type { HiveRuntimeCloudRegistrationState } from './hive-runtime-cloud-state-store'

type ActivationRunnerOptions = Readonly<{
  client: PresenceClient | null
  authorization: HiveRuntimeCloudAuthorization
  userDataPath: string
  bootId: string
  runtimeSource: RuntimeSource
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
  return activateHiveRuntimeCloudPresence({
    client: options.client,
    authorization: options.authorization,
    identity: loadedIdentity.identity,
    stored: stored.status === 'ok' ? stored.value : null,
    bootId: options.bootId,
    report: options.runtimeSource.getReport(),
    signal: options.signal,
    now: options.dependencies.now,
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
