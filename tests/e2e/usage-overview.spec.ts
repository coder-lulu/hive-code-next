import { writeFile } from 'node:fs/promises'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

test.use({ orcaAppExtraEnv: { ORCA_BACKGROUND_LAUNCH: '1' } })

test('AI services combines usage and providers while retaining daily intensity and filters', async ({
  orcaPage: page,
  electronApp
}, testInfo) => {
  await waitForSessionReady(page)
  await page.evaluate(async () => {
    const state = window.__store!.getState()
    await state.updateSettings({ uiLanguage: 'en', theme: 'light' })
    state.openSettingsTarget({ pane: 'accounts', repoId: null })
    state.openSettingsPage()
  })
  const section = page.locator('[data-settings-section="accounts"]')
  await expect(
    section.getByRole('heading', { name: 'AI Services & Usage', exact: true })
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stats & Usage', exact: true })).toHaveCount(0)
  const usage = section.getByRole('tab', { name: 'Usage', exact: true })
  const providers = section.getByRole('tab', { name: 'AI Providers', exact: true })
  await expect(usage).toHaveAttribute('aria-selected', 'true')
  await expect(section.getByRole('heading', { name: 'Daily intensity', exact: true })).toBeVisible()
  const range = section.getByRole('combobox', { name: 'Time range', exact: true })
  await range.click()
  await page.getByRole('option', { name: 'Last 90 days', exact: true }).click()
  await expect(section.locator('[aria-label="Recent token activity heatmap"] button')).toHaveCount(
    90
  )
  await range.click()
  await page.getByRole('option', { name: 'Last 7 days', exact: true }).click()
  await expect(range).toHaveText('Last 7 days')
  await providers.click()
  await expect(providers).toHaveAttribute('aria-selected', 'true')
  await expect(section.getByTestId('usage-overview-pane')).toBeHidden()
  await usage.click()
  await expect(range).toHaveText('Last 7 days')
  await expect(section.getByRole('heading', { name: 'Daily intensity', exact: true })).toBeVisible()
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate(async (value) => {
      await window.__store!.getState().updateSettings({ theme: value, uiLanguage: 'zh' })
    }, theme)
    await electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      window.webContents.setZoomFactor(1.3)
    })
    await section.getByRole('combobox').first().scrollIntoViewIfNeeded()
    const bounds = await section
      .getByRole('combobox')
      .first()
      .evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return { right: rect.right, width: innerWidth }
      })
    expect(bounds.right).toBeLessThanOrEqual(bounds.width + 1)
    const image = await electronApp.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64')
    )
    await writeFile(testInfo.outputPath(`ai-services-${theme}.png`), Buffer.from(image, 'base64'))
    await section.getByRole('heading', { name: '每日强度', exact: true }).scrollIntoViewIfNeeded()
    // Let the background Electron compositor paint the scrolled viewport before native capture.
    await page.waitForTimeout(400)
    const intensityImage = await electronApp.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64')
    )
    await writeFile(
      testInfo.outputPath(`daily-intensity-${theme}.png`),
      Buffer.from(intensityImage, 'base64')
    )
  }
})
