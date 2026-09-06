import { setTimeout as delay } from 'node:timers/promises'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import type {
  HiveLocalRuntimeClaimPollResult,
  HiveLocalRuntimeClaimStartResult,
  HiveLocalRuntimeCloudStatus,
  HiveLocalRuntimeIdentityResetResult,
  HiveLocalRuntimeOwnershipState
} from '../../shared/hive-runtime-cloud'
import type { HiveRuntimeCloudPresenceState } from './hive-runtime-cloud-presence-support'
import {
  analyzeLocalRuntimeOwnership,
  claimLocalRuntimeForAccount
} from './local-runtime-account-operations'
import {
  beginHeadlessRuntimeClaim,
  pollHeadlessRuntimeClaim
} from './local-runtime-headless-operations'
import {
  defaultLocalRuntimeOwnershipDependencies,
  type HeadlessClaim,
  type LocalRuntimeOwnershipServiceOptions
} from './local-runtime-ownership-contracts'
import { LocalRuntimeOwnershipSession, ownershipErrorCode } from './local-runtime-ownership-session'
import { LocalRuntimeRegistration } from './local-runtime-registration'

export {
  defaultLocalRuntimeOwnershipDependencies,
  type LocalRuntimeOwnershipDependencies,
  type LocalRuntimeOwnershipServiceOptions
} from './local-runtime-ownership-contracts'

export class LocalRuntimeOwnershipService {
  private readonly registration: LocalRuntimeRegistration
  private readonly session: LocalRuntimeOwnershipSession
  private headlessClaim: HeadlessClaim | null = null

  constructor(private readonly options: LocalRuntimeOwnershipServiceOptions) {
    const dependencies = options.dependencies ?? defaultLocalRuntimeOwnershipDependencies
    this.registration = new LocalRuntimeRegistration(options, dependencies)
    this.session = new LocalRuntimeOwnershipSession(options, this.registration)
  }

  getState(): HiveLocalRuntimeOwnershipState {
    return this.session.getState()
  }

  getLocalRuntimeStatus(): HiveLocalRuntimeCloudStatus {
    const base = {
      presence: this.session.getState().presence,
      relay: this.options.getRelayStatus?.() ?? 'offline'
    } as const
    if (!this.registration.isAvailable()) {
      return { ...base, ownership: 'DISABLED', runtimeRecordId: null }
    }
    try {
      const registration = this.registration.readState()
      if (!registration) {
        return { ...base, ownership: 'UNREGISTERED', runtimeRecordId: null }
      }
      return {
        ...base,
        ownership: registration.status,
        runtimeRecordId: registration.runtimeRecordId
      }
    } catch {
      return { ...base, ownership: 'UNVERIFIABLE', runtimeRecordId: null }
    }
  }

  getClaimedRuntimeRecordId(): string | null {
    try {
      const registration = this.registration.readState()
      return registration?.status === 'CLAIMED' ? registration.runtimeRecordId : null
    } catch {
      return null
    }
  }

  subscribe(listener: (state: HiveLocalRuntimeOwnershipState) => void): () => void {
    return this.session.subscribe(listener)
  }

  setPresenceState(presence: HiveRuntimeCloudPresenceState): void {
    this.session.setPresence(presence)
  }

  setAuthorization(authorization: HiveRuntimeCloudAuthorization | null): void {
    if (this.session.setAuthorization(authorization) && authorization) {
      void this.runAnalysis(authorization)
    }
  }

  async refresh(): Promise<HiveLocalRuntimeOwnershipState> {
    const authorization = this.session.getAuthorization()
    if (!authorization || !this.registration.isAvailable() || this.session.isStopped()) {
      return this.session.getState()
    }
    this.session.markAnalyzing()
    await this.runAnalysis(authorization)
    return this.session.getState()
  }

  async claimLocalRuntime(
    expectedAccountId: string,
    openVerification: (userCode: string) => Promise<void>
  ): Promise<HiveLocalRuntimeOwnershipState> {
    const authorization = this.session.getAuthorization()
    if (!authorization || !this.registration.isAvailable() || this.session.isStopped()) {
      throw new Error('hive_runtime_cloud_account_required')
    }
    if (authorization.accountId !== expectedAccountId) {
      throw new Error('hive_runtime_cloud_account_changed')
    }
    const operation = this.session.startOperation()
    this.session.markAnalyzing()
    let registrationNotificationPending = false
    try {
      const claimed = await claimLocalRuntimeForAccount({
        registration: this.registration,
        authorization,
        openVerification: async (code) => {
          this.session.assertAccountCurrent(operation, authorization)
          this.session.setClaimUserCode(code)
          await openVerification(code)
        },
        waitForPoll:
          this.options.dependencies?.waitForClaimPoll ??
          ((milliseconds, signal) => delay(milliseconds, undefined, { signal })),
        signal: operation.controller.signal,
        assertCurrent: () => this.session.assertAccountCurrent(operation, authorization)
      })
      registrationNotificationPending = true
      this.session.assertAccountCurrent(operation, authorization)
      this.session.publishClaimed(authorization, claimed.runtimeRecordId)
      registrationNotificationPending = false
      this.session.notifyRegistrationChanged()
      return this.session.getState()
    } catch (error) {
      if (registrationNotificationPending) {
        registrationNotificationPending = false
        this.session.notifyRegistrationChanged()
      }
      if (this.session.isOperationStale(operation)) {
        return this.session.getState()
      }
      this.session.publishClaimFailure(error)
      throw error
    } finally {
      this.session.finishOperation(operation)
    }
  }

  async beginHeadlessClaim(): Promise<HiveLocalRuntimeClaimStartResult> {
    if (!this.registration.isAvailable() || this.session.isStopped()) {
      throw new Error('hive_runtime_cloud_unavailable')
    }
    this.headlessClaim = null
    const operation = this.session.startOperation()
    let registrationNotificationPending = false
    try {
      const started = await beginHeadlessRuntimeClaim({
        registration: this.registration,
        signal: operation.controller.signal,
        assertCurrent: () => this.session.assertOperationCurrent(operation)
      })
      registrationNotificationPending = started.registrationChanged
      this.session.assertOperationCurrent(operation)
      this.headlessClaim = started.challenge
      if (registrationNotificationPending) {
        registrationNotificationPending = false
        this.session.notifyRegistrationChanged()
      }
      return started.result
    } catch (error) {
      if (registrationNotificationPending) {
        registrationNotificationPending = false
        this.session.notifyRegistrationChanged()
      }
      throw error
    } finally {
      this.session.finishOperation(operation)
    }
  }

  async pollHeadlessClaim(challengeId: string): Promise<HiveLocalRuntimeClaimPollResult> {
    if (!this.registration.isAvailable() || this.session.isStopped()) {
      throw new Error('hive_runtime_cloud_unavailable')
    }
    const challenge = this.headlessClaim
    if (!challenge || challenge.challengeId !== challengeId) {
      throw new Error('hive_runtime_cloud_claim_challenge_not_found')
    }
    if (challenge.expiresAt <= this.registration.now()) {
      this.headlessClaim = null
      return { status: 'EXPIRED', challengeId }
    }
    const operation = this.session.startOperation()
    let registrationNotificationPending = false
    try {
      const polled = await pollHeadlessRuntimeClaim({
        registration: this.registration,
        challenge,
        signal: operation.controller.signal,
        assertCurrent: () => this.session.assertOperationCurrent(operation),
        onTerminalResult: () => {
          this.headlessClaim = null
        }
      })
      registrationNotificationPending = polled.registrationChanged
      this.session.assertOperationCurrent(operation)
      this.headlessClaim = polled.challenge
      if (registrationNotificationPending) {
        registrationNotificationPending = false
        this.session.notifyRegistrationChanged()
        if (this.session.isOperationStale(operation)) {
          return polled.result
        }
        const authorization = this.session.getAuthorization()
        if (authorization) {
          this.setAuthorization(authorization)
        } else {
          this.session.publishWithoutAccount()
        }
      }
      return polled.result
    } catch (error) {
      if (registrationNotificationPending) {
        registrationNotificationPending = false
        this.session.notifyRegistrationChanged()
      }
      throw error
    } finally {
      this.session.finishOperation(operation)
    }
  }

  resetCloudIdentity(): HiveLocalRuntimeIdentityResetResult {
    if (this.session.isStopped()) {
      throw new Error('hive_runtime_cloud_unavailable')
    }
    this.session.cancelCurrentOperation()
    this.headlessClaim = null
    this.registration.clearCloudIdentity()
    this.session.notifyRegistrationChanged()
    const authorization = this.session.getAuthorization()
    if (authorization) {
      this.setAuthorization(authorization)
    } else {
      this.session.publishWithoutAccount()
    }
    return { reset: true }
  }

  stop(): void {
    this.headlessClaim = null
    this.session.stop()
  }

  private async runAnalysis(authorization: HiveRuntimeCloudAuthorization): Promise<void> {
    const operation = this.session.startOperation()
    let registrationNotificationPending = false
    try {
      const analysis = await analyzeLocalRuntimeOwnership({
        registration: this.registration,
        authorization,
        signal: operation.controller.signal,
        assertCurrent: () => this.session.assertAccountCurrent(operation, authorization)
      })
      registrationNotificationPending = analysis.registrationChanged
      this.session.assertAccountCurrent(operation, authorization)
      this.session.publishAnalysis(authorization, analysis.result)
      if (registrationNotificationPending) {
        registrationNotificationPending = false
        this.session.notifyRegistrationChanged()
      }
    } catch (error) {
      if (registrationNotificationPending) {
        registrationNotificationPending = false
        this.session.notifyRegistrationChanged()
      }
      if (this.session.isOperationStale(operation)) {
        return
      }
      this.session.publishAnalysis(authorization, {
        relation: 'UNVERIFIABLE',
        runtimeRecordId: this.session.getState().runtimeRecordId,
        claimCapabilityAvailable: false,
        errorCode: ownershipErrorCode(error)
      })
    } finally {
      this.session.finishOperation(operation)
    }
  }
}
