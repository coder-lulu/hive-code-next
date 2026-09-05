import { createHash } from 'node:crypto'
import nacl from 'tweetnacl'
import type { E2EEKeypair } from '../../runtime/e2ee-keypair'
import type { CurrentHiveRuntimeCloudLeaseContext } from '../hive-runtime-cloud-lease-context'
import type { HiveRuntimeRelayCloudClient } from './hive-runtime-relay-cloud-client'
import { requireHiveRuntimeRelayControlBinding } from './hive-runtime-relay-credential-binding'
import {
  hiveRuntimeRelayTuplesEqual,
  type HiveRuntimeRelayAssignment,
  type HiveRuntimeRelayHostBinding
} from './hive-runtime-relay-types'

export type HiveRuntimeRelayBindingStore = {
  read(runtimeRecordId: string): HiveRuntimeRelayHostBinding | null
  write(runtimeRecordId: string, binding: HiveRuntimeRelayHostBinding): void
}
export type HiveRuntimeRelayAuthorizationOptions = {
  client: Pick<HiveRuntimeRelayCloudClient, 'bindHost' | 'authorize' | 'assign' | 'refresh'>
  currentLeaseContext: () => CurrentHiveRuntimeCloudLeaseContext | null
  requestedRegion?: string
  bindingStore: HiveRuntimeRelayBindingStore
  beforeKeyRotation: () => void | Promise<void>
  now?: () => number
}

export class HiveRuntimeRelayAuthorizationProvider {
  private pending: Promise<HiveRuntimeRelayAssignment> | null = null
  constructor(private readonly options: HiveRuntimeRelayAuthorizationOptions) {}

  refresh(
    assignment: HiveRuntimeRelayAssignment,
    signal?: AbortSignal
  ): Promise<HiveRuntimeRelayAssignment> {
    if (this.pending) {
      return Promise.reject(new Error('hive_runtime_relay_authorization_in_progress'))
    }
    const pending = this.refreshCurrent(assignment, signal)
    this.pending = pending
    void pending
      .finally(() => {
        if (this.pending === pending) {
          this.pending = null
        }
      })
      .catch(() => undefined)
    return pending
  }

  private async refreshCurrent(
    assignment: HiveRuntimeRelayAssignment,
    signal?: AbortSignal
  ): Promise<HiveRuntimeRelayAssignment> {
    const assertCurrent = (): void => {
      const current = this.options.currentLeaseContext()
      if (
        signal?.aborted ||
        !current ||
        current.authorityId !== assignment.context.authorityId ||
        current.identity.publicKey !== assignment.context.identity.publicKey ||
        !hiveRuntimeRelayTuplesEqual(current.tuple, assignment.context.tuple)
      ) {
        throw new Error('hive_runtime_relay_stale_tuple')
      }
    }
    assertCurrent()
    const result = await this.options.client.refresh(
      assignment.context,
      {
        assignmentId: assignment.assignmentId,
        assignmentEpoch: assignment.assignmentEpoch,
        controlGeneration: assignment.controlGeneration,
        expectedControlLeaseExpiresAt: assignment.controlLeaseExpiresAt
      },
      signal
    )
    assertCurrent()
    const hostHash = createHash('sha256')
      .update(Buffer.from(assignment.hostPublicKeyB64, 'base64url'))
      .digest('base64url')
    const generation = requireHiveRuntimeRelayControlBinding(
      result,
      assignment.context,
      hostHash,
      (this.options.now ?? Date.now)()
    )
    if (
      generation !== assignment.controlGeneration ||
      result.assignmentId !== assignment.assignmentId ||
      result.assignmentEpoch !== assignment.assignmentEpoch ||
      result.cellOrigin !== assignment.cellOrigin ||
      result.cellId !== assignment.cellId ||
      result.cellIncarnationId !== assignment.cellIncarnationId ||
      result.controlLeaseExpiresAt < assignment.controlLeaseExpiresAt
    ) {
      throw new Error('hive_runtime_relay_refresh_binding_mismatch')
    }
    return Object.freeze({ ...assignment, ...result })
  }

  resolve(input: {
    context: CurrentHiveRuntimeCloudLeaseContext
    keypair: E2EEKeypair
    signal?: AbortSignal
  }): Promise<HiveRuntimeRelayAssignment> {
    // A second caller must retry with its own current tuple instead of borrowing an old chain.
    if (this.pending) {
      return Promise.reject(new Error('hive_runtime_relay_authorization_in_progress'))
    }
    const pending = this.resolveCurrent(input)
    this.pending = pending
    void pending
      .finally(() => {
        if (this.pending === pending) {
          this.pending = null
        }
      })
      .catch(() => undefined)
    return pending
  }

  private async resolveCurrent({
    context,
    keypair,
    signal
  }: {
    context: CurrentHiveRuntimeCloudLeaseContext
    keypair: E2EEKeypair
    signal?: AbortSignal
  }): Promise<HiveRuntimeRelayAssignment> {
    const assertCurrent = (): void => {
      const current = this.options.currentLeaseContext()
      if (
        signal?.aborted ||
        !current ||
        current.authorityId !== context.authorityId ||
        current.identity.publicKey !== context.identity.publicKey ||
        !hiveRuntimeRelayTuplesEqual(current.tuple, context.tuple)
      ) {
        throw new Error('hive_runtime_relay_stale_tuple')
      }
    }
    assertCurrent()
    if (
      keypair.secretKey.length !== 32 ||
      keypair.publicKey.length !== 32 ||
      !Buffer.from(nacl.box.keyPair.fromSecretKey(keypair.secretKey).publicKey).equals(
        Buffer.from(keypair.publicKey)
      )
    ) {
      throw new Error('hive_runtime_relay_invalid_host_key')
    }
    const hostPublicKeyB64 = Buffer.from(keypair.publicKey).toString('base64url')
    const hostKeyHash = createHash('sha256').update(keypair.publicKey).digest('base64url')
    const requestedRelayHostId = hostKeyHash.slice(0, 16)
    const previous = this.options.bindingStore.read(context.tuple.runtimeRecordId)
    if (previous && previous.hostPublicKeyB64 !== hostPublicKeyB64) {
      await this.options.beforeKeyRotation()
      assertCurrent()
    }
    const bound = await this.options.client.bindHost(
      context,
      {
        hostPublicKeyB64,
        requestedRelayHostId,
        expectedBindingVersion: previous?.hostBindingVersion ?? 0
      },
      signal
    )
    const expectedVersion = previous?.hostBindingVersion ?? 0
    if (
      bound.hostBindingVersion < 1 ||
      (bound.hostBindingVersion !== expectedVersion &&
        bound.hostBindingVersion !== expectedVersion + 1)
    ) {
      throw new Error('hive_runtime_relay_binding_version_mismatch')
    }
    // Persist the CAS receipt even after cancellation so a completed rotation remains recoverable.
    const binding = Object.freeze({ ...bound, hostPublicKeyB64 })
    this.options.bindingStore.write(context.tuple.runtimeRecordId, binding)
    assertCurrent()
    const authorization = await this.options.client.authorize(context, signal)
    assertCurrent()
    const now = this.options.now ?? Date.now
    if (authorization.expiresAt <= now() || authorization.expiresAt > now() + 330_000) {
      throw new Error('hive_runtime_relay_authorization_expired')
    }
    const assignment = await this.options.client.assign(
      {
        hostPublicKeyB64,
        requestedRegion: this.options.requestedRegion,
        relayToken: authorization.relayToken
      },
      signal
    )
    assertCurrent()
    if (assignment.relayHostId !== requestedRelayHostId) {
      throw new Error('hive_runtime_relay_host_binding_mismatch')
    }
    const controlGeneration = requireHiveRuntimeRelayControlBinding(
      assignment,
      context,
      hostKeyHash,
      now()
    )
    return Object.freeze({ ...assignment, context, binding, hostPublicKeyB64, controlGeneration })
  }
}
