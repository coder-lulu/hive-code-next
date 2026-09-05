import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto'
import { HiveRuntimeCloudHttpClient } from '../hive-runtime-cloud-http-client'
import type { CurrentHiveRuntimeCloudLeaseContext } from '../hive-runtime-cloud-lease-context'
import { canonicalRuntimeHeartbeatBody } from '../hive-runtime-cloud-proof-core'
import { exactKeys, isRecord } from '../hive-runtime-cloud-response'
import type {
  ControlLeaseForCell,
  HiveRuntimeRelayConsumeInput,
  HiveRuntimeRelayConsumeResult,
  RelayTokenForDirector
} from './hive-runtime-relay-types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
function invalid(): never {
  throw new Error('invalid_hive_runtime_relay_response')
}
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!isRecord(value)) {
    return invalid()
  }
  exactKeys(value, keys)
  return value
}
function integer(value: unknown, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    return invalid()
  }
  return value
}
function text(value: unknown, pattern: RegExp, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum || !pattern.test(value)) {
    return invalid()
  }
  return value
}
export function requireHiveRuntimeRelayOrigin(value: unknown): string {
  const origin = text(value, /^https:\/\/[a-z0-9.-]+(?::[0-9]+)?$/, 256)
  const url = new URL(origin)
  if (
    url.origin !== origin ||
    /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) ||
    url.hostname.length > 253 ||
    url.hostname
      .split('.')
      .some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    url.port === '0'
  ) {
    return invalid()
  }
  return origin
}

export function createHiveRuntimeRelayProofRequest(
  context: CurrentHiveRuntimeCloudLeaseContext,
  path: string,
  body: Record<string, unknown>,
  issuedAt = Date.now(),
  nonce = randomUUID()
): Record<string, unknown> {
  const tuple = context.tuple
  const proof = {
    protocolVersion: 'hive-relay-runtime-proof/v2',
    algorithm: 'Ed25519',
    method: 'POST',
    path,
    authorityId: context.authorityId,
    runtimeId: tuple.runtimeInstanceId,
    runtimeBootId: tuple.bootId,
    authorityGeneration: tuple.authorityGeneration,
    fencingEpoch: tuple.fencingEpoch,
    leaseEpoch: tuple.leaseEpoch,
    issuedAt,
    nonce,
    bodySha256: createHash('sha256').update(canonicalRuntimeHeartbeatBody(body)).digest('hex')
  }
  const key = createPrivateKey({
    key: Buffer.from(context.identity.privateKeyPkcs8, 'base64'),
    format: 'der',
    type: 'pkcs8'
  })
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('invalid_hive_runtime_relay_identity')
  }
  return {
    ...body,
    runtimeProof: {
      ...proof,
      signature: sign(null, Buffer.from(Object.values(proof).join('\n')), key).toString('base64url')
    }
  }
}

export class HiveRuntimeRelayCloudClient extends HiveRuntimeCloudHttpClient {
  async bindHost(
    context: CurrentHiveRuntimeCloudLeaseContext,
    input: {
      hostPublicKeyB64: string
      requestedRelayHostId: string
      expectedBindingVersion: number
    },
    signal?: AbortSignal
  ) {
    const path = '/hive/v1/runtime-relay-hosts'
    const tuple = context.tuple
    const body = {
      protocolVersion: 2,
      runtimeId: tuple.runtimeInstanceId,
      runtimeBootId: tuple.bootId,
      authorityGeneration: tuple.authorityGeneration,
      fencingEpoch: tuple.fencingEpoch,
      leaseEpoch: tuple.leaseEpoch,
      ...input
    }
    const response = record(
      await this.request(
        path,
        createHiveRuntimeRelayProofRequest(context, path, body),
        {},
        200,
        signal
      ),
      ['protocolVersion', 'relayHostId', 'hostBindingVersion']
    )
    if (response.protocolVersion !== 2 || response.relayHostId !== input.requestedRelayHostId) {
      return invalid()
    }
    return {
      relayHostId: text(response.relayHostId, /^[A-Za-z0-9_-]{16}$/, 16),
      hostBindingVersion: integer(response.hostBindingVersion, 1)
    }
  }

  async authorize(context: CurrentHiveRuntimeCloudLeaseContext, signal?: AbortSignal) {
    const path = `/hive/v1/runtimes/${text(context.tuple.runtimeRecordId, UUID, 36)}/relay/authorizations`
    const body = { protocolVersion: 2, capabilities: ['ticket-connect-v2'] }
    const response = record(
      await this.request(
        path,
        createHiveRuntimeRelayProofRequest(context, path, body),
        {},
        200,
        signal
      ),
      ['protocolVersion', 'relayToken', 'expiresAt']
    )
    if (response.protocolVersion !== 2) {
      return invalid()
    }
    return {
      relayToken: text(
        response.relayToken,
        /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
        8192
      ) as RelayTokenForDirector,
      expiresAt: integer(response.expiresAt)
    }
  }

  async assign(
    input: {
      hostPublicKeyB64: string
      requestedRegion?: string
      relayToken: RelayTokenForDirector
    },
    signal?: AbortSignal
  ) {
    const response = record(
      await this.request(
        '/v1/assign',
        {
          protocolVersion: 2,
          hostPublicKeyB64: input.hostPublicKeyB64,
          ...(input.requestedRegion !== undefined ? { requestedRegion: input.requestedRegion } : {})
        },
        { authorization: `Bearer ${input.relayToken}` },
        200,
        signal
      ),
      [
        'protocolVersion',
        'cellUrl',
        'cellId',
        'cellIncarnationId',
        'assignmentId',
        'assignmentEpoch',
        'relayHostId',
        'controlLease',
        'controlLeaseExpiresAt'
      ]
    )
    return normalizeAssignment(response)
  }

  async consume(
    context: CurrentHiveRuntimeCloudLeaseContext,
    ticketId: string,
    input: HiveRuntimeRelayConsumeInput,
    signal?: AbortSignal
  ): Promise<HiveRuntimeRelayConsumeResult> {
    const path = `/hive/v1/runtime-connection-tickets/${text(ticketId, UUID, 36)}/consume`
    const tuple = context.tuple
    const body = {
      protocolVersion: 'account-runtime-ticket-consume/v2',
      runtimeId: tuple.runtimeInstanceId,
      runtimeBootId: tuple.bootId,
      authorityGeneration: tuple.authorityGeneration,
      fencingEpoch: tuple.fencingEpoch,
      leaseEpoch: tuple.leaseEpoch,
      ...input
    }
    const response = record(
      await this.request(
        path,
        createHiveRuntimeRelayProofRequest(context, path, body),
        {},
        200,
        signal
      ),
      [
        'protocolVersion',
        'managedSessionId',
        'runtimeSessionId',
        'status',
        'activationDeadlineAt',
        'absoluteExpiresAt',
        'controlVersion'
      ]
    )
    if (
      response.protocolVersion !== 'account-runtime-ticket-consume/v2' ||
      response.status !== 'PENDING_ACTIVATION'
    ) {
      return invalid()
    }
    const activationDeadlineAt = integer(response.activationDeadlineAt)
    const absoluteExpiresAt = integer(response.absoluteExpiresAt)
    if (absoluteExpiresAt < activationDeadlineAt) {
      return invalid()
    }
    return {
      protocolVersion: 'account-runtime-ticket-consume/v2',
      status: 'PENDING_ACTIVATION',
      managedSessionId: text(response.managedSessionId, UUID, 36),
      runtimeSessionId: text(response.runtimeSessionId, UUID, 36),
      activationDeadlineAt,
      absoluteExpiresAt,
      controlVersion: integer(response.controlVersion, 1)
    }
  }

  async refresh(
    context: CurrentHiveRuntimeCloudLeaseContext,
    input: {
      assignmentId: string
      assignmentEpoch: number
      controlGeneration: number
      expectedControlLeaseExpiresAt: number
    },
    signal?: AbortSignal
  ) {
    const path = `/hive/v1/runtimes/${text(context.tuple.runtimeRecordId, UUID, 36)}/relay/control-leases/refresh`
    const value = await this.request(
      path,
      createHiveRuntimeRelayProofRequest(context, path, { protocolVersion: 2, ...input }),
      {},
      200,
      signal
    )
    return normalizeAssignment(
      record(value, [
        'protocolVersion',
        'cellUrl',
        'cellId',
        'cellIncarnationId',
        'assignmentId',
        'assignmentEpoch',
        'relayHostId',
        'controlLease',
        'controlLeaseExpiresAt'
      ])
    )
  }
}

function normalizeAssignment(response: Record<string, unknown>) {
  if (response.protocolVersion !== 2) {
    return invalid()
  }
  return {
    cellOrigin: requireHiveRuntimeRelayOrigin(response.cellUrl),
    cellId: text(response.cellId, /^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 128),
    cellIncarnationId: text(response.cellIncarnationId, UUID, 36),
    assignmentId: text(response.assignmentId, UUID, 36),
    assignmentEpoch: integer(response.assignmentEpoch),
    relayHostId: text(response.relayHostId, /^[A-Za-z0-9_-]{16}$/, 16),
    controlLease: text(
      response.controlLease,
      /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
      8192
    ) as ControlLeaseForCell,
    controlLeaseExpiresAt: integer(response.controlLeaseExpiresAt)
  }
}
