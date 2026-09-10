import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'

test.use({ minimumSeededWorktreeCount: 1 })

const captureDirectory = process.env.HIVE_UI_BASELINE_DIR

async function capture(page: Page, name: string): Promise<void> {
  if (!captureDirectory) {
    return
  }
  await page.evaluate(() => document.fonts.ready)
  const metrics = await page.evaluate(() => {
    const rect = (element: Element) => {
      const bounds = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return {
        width: bounds.width,
        height: bounds.height,
        background: style.backgroundColor,
        minWidth: style.minWidth,
        font: style.fontFamily
      }
    }
    return {
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      theme: document.documentElement.className,
      sidebarWidth: window.__store!.getState().sidebarWidth,
      strips: [...document.querySelectorAll('[data-tab-group-strip-id]')].map(rect),
      tabs: [...document.querySelectorAll('[data-tab-id]')]
        .filter((element) => element.getBoundingClientRect().height > 0)
        .map((element) => ({ id: element.getAttribute('data-tab-id'), ...rect(element) })),
      sessionRows: [...document.querySelectorAll('[data-testid="temporary-session-row"]')].map(rect)
    }
  })
  mkdirSync(captureDirectory, { recursive: true })
  writeFileSync(path.join(captureDirectory, `${name}.json`), JSON.stringify(metrics, null, 2))
  await page.screenshot({
    path: path.join(captureDirectory, `${name}.png`),
    animations: 'disabled'
  })
}

test('captures navigation, mixed tabs and recoverable-session baseline', async ({
  electronApp,
  orcaPage,
  seededRepoPath
}) => {
  test.skip(!captureDirectory, 'Opt in with HIVE_UI_BASELINE_DIR to collect visual evidence')
  test.setTimeout(180_000)
  await waitForSessionReady(orcaPage)
  await ensureTerminalVisible(orcaPage)
  const hiddenWindows = await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().every((window) => !window.isVisible())
  )
  expect(hiddenWindows).toBe(true)
  await orcaPage.setViewportSize({ width: 1440, height: 960 })
  const worktreeId = await orcaPage.evaluate(async () => {
    const store = window.__store!
    await store.getState().updateSettings({ theme: 'light' })
    store.setState({ sidebarOpen: true, sidebarWidth: 280, rightSidebarOpen: false })
    return store.getState().activeWorktreeId!
  })
  await expect(orcaPage.locator('[data-tab-group-strip-id]').first()).toBeVisible()
  await capture(orcaPage, 'workspace-light-single')

  const workspacePath = await orcaPage.evaluate((worktreeId) => {
    const state = window.__store!.getState()
    const worktree = Object.values(state.worktreesByRepo)
      .flat()
      .find((item) => item.id === worktreeId)
    if (!worktree) {
      throw new Error('Seeded workspace unavailable')
    }
    return worktree.path
  }, worktreeId)
  console.log('Baseline fixture paths', { seededRepoPath, workspacePath })

  for (let index = 1; index <= 7; index += 1) {
    const relativePath = `P0-基准-${index}-long-title.ts`
    const filePath = path.join(workspacePath, relativePath)
    writeFileSync(filePath, '// UI baseline fixture\nexport const ready = true\n')
    await orcaPage.evaluate(
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
      { filePath, relativePath, worktreeId }
    )
  }
  await orcaPage.evaluate((worktreeId) => {
    window.__store!.getState().createBrowserTab(worktreeId, 'about:blank', {
      title: 'P0 browser fixture',
      activate: false
    })
  }, worktreeId)
  await expect(orcaPage.locator('[data-tab-group-strip-id]').first()).toContainText('P0-基准-7')
  await expect(orcaPage.locator('.monaco-editor').first()).toBeVisible()
  await expect(orcaPage.getByText('Unable to load file', { exact: true })).toHaveCount(0)
  await capture(orcaPage, 'workspace-light-mixed')
  await orcaPage.evaluate(async () => {
    await window.__store!.getState().updateSettings({ theme: 'dark' })
  })
  await expect(orcaPage.locator('html')).toHaveClass(/dark/)
  await capture(orcaPage, 'workspace-dark-mixed')
  await orcaPage.setViewportSize({ width: 960, height: 768 })
  await capture(orcaPage, 'workspace-dark-narrow')

  await orcaPage.setViewportSize({ width: 1440, height: 960 })
  await orcaPage.evaluate(async () => {
    const store = window.__store!
    await store.getState().updateSettings({ theme: 'light' })
    for (const [index, title] of [
      '修复 failed 错误（基线样例）',
      'Review done 问题（基线样例）',
      '无状态会话（基线样例）'
    ].entries()) {
      const tab = store
        .getState()
        .createTab('global-floating-terminal', undefined, undefined, { activate: false })
      store
        .getState()
        .setAiVaultTabTitle(tab.id, { agent: 'codex', sessionId: `p0-fixture-${index}`, title })
    }
    store.setState({ activeView: 'activity', activityPageScope: 'temporary-sessions' })
  })
  await expect(orcaPage.getByTestId('temporary-session-row')).toHaveCount(3)
  await capture(orcaPage, 'sessions-light')
  await orcaPage.evaluate(async () => {
    await window.__store!.getState().updateSettings({ theme: 'dark' })
  })
  await expect(orcaPage.locator('html')).toHaveClass(/dark/)
  await capture(orcaPage, 'sessions-dark')
})
