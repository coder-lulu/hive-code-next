import { app, BrowserWindow, ipcMain } from 'electron'
import {
  HIVE_ACCOUNT_STATE_CHANGED_CHANNEL,
  type HiveAccountSignInOptions,
  type HiveAccountState
} from '../../shared/hive-account'
import { HiveAccountService } from '../hive-account/hive-account-service'

type HiveAccountHandlerService = Pick<
  HiveAccountService,
  'getState' | 'signIn' | 'refresh' | 'signOut'
>

type HiveAccountHandlerDependencies = {
  createService: (
    userDataPath: string,
    onStateChanged: (state: HiveAccountState) => void
  ) => HiveAccountHandlerService
}

const defaultDependencies: HiveAccountHandlerDependencies = {
  createService: (userDataPath, onStateChanged) =>
    new HiveAccountService(userDataPath, undefined, onStateChanged)
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
  if (
    Object.keys(record).length !== 1 ||
    (record.sessionProfile !== 'TEMPORARY' && record.sessionProfile !== 'TRUSTED')
  ) {
    throw new Error('Invalid HiveCloud sign-in options')
  }
  return { sessionProfile: record.sessionProfile }
}

export function registerHiveAccountHandlers(
  dependencies: HiveAccountHandlerDependencies = defaultDependencies
): void {
  const service = dependencies.createService(app.getPath('userData'), broadcastHiveAccountState)
  let startupRefreshPending = true
  const startupState: Promise<HiveAccountState> = service
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
  ipcMain.handle('hiveAccount:refresh', () => service.refresh())
  ipcMain.handle('hiveAccount:signOut', () => service.signOut())
}
