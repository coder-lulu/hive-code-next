import path from 'node:path'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

test('dismisses the project board when primary navigation is activated', async ({
  orcaPage: page
}, testInfo) => {
  await waitForSessionReady(page)
  await page.evaluate(async () => {
    const state = window.__store!.getState()
    await state.updateSettings({ uiLanguage: 'en', theme: 'light' })
    state.setSidebarOpen(true)
    state.openSessionsPage()
    state.updateSessionsView({ navigation: 'projects' })
  })
  await page.setViewportSize({ width: 1400, height: 950 })
  const navigation = page.locator('.sidebar-primary-nav')
  const projects = navigation.getByRole('button', { name: 'Projects', exact: true })
  const board = page.locator('[data-workspace-board-sheet]')

  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate(async (theme) => {
      await window.__store!.getState().updateSettings({ theme })
    }, theme)
    for (const destination of ['Sessions', 'Projects', 'New task', 'Tasks', 'Automations']) {
      await projects.click()
      await page.locator('[data-workspace-board-trigger]').click()
      await expect(board).toBeVisible()

      const button = navigation.getByRole('button', { name: destination, exact: true })
      await (destination === 'Sessions' ? button.press('Enter') : button.click())

      await expect(board).toHaveCount(0)
      await expect(button).toHaveAttribute('aria-current', 'page')
    }
    await page.screenshot({
      path: path.join(testInfo.outputDir, `navigation-${theme}.png`),
      animations: 'disabled'
    })
  }

  await projects.click()
  await expect(board).toHaveCount(0)
  await page.locator('[data-workspace-board-trigger]').click()
  await expect(board).toBeVisible()
})
