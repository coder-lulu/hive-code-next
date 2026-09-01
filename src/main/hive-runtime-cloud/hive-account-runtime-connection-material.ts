import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import type { HiveAccountRuntimeDirectoryEntry } from '../../shared/hive-runtime-cloud'
import { generateKeyPair } from '../../shared/e2ee-crypto'
import { RemoteRuntimeClientError } from '../../shared/remote-runtime-client-error'
import type { RuntimeEnvironmentAccountClaim } from '../../shared/runtime-environments'
import type { HiveRuntimeCloudClient } from './hive-runtime-cloud-client'
import { isHiveAccountRuntimeCloudConnectable } from './hive-runtime-catalog'

type ConnectionIntentClient = Readonly<{
  createConnectionIntent?: HiveRuntimeCloudClient['createConnectionIntent']
}>

export type HiveAccountRuntimeConnectionMaterial = Readonly<{
  connectionIntentId: string
  ticketId: string
  ticketSecret: string
  runtimeRecordId: string
  expiresAt: number
  runtimePublicKeyB64: string
  clientKeyPair: ReturnType<typeof generateKeyPair>
  relay: Readonly<{
    cellUrl: string
    relayHostId: string
    assignmentEpoch: number
    e2eeFraming: 'hive-e2ee-v1'
  }>
}>

export class HiveAccountRuntimeConnectionUnavailableError extends Error {
  constructor(readonly code: 'SIGNED_OUT' | 'RUNTIME_NOT_FOUND' | 'STALE' | 'RELAY_UNAVAILABLE') {
    super(`hive_account_runtime_connection_${code.toLowerCase()}`)
    this.name = 'HiveAccountRuntimeConnectionUnavailableError'
  }
}

export function assertHiveAccountRuntimeCloudConnectable(
  claim: RuntimeEnvironmentAccountClaim
): void {
  if (!claim.cloudConnectable) {
    throw new RemoteRuntimeClientError(
      'remote_runtime_unavailable',
      claim.presence === 'OFFLINE'
        ? 'Cloud Runtime is offline.'
        : 'Cloud Runtime relay is not available.'
    )
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
  const { authorization, client, runtimeRecordId, expectedResourceVersion } = options
  if (
    !authorization ||
    !client?.createConnectionIntent ||
    authorization.sessionExpiresAt <= options.now()
  ) {
    throw new HiveAccountRuntimeConnectionUnavailableError('SIGNED_OUT')
  }
  const directoryEntry = options.findEntry(runtimeRecordId)
  if (!directoryEntry) {
    throw new HiveAccountRuntimeConnectionUnavailableError('RUNTIME_NOT_FOUND')
  }
  if (directoryEntry.resourceVersion !== expectedResourceVersion) {
    throw new HiveAccountRuntimeConnectionUnavailableError('STALE')
  }
  if (!isHiveAccountRuntimeCloudConnectable(directoryEntry)) {
    throw new HiveAccountRuntimeConnectionUnavailableError('RELAY_UNAVAILABLE')
  }

  const ticketSecret = randomBytes(32).toString('base64url')
  const clientKeyPair = generateKeyPair()
  const intent = await client.createConnectionIntent(
    runtimeRecordId,
    {
      clientKind: 'DESKTOP',
      expectedResourceVersion,
      ticketSecretSha256: createHash('sha256').update(ticketSecret).digest('base64url'),
      clientEphemeralPublicKey: Buffer.from(clientKeyPair.publicKey).toString('base64url')
    },
    authorization.accessToken,
    randomUUID(),
    options.signal
  )
  options.assertAuthorizationCurrent(authorization)
  const currentEntry = options.findEntry(runtimeRecordId)
  if (!currentEntry) {
    throw new HiveAccountRuntimeConnectionUnavailableError('RUNTIME_NOT_FOUND')
  }
  if (
    currentEntry.resourceVersion !== expectedResourceVersion ||
    !isHiveAccountRuntimeCloudConnectable(currentEntry) ||
    intent.runtimeRecordId !== runtimeRecordId ||
    intent.expiresAt <= options.now()
  ) {
    throw new HiveAccountRuntimeConnectionUnavailableError('STALE')
  }
  if (!intent.relay) {
    throw new HiveAccountRuntimeConnectionUnavailableError('RELAY_UNAVAILABLE')
  }
  return { ...intent, relay: intent.relay, ticketSecret, clientKeyPair }
}
