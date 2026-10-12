import { app, BrowserWindow, ipcMain } from 'electron'
import {
  HIVE_ACCOUNT_STATE_CHANGED_CHANNEL,
  type HiveAccountSignInOptions,
  type HiveAccountSmsSignInOptions,
  type HiveAccountSmsVerifyOptions,
  type HiveAccountState
} from '../../shared/hive-account'
import { HiveAccountService } from '../hive-account/hive-account-service'

type HiveAccountHandlerService = Pick<
  HiveAccountService,
  | 'getLoginCapabilities'
  | 'getState'
  | 'signIn'
  | 'startSmsSignIn'
  | 'cancelSmsSignIn'
  | 'completeSmsSignIn'
  | 'refresh'
  | 'signOut'
> &
  Partial<
    Pick<
      HiveAccountService,
      | 'accountSecurity'
      | 'setPassword'
      | 'startPasswordReset'
      | 'verifyPasswordReset'
      | 'startPhoneBinding'
      | 'verifyPhoneBinding'
    >
  >

export type HiveAccountHandlerDependencies = {
  service?: HiveAccountHandlerService & {
    subscribeStateChanged?: (listener: (state: HiveAccountState) => void) => () => void
  }
  startupState?: Promise<HiveAccountState>
  createService?: (
    userDataPath: string,
    onStateChanged: (state: HiveAccountState) => void
  ) => HiveAccountHandlerService
}

const defaultDependencies = {
  createService: (userDataPath, onStateChanged) =>
    new HiveAccountService(userDataPath, undefined, onStateChanged)
} satisfies HiveAccountHandlerDependencies

const HIVE_ACCOUNT_PHONE_PATTERN = /^\+?[0-9]{6,20}$/
const HIVE_ACCOUNT_CHALLENGE_ID_PATTERN = /^[0-9a-f]{32}$/
const HIVE_ACCOUNT_SECURITY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
const HIVE_ACCOUNT_SMS_CODE_PATTERN = /^\d{6}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(record)
  return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(record, key))
}

function hasAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) {
      return true
    }
  }
  return false
}

function isValidHiveAccountPassword(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 12 &&
    value.length <= 128 &&
    !hasAsciiControlCharacter(value)
  )
}

export function requireHiveAccountPhoneNumber(value: unknown): string {
  if (typeof value !== 'string' || !HIVE_ACCOUNT_PHONE_PATTERN.test(value.trim())) {
    throw new Error('Invalid phone number')
  }
  return value.trim()
}

export function requireHiveAccountPassword(value: unknown): string {
  if (!isValidHiveAccountPassword(value)) {
    throw new Error('Invalid HiveCloud password')
  }
  return value
}

export function requireHiveAccountPasswordResetVerification(value: unknown): {
  challengeId: string
  bindingId: string
  smsCode: string
  newPassword: string
} {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['challengeId', 'bindingId', 'smsCode', 'newPassword'])
  ) {
    throw new Error('Invalid password reset verification')
  }
  if (
    typeof value.challengeId !== 'string' ||
    !HIVE_ACCOUNT_CHALLENGE_ID_PATTERN.test(value.challengeId) ||
    typeof value.bindingId !== 'string' ||
    !HIVE_ACCOUNT_SECURITY_ID_PATTERN.test(value.bindingId) ||
    typeof value.smsCode !== 'string' ||
    !HIVE_ACCOUNT_SMS_CODE_PATTERN.test(value.smsCode) ||
    !isValidHiveAccountPassword(value.newPassword)
  ) {
    throw new Error('Invalid password reset verification')
  }
  return {
    challengeId: value.challengeId,
    bindingId: value.bindingId,
    smsCode: value.smsCode,
    newPassword: value.newPassword
  }
}

export function requireHiveAccountPhoneVerification(value: unknown): {
  challengeId: string
  bindingId: string
  smsCode: string
} {
  if (!isRecord(value) || !hasExactKeys(value, ['challengeId', 'bindingId', 'smsCode'])) {
    throw new Error('Invalid phone verification')
  }
  if (
    typeof value.challengeId !== 'string' ||
    !HIVE_ACCOUNT_CHALLENGE_ID_PATTERN.test(value.challengeId) ||
    typeof value.bindingId !== 'string' ||
    !HIVE_ACCOUNT_SECURITY_ID_PATTERN.test(value.bindingId) ||
    typeof value.smsCode !== 'string' ||
    !HIVE_ACCOUNT_SMS_CODE_PATTERN.test(value.smsCode)
  ) {
    throw new Error('Invalid phone verification')
  }
  return {
    challengeId: value.challengeId,
    bindingId: value.bindingId,
    smsCode: value.smsCode
  }
}

function broadcastHiveAccountState(state: HiveAccountState): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(HIVE_ACCOUNT_STATE_CHANGED_CHANNEL, state)
    }
  }
}

export function requireHiveAccountSignInOptions(value: unknown): HiveAccountSignInOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid HiveCloud sign-in options')
  }
  const record = value as Record<string, unknown>
  const providerId = record.providerId
  const intent = record.intent
  const expectedKeyCount = 1 + (providerId === undefined ? 0 : 1) + (intent === undefined ? 0 : 1)
  if (
    (record.sessionProfile !== 'TEMPORARY' && record.sessionProfile !== 'TRUSTED') ||
    (providerId !== undefined &&
      providerId !== 'github' &&
      providerId !== 'wechat' &&
      providerId !== 'qq') ||
    (intent !== undefined && intent !== 'STEP_UP') ||
    (intent === 'STEP_UP' && providerId !== undefined) ||
    Object.keys(record).some(
      (key) => key !== 'sessionProfile' && key !== 'providerId' && key !== 'intent'
    ) ||
    Object.keys(record).length !== expectedKeyCount
  ) {
    throw new Error('Invalid HiveCloud sign-in options')
  }
  if (intent === 'STEP_UP') {
    return { sessionProfile: record.sessionProfile, intent }
  }
  return providerId === undefined
    ? { sessionProfile: record.sessionProfile }
    : { sessionProfile: record.sessionProfile, providerId }
}

export function requireHiveAccountSmsSignInOptions(value: unknown): HiveAccountSmsSignInOptions {
  if (!isRecord(value)) {
    throw new Error('Invalid HiveCloud SMS options')
  }
  const record = value
  const expectedKeys =
    record.locale === undefined
      ? ['phoneNumber', 'sessionProfile', 'termsAccepted']
      : ['phoneNumber', 'sessionProfile', 'locale', 'termsAccepted']
  if (
    !hasExactKeys(record, expectedKeys) ||
    typeof record.phoneNumber !== 'string' ||
    !HIVE_ACCOUNT_PHONE_PATTERN.test(record.phoneNumber.trim()) ||
    (record.sessionProfile !== 'TEMPORARY' && record.sessionProfile !== 'TRUSTED') ||
    (record.locale !== undefined && record.locale !== 'zh-CN' && record.locale !== 'en-US') ||
    record.termsAccepted !== true
  ) {
    throw new Error('Invalid HiveCloud SMS options')
  }
  return {
    phoneNumber: record.phoneNumber.trim(),
    sessionProfile: record.sessionProfile,
    locale: record.locale as 'zh-CN' | 'en-US' | undefined,
    termsAccepted: true
  }
}

export function requireHiveAccountSmsVerifyOptions(value: unknown): HiveAccountSmsVerifyOptions {
  if (!isRecord(value)) {
    throw new Error('Invalid HiveCloud SMS verification')
  }
  const record = value
  if (
    !hasExactKeys(record, ['challengeId', 'smsCode']) ||
    typeof record.challengeId !== 'string' ||
    !HIVE_ACCOUNT_CHALLENGE_ID_PATTERN.test(record.challengeId) ||
    typeof record.smsCode !== 'string' ||
    !HIVE_ACCOUNT_SMS_CODE_PATTERN.test(record.smsCode)
  ) {
    throw new Error('Invalid HiveCloud SMS verification')
  }
  return { challengeId: record.challengeId, smsCode: record.smsCode }
}

export function registerHiveAccountHandlers(
  dependencies: HiveAccountHandlerDependencies = defaultDependencies
): void {
  const service =
    dependencies.service ??
    (dependencies.createService ?? defaultDependencies.createService)(
      app.getPath('userData'),
      broadcastHiveAccountState
    )
  dependencies.service?.subscribeStateChanged?.(broadcastHiveAccountState)
  const startupState: Promise<HiveAccountState> =
    dependencies.startupState ??
    service
      .refresh()
      .then((result) => result.state)
      .catch(() => service.getState())
  // Keep startup refresh in the background; cached encrypted state is sufficient for first paint.
  void startupState.catch(() => undefined)

  ipcMain.handle('hiveAccount:getState', () => service.getState())
  ipcMain.handle('hiveAccount:getLoginCapabilities', () => service.getLoginCapabilities())
  ipcMain.handle('hiveAccount:signIn', (_event, options) =>
    service.signIn(requireHiveAccountSignInOptions(options))
  )
  ipcMain.handle('hiveAccount:startSmsSignIn', (_event, options) =>
    service.startSmsSignIn(requireHiveAccountSmsSignInOptions(options))
  )
  ipcMain.handle('hiveAccount:cancelSmsSignIn', () => service.cancelSmsSignIn())
  ipcMain.handle('hiveAccount:completeSmsSignIn', (_event, options) =>
    service.completeSmsSignIn(requireHiveAccountSmsVerifyOptions(options))
  )
  ipcMain.handle('hiveAccount:refresh', () => service.refresh())
  ipcMain.handle('hiveAccount:signOut', () => service.signOut())
  ipcMain.handle('hiveAccount:accountSecurity', () => {
    if (!service.accountSecurity) {
      throw new Error('HiveCloud account security is unavailable')
    }
    return service.accountSecurity()
  })
  ipcMain.handle('hiveAccount:setPassword', (_event, password) => {
    const validPassword = requireHiveAccountPassword(password)
    if (!service.setPassword) {
      throw new Error('HiveCloud password management is unavailable')
    }
    return service.setPassword(validPassword)
  })
  ipcMain.handle('hiveAccount:startPasswordReset', (_event, phoneNumber) => {
    const validPhoneNumber = requireHiveAccountPhoneNumber(phoneNumber)
    if (!service.startPasswordReset) {
      throw new Error('hive_account_security_unavailable')
    }
    return service.startPasswordReset(validPhoneNumber)
  })
  ipcMain.handle('hiveAccount:verifyPasswordReset', (_event, payload) => {
    const validPayload = requireHiveAccountPasswordResetVerification(payload)
    if (!service.verifyPasswordReset) {
      throw new Error('hive_account_security_unavailable')
    }
    return service.verifyPasswordReset(
      validPayload.challengeId,
      validPayload.bindingId,
      validPayload.smsCode,
      validPayload.newPassword
    )
  })
  ipcMain.handle('hiveAccount:startPhoneBinding', (_event, phoneNumber) => {
    const validPhoneNumber = requireHiveAccountPhoneNumber(phoneNumber)
    if (!service.startPhoneBinding) {
      throw new Error('HiveCloud phone binding is unavailable')
    }
    return service.startPhoneBinding(validPhoneNumber)
  })
  ipcMain.handle('hiveAccount:verifyPhoneBinding', (_event, args) => {
    const validArgs = requireHiveAccountPhoneVerification(args)
    if (!service.verifyPhoneBinding) {
      throw new Error('HiveCloud phone binding is unavailable')
    }
    return service.verifyPhoneBinding(validArgs.challengeId, validArgs.bindingId, validArgs.smsCode)
  })
}
