import type {
  HiveAccountErrorCode,
  HiveAccountRefreshResult,
  HiveAccountSignInResult,
  HiveAccountSignOutResult,
  HiveAccountState
} from '../../shared/hive-account'
import { getHiveAccountConfig, type HiveAccountConfig } from './hive-account-config'
import { HiveAccountClient, HiveAccountRequestError } from './hive-account-client'
import { getOrCreateHiveDeviceIdentity, signHiveDeviceAuthorization } from './hive-account-device'
import { migrateLegacyOrcaCloudIdentity } from './hive-account-legacy-migration'
import { beginHiveAccountPkceFlow } from './hive-account-pkce'
import { isHiveAccountEncryptionAvailable } from './hive-account-secure-store'
import {
  clearHiveAccountSession,
  readHiveAccountSession,
  saveHiveAccountSession,
  type HiveAccountSession
} from './hive-account-session-store'

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

function signedOutState(): HiveAccountState {
  return { configured: true, status: 'signed-out', persistence: 'encrypted' }
}

function stateFromSession(session: HiveAccountSession): HiveAccountState {
  return {
    configured: true,
    status: 'signed-in',
    persistence: 'encrypted',
    account: session.account,
    authorityId: session.authorityId,
    deviceLabel: session.deviceLabel,
    expiresAt: session.expiresAt,
    ...(session.expiresAt <= Date.now() ? { errorCode: 'session_expired' as const } : {})
  }
}

function errorState(errorCode: HiveAccountErrorCode): HiveAccountState {
  return { configured: true, status: 'error', persistence: 'none', errorCode }
}

function classifyError(error: unknown): HiveAccountErrorCode {
  if (error instanceof HiveAccountRequestError) {
    if (error.status === 401 || error.status === 403) {
      return 'session_rejected'
    }
    if (error.status >= 500) {
      return 'server_unavailable'
    }
    return 'authorization_failed'
  }
  if (error instanceof Error) {
    if (error.message === 'hive_account_authorization_cancelled') {
      return 'authorization_cancelled'
    }
    if (error.message === 'hive_account_authorization_timeout') {
      return 'authorization_timeout'
    }
    if (error.name === 'AbortError' || error instanceof TypeError) {
      return 'network_unavailable'
    }
  }
  return 'authorization_failed'
}

export class HiveAccountService {
  private signInFlight: Promise<HiveAccountSignInResult> | null = null
  private refreshFlight: Promise<HiveAccountRefreshResult> | null = null
  private mutationEpoch = 0

  constructor(
    private readonly userDataPath: string,
    private readonly dependencies: ServiceDependencies = defaultDependencies
  ) {
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
    const stored = readHiveAccountSession(this.userDataPath)
    if (stored.status === 'missing') {
      return signedOutState()
    }
    if (stored.status === 'unavailable') {
      return errorState('secure_storage_unavailable')
    }
    if (stored.status === 'unreadable') {
      return errorState('credential_unreadable')
    }
    return stateFromSession(stored.value)
  }

  signIn(): Promise<HiveAccountSignInResult> {
    if (this.signInFlight) {
      return this.signInFlight
    }
    this.signInFlight = this.runSignIn().finally(() => {
      this.signInFlight = null
    })
    return this.signInFlight
  }

  private async runSignIn(): Promise<HiveAccountSignInResult> {
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
            proof: signHiveDeviceAuthorization(device.identity, nonce, configured.config.clientId)
          })
        }
      })
      const exchange = await client.exchangeSession(code)
      if (this.mutationEpoch !== expectedEpoch) {
        await this.bestEffortRevokeCurrent(client, exchange.accessToken)
        return { status: 'cancelled', state: signedOutState() }
      }
      const previous = readHiveAccountSession(this.userDataPath)
      const generation = previous.status === 'ok' ? previous.value.generation + 1 : 1
      const session: HiveAccountSession = {
        schemaVersion: 1,
        ...exchange,
        deviceLabel: device.identity.deviceLabel,
        generation,
        savedAt: Date.now()
      }
      if (!saveHiveAccountSession(this.userDataPath, session)) {
        return { status: 'failed', state: errorState('secure_storage_unavailable') }
      }
      return { status: 'signed-in', state: stateFromSession(session) }
    } catch (error) {
      const errorCode = classifyError(error)
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
    this.refreshFlight = this.runRefresh().finally(() => {
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
    const stored = readHiveAccountSession(this.userDataPath)
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
      const current = readHiveAccountSession(this.userDataPath)
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
        schemaVersion: 1,
        ...refreshed,
        deviceLabel: expected.deviceLabel,
        generation: expected.generation + 1,
        savedAt: Date.now()
      }
      if (!saveHiveAccountSession(this.userDataPath, session)) {
        return { status: 'failed', state: errorState('secure_storage_unavailable') }
      }
      return { status: 'refreshed', state: stateFromSession(session) }
    } catch (error) {
      const errorCode = classifyError(error)
      if (errorCode === 'session_rejected') {
        clearHiveAccountSession(this.userDataPath)
        return { status: 'signed-out', state: signedOutState() }
      }
      return { status: 'failed', state: { ...stateFromSession(expected), errorCode } }
    }
  }

  async signOut(): Promise<HiveAccountSignOutResult> {
    this.mutationEpoch += 1
    const configured = this.dependencies.getConfig()
    const stored = readHiveAccountSession(this.userDataPath)
    if (stored.status === 'missing') {
      return { status: 'already-signed-out', state: signedOutState() }
    }
    let remoteRevoked = false
    try {
      if (configured.configured && stored.status === 'ok') {
        const client = this.dependencies.createClient(configured.config)
        await this.revokeCurrent(client, stored.value.accessToken)
        remoteRevoked = true
      }
    } catch {
      remoteRevoked = false
    } finally {
      clearHiveAccountSession(this.userDataPath)
    }
    return {
      status: remoteRevoked ? 'remote-and-local' : 'local-only',
      state: signedOutState()
    }
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
}
