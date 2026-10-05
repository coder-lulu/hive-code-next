import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import {
  EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP,
  type HiveLocalRuntimeOwnershipState
} from '../../shared/hive-runtime-cloud'
import { HiveRuntimeCloudRequestError } from './hive-runtime-cloud-client'
import type { HiveRuntimeCloudPresenceState } from './hive-runtime-cloud-presence-support'
import type { LocalRuntimeOwnershipServiceOptions } from './local-runtime-ownership-contracts'
import type { LocalRuntimeRegistration } from './local-runtime-registration'

export type OwnershipOperation = Readonly<{
  epoch: number
  controller: AbortController
}>

type OwnershipResult = Pick<
  HiveLocalRuntimeOwnershipState,
  'relation' | 'runtimeRecordId' | 'ownershipEpoch' | 'claimCapabilityAvailable' | 'errorCode'
>

export class LocalRuntimeOwnershipSession {
  private readonly listeners = new Set<(state: HiveLocalRuntimeOwnershipState) => void>()
  private authorization: HiveRuntimeCloudAuthorization | null = null
  private state: HiveLocalRuntimeOwnershipState
  private presence: HiveRuntimeCloudPresenceState
  private controller: AbortController | null = null
  private epoch = 0
  private stopped = false

  constructor(
    private readonly options: LocalRuntimeOwnershipServiceOptions,
    private readonly registration: LocalRuntimeRegistration
  ) {
    this.presence = options.config.enabled ? 'WAITING_RUNTIME' : 'DISABLED'
    this.state = {
      ...EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP,
      presence: this.publicPresence(),
      errorCode: options.config.enabled ? null : 'RUNTIME_CLOUD_DISABLED'
    }
  }

  getState(): HiveLocalRuntimeOwnershipState {
    return this.state
  }

  getAuthorization(): HiveRuntimeCloudAuthorization | null {
    return this.authorization
  }

  isStopped(): boolean {
    return this.stopped
  }

  subscribe(listener: (state: HiveLocalRuntimeOwnershipState) => void): () => void {
    this.listeners.add(listener)
    this.publishToListener(listener, this.state)
    return () => this.listeners.delete(listener)
  }

  setPresence(presence: HiveRuntimeCloudPresenceState): void {
    this.presence = presence
    this.setState({ ...this.state, presence: this.publicPresence() })
  }

  setAuthorization(authorization: HiveRuntimeCloudAuthorization | null): boolean {
    if (this.stopped || !this.registration.isAvailable()) {
      return false
    }
    this.cancelOperation()
    if (!authorization || authorization.sessionExpiresAt <= this.registration.now()) {
      this.authorization = null
      this.publishWithoutAccount()
      return false
    }
    this.authorization = authorization
    this.setState({
      ...this.state,
      relation: 'ANALYZING',
      accountId: authorization.accountId,
      sessionGeneration: authorization.sessionGeneration,
      checkedAt: null,
      errorCode: null
    })
    return true
  }

  setClaimUserCode(code?: string): void {
    if (this.state.claimUserCode === code) {
      return
    }
    const state = { ...this.state }
    if (code) {
      state.claimUserCode = code
    } else {
      delete state.claimUserCode
    }
    this.setState(state)
  }

  markAnalyzing(): void {
    this.setState({ ...this.state, relation: 'ANALYZING', errorCode: null })
  }

  startOperation(): OwnershipOperation {
    this.cancelOperation()
    const operation = { epoch: this.epoch, controller: new AbortController() }
    this.controller = operation.controller
    return operation
  }

  cancelCurrentOperation(): void {
    this.cancelOperation()
  }

  finishOperation(operation: OwnershipOperation): void {
    if (this.controller === operation.controller) {
      this.controller = null
      this.setClaimUserCode()
    }
  }

  isOperationStale(operation: OwnershipOperation): boolean {
    return operation.controller.signal.aborted || operation.epoch !== this.epoch || this.stopped
  }

  assertOperationCurrent(operation: OwnershipOperation): void {
    if (this.stopped || operation.epoch !== this.epoch) {
      throw new Error('hive_runtime_cloud_ownership_stale')
    }
  }

  assertAccountCurrent(
    operation: OwnershipOperation,
    authorization: HiveRuntimeCloudAuthorization
  ): void {
    const current = this.authorization
    if (
      this.stopped ||
      operation.epoch !== this.epoch ||
      !current ||
      current.accountId !== authorization.accountId ||
      current.authorityId !== authorization.authorityId ||
      current.sessionGeneration !== authorization.sessionGeneration ||
      current.sessionExpiresAt <= this.registration.now()
    ) {
      throw new Error('hive_runtime_cloud_ownership_stale')
    }
  }

  publishClaimed(
    authorization: HiveRuntimeCloudAuthorization,
    runtimeRecordId: string,
    ownershipEpoch: number | null = null
  ): void {
    this.publishAnalysis(authorization, {
      relation: 'CLAIMED_BY_CURRENT',
      runtimeRecordId,
      ownershipEpoch,
      claimCapabilityAvailable: false,
      errorCode: null
    })
  }

  publishAnalysis(authorization: HiveRuntimeCloudAuthorization, result: OwnershipResult): void {
    this.setState({
      ...result,
      stateRevision: this.state.stateRevision,
      accountId: authorization.accountId,
      sessionGeneration: authorization.sessionGeneration,
      presence: this.publicPresence(),
      checkedAt: this.registration.now()
    })
  }

  publishUnverifiable(authorization: HiveRuntimeCloudAuthorization, error: unknown): void {
    this.publishAnalysis(authorization, {
      relation: 'UNVERIFIABLE',
      runtimeRecordId: this.state.runtimeRecordId,
      ownershipEpoch: null,
      claimCapabilityAvailable: false,
      errorCode: ownershipErrorCode(error)
    })
  }

  publishClaimFailure(error: unknown): void {
    this.setState({
      ...this.state,
      relation: ownershipRelationForFailure(error),
      checkedAt: this.registration.now(),
      errorCode: ownershipErrorCode(error)
    })
  }

  notifyRegistrationChanged(): void {
    try {
      this.options.onRegistrationChanged?.()
    } catch {
      console.warn(
        '[hive-runtime-cloud] Registration change observer failed; committed state was preserved'
      )
    }
  }

  publishWithoutAccount(): void {
    if (this.stopped) {
      return
    }
    let relation: HiveLocalRuntimeOwnershipState['relation'] = 'UNREGISTERED'
    let runtimeRecordId: string | null = null
    let claimCapabilityAvailable = false
    let errorCode: string | null = null
    try {
      const stored = this.registration.readState()
      if (stored?.status === 'CLAIMED') {
        relation = 'CLAIMED_BY_CURRENT'
        runtimeRecordId = stored.runtimeRecordId
      } else if (stored?.status === 'PENDING_CLAIM') {
        relation = 'PENDING_CLAIM'
        runtimeRecordId = stored.runtimeRecordId
        claimCapabilityAvailable = stored.claimExpiresAt > this.registration.now()
      }
    } catch (error) {
      relation = 'UNVERIFIABLE'
      errorCode = ownershipErrorCode(error)
    }
    this.setState({
      stateRevision: this.state.stateRevision,
      relation,
      accountId: null,
      sessionGeneration: null,
      runtimeRecordId,
      ownershipEpoch: null,
      claimCapabilityAvailable,
      presence: this.publicPresence(),
      checkedAt: this.registration.now(),
      errorCode
    })
  }

  stop(): void {
    this.stopped = true
    this.authorization = null
    this.cancelOperation()
    this.listeners.clear()
  }

  private publicPresence(): HiveLocalRuntimeOwnershipState['presence'] {
    return this.presence === 'SIGNED_OUT' || this.presence === 'ACTIVATING'
      ? 'WAITING_RUNTIME'
      : this.presence
  }

  private cancelOperation(): void {
    this.epoch += 1
    this.controller?.abort()
    this.controller = null
    this.setClaimUserCode()
  }

  private setState(state: HiveLocalRuntimeOwnershipState): void {
    const nextState = { ...state, stateRevision: this.state.stateRevision + 1 }
    this.state = nextState
    for (const listener of this.listeners) {
      if (this.state !== nextState) {
        break
      }
      this.publishToListener(listener, nextState)
    }
  }

  private publishToListener(
    listener: (state: HiveLocalRuntimeOwnershipState) => void,
    state: HiveLocalRuntimeOwnershipState
  ): void {
    try {
      listener(state)
    } catch {
      // Observers cannot roll back a completed ownership transition.
    }
  }
}

export function ownershipErrorCode(error: unknown): string {
  if (error instanceof HiveRuntimeCloudRequestError) {
    if (error.status === 403) {
      return error.category === 'runtime_claim_step_up_required'
        ? 'STEP_UP_REQUIRED'
        : (error.category ?? 'REQUEST_FAILED')
    }
    if (error.status === 404) {
      return 'CLAIMED_BY_OTHER'
    }
    if (error.status === 409) {
      return 'CLAIM_CONFLICT'
    }
    if (error.status === 410) {
      return 'CLAIM_CAPABILITY_EXPIRED'
    }
    return error.category ?? 'REQUEST_FAILED'
  }
  return error instanceof Error ? error.message : 'OWNERSHIP_UNAVAILABLE'
}

function ownershipRelationForFailure(error: unknown): HiveLocalRuntimeOwnershipState['relation'] {
  return error instanceof HiveRuntimeCloudRequestError &&
    (error.status === 404 || error.status === 409)
    ? 'CLAIMED_BY_OTHER'
    : 'UNVERIFIABLE'
}
