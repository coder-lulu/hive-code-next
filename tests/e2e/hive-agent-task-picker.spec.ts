import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

test.use({ orcaAppExtraEnv: { ORCA_BACKGROUND_LAUNCH: '1' } })

test('HiveCode AI is selectable in the normal task composer without a CLI install', async ({
  orcaPage,
  electronApp
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  // The picker belongs to the task home; activating a worktree first starts an
  // unrelated terminal and makes this headless test race the workspace transition.
  await orcaPage.evaluate(() => {
    const store = window.__store!
    const current = store.getState()
    store.setState({ settings: { ...current.settings!, defaultTuiAgent: 'claude' } })
  })
  await orcaPage.getByRole('button', { name: 'New task', exact: true }).click()
  const picker = orcaPage.locator('.desktop-home-agent-picker').getByRole('combobox')
  await picker.click()
  await orcaPage.getByRole('option', { name: 'HiveCode AI', exact: true }).click()
  await expect(picker).toContainText('HiveCode AI')
  await expect(orcaPage.getByRole('listbox')).not.toBeVisible()
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1.3)
  })
  for (const theme of ['light', 'dark'] as const) {
    await orcaPage.evaluate(
      (value) => window.__store!.getState().updateSettings({ theme: value }),
      theme
    )
    await expect(picker).toBeVisible()
    await orcaPage.screenshot({ path: testInfo.outputPath(`hive-ai-picker-${theme}.png`) })
  }
})
