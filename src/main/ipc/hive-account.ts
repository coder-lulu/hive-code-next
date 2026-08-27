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
  | 'getState'
  | 'signIn'
  | 'startSmsSignIn'
  | 'cancelSmsSignIn'
  | 'completeSmsSignIn'
  | 'refresh'
  | 'signOut'
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
  if (
    Object.keys(record).length !== 1 ||
    (record.sessionProfile !== 'TEMPORARY' && record.sessionProfile !== 'TRUSTED')
  ) {
    throw new Error('Invalid HiveCloud sign-in options')
  }
  return { sessionProfile: record.sessionProfile }
}

export function requireHiveAccountSmsSignInOptions(value: unknown): HiveAccountSmsSignInOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid HiveCloud SMS options')
  }
  const record = value as Record<string, unknown>
  if (
    typeof record.phoneNumber !== 'string' ||
    !/^\+?[0-9]{6,20}$/.test(record.phoneNumber.trim()) ||
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
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid HiveCloud SMS verification')
  }
  const record = value as Record<string, unknown>
  if (
    typeof record.challengeId !== 'string' ||
    !/^[0-9a-f]{32}$/.test(record.challengeId) ||
    typeof record.smsCode !== 'string' ||
    !/^\d{6}$/.test(record.smsCode)
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
  let startupRefreshPending = true
  const startupState: Promise<HiveAccountState> =
    dependencies.startupState ??
    service
      .refresh()
      .then((result) => result.state)
      .catch(() => service.getState())
  void startupState.then(
    () => {
      startupRefreshPending = false
    },
    () => {
      startupRefreshPending = false
    }
  )

  ipcMain.handle('hiveAccount:getState', () =>
    startupRefreshPending ? startupState : service.getState()
  )
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
}
