import path from 'node:path'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

test.use({ minimumSeededWorktreeCount: 1 })

test('unifies device settings, preserves direct pairing and respects account shortcut visibility', async ({
  orcaPage: page,
  electronApp
}, testInfo) => {
  await waitForSessionReady(page)
  await page.evaluate(async () => {
    await window.__store!.getState().updateSettings({ theme: 'light', uiLanguage: 'en' })
    window.__store!.setState({ sidebarOpen: true, sidebarWidth: 240, rightSidebarOpen: false })
  })
  await page.setViewportSize({ width: 1400, height: 1000 })
  const shortcut = page
    .locator('.sidebar-primary-nav')
    .getByRole('button', { name: /^Phone connection/ })
  await shortcut.click()
  const heading = page.getByRole('heading', { name: 'Devices & connections', exact: true })
  await expect(heading).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Connect to this computer' })).toHaveAttribute(
    'data-state',
    'active'
  )
  await expect(page.getByRole('tab', { name: 'HiveCloud account' })).toHaveAttribute(
    'data-state',
    'active'
  )
  await page.getByRole('button', { name: 'Sign in to HiveCloud' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(heading).toBeVisible()
  await page.screenshot({
    animations: 'disabled',
    path: path.join(testInfo.outputDir, 'cloud-light.png')
  })

  await page.getByRole('tab', { name: 'Direct address' }).click()
  await page.getByRole('button', { name: 'Generate QR code' }).click()
  const qr = page.getByRole('img', { name: 'QR Code for mobile pairing' })
  await expect(qr).toBeVisible()
  const source = await qr.getAttribute('src')
  await expect(page.getByRole('heading', { name: 'Browser or another computer' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Shared Server Access' })).toHaveCount(0)
  await page.getByRole('tab', { name: 'Access management' }).click()
  await expect(page.getByRole('heading', { name: 'Shared Server Access' })).toBeVisible()
  await page.getByRole('tab', { name: 'Connect to this computer' }).click()
  await page.getByRole('button', { name: 'Generate Access Link' }).click()
  await expect(page.getByRole('button', { name: 'Copy Open in browser' })).toBeVisible()
  await page.screenshot({
    animations: 'disabled',
    path: path.join(testInfo.outputDir, 'direct-light.png')
  })

  await page.getByRole('tab', { name: 'My hosts' }).click()
  await expect(qr).toBeHidden()
  await page.getByRole('button', { name: 'Add Server', exact: true }).click()
  await expect(page.getByLabel('Access link', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'SSH Hosts', exact: true }).click()
  await page.getByRole('button', { name: 'Add Target', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByLabel('Host or alias')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.screenshot({
    animations: 'disabled',
    path: path.join(testInfo.outputDir, 'hosts-light.png')
  })

  await page.getByRole('tab', { name: 'Access management' }).click()
  await expect(page.getByRole('heading', { name: 'HiveCloud access sessions' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Shared Server Access' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Refresh shared access' })).toBeVisible()
  await expect(qr).toBeHidden()
  await page.screenshot({
    animations: 'disabled',
    path: path.join(testInfo.outputDir, 'access-light.png')
  })
  await page.getByRole('button', { name: /^Revoke Runtime / }).click()
  await expect(page.getByRole('button', { name: /^Revoke Runtime / })).toHaveCount(0)
  await page.getByRole('tab', { name: 'Connect to this computer' }).click()
  await expect(page.getByRole('button', { name: 'Copy Open in browser' })).toHaveCount(0)
  await expect(qr).toHaveAttribute('src', source!)
  await page.getByRole('tab', { name: 'HiveCloud account' }).focus()
  await page.keyboard.press('Enter')
  await expect(qr).toBeHidden()
  await page.getByRole('tab', { name: 'Direct address' }).click()
  await expect(qr).toHaveAttribute('src', source!)
  await qr.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(heading).toBeVisible()

  await page.evaluate(() => window.__store!.getState().updateSettings({ theme: 'dark' }))
  await page.screenshot({
    animations: 'disabled',
    path: path.join(testInfo.outputDir, 'direct-dark.png')
  })
  await page.setViewportSize({ width: 760, height: 1000 })
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '130%'
  })
  const dimensions = await page.locator('.device-connections-page-root').evaluate((element) => ({
    width: element.clientWidth,
    scroll: element.scrollWidth
  }))
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1)
  const tabsFit = await page
    .getByRole('tablist', { name: 'Devices & connections', exact: true })
    .evaluate((list) => {
      const bounds = list.getBoundingClientRect()
      return Array.from(list.querySelectorAll('[role="tab"]')).every((tab) => {
        const box = tab.getBoundingClientRect()
        return box.bottom <= bounds.bottom + 1 && box.right <= bounds.right + 1
      })
    })
  expect(tabsFit).toBe(true)
  await expect(qr).toBeVisible()
  await page.screenshot({
    animations: 'disabled',
    path: path.join(testInfo.outputDir, 'direct-narrow-large-text.png')
  })
  await page.evaluate(() => {
    document.documentElement.style.fontSize = ''
  })
  await page.setViewportSize({ width: 1400, height: 1000 })

  await electronApp.evaluate(({ ipcMain, BrowserWindow }) => {
    const state = {
      configured: true,
      status: 'signed-in',
      persistence: 'encrypted',
      account: { accountId: 'e2e-account', displayName: 'Test account' }
    }
    ipcMain.removeHandler('hiveAccount:getState')
    ipcMain.handle('hiveAccount:getState', () => state)
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('hiveAccount:stateChanged', state)
    }
  })
  await expect(shortcut).toHaveCount(0)
  await expect(page.locator('button[aria-label="Phone connection"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Account settings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Sign-in devices', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: /Runtime access/ })).toHaveCount(0)
  await page
    .locator('[data-settings-section="orca-account"]')
    .getByRole('button', { name: 'Devices & connections', exact: true })
    .click()
  await expect(page.getByRole('tab', { name: 'My hosts' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open Phone connection' })).toHaveCount(0)
  await page.getByRole('tab', { name: 'Connect to this computer' }).click()
  await expect(page.getByRole('tab', { name: 'Direct address' })).toBeVisible()

  await page.getByRole('button', { name: 'Work environments', exact: true }).click()
  await expect(page.getByRole('switch', { name: 'Toggle Cloud VM' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Cloud machines', exact: true })).toBeVisible()
  await page.screenshot({
    animations: 'disabled',
    path: path.join(testInfo.outputDir, 'work-environments.png')
  })
  const search = page.getByPlaceholder('Search settings')
  await search.fill('QR')
  await page.getByRole('button', { name: 'Devices & connections', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Connect to this computer' })).toHaveAttribute(
    'data-state',
    'active'
  )
  await expect(page.getByRole('tab', { name: 'Direct address' })).toHaveAttribute(
    'data-state',
    'active'
  )
  await expect(page.getByRole('button', { name: 'Generate QR code' })).toBeVisible()
  await search.fill('SSH')
  await expect(page.getByRole('button', { name: 'SSH Hosts', exact: true })).toHaveAttribute(
    'data-state',
    'open'
  )
  await search.fill('')
  await page.evaluate(() => {
    window.__store!.getState().openSettingsTarget({
      pane: 'servers',
      sectionId: 'devices-ssh',
      repoId: null,
      intent: 'add-ssh-host'
    })
  })
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByLabel('Host or alias')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('tab', { name: 'My hosts' })).toHaveAttribute('data-state', 'active')
  await page.getByRole('button', { name: 'SSH Hosts', exact: true }).click()
  await expect(page.getByRole('button', { name: 'SSH Hosts', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false'
  )
  await page.getByRole('button', { name: 'SSH Hosts', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await electronApp.evaluate(({ ipcMain, BrowserWindow }) => {
    const state = { configured: true, status: 'signed-out', persistence: 'none' }
    ipcMain.removeHandler('hiveAccount:getState')
    ipcMain.handle('hiveAccount:getState', () => state)
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('hiveAccount:stateChanged', state)
    }
  })
  await page.evaluate(() => window.__store!.getState().closeSettingsPage())
  await expect(shortcut).toBeVisible()
  await expect(page.locator('button[aria-label="Phone connection"]')).toBeVisible()
  await shortcut.click()
  await page.evaluate(() =>
    window.__store!.getState().updateSettings({ uiLanguage: 'zh', theme: 'light' })
  )
  await expect(page.getByRole('heading', { name: '设备与连接', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: '连接本机' })).toHaveAttribute('data-state', 'active')
  await expect(page.getByRole('tab', { name: '地址直连' })).toBeVisible()
  await page.screenshot({
    animations: 'disabled',
    path: path.join(testInfo.outputDir, 'cloud-chinese.png')
  })
  await page.evaluate(() => {
    ;(window as unknown as { __ORCA_WEB_CLIENT__: boolean }).__ORCA_WEB_CLIENT__ = true
    window.__store!.getState().openDeviceConnectionsPage()
  })
  await expect(page.getByRole('tab', { name: '我的主机' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '账号设置', exact: true })).toHaveCount(0)
})
