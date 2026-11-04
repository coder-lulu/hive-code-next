import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

test.use({ seedTestRepo: false })

const evidenceDirectory = path.resolve('logs/ui-regression-review/pages')

async function capture(page: Page, name: string): Promise<void> {
  mkdirSync(evidenceDirectory, { recursive: true })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({
    path: path.join(evidenceDirectory, `${name}.png`),
    animations: 'disabled'
  })
}

test('keeps restored page routes and their navigation layouts visible', async ({
  orcaPage: page,
  electronApp
}) => {
  await waitForSessionReady(page)
  expect(
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every((window) => !window.isVisible())
    )
  ).toBe(true)
  for (const [theme, width] of [
    ['light', 1440],
    ['dark', 1000]
  ] as const) {
    await page.setViewportSize({ width, height: 960 })
    await page.evaluate(async (theme) => {
      const state = window.__store!.getState()
      await state.updateSettings({ theme, uiLanguage: 'en' })
      state.setSidebarOpen(true)
      state.setSidebarWidth(240)
      window.__store!.setState({ rightSidebarOpen: false })
      state.openSessionsPage()
      state.updateSessionsView({ navigation: 'sessions' })
    }, theme)
    const sessions = page.getByTestId('sessions-page')
    await expect(sessions).toBeVisible()
    await expect(sessions.locator('.sessions-layout')).toHaveCSS('display', 'flex')
    const list = page.locator('.sessions-list-pane')
    await expect(list).toHaveCSS('width', '320px')
    const heading = list.locator('.sessions-list-heading')
    await expect(heading).toHaveCSS('height', '36px')
    await capture(page, `sessions-${theme}`)

    await page.getByRole('button', { name: 'Projects', exact: true }).click()
    const projects = page.getByTestId('projects-navigation-pane')
    await expect(projects).toBeVisible()
    await expect(projects).toHaveCSS('display', 'flex')
    await expect(page.getByTestId('project-workspace-empty')).toBeVisible()
    await capture(page, `projects-${theme}`)

    await page.evaluate(() => window.__store!.getState().openDeviceConnectionsPage())
    await expect(
      page.getByRole('heading', { name: 'Devices & connections', exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole('tab', { name: 'Connect to this computer', exact: true })
    ).toBeVisible()
    await capture(page, `devices-${theme}`)

    await page.evaluate(() =>
      window.__store!.getState().openActivityPage({ scope: 'temporary-sessions' })
    )
    await expect(
      page.getByRole('heading', { name: 'Temporary sessions', exact: true })
    ).toBeVisible()
    await capture(page, `temporary-sessions-${theme}`)
  }
})

test('renders every settings navigation destination without horizontal clipping', async ({
  orcaPage: page
}) => {
  // Visits every settings destination in two viewport/theme configurations.
  test.setTimeout(480_000)
  await waitForSessionReady(page)
  const measurements: unknown[] = []
  for (const [theme, width] of [
    ['light', 1440],
    ['dark', 1000]
  ] as const) {
    await page.setViewportSize({ width, height: 960 })
    await page.evaluate(async (theme) => {
      const state = window.__store!.getState()
      await state.updateSettings({ theme, uiLanguage: 'en' })
      state.openSettingsPage()
    }, theme)
    const buttons = page.locator('.settings-view-shell > aside .space-y-1 > button')
    await expect(buttons.first()).toBeVisible()
    const count = await buttons.count()
    expect(count).toBeGreaterThan(20)
    for (let index = 0; index < count; index++) {
      const button = buttons.nth(index)
      const name = await button.innerText()
      await button.click()
      await expect(button).toHaveAttribute('aria-current', 'page')
      const section = page.locator('section.scroll-mt-8[data-settings-section]:visible')
      await expect(section).toHaveCount(1)
      await expect(section).toBeVisible()
      await expect(section).not.toContainText('This page hit an error.')
      const id = await section.getAttribute('data-settings-section')
      const measurement = await section.evaluate((element) => ({
        id: element.getAttribute('data-settings-section'),
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
        rect: element.getBoundingClientRect().toJSON()
      }))
      measurements.push({ theme, name, ...measurement })
      await capture(page, `settings-${id}-${theme}`)
      expect
        .soft(measurement.scrollWidth, `${name} (${theme})`)
        .toBeLessThanOrEqual(measurement.width + 1)
    }
  }
  writeFileSync(
    path.join(evidenceDirectory, 'settings-layout.json'),
    JSON.stringify(measurements, null, 2)
  )
})

test('keeps remaining top-level pages usable with open and collapsed chrome', async ({
  orcaPage: page
}) => {
  await waitForSessionReady(page)
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  for (const [theme, width, sidebarOpen] of [
    ['light', 1440, true],
    ['dark', 1000, false]
  ] as const) {
    await page.setViewportSize({ width, height: 960 })
    await page.evaluate(async (theme) => {
      await window.__store!.getState().updateSettings({ theme, uiLanguage: 'en' })
    }, theme)
    for (const view of [
      'tasks',
      'automations',
      'artifacts',
      'skills',
      'activity',
      'space'
    ] as const) {
      await page.evaluate(
        ({ view, sidebarOpen }) => {
          window.__store!.setState({
            activeView: view,
            activityPageScope: 'all',
            sidebarOpen,
            rightSidebarOpen: false
          })
        },
        { view, sidebarOpen }
      )
      const content = page.locator('[data-workspace-content-region]')
      if (view === 'tasks') {
        await expect(
          content.getByRole('button', { name: 'Close tasks', exact: true })
        ).toBeVisible()
      } else if (view === 'activity') {
        await expect(content.getByPlaceholder('Filter...', { exact: true })).toBeVisible()
      } else if (view === 'space') {
        await expect(
          content.getByRole('heading', { name: 'See where workspace storage goes', exact: true })
        ).toBeVisible()
      } else {
        const title = { automations: 'Automations', artifacts: 'Artifacts', skills: 'Skills' }[view]
        await expect(content.getByRole('heading', { name: title, exact: true })).toBeVisible()
      }
      await expect(content).not.toContainText('This page hit an error.')
      await capture(page, `${view}-${theme}`)
      const geometry = await content.evaluate((element) => ({
        width: element.clientWidth,
        scrollWidth: element.scrollWidth
      }))
      expect.soft(geometry.width, `${view} (${theme})`).toBeGreaterThan(400)
      expect
        .soft(geometry.scrollWidth, `${view} (${theme})`)
        .toBeLessThanOrEqual(geometry.width + 1)
    }
  }
  expect(pageErrors).toEqual([])
})
