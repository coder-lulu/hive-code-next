import { app, ipcMain } from 'electron'
import { HiveAccountService } from '../hive-account/hive-account-service'

export function registerHiveAccountHandlers(): void {
  const service = new HiveAccountService(app.getPath('userData'))
  ipcMain.handle('hiveAccount:getState', () => service.getState())
  ipcMain.handle('hiveAccount:signIn', () => service.signIn())
  ipcMain.handle('hiveAccount:refresh', () => service.refresh())
  ipcMain.handle('hiveAccount:signOut', () => service.signOut())
}
