import { app, ipcMain } from 'electron'
import type { HiveAccountSignInOptions, HiveAccountState } from '../../shared/hive-account'
import { HiveAccountService } from '../hive-account/hive-account-service'

type HiveAccountHandlerService = Pick<
  HiveAccountService,
  'getState' | 'signIn' | 'refresh' | 'signOut'
>

type HiveAccountHandlerDependencies = {
  createService: (userDataPath: string) => HiveAccountHandlerService
}

const defaultDependencies: HiveAccountHandlerDependencies = {
  createService: (userDataPath) => new HiveAccountService(userDataPath)
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
  const service = dependencies.createService(app.getPath('userData'))
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
