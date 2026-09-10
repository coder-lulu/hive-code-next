import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'

test.use({ minimumSeededWorktreeCount: 1 })

const captureDirectory = process.env.HIVE_UI_P1_DIR

async function capture(page: Page, name: string): Promise<void> {
  if (!captureDirectory) {
    return
  }
  await page.evaluate(() => document.fonts.ready)
  const metrics = await page.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    theme: document.documentElement.className,
    strips: [...document.querySelectorAll('[data-tab-group-strip-id]')].map((strip) => {
      const id = strip.getAttribute('data-tab-group-strip-id')
      const body = document.querySelector(`[data-tab-group-body-id="${id}"]`)!
      const scroll = strip.querySelector('.terminal-tab-strip')!
      return {
        strip: strip.getBoundingClientRect().toJSON(),
        body: body.getBoundingClientRect().toJSON(),
        scrollWidth: scroll.scrollWidth,
        clientWidth: scroll.clientWidth,
        tabs: [...strip.querySelectorAll('[data-tab-id]')].map((tab) => ({
          rect: tab.getBoundingClientRect().toJSON(),
          active: tab.getAttribute('data-active'),
          dirty: tab.getAttribute('data-dirty'),
          divider: getComputedStyle(tab.closest('.tab-container')!).backgroundImage
        }))
      }
    })
  }))
  mkdirSync(captureDirectory, { recursive: true })
  writeFileSync(path.join(captureDirectory, `${name}.json`), JSON.stringify(metrics, null, 2))
  await page.screenshot({
    path: path.join(captureDirectory, `${name}.png`),
    animations: 'disabled'
  })
}

test('keeps tab seams, state slots and resident content stable across themes and overflow', async ({
  electronApp,
  orcaPage: page
}) => {
  test.setTimeout(240_000)
  await waitForSessionReady(page)
  await ensureTerminalVisible(page)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await page.setViewportSize({ width: 1440, height: 960 })
  const fixture = await page.evaluate(async () => {
    const store = window.__store!
    await store.getState().updateSettings({ theme: 'light', editorAutoSave: false })
    store.setState({ sidebarOpen: true, sidebarWidth: 280, rightSidebarOpen: false })
    const state = store.getState()
    const worktreeId = state.activeWorktreeId!
    const workspace = Object.values(state.worktreesByRepo)
      .flat()
      .find((item) => item.id === worktreeId)!
    return { worktreeId, workspacePath: workspace.path }
  })
  expect(
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every((window) => !window.isVisible())
    )
  ).toBe(true)
  const strip = page.locator('.terminal-tab-strip').first()
  const tabs = strip.locator('[data-tab-id]')
  await expect(tabs).toHaveCount(1)
  const terminal = tabs.first()
  const terminalId = await terminal.getAttribute('data-tab-id')
  const xterm = await page.locator('.xterm').first().elementHandle()
  await capture(page, '01-light-single')
  // Seed a fresh hook payload for the actual terminal leaf; exercise the production status resolver.
  await page.evaluate((tabId) => {
    const store = window.__store!
    const leafId = store.getState().terminalLayoutsByTabId[tabId!].activeLeafId!
    const paneKey = `${tabId}:${leafId}`
    const now = Date.now()
    store.setState({
      agentStatusByPaneKey: {
        [paneKey]: {
          paneKey,
          state: 'working',
          prompt: '',
          updatedAt: now,
          stateStartedAt: now,
          stateHistory: [],
          agentType: 'codex'
        }
      }
    })
  }, terminalId)
  await expect(terminal.locator('[data-testid="tab-agent-activity-indicator"]')).toHaveAttribute(
    'data-agent-activity-status',
    'working'
  )
  await capture(page, '01b-light-working')
  await page.evaluate(() => window.__store!.getState().updateSettings({ theme: 'dark' }))
  await expect(page.locator('html')).toHaveClass(/dark/)
  await capture(page, '01c-dark-working')
  await page.evaluate(() => window.__store!.getState().updateSettings({ theme: 'light' }))

  async function openFiles(from: number, to: number): Promise<void> {
    for (let index = from; index <= to; index += 1) {
      const relativePath = `P1-中文长标题-${index}.ts`
      const filePath = path.join(fixture.workspacePath, relativePath)
      writeFileSync(filePath, '// Tab visual fixture\nexport const ready = true\n')
      await page.evaluate(
        ({ filePath, relativePath, worktreeId }) => {
          window.__store!.getState().openFile(
            {
              filePath,
              relativePath,
              worktreeId,
              language: 'typescript',
              mode: 'edit',
              runtimeEnvironmentId: null
            },
            { preview: false }
          )
        },
        { filePath, relativePath, worktreeId: fixture.worktreeId }
      )
    }
  }
  await openFiles(1, 6)
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end('<title>P1 browser</title><p>Resident browser fixture</p>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Fixture server unavailable')
    }
    const browserId = await page.evaluate(
      ({ worktreeId, port }) =>
        window.__store!.getState().createBrowserTab(worktreeId, `http://127.0.0.1:${port}`, {
          activate: true,
          focusAddressBar: false
        }).id,
      { worktreeId: fixture.worktreeId, port: address.port }
    )
    const browser = page.locator(`[data-browser-overlay-tab-id="${browserId}"] webview`)
    await expect(browser).toBeVisible({ timeout: 30_000 })
    const guest = await browser.elementHandle()
    await expect(tabs).toHaveCount(8)
    const editorTab = tabs.filter({ hasText: 'P1-中文长标题-6.ts' })
    await editorTab.click()
    await expect(editorTab).toHaveAttribute('data-active', 'true')
    await expect(page.locator('.monaco-editor').first()).toBeVisible()
    await page
      .locator('.monaco-editor .view-lines')
      .first()
      .click({ position: { x: 80, y: 10 } })
    await page.keyboard.insertText('// unsaved ')
    await expect(editorTab).toHaveAttribute('data-dirty', 'true')
    const dirty = editorTab.locator('[data-tab-dirty-marker]')
    const close = editorTab.locator('[data-tab-close-button]')
    await editorTab.hover()
    await expect(dirty).toBeVisible()
    await expect(close).toHaveCSS('opacity', '1')
    expect(await close.evaluate((element) => element.getBoundingClientRect().width)).toBe(24)
    await close.focus()
    await page.keyboard.press('Shift+Tab')
    await expect(editorTab).toBeFocused()
    await expect(editorTab).toHaveCSS('outline-style', 'solid')
    await expect(dirty).toBeVisible()
    await capture(page, '02-light-eight-dirty-focus')

    const scrollWidth = await strip.evaluate((element) => element.scrollWidth)
    await tabs.filter({ hasText: 'P1-中文长标题-5.ts' }).click()
    await expect.poll(() => strip.evaluate((element) => element.scrollWidth)).toBe(scrollWidth)
    const separators = await strip.evaluate((element) => {
      const selected = element.querySelector('.tab-item-active')!.closest('.tab-container')!
      return [selected, selected.previousElementSibling]
        .filter(Boolean)
        .map((tab) => getComputedStyle(tab!).backgroundImage)
    })
    expect(separators.every((value) => value === 'none')).toBe(true)
    expect(await xterm!.evaluate((element) => element.isConnected)).toBe(true)
    expect(await guest!.evaluate((element) => element.isConnected)).toBe(true)
    await page.locator(`[data-tab-id="${browserId}"]`).click()
    await expect(browser).toBeVisible()
    expect(await guest!.evaluate((element) => element.isConnected)).toBe(true)

    await page.locator(`[data-tab-id="${terminalId}"]`).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Pin Tab', exact: true }).click()
    const pinned = page.locator(`[data-tab-id="${terminalId}"]`)
    await expect(pinned).toHaveAttribute('data-pinned', 'true')
    await expect(pinned.locator('[data-tab-close-button]')).toHaveCount(0)
    await expect(pinned).not.toHaveText('')
    await page.getByRole('button', { name: 'New tab', exact: true }).first().click()
    await expect(page.getByRole('menu').first()).toBeVisible()
    await capture(page, '03-light-menu')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await page.evaluate(() => window.__store!.getState().updateSettings({ theme: 'dark' }))
    await expect(page.locator('html')).toHaveClass(/dark/)
    await editorTab.click()
    await capture(page, '04-dark-eight')
    await openFiles(7, 28)
    await expect(tabs).toHaveCount(30)
    await page.setViewportSize({ width: 960, height: 768 })
    await expect(page.getByRole('button', { name: 'Scroll tabs left', exact: true })).toBeEnabled()
    const last = tabs.filter({ hasText: 'P1-中文长标题-28.ts' })
    await expect(last).toBeInViewport()
    const beforeScroll = await strip.evaluate((element) => element.scrollLeft)
    await page.getByRole('button', { name: 'Scroll tabs left', exact: true }).click()
    await expect
      .poll(() => strip.evaluate((element) => element.scrollLeft))
      .toBeLessThan(beforeScroll)
    await capture(page, '05-dark-thirty-narrow')
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((window) => !window.isDestroyed())!
        .webContents.setZoomFactor(1.25)
    })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect
      .poll(() => strip.evaluate((element) => element.clientWidth))
      .toBeGreaterThanOrEqual(128)
    await page.getByRole('button', { name: 'Add quick command', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await last.click()
    await capture(page, '06-dark-thirty-125pct')
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((window) => !window.isDestroyed())!
        .webContents.setZoomFactor(1)
    })
    await page.setViewportSize({ width: 1440, height: 960 })
    await page.evaluate(() => window.__store!.getState().updateSettings({ theme: 'light' }))
    await expect(page.locator('html')).not.toHaveClass(/dark/)
    await capture(page, '06b-light-thirty')
    await page.evaluate(() => window.__store!.getState().updateSettings({ theme: 'dark' }))
    await page.evaluate((worktreeId) => {
      const state = window.__store!.getState()
      const root = state.ensureWorktreeRootGroup(worktreeId)
      const split = state.createEmptySplitGroup(worktreeId, root, 'right')!
      state.createBrowserTab(worktreeId, 'about:blank', { targetGroupId: split, activate: true })
    }, fixture.worktreeId)
    await expect(page.locator('[data-tab-group-strip-id]')).toHaveCount(2)
    const seams = await page.locator('[data-tab-group-strip-id]').evaluateAll((strips) =>
      strips.map((strip) => {
        const id = strip.getAttribute('data-tab-group-strip-id')
        const body = document.querySelector(`[data-tab-group-body-id="${id}"]`)!
        const rect = strip.getBoundingClientRect()
        return { height: rect.height, gap: body.getBoundingClientRect().top - rect.bottom }
      })
    )
    expect(seams).toEqual([
      { height: 36, gap: 0 },
      { height: 36, gap: 0 }
    ])
    await capture(page, '07-dark-split')
    const splitTab = page.locator('[data-tab-group-strip-id]').last().locator('[data-tab-id]')
    await splitTab.locator('[data-tab-close-button]').click()
    await expect(page.locator('[data-tab-id]')).toHaveCount(30)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
