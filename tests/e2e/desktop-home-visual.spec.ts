import path from 'node:path'
import { mkdirSync } from 'node:fs'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { APP_DISPLAY_NAME } from '../../src/shared/brand'
import type { HiveAccountState } from '../../src/shared/hive-account'

test.use({ seedTestRepo: false, dismissOnboarding: true })

async function publishAccountState(
  electronApp: ElectronApplication,
  state: HiveAccountState
): Promise<void> {
  await electronApp.evaluate(({ ipcMain, BrowserWindow }, state) => {
    ipcMain.removeHandler('hiveAccount:getState')
    ipcMain.handle('hiveAccount:getState', () => state)
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('hiveAccount:stateChanged', state)
    }
  }, state)
}

test('desktop home renders the production shell and empty states', async ({
  electronApp,
  orcaPage
}) => {
  await orcaPage.waitForFunction(
    () => Boolean(window.__store?.getState().workspaceSessionReady),
    undefined,
    { timeout: 30_000 }
  )
  await publishAccountState(electronApp, {
    configured: true,
    status: 'signed-out',
    persistence: 'encrypted'
  })
  await orcaPage.evaluate(() => {
    window.__store?.setState({
      activeView: 'terminal',
      activeWorktreeId: null,
      rightSidebarOpen: true
    })
  })

  const home = orcaPage.getByTestId('desktop-home')
  await expect(home).toBeVisible()
  await expect(
    home.getByRole('heading', { name: `${APP_DISPLAY_NAME} — start today's development` })
  ).toBeVisible()
  await expect(home.locator('.desktop-home-composer-context')).toBeVisible()

  const evidenceDir = path.resolve('logs/e2e/desktop-home-visual')
  mkdirSync(evidenceDir, { recursive: true })
  await orcaPage.screenshot({
    path: path.join(evidenceDir, 'home-light.png'),
    animations: 'disabled'
  })

  await orcaPage.evaluate(async () => {
    await window.__store?.getState().updateSettings({ theme: 'dark' })
  })
  await expect
    .poll(() => orcaPage.locator('html').getAttribute('class'), { timeout: 5_000 })
    .toContain('dark')

  const accountTrigger = orcaPage.locator('[data-sidebar-account-trigger]')
  await expect(accountTrigger).toBeEnabled()
  await accountTrigger.click()

  const accountPopover = orcaPage.locator('[data-account-popover]')
  await expect(accountPopover).toBeVisible()
  await expect
    .poll(async () =>
      orcaPage.evaluate(() => {
        const background = (selector: string): string => {
          const element = document.querySelector<HTMLElement>(selector)
          return element ? window.getComputedStyle(element).backgroundColor : ''
        }
        return {
          accountPopover: background('[data-account-popover]'),
          composerContext: background('.desktop-home-composer-context'),
          disabledSend: background('.desktop-home-send:disabled')
        }
      })
    )
    .toEqual({
      accountPopover: 'rgb(23, 23, 23)',
      composerContext: 'rgb(38, 38, 38)',
      disabledSend: 'rgb(38, 38, 38)'
    })

  await orcaPage.screenshot({
    path: path.join(evidenceDir, 'home-dark.png'),
    animations: 'disabled'
  })

  const signInButton = accountPopover.getByRole('button', {
    name: /登录 HiveCloud|Sign in to HiveCloud/
  })
  await signInButton.click()
  const accountDialog = orcaPage.locator('.hive-account-dialog')
  await expect(accountDialog).toBeVisible()
  await expect
    .poll(() =>
      orcaPage.evaluate(() => {
        const background = (selector: string): string => {
          const element = document.querySelector<HTMLElement>(selector)
          return element ? window.getComputedStyle(element).backgroundColor : ''
        }
        return {
          dialog: background('.hive-account-dialog'),
          brandPanel: background('.hive-account-brand-panel'),
          phoneInput: background('.hive-account-phone-input')
        }
      })
    )
    .toEqual({
      dialog: 'rgb(23, 23, 23)',
      brandPanel: 'rgb(38, 38, 38)',
      phoneInput: 'rgb(10, 10, 10)'
    })

  await orcaPage.screenshot({
    path: path.join(evidenceDir, 'sign-in-dark.png'),
    animations: 'disabled'
  })
})

test('secure storage failure directs sign-in to the blocked account settings', async ({
  electronApp,
  orcaPage
}) => {
  await orcaPage.waitForFunction(() => Boolean(window.__store?.getState().workspaceSessionReady))
  await publishAccountState(electronApp, {
    configured: true,
    status: 'error',
    persistence: 'none',
    errorCode: 'secure_storage_unavailable'
  })
  await orcaPage.locator('[data-sidebar-account-trigger]').click()
  await orcaPage
    .locator('[data-account-popover]')
    .getByRole('button', { name: 'Sign in to HiveCloud', exact: true })
    .click()
  await expect(
    orcaPage.getByRole('heading', { name: 'Account & cloud', exact: true })
  ).toBeVisible()
  await expect(orcaPage.getByRole('alert')).toContainText('System secure storage is unavailable')
  await expect(
    orcaPage.getByRole('button', { name: 'Sign in to HiveCloud', exact: true })
  ).toBeDisabled()
  await expect(orcaPage.locator('.hive-account-dialog')).toHaveCount(0)
})
