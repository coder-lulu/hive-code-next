import type {
  HiveAccountRefreshResult,
  HiveAccountSignInOptions,
  HiveAccountSignInResult,
  HiveAccountSignOutResult,
  HiveAccountState
} from '../../shared/hive-account'
import { getHiveAccountConfig, type HiveAccountConfig } from './hive-account-config'
import { HiveAccountClient } from './hive-account-client'
import { getOrCreateHiveDeviceIdentity, signHiveDeviceAuthorization } from './hive-account-device'
import { migrateLegacyOrcaCloudIdentity } from './hive-account-legacy-migration'
import { beginHiveAccountPkceFlow } from './hive-account-pkce'
import { isHiveAccountEncryptionAvailable } from './hive-account-secure-store'
import { publishHiveAccountResult } from './hive-account-state-publication'
import { completeHiveAccountSignOut } from './hive-account-sign-out'
import {
  classifyHiveAccountError,
  errorState,
  signedOutState,
  stateFromSession
} from './hive-account-state'
import {
  clearHiveAccountSession,
  readHiveAccountSession,
  saveHiveAccountSession,
  type HiveAccountSession
} from './hive-account-session-store'
import { HiveAccountPublication } from './hive-account-publication'
import { scheduleHiveAccountRefresh } from './hive-account-refresh-schedule'

export type { HiveRuntimeCloudAuthorization } from './hive-account-publication'

type ServiceDependencies = {
  getConfig: () => ReturnType<typeof getHiveAccountConfig>
  createClient: (config: HiveAccountConfig) => HiveAccountClient
  beginAuthorization: typeof beginHiveAccountPkceFlow
}

const defaultDependencies: ServiceDependencies = {
  getConfig: () => getHiveAccountConfig(),
  createClient: (config) => new HiveAccountClient(config),
  beginAuthorization: beginHiveAccountPkceFlow
}

export class HiveAccountService extends HiveAccountPublication {
  private signInFlight: Promise<HiveAccountSignInResult> | null = null
  private refreshFlight: Promise<HiveAccountRefreshResult> | null = null
  private temporarySession: HiveAccountSession | null = null
  private refreshTimer: NodeJS.Timeout | undefined
  private mutationEpoch = 0
  constructor(
    private readonly userDataPath: string,
    private readonly dependencies: ServiceDependencies = defaultDependencies,
    onStateChanged: (state: HiveAccountState) => void = () => undefined
  ) {
    super(onStateChanged)
    migrateLegacyOrcaCloudIdentity(userDataPath)
  }

  async getState(): Promise<HiveAccountState> {
    const configured = this.dependencies.getConfig()
    if (!configured.configured) {
      return {
        configured: false,
        status: 'unconfigured',
        persistence: 'none',
        setupMessage: configured.setupMessage
      }
    }
    if (!isHiveAccountEncryptionAvailable()) {
      return errorState('secure_storage_unavailable')
    }
    const stored = this.readCurrentSession()
    if (stored.status === 'missing') {
      return signedOutState()
    }
    if (stored.status === 'unavailable') {
      return errorState('secure_storage_unavailable')
    }
    if (stored.status === 'unreadable') {
      return errorState('credential_unreadable')
    }
    this.scheduleRefresh(stored.value)
    return stateFromSession(stored.value)
  }

  signIn(options: HiveAccountSignInOptions): Promise<HiveAccountSignInResult> {
    if (this.signInFlight) {
      return this.signInFlight
    }
    this.signInFlight = this.runSignIn(options)
      .then((result) => publishHiveAccountResult((state) => this.publishState(state), result))
      .finally(() => {
        this.signInFlight = null
      })
    return this.signInFlight
  }

  private async runSignIn(options: HiveAccountSignInOptions): Promise<HiveAccountSignInResult> {
    const expectedEpoch = ++this.mutationEpoch
    const configured = this.dependencies.getConfig()
    if (!configured.configured) {
      return { status: 'unconfigured', state: await this.getState() }
    }
    if (!isHiveAccountEncryptionAvailable()) {
      return { status: 'failed', state: errorState('secure_storage_unavailable') }
    }
    const device = getOrCreateHiveDeviceIdentity(this.userDataPath)
    if (device.status !== 'ok') {
      return {
        status: 'failed',
        state: errorState(
          device.status === 'unavailable' ? 'secure_storage_unavailable' : 'credential_unreadable'
        )
      }
    }
    try {
      const client = this.dependencies.createClient(configured.config)
      const authorizationEndpoint = await client.discoverAuthorizationEndpoint()
      const code = await this.dependencies.beginAuthorization({
        authorizationEndpoint,
        clientId: configured.config.clientId,
        scope: configured.config.scope,
        prepareDeviceAuthorization: async (nonce) => {
          await client.createDeviceAuthorization({
            nonce,
            devicePublicKey: device.identity.publicKey,
            deviceLabel: device.identity.deviceLabel,
            sessionProfile: options.sessionProfile,
            proof: signHiveDeviceAuthorization(
              device.identity,
              nonce,
              configured.config.clientId,
              options.sessionProfile
            )
          })
        }
      })
      const exchange = await client.exchangeSession(code)
      if (this.mutationEpoch !== expectedEpoch) {
        await this.bestEffortRevokeCurrent(client, exchange.accessToken)
        return { status: 'cancelled', state: signedOutState() }
      }
      const previous = this.readCurrentSession()
      const generation = previous.status === 'ok' ? previous.value.generation + 1 : 1
      const session: HiveAccountSession = {
        schemaVersion: 2,
        ...exchange,
        deviceLabel: device.identity.deviceLabel,
        generation,
        savedAt: Date.now()
      }
      this.fenceRuntimeCloudAuthorization()
      if (!this.persistSession(session)) {
        await this.bestEffortRevokeCurrent(client, exchange.accessToken)
        return { status: 'failed', state: errorState('secure_storage_unavailable') }
      }
      this.scheduleRefresh(session)
      this.publishRuntimeCloudSession(session)
      return { status: 'signed-in', state: stateFromSession(session) }
    } catch (error) {
      const errorCode = classifyHiveAccountError(error)
      return {
        status: errorCode === 'authorization_cancelled' ? 'cancelled' : 'failed',
        state: errorState(errorCode)
      }
    }
  }

  refresh(): Promise<HiveAccountRefreshResult> {
    if (this.refreshFlight) {
      return this.refreshFlight
    }
    this.refreshFlight = this.runRefresh()
      .then((result) => publishHiveAccountResult((state) => this.publishState(state), result))
      .finally(() => {
        this.refreshFlight = null
      })
    return this.refreshFlight
  }

  private async runRefresh(): Promise<HiveAccountRefreshResult> {
    const expectedEpoch = this.mutationEpoch
    const configured = this.dependencies.getConfig()
    if (!configured.configured) {
      return { status: 'unconfigured', state: await this.getState() }
    }
    const stored = this.readCurrentSession()
    if (stored.status === 'missing') {
      return { status: 'signed-out', state: signedOutState() }
    }
    if (stored.status !== 'ok') {
      return {
        status: 'failed',
        state: errorState(
          stored.status === 'unavailable' ? 'secure_storage_unavailable' : 'credential_unreadable'
        )
      }
    }
    const expected = stored.value
    try {
      const client = this.dependencies.createClient(configured.config)
      const refreshed = await client.refreshSession(expected.refreshToken)
      const current = this.readCurrentSession()
      if (
        current.status !== 'ok' ||
        this.mutationEpoch !== expectedEpoch ||
        current.value.generation !== expected.generation ||
        current.value.refreshToken !== expected.refreshToken
      ) {
        await this.bestEffortRevokeCurrent(client, refreshed.accessToken)
        return {
          status: current.status === 'ok' ? 'refreshed' : 'signed-out',
          state: current.status === 'ok' ? stateFromSession(current.value) : signedOutState()
        }
      }
      const session: HiveAccountSession = {
        schemaVersion: 2,
        ...refreshed,
        deviceLabel: expected.deviceLabel,
        generation: expected.generation + 1,
        savedAt: Date.now()
      }
      if (!this.persistSession(session)) {
        return { status: 'failed', state: errorState('secure_storage_unavailable') }
      }
      this.scheduleRefresh(session)
      this.publishRuntimeCloudSession(session)
      return { status: 'refreshed', state: stateFromSession(session) }
    } catch (error) {
      const errorCode = classifyHiveAccountError(error)
      if (errorCode === 'session_rejected') {
        this.fenceRuntimeCloudAuthorization()
        this.clearCurrentSession()
        return { status: 'signed-out', state: signedOutState() }
      }
      this.scheduleRefresh(expected, 60_000)
      return { status: 'failed', state: { ...stateFromSession(expected), errorCode } }
    }
  }

  async signOut(): Promise<HiveAccountSignOutResult> {
    this.mutationEpoch += 1
    this.fenceRuntimeCloudAuthorization()
    const configured = this.dependencies.getConfig()
    const stored = this.readCurrentSession()
    const revokeRemote =
      configured.configured && stored.status === 'ok'
        ? async (): Promise<void> => {
            const client = this.dependencies.createClient(configured.config)
            await this.revokeCurrent(client, stored.value.accessToken)
          }
        : null
    const result = await completeHiveAccountSignOut({
      hasStoredSession: stored.status !== 'missing',
      revokeRemote,
      clearLocal: () => this.clearCurrentSession()
    })
    return publishHiveAccountResult((state) => this.publishState(state), result)
  }

  private async revokeCurrent(client: HiveAccountClient, accessToken: string): Promise<void> {
    const sessions = await client.listCloudSessions(accessToken)
    const current = sessions.find((session) => session.currentSession)
    if (current) {
      await client.revokeSession(accessToken, current)
    }
  }

  private async bestEffortRevokeCurrent(
    client: HiveAccountClient,
    accessToken: string
  ): Promise<void> {
    try {
      await this.revokeCurrent(client, accessToken)
    } catch {
      // The credential was never persisted. The Web security center remains
      // the recovery surface if this best-effort cleanup cannot reach Cloud.
    }
  }

  private readCurrentSession(): ReturnType<typeof readHiveAccountSession> {
    return this.temporarySession
      ? { status: 'ok', value: this.temporarySession }
      : readHiveAccountSession(this.userDataPath)
  }

  protected getRuntimeCloudSession(): HiveAccountSession | null {
    const stored = this.readCurrentSession()
    return stored.status === 'ok' ? stored.value : null
  }

  private persistSession(session: HiveAccountSession): boolean {
    if (session.sessionProfile === 'TEMPORARY') {
      this.temporarySession = session
      clearHiveAccountSession(this.userDataPath)
      return true
    }
    this.temporarySession = null
    return saveHiveAccountSession(this.userDataPath, session)
  }

  private clearCurrentSession(): void {
    this.temporarySession = null
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = undefined
    }
    clearHiveAccountSession(this.userDataPath)
  }

  private scheduleRefresh(session: HiveAccountSession, retryDelay?: number): void {
    this.refreshTimer = scheduleHiveAccountRefresh(this.refreshTimer, session, retryDelay, () => {
      this.refreshTimer = undefined
      void this.refresh()
    })
  }
}
