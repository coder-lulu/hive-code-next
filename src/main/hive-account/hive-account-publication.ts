import type { HiveAccountState } from '../../shared/hive-account'
import type { HiveAccountSession } from './hive-account-session-store'

export type HiveRuntimeCloudAuthorization = Readonly<{
  accessToken: string
  accountId: string
  authorityId: string
  sessionExpiresAt: number
  sessionGeneration: number
}>

export abstract class HiveAccountPublication {
  private runtimeCloudAuthorizationFenced = false
  private readonly stateListeners = new Set<(state: HiveAccountState) => void>()
  private readonly runtimeCloudAuthorizationListeners = new Set<
    (authorization: HiveRuntimeCloudAuthorization | null) => void
  >()

  protected constructor(onStateChanged: (state: HiveAccountState) => void) {
    this.stateListeners.add(onStateChanged)
  }

  protected abstract getRuntimeCloudSession(): HiveAccountSession | null

  subscribeStateChanged(listener: (state: HiveAccountState) => void): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  subscribeRuntimeCloudAuthorization(
    listener: (authorization: HiveRuntimeCloudAuthorization | null) => void
  ): () => void {
    this.runtimeCloudAuthorizationListeners.add(listener)
    return () => this.runtimeCloudAuthorizationListeners.delete(listener)
  }

  getRuntimeCloudAuthorization(): HiveRuntimeCloudAuthorization | null {
    if (this.runtimeCloudAuthorizationFenced) {
      return null
    }
    const session = this.getRuntimeCloudSession()
    return session ? this.authorizationFromSession(session) : null
  }

  protected publishState(state: HiveAccountState): void {
    for (const listener of this.stateListeners) {
      try {
        listener(state)
      } catch {
        // Publication failures cannot roll back an account mutation that already committed.
      }
    }
  }

  protected publishRuntimeCloudSession(session: HiveAccountSession): void {
    const authorization = this.authorizationFromSession(session)
    this.runtimeCloudAuthorizationFenced = authorization === null
    this.publishRuntimeCloudAuthorization(authorization)
  }

  protected fenceRuntimeCloudAuthorization(): void {
    this.runtimeCloudAuthorizationFenced = true
    this.publishRuntimeCloudAuthorization(null)
  }

  private authorizationFromSession(
    session: HiveAccountSession
  ): HiveRuntimeCloudAuthorization | null {
    if (session.sessionExpiresAt <= Date.now()) {
      return null
    }
    return {
      accessToken: session.accessToken,
      accountId: session.account.accountId,
      authorityId: session.authorityId,
      sessionExpiresAt: session.sessionExpiresAt,
      sessionGeneration: session.generation
    }
  }

  private publishRuntimeCloudAuthorization(
    authorization: HiveRuntimeCloudAuthorization | null
  ): void {
    for (const listener of this.runtimeCloudAuthorizationListeners) {
      try {
        listener(authorization)
      } catch {
        // A consumer must not prevent credentials from being fenced locally.
      }
    }
  }
}
