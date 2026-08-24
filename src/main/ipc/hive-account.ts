import { app, ipcMain } from 'electron'
import type { HiveAccountState } from '../../shared/hive-account'
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
  ipcMain.handle('hiveAccount:signIn', () => service.signIn())
  ipcMain.handle('hiveAccount:refresh', () => service.refresh())
  ipcMain.handle('hiveAccount:signOut', () => service.signOut())
}
