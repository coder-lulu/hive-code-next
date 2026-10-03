import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import type { WebviewTag } from 'electron'
import type { Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'

test.use({ minimumSeededWorktreeCount: 1 })

async function capture(page: Page, info: TestInfo, name: string, metrics: unknown): Promise<void> {
  const directory = process.env.HIVE_UI_REVIEW_DIR ?? info.outputPath('review')
  mkdirSync(directory, { recursive: true })
  writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(metrics, null, 2))
  await page.screenshot({ path: path.join(directory, `${name}.png`), animations: 'disabled' })
}

test.beforeEach(async ({ orcaPage: page }) => {
  await waitForSessionReady(page)
  await ensureTerminalVisible(page)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await page.setViewportSize({ width: 960, height: 768 })
  await page.evaluate(async () => {
    const store = window.__store!
    await store.getState().updateSettings({ theme: 'light' })
    store.setState({ sidebarOpen: true, sidebarWidth: 280, rightSidebarOpen: false })
  })
})

test('tab context menus stay at the pointer and ignore secondary clicks inside the portal', async ({
  orcaPage: page
}, info) => {
  const fixture = await page.evaluate(() => {
    const state = window.__store!.getState()
    const worktreeId = state.activeWorktreeId!
    const workspace = Object.values(state.worktreesByRepo)
      .flat()
      .find((item) => item.id === worktreeId)!
    return { worktreeId, workspacePath: workspace.path }
  })
  const filePath = path.join(fixture.workspacePath, 'review-tab.ts')
  writeFileSync(filePath, 'export const reviewed = true\n')
  await page.evaluate(
    ({ worktreeId, filePath }) => {
      const state = window.__store!.getState()
      state.openFile(
        {
          worktreeId,
          filePath,
          relativePath: 'review-tab.ts',
          language: 'typescript',
          mode: 'edit',
          runtimeEnvironmentId: null
        },
        { preview: false }
      )
      for (let index = 0; index < 4; index += 1) {
        state.createBrowserTab(worktreeId, 'about:blank', { activate: false })
      }
    },
    { ...fixture, filePath }
  )
  const strip = page.locator('.terminal-tab-strip').first()
  const ids = await strip
    .locator('[data-tab-id]')
    .evaluateAll((tabs) => tabs.slice(0, 3).map((tab) => tab.getAttribute('data-tab-id')!))
  for (const [index, id] of ids.entries()) {
    const tab = strip.locator(`[data-tab-id="${id}"]`)
    await tab.scrollIntoViewIfNeeded()
    await tab.click({ button: 'right', position: { x: 45, y: 16 } })
    const menu = page.getByRole('menu').first()
    await expect(menu).toBeVisible()
    const anchor = tab.locator('xpath=..').locator('button[aria-hidden="true"]')
    const metrics = await anchor.evaluate((element) => ({
      rect: element.getBoundingClientRect().toJSON(),
      x: Number.parseFloat(element.style.left),
      y: Number.parseFloat(element.style.top)
    }))
    await capture(page, info, `context-${index}`, metrics)
    expect.soft(Math.abs(metrics.rect.left - metrics.x), 'context anchor x').toBeLessThan(2)
    expect.soft(Math.abs(metrics.rect.top - metrics.y), 'context anchor y').toBeLessThan(2)
    const before = await menu.boundingBox()
    await menu.click({ button: 'right', position: { x: 20, y: 40 } })
    const after = await menu.boundingBox()
    await capture(page, info, `context-${index}-secondary`, { before, after })
    expect.soft(after?.x, 'secondary click must not reposition the menu').toBeCloseTo(before!.x, 0)
    expect.soft(after?.y, 'secondary click must not reposition the menu').toBeCloseTo(before!.y, 0)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
  }
})

test('long saved quick commands leave a complete tab visible in a narrow window', async ({
  orcaPage: page
}, info) => {
  await page.setViewportSize({ width: 920, height: 768 })
  await page.evaluate(async () => {
    const store = window.__store!
    const state = store.getState()
    await state.updateSettings({
      terminalQuickCommands: [
        {
          id: 'review-command',
          label: '一个非常长的常用命令名称用于验证标签栏布局',
          scope: { type: 'global' },
          command: 'echo review',
          appendEnter: false
        }
      ]
    })
    for (let index = 0; index < 4; index += 1) {
      state.createBrowserTab(state.activeWorktreeId!, 'about:blank', { activate: false })
    }
  })
  const more = page.getByRole('button', { name: 'More quick commands', exact: true })
  await expect(more).toBeVisible()
  const strip = page.locator('.terminal-tab-strip').first()
  for (const width of [768, 920, 980, 1000]) {
    await page.setViewportSize({ width, height: 768 })
    await expect
      .poll(() => strip.evaluate((element) => element.clientWidth))
      .toBeGreaterThanOrEqual(128)
    const metrics = await strip.evaluate((element) => ({
      viewport: innerWidth,
      width: element.clientWidth,
      scrollWidth: element.scrollWidth,
      minimumTabWidth: Math.min(
        ...[...element.querySelectorAll('[data-tab-id]')].map(
          (tab) => tab.getBoundingClientRect().width
        )
      )
    }))
    await capture(page, info, `narrow-saved-command-${width}`, metrics)
    if (width <= 980) {
      await expect(page.locator('.tab-quick-command-run')).toBeHidden()
      await expect(more).toHaveCSS('width', '24px')
      await expect(more).toHaveCSS('border-left-width', '0px')
    } else {
      await expect(page.locator('.tab-quick-command-run')).toBeVisible()
    }
  }
  await more.click()
  await expect(page.getByRole('menu').first()).toContainText('一个非常长的常用命令名称')
})

test('floating tabs retain their titlebar geometry and menu position', async ({
  orcaPage: page
}, info) => {
  await page.evaluate(async () => {
    const store = window.__store!
    await store.getState().updateSettings({ floatingTerminalEnabled: true })
    store.getState().createTab('global-floating-terminal')
  })
  const panel = page.locator('[data-floating-terminal-panel]')
  await expect(panel).toBeAttached()
  await page.evaluate(() => window.dispatchEvent(new Event('orca-toggle-floating-terminal')))
  await expect(panel).toBeVisible()
  const tab = panel.locator('[data-tab-id]').first()
  await expect(tab).toBeVisible()
  const geometry = await tab.evaluate((element) => ({
    tab: element.getBoundingClientRect().toJSON(),
    titlebar: element
      .closest('[data-floating-terminal-shortcut-surface]')!
      .getBoundingClientRect()
      .toJSON()
  }))
  expect(geometry.titlebar.height).toBe(36)
  await capture(page, info, 'floating-light', geometry)
  await tab.click({ button: 'right', position: { x: 45, y: 16 } })
  await expect(page.getByRole('menu').first()).toBeVisible()
  await capture(page, info, 'floating-context', await page.getByRole('menu').first().boundingBox())
})

test('moving tabs through the split menu preserves terminal and browser content', async ({
  orcaPage: page
}, info) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  const terminalId = await page.locator('[data-tab-id]').first().getAttribute('data-tab-id')
  const xterm = await page.locator('.xterm').first().elementHandle()
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end('<title>Review resident browser</title><p>Cross-group content</p>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Fixture server unavailable')
    }
    const browserId = await page.evaluate((port) => {
      const state = window.__store!.getState()
      const worktreeId = state.activeWorktreeId!
      state.createBrowserTab(worktreeId, 'about:blank', { activate: false })
      return state.createBrowserTab(worktreeId, `http://127.0.0.1:${port}`, {
        activate: true,
        focusAddressBar: false
      }).id
    }, address.port)
    const browser = page.locator(`[data-browser-overlay-tab-id="${browserId}"] webview`)
    await expect(browser).toBeVisible({ timeout: 30_000 })
    await expect(page.locator(`[data-tab-id="${browserId}"]`)).toContainText(
      'Review resident browser'
    )
    const guest = await browser.elementHandle()
    const guestId = await guest!.evaluate((element) => (element as WebviewTag).getWebContentsId())
    for (const [index, id] of [browserId, terminalId!].entries()) {
      const tab = page.locator(`[data-tab-id="${id}"]`)
      await tab.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Move Tab to Split', exact: true }).hover()
      await page.getByRole('menuitem', { name: 'Right', exact: true }).click()
      await expect(page.locator('[data-tab-group-strip-id]')).toHaveCount(index + 2)
      await expect(tab).toHaveAttribute('data-active', 'true')
    }
    expect(await xterm!.evaluate((element) => element.isConnected)).toBe(true)
    expect(await guest!.evaluate((element) => element.isConnected)).toBe(true)
    expect(await guest!.evaluate((element) => (element as WebviewTag).getWebContentsId())).toBe(
      guestId
    )
    await expect(browser).toBeVisible()
    const placements: unknown[] = []
    for (const [id, content] of [
      [browserId, guest!],
      [terminalId!, xterm!]
    ] as const) {
      const body = await page.locator(`[data-tab-id="${id}"]`).evaluate((tab) => {
        const groupId = tab
          .closest('[data-tab-group-strip-id]')!
          .getAttribute('data-tab-group-strip-id')
        return document
          .querySelector(`[data-tab-group-body-id="${groupId}"]`)!
          .getBoundingClientRect()
          .toJSON()
      })
      await expect
        .poll(async () => {
          const rect = await content.boundingBox()
          return Boolean(
            rect &&
            rect.x >= body.left - 1 &&
            rect.y >= body.top - 1 &&
            rect.x + rect.width <= body.right + 1 &&
            rect.y + rect.height <= body.bottom + 1
          )
        })
        .toBe(true)
      placements.push({ id, body, content: await content.boundingBox() })
    }
    await capture(page, info, 'split-residency-light', placements)
    await page.evaluate(() => window.__store!.getState().updateSettings({ theme: 'dark' }))
    await expect(page.locator('html')).toHaveClass(/dark/)
    await capture(page, info, 'split-residency-dark', placements)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
