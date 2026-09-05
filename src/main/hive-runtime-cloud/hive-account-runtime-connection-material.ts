import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import type { HiveAccountRuntimeDirectoryEntry } from '../../shared/hive-runtime-cloud'
import type { HiveRuntimeCloudClient } from './hive-runtime-cloud-client'
type ConnectionIntentClient = Readonly<{
  createConnectionIntent?: HiveRuntimeCloudClient['createConnectionIntent']
}>
export type HiveAccountRuntimeConnectionMaterial = never
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
}): Promise<never> {
  if (!options.authorization || options.authorization.sessionExpiresAt <= options.now()) {
    throw new HiveAccountRuntimeConnectionUnavailableError('SIGNED_OUT')
  }
  throw new Error('Account remote connection is not ready.')
}
