/* eslint-disable max-lines -- HiveCloud account lifecycle and SMS authentication share one secure-store and PKCE boundary. */

import { createHash, randomBytes } from 'node:crypto'
import type {
  HiveAccountLoginCapabilities,
  HiveAccountLoginProviderId,
  HiveAccountRefreshResult,
  HiveAccountSessionProfile,
  HiveAccountSignInOptions,
  HiveAccountSignInResult,
  HiveAccountSignOutResult,
  HiveAccountSecurity,
  HiveAccountSecurityChallenge,
  HiveAccountState
} from '../../shared/hive-account'
import {
  getHiveAccountConfig,
  HIVE_ACCOUNT_CLIENT_ID,
  type HiveAccountConfig
} from './hive-account-config'
import {
  HiveAccountClient,
  HiveAccountRequestError,
  type SmsChallengeStart
} from './hive-account-client'
import {
  getOrCreateHiveDeviceIdentity,
  signHiveDeviceAuthorization,
  type HiveDeviceIdentity
} from './hive-account-device'
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

type PendingSmsSignIn = {
  nonce: string
  state: string
  codeVerifier: string
  codeChallenge: string
  redirectUri: string
  challengeId: string
  expiresAt: number
  stage: 'ISSUED' | 'VERIFIED'
  sessionProfile: Exclude<HiveAccountSessionProfile, 'LEGACY'>
  device: HiveDeviceIdentity
  config: HiveAccountConfig
}

function randomToken(bytes: number): string {
  return randomBytes(bytes).toString('base64url')
}

const defaultDependencies: ServiceDependencies = {
  getConfig: () => getHiveAccountConfig(),
  createClient: (config) => new HiveAccountClient(config),
  beginAuthorization: beginHiveAccountPkceFlow
}

const HIVE_ACCOUNT_STEP_UP_ACR = 'urn:hive:acr:step-up'

function emptyLoginCapabilities(clientId: string): HiveAccountLoginCapabilities {
  return {
    contractRevision: 'hive-login-capabilities-v1',
    clientId,
    defaultMethod: 'phone_sms',
    providers: []
  }
}

export class HiveAccountService extends HiveAccountPublication {
  private signInFlight: Promise<HiveAccountSignInResult> | null = null
  private smsSignInFlight: Promise<HiveAccountSignInResult> | null = null
  private smsStartFlight: Promise<SmsChallengeStart> | null = null
  private smsStartEpoch: number | null = null
  private pendingSmsSignIn: PendingSmsSignIn | null = null
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

  async getLoginCapabilities(): Promise<HiveAccountLoginCapabilities> {
    const configured = this.dependencies.getConfig()
    if (!configured.configured) {
      return emptyLoginCapabilities(HIVE_ACCOUNT_CLIENT_ID)
    }
    try {
      return await this.dependencies.createClient(configured.config).getLoginCapabilities()
    } catch {
      return emptyLoginCapabilities(configured.config.clientId)
    }
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

  async startSmsSignIn(options: {
    phoneNumber: string
    sessionProfile: Exclude<HiveAccountSessionProfile, 'LEGACY'>
    locale?: 'zh-CN' | 'en-US'
    termsAccepted: true
  }): Promise<SmsChallengeStart> {
    this.reapExpiredSmsSignIn()
    const startInFlight = this.smsStartFlight && this.smsStartEpoch === this.mutationEpoch
    if (this.pendingSmsSignIn || startInFlight) {
      throw new Error('hive_account_sms_sign_in_pending')
    }
    const flight = this.runStartSmsSignIn(options)
    this.smsStartFlight = flight
    this.smsStartEpoch = this.mutationEpoch
    try {
      return await flight
    } finally {
      if (this.smsStartFlight === flight) {
        this.smsStartFlight = null
        this.smsStartEpoch = null
      }
    }
  }

  cancelSmsSignIn(): void {
    if (!this.pendingSmsSignIn && !this.smsStartFlight) {
      return
    }
    this.mutationEpoch += 1
    this.pendingSmsSignIn = null
  }

  private reapExpiredSmsSignIn(): void {
    if (this.pendingSmsSignIn && this.pendingSmsSignIn.expiresAt <= Date.now()) {
      this.cancelSmsSignIn()
    }
  }

  private async runStartSmsSignIn(options: {
    phoneNumber: string
    sessionProfile: Exclude<HiveAccountSessionProfile, 'LEGACY'>
    locale?: 'zh-CN' | 'en-US'
    termsAccepted: true
  }): Promise<SmsChallengeStart> {
    const expectedEpoch = ++this.mutationEpoch
    const configured = this.dependencies.getConfig()
    if (!configured.configured) {
      throw new Error('hive_account_not_configured')
    }
    if (!isHiveAccountEncryptionAvailable()) {
      throw new Error('secure_storage_unavailable')
    }
    if (!/^\+?[0-9]{6,20}$/.test(options.phoneNumber.trim())) {
      throw new Error('hive_account_sms_phone_invalid')
    }
    const device = getOrCreateHiveDeviceIdentity(this.userDataPath)
    if (device.status !== 'ok') {
      throw new Error('secure_storage_unavailable')
    }
    const nonce = randomToken(32)
    const state = randomToken(32)
    const codeVerifier = randomToken(32)
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
    const redirectUri = 'http://127.0.0.1'
    const client = this.dependencies.createClient(configured.config)
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
    const challenge = await client.createSmsChallenge({
      nonce,
      phoneNumber: options.phoneNumber.trim(),
      locale: options.locale ?? 'zh-CN',
      termsAccepted: options.termsAccepted
    })
    if (this.mutationEpoch !== expectedEpoch) {
      throw new Error('hive_account_sms_sign_in_cancelled')
    }
    this.pendingSmsSignIn = {
      nonce,
      state,
      codeVerifier,
      codeChallenge,
      redirectUri,
      challengeId: challenge.challengeId,
      expiresAt: Date.now() + Math.max(1, challenge.expiresInSeconds) * 1000,
      stage: 'ISSUED',
      sessionProfile: options.sessionProfile,
      device: device.identity,
      config: configured.config
    }
    return challenge
  }

  completeSmsSignIn(args: {
    challengeId: string
    smsCode: string
  }): Promise<HiveAccountSignInResult> {
    if (this.smsSignInFlight) {
      return this.smsSignInFlight
    }
    this.smsSignInFlight = this.runSmsSignIn(args)
      .then((result) => publishHiveAccountResult((state) => this.publishState(state), result))
      .finally(() => {
        this.smsSignInFlight = null
      })
    return this.smsSignInFlight
  }

  private async runSmsSignIn(args: {
    challengeId: string
    smsCode: string
  }): Promise<HiveAccountSignInResult> {
    const pending = this.pendingSmsSignIn
    if (!pending || pending.challengeId !== args.challengeId || !/^\d{6}$/.test(args.smsCode)) {
      return { status: 'failed', state: errorState('authorization_failed') }
    }
    if (pending.expiresAt <= Date.now()) {
      this.cancelSmsSignIn()
      return { status: 'failed', state: errorState('authorization_failed') }
    }
    const expectedEpoch = ++this.mutationEpoch
    try {
      const client = this.dependencies.createClient(pending.config)
      if (pending.stage === 'ISSUED') {
        await client.verifySmsChallenge({
          challengeId: pending.challengeId,
          nonce: pending.nonce,
          smsCode: args.smsCode,
          termsAccepted: true
        })
        if (
          this.mutationEpoch !== expectedEpoch ||
          this.pendingSmsSignIn?.challengeId !== pending.challengeId
        ) {
          return { status: 'cancelled', state: signedOutState() }
        }
        this.pendingSmsSignIn = { ...pending, stage: 'VERIFIED' }
      }

      const verified = this.pendingSmsSignIn
      if (!verified || verified.challengeId !== pending.challengeId) {
        return { status: 'cancelled', state: signedOutState() }
      }
      if (verified.stage !== 'VERIFIED') {
        return { status: 'failed', state: errorState('authorization_failed') }
      }
      // Authorization codes are single-use. Keep the SMS challenge at VERIFIED
      // until the exchange succeeds so a transient authorization or exchange
      // failure can obtain a fresh code without asking the user to re-enter SMS.
      const authorization = await client.authorizeSms({
        nonce: verified.nonce,
        codeChallenge: verified.codeChallenge,
        redirectUri: verified.redirectUri,
        state: verified.state
      })
      if (
        this.mutationEpoch !== expectedEpoch ||
        this.pendingSmsSignIn?.challengeId !== pending.challengeId
      ) {
        return { status: 'cancelled', state: signedOutState() }
      }
      const exchange = await client.exchangeSession({
        authorizationCode: authorization.authorizationCode,
        codeVerifier: verified.codeVerifier,
        redirectUri: verified.redirectUri,
        nonce: verified.nonce
      })
      if (this.mutationEpoch !== expectedEpoch) {
        this.pendingSmsSignIn = null
        await this.bestEffortRevokeCurrent(client, exchange.accessToken)
        return { status: 'cancelled', state: signedOutState() }
      }
      const previous = this.readCurrentSession()
      const session: HiveAccountSession = {
        schemaVersion: 2,
        ...exchange,
        deviceLabel: verified.device.deviceLabel,
        generation: previous.status === 'ok' ? previous.value.generation + 1 : 1,
        savedAt: Date.now()
      }
      this.fenceRuntimeCloudAuthorization()
      if (!this.persistSession(session)) {
        this.pendingSmsSignIn = null
        await this.bestEffortRevokeCurrent(client, exchange.accessToken)
        return { status: 'failed', state: errorState('secure_storage_unavailable') }
      }
      this.scheduleRefresh(session)
      this.publishRuntimeCloudSession(session)
      this.pendingSmsSignIn = null
      return { status: 'signed-in', state: stateFromSession(session) }
    } catch (error) {
      return { status: 'failed', state: errorState(classifyHiveAccountError(error)) }
    }
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
      const authorizationEndpoint = options.providerId
        ? await this.getProviderAuthorizationEndpoint(client, configured.config, options.providerId)
        : await client.discoverAuthorizationEndpoint()
      const code = await this.dependencies.beginAuthorization({
        authorizationEndpoint,
        clientId: configured.config.clientId,
        scope: configured.config.scope,
        ...(options.intent === 'STEP_UP'
          ? {
              acrValues: HIVE_ACCOUNT_STEP_UP_ACR,
              maxAgeSeconds: 0,
              prompt: 'login' as const
            }
          : {}),
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

  private async getProviderAuthorizationEndpoint(
    client: HiveAccountClient,
    config: HiveAccountConfig,
    providerId: HiveAccountLoginProviderId
  ): Promise<string> {
    const capabilities = await client.getLoginCapabilities()
    const provider = capabilities.providers.find((candidate) => candidate.id === providerId)
    if (!provider) {
      throw new Error('hive_account_login_provider_unavailable')
    }
    return new URL(provider.authorizationPath, `${config.apiBaseUrl}/`).toString()
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
      const superseded = this.getSupersededRefreshResult(expectedEpoch, expected)
      if (superseded) {
        await this.bestEffortRevokeCurrent(client, refreshed.accessToken)
        return superseded
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
      const superseded = this.getSupersededRefreshResult(expectedEpoch, expected)
      if (superseded) {
        return superseded
      }
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

  private getSupersededRefreshResult(
    expectedEpoch: number,
    expected: HiveAccountSession
  ): HiveAccountRefreshResult | null {
    const current = this.readCurrentSession()
    if (
      current.status === 'ok' &&
      this.mutationEpoch === expectedEpoch &&
      current.value.generation === expected.generation &&
      current.value.refreshToken === expected.refreshToken
    ) {
      return null
    }
    return {
      status: current.status === 'ok' ? 'refreshed' : 'signed-out',
      state: current.status === 'ok' ? stateFromSession(current.value) : signedOutState()
    }
  }

  async signOut(): Promise<HiveAccountSignOutResult> {
    this.mutationEpoch += 1
    this.pendingSmsSignIn = null
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

  async accountSecurity(): Promise<HiveAccountSecurity> {
    const configured = this.dependencies.getConfig()
    const stored = this.readCurrentSession()
    if (!configured.configured || stored.status !== 'ok') {
      throw new Error('hive_account_session_required')
    }
    const client = this.dependencies.createClient(configured.config)
    return this.requestWithRefresh(
      (accessToken) => client.accountSecurity(accessToken),
      stored.value.accessToken
    )
  }

  async setPassword(newPassword: string): Promise<void> {
    if (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 128) {
      throw new Error('hive_account_password_invalid')
    }
    const configured = this.dependencies.getConfig()
    const stored = this.readCurrentSession()
    if (!configured.configured || stored.status !== 'ok') {
      throw new Error('hive_account_session_required')
    }
    const client = this.dependencies.createClient(configured.config)
    await this.requestWithRefresh(
      (accessToken) => client.setPassword(accessToken, newPassword),
      stored.value.accessToken
    )
    // Password changes advance the account security version and invalidate all
    // existing sessions, including this desktop session.
    this.mutationEpoch += 1
    this.fenceRuntimeCloudAuthorization()
    this.clearCurrentSession()
    this.publishState(signedOutState())
  }

  async startPasswordReset(phoneNumber: string): Promise<HiveAccountSecurityChallenge> {
    const configured = this.dependencies.getConfig()
    if (!configured.configured) {
      throw new Error('hive_account_unconfigured')
    }
    return this.dependencies.createClient(configured.config).startPasswordReset(phoneNumber)
  }

  async verifyPasswordReset(
    challengeId: string,
    bindingId: string,
    smsCode: string,
    newPassword: string
  ): Promise<void> {
    if (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 128) {
      throw new Error('hive_account_password_invalid')
    }
    const configured = this.dependencies.getConfig()
    if (!configured.configured) {
      throw new Error('hive_account_unconfigured')
    }
    await this.dependencies
      .createClient(configured.config)
      .verifyPasswordReset(challengeId, bindingId, smsCode, newPassword)
    // A reset invalidates every cloud session; remove any local credential as
    // well in case the flow was started from an already-authenticated window.
    this.mutationEpoch += 1
    this.fenceRuntimeCloudAuthorization()
    this.clearCurrentSession()
    this.publishState(signedOutState())
  }

  async startPhoneBinding(phoneNumber: string): Promise<HiveAccountSecurityChallenge> {
    const configured = this.dependencies.getConfig()
    const stored = this.readCurrentSession()
    if (!configured.configured || stored.status !== 'ok') {
      throw new Error('hive_account_session_required')
    }
    const client = this.dependencies.createClient(configured.config)
    return this.requestWithRefresh(
      (accessToken) => client.startPhoneBinding(accessToken, phoneNumber),
      stored.value.accessToken
    )
  }

  async verifyPhoneBinding(challengeId: string, bindingId: string, smsCode: string): Promise<void> {
    const configured = this.dependencies.getConfig()
    const stored = this.readCurrentSession()
    if (!configured.configured || stored.status !== 'ok') {
      throw new Error('hive_account_session_required')
    }
    const client = this.dependencies.createClient(configured.config)
    await this.requestWithRefresh(
      (accessToken) => client.verifyPhoneBinding(accessToken, challengeId, bindingId, smsCode),
      stored.value.accessToken
    )
    // Phone binding advances the account security version and invalidates all
    // existing sessions, including this desktop session.
    this.mutationEpoch += 1
    this.fenceRuntimeCloudAuthorization()
    this.clearCurrentSession()
    this.publishState(signedOutState())
  }

  private async requestWithRefresh<T>(
    operation: (accessToken: string) => Promise<T>,
    accessToken: string
  ): Promise<T> {
    try {
      return await operation(accessToken)
    } catch (failure) {
      if (!(failure instanceof HiveAccountRequestError) || failure.status !== 401) {
        throw failure
      }
      const refreshed = await this.refresh()
      if (refreshed.status !== 'refreshed') {
        throw failure
      }
      const current = this.readCurrentSession()
      if (current.status !== 'ok') {
        throw failure
      }
      return operation(current.value.accessToken)
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
