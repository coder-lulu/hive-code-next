import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'

test.use({ minimumSeededWorktreeCount: 1 })
test('clicks replace a session while dragging adds tabs and splits without changing execution owners', async ({
  orcaPage: page,
  electronApp
}) => {
  test.setTimeout(180_000)
  await waitForSessionReady(page)
  await ensureTerminalVisible(page)
  await page.setViewportSize({ width: 1440, height: 960 })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  const owner = await page.evaluate(async () => {
    const store = window.__store!
    await store.getState().updateSettings({ theme: 'light' })
    store.setState({ sidebarOpen: true, sidebarWidth: 240, rightSidebarOpen: false })
    const bucket = store.getState().activeWorktreeId!
    const first = store.getState().tabsByWorktree[bucket][0]
    store.getState().setAiVaultTabTitle(first.id, {
      agent: 'codex',
      sessionId: 'split-first',
      title: 'Split First'
    })
    const second = store
      .getState()
      .createTab('global-floating-terminal', undefined, undefined, { activate: false })
    store.getState().setAiVaultTabTitle(second.id, {
      agent: 'codex',
      sessionId: 'split-second',
      title: 'Split Second'
    })
    return { bucket, firstId: first.id, secondId: second.id }
  })
  await page
    .locator('.sidebar-primary-nav')
    .getByRole('button', { name: 'Sessions', exact: true })
    .click()
  const first = page.getByTestId('session-center-row').filter({ hasText: 'Split First' })
  const second = page.getByTestId('session-center-row').filter({ hasText: 'Split Second' })
  await first.click()
  await expect(page.locator('[data-session-terminal] .xterm:visible')).toHaveCount(1)
  await second.click()
  await expect(page.locator('.session-panel-tabs [role="tab"]')).toHaveCount(1)
  await expect(page.locator('.session-panel-tabs')).toContainText('Split Second')
  await first.click()
  const dragSecond = async (edge: boolean): Promise<void> => {
    const source = await second.locator('.session-row-select').boundingBox()
    const target = await page.locator('[data-session-panel]').first().boundingBox()
    expect(source).not.toBeNull()
    expect(target).not.toBeNull()
    await page.mouse.move(source!.x + 50, source!.y + 20)
    await page.mouse.down()
    await page.mouse.move(source!.x + 70, source!.y + 20, { steps: 4 })
    const point = {
      x: target!.x + target!.width * (edge ? 0.95 : 0.5),
      y: target!.y + target!.height * 0.5
    }
    await page.mouse.move(point.x, point.y, { steps: 20 })
    await expect(page.locator('.session-drag-preview')).toBeVisible()
    const preview = await page.locator('.session-drag-preview').boundingBox()
    expect(Math.abs(preview!.x - point.x - 12)).toBeLessThan(2)
    expect(Math.abs(preview!.y - point.y - 12)).toBeLessThan(2)
    expect(
      await page.evaluate(
        ({ x, y }) => getComputedStyle(document.elementFromPoint(x, y)!).cursor,
        point
      )
    ).toBe('grabbing')
    await page.mouse.up()
    await expect(page.locator('.session-drag-preview')).toHaveCount(0)
    await expect(page.locator('html')).not.toHaveAttribute('data-session-dragging')
  }
  await dragSecond(false)
  await page.mouse.move(900, 900)
  await expect(second.locator('.session-row-actions')).toHaveCSS('opacity', '0')
  await expect(page.locator('.session-panel-tabs [role="tab"]')).toHaveCount(2)
  await expect(page.locator('[data-session-panel]')).toHaveCount(1)
  await dragSecond(true)
  await expect(page.locator('[data-session-panel]')).toHaveCount(2)
  await expect(page.locator('[data-session-terminal] .xterm:visible')).toHaveCount(2)
  const original = await page
    .locator(`[data-session-terminal="${owner.firstId}"] .xterm`)
    .elementHandle()
  const rects = await page
    .locator('[data-session-panel]')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()))
  expect(rects[0].right).toBeLessThanOrEqual(rects[1].left + 2)
  const handle = page.locator('.session-panel-workspace .tab-group-split-resize-handle')
  const bounds = await handle.boundingBox()
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + 50)
  await page.mouse.down()
  await page.mouse.move(bounds!.x + 70, bounds!.y + 50, { steps: 8 })
  await page.mouse.up()
  expect(await original!.evaluate((node) => node.isConnected)).toBe(true)
  const directory = process.env.HIVE_UI_BASELINE_DIR
  if (directory) {
    mkdirSync(directory, { recursive: true })
    await page.mouse.move(900, 900)
    await page.screenshot({ path: path.join(directory, 'p2-session-split-light.png') })
  }
  await page
    .getByTestId('session-detail')
    .filter({ hasText: 'Split Second' })
    .getByRole('button', { name: 'Close session view', exact: true })
    .click()
  await expect(page.locator('[data-session-panel]')).toHaveCount(1)
  await expect(page.locator('[data-session-terminal] .xterm:visible')).toHaveCount(1)
  expect(
    await page.evaluate(({ bucket, firstId, secondId }) => {
      const state = window.__store!.getState()
      return (
        state.activeView === 'sessions' &&
        state.activeWorktreeId === bucket &&
        state.tabsByWorktree[bucket].some((tab) => tab.id === firstId) &&
        state.tabsByWorktree['global-floating-terminal'].some((tab) => tab.id === secondId)
      )
    }, owner)
  ).toBe(true)
  expect(
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every((window) => !window.isVisible())
    )
  ).toBe(true)
})
