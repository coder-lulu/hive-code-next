import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import type { HiveAccountRuntimeDirectoryEntry } from '../../shared/hive-runtime-cloud'
import type { HiveRuntimeCloudClient } from './hive-runtime-cloud-client'
import {
  acquireHiveAccountRelayMaterial,
  disposeHiveAccountRelayMaterial,
  type HiveAccountRelayMaterial
} from '../../shared/hive-account-relay-material'
type ConnectionIntentClient = Readonly<{
  createConnectionIntent?: HiveRuntimeCloudClient['createConnectionIntent']
}>
export type HiveAccountRuntimeConnectionMaterial = HiveAccountRelayMaterial
export class HiveAccountRuntimeConnectionUnavailableError extends Error {
  constructor(readonly code: 'SIGNED_OUT' | 'RUNTIME_NOT_FOUND' | 'STALE' | 'RELAY_UNAVAILABLE') {
    super(`hive_account_runtime_connection_${code.toLowerCase()}`)
    this.name = 'HiveAccountRuntimeConnectionUnavailableError'
  }
}

export async function createHiveAccountRuntimeConnectionMaterial(options: {
  runtimeRecordId: string
  expectedResourceVersion: number
  signal?: AbortSignal
  authorization: HiveRuntimeCloudAuthorization | null
  client: ConnectionIntentClient | null
  findEntry: (runtimeRecordId: string) => HiveAccountRuntimeDirectoryEntry | undefined
  now: () => number
  assertAuthorizationCurrent: (authorization: HiveRuntimeCloudAuthorization) => void
}): Promise<HiveAccountRuntimeConnectionMaterial> {
  if (!options.authorization || options.authorization.sessionExpiresAt <= options.now()) {
    throw new HiveAccountRuntimeConnectionUnavailableError('SIGNED_OUT')
  }
  const authorization = options.authorization
  const createIntent = options.client?.createConnectionIntent?.bind(options.client)
  const entry = options.findEntry(options.runtimeRecordId)
  if (!entry) {
    throw new HiveAccountRuntimeConnectionUnavailableError('RUNTIME_NOT_FOUND')
  }
  if (entry.resourceVersion !== options.expectedResourceVersion) {
    throw new HiveAccountRuntimeConnectionUnavailableError('STALE')
  }
  if (!createIntent || options.signal?.aborted) {
    throw new HiveAccountRuntimeConnectionUnavailableError('RELAY_UNAVAILABLE')
  }
  options.assertAuthorizationCurrent(authorization)
  const material = await acquireHiveAccountRelayMaterial({
    clientKind: 'DESKTOP',
    expectedResourceVersion: options.expectedResourceVersion,
    now: options.now,
    createIntent: (request) =>
      createIntent(
        options.runtimeRecordId,
        request,
        authorization.accessToken,
        request.idempotencyKey,
        options.signal
      )
  })
  try {
    options.assertAuthorizationCurrent(authorization)
    if (options.signal?.aborted) {
      throw new HiveAccountRuntimeConnectionUnavailableError('STALE')
    }
    return material
  } catch (error) {
    disposeHiveAccountRelayMaterial(material)
    throw error
  }
}
