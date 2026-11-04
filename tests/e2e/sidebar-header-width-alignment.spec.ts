import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'
import path from 'node:path'
import { mkdirSync } from 'node:fs'

test('open sidebar header follows the list width at its minimum and during a resize', async ({
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    state.setSidebarOpen(true)
    state.setSidebarWidth(220)
    state.openSessionsPage()
    state.updateSessionsView({ navigation: 'projects' })
  })

  const measureEdges = () =>
    orcaPage.evaluate(() => {
      const sidebar = document.querySelector<HTMLElement>(
        '[data-sidebar-resize-handle]'
      )?.parentElement
      const header = document.querySelector<HTMLElement>('.titlebar-left')
      if (!sidebar || !header) {
        return null
      }
      return {
        sidebarRight: sidebar.getBoundingClientRect().right,
        headerRight: header.getBoundingClientRect().right
      }
    })

  await expect.poll(measureEdges).toMatchObject({ sidebarRight: 220, headerRight: 220 })

  const handle = orcaPage.locator('[data-sidebar-resize-handle]')
  const box = await handle.boundingBox()
  expect(box).not.toBeNull()
  const startX = box!.x + box!.width / 4
  const startY = box!.y + box!.height / 2
  await orcaPage.mouse.move(startX, startY)
  await orcaPage.mouse.down()
  expect(await orcaPage.evaluate(() => document.body.style.cursor)).toBe('col-resize')
  await orcaPage.mouse.move(startX + 60, startY)

  await expect.poll(measureEdges).toMatchObject({ sidebarRight: 280, headerRight: 280 })

  await orcaPage.mouse.up()
  await expect.poll(measureEdges).toMatchObject({ sidebarRight: 280, headerRight: 280 })
})

test('collapsed sidebar keeps the first clickable tab beside its painted header', async ({
  orcaPage: page
}) => {
  await waitForSessionReady(page)
  await ensureTerminalVisible(page)
  await page.setViewportSize({ width: 1440, height: 960 })
  const tabId = await page.evaluate(() => {
    const store = window.__store!
    const state = store.getState()
    state.setSidebarOpen(true)
    store.setState({ rightSidebarOpen: false })
    const worktreeId = state.activeWorktreeId!
    const tab = state.tabsByWorktree[worktreeId][0]
    state.createTab(worktreeId, undefined, undefined, { activate: false })
    return tab.id
  })
  const strip = page.locator('[data-tab-group-strip-id]').first()
  await expect(strip).toHaveCSS('height', '36px')
  await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click()

  const tab = strip.locator(`[data-tab-id="${tabId}"]`)
  await expect(tab).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const header = document.querySelector('.titlebar-left-floating')
        const firstTab = document.querySelector('[data-tab-group-strip-id] .tab-container')
        if (!header || !firstTab) {
          return null
        }
        return Math.abs(
          firstTab.getBoundingClientRect().left - header.getBoundingClientRect().right
        )
      })
    )
    // The workbench's left border may occupy the seam.
    .toBeLessThanOrEqual(1)
  const dimensions = await tab.evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height
  }))
  expect(dimensions.width).toBeGreaterThanOrEqual(128)
  expect(dimensions.height).toBe(32)
  await tab.click()
  await expect(tab).toHaveAttribute('data-active', 'true')

  const directory = path.resolve('logs/ui-regression-review/pages')
  mkdirSync(directory, { recursive: true })
  await page.screenshot({
    path: path.join(directory, 'workspace-sidebar-collapsed.png'),
    animations: 'disabled'
  })
  await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click()
  await expect
    .poll(() =>
      strip.evaluate((element) => {
        const header = document.querySelector('.titlebar-left')
        return header
          ? Math.abs(element.getBoundingClientRect().left - header.getBoundingClientRect().right)
          : null
      })
    )
    .toBeLessThanOrEqual(1)
})
