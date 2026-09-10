import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'

test.use({ minimumSeededWorktreeCount: 1 })

async function capture(page: Page, name: string): Promise<void> {
  const directory = process.env.HIVE_UI_BASELINE_DIR
  if (!directory) {
    return
  }
  await page.mouse.move(900, 900)
  await page.evaluate(() => document.fonts.ready)
  const metrics = await page.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    theme: document.documentElement.className,
    page: document.querySelector('[data-testid="sessions-page"]')?.getBoundingClientRect().toJSON(),
    list: document.querySelector('.sessions-list-pane')?.getBoundingClientRect().toJSON(),
    detail: document
      .querySelector('[data-testid="session-detail"]')
      ?.getBoundingClientRect()
      .toJSON(),
    scrollTop: document.querySelector('[data-testid="sessions-list-scroll"]')?.scrollTop,
    workspaceSection: document
      .querySelector('.sidebar-workspace-section')
      ?.getBoundingClientRect()
      .toJSON(),
    rows: [...document.querySelectorAll('[data-testid="session-center-row"]')].map((row) => ({
      key: row.getAttribute('data-session-key'),
      selected: row.getAttribute('aria-selected'),
      rect: row.getBoundingClientRect().toJSON(),
      text: row.textContent
    }))
  }))
  mkdirSync(directory, { recursive: true })
  writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(metrics, null, 2))
  await page.screenshot({ path: path.join(directory, `${name}.png`), animations: 'disabled' })
}

async function seedSessions(page: Page, temporaryCount = 2) {
  return page.evaluate(async (count) => {
    const store = window.__store!
    await store.getState().updateSettings({ theme: 'light' })
    store.setState({ sidebarOpen: true, sidebarWidth: 240, rightSidebarOpen: false })
    const state = store.getState()
    const worktreeId = state.activeWorktreeId!
    const tab = state.tabsByWorktree[worktreeId][0]
    state.setAiVaultTabTitle(tab.id, {
      agent: 'codex',
      sessionId: 'p2-workspace-session',
      title: 'P2 Workspace continuity'
    })
    for (let index = 0; index < count; index += 1) {
      const temporary = store
        .getState()
        .createTab('global-floating-terminal', undefined, undefined, { activate: false })
      store.getState().setAiVaultTabTitle(temporary.id, {
        agent: 'codex',
        sessionId: `p2-temporary-${index}`,
        title: `P2 Temporary ${String(index).padStart(2, '0')} 中文长标题等待核对`
      })
    }
    return { worktreeId, terminalId: tab.id }
  }, temporaryCount)
}

async function openSessions(page: Page): Promise<void> {
  await page
    .locator('.sidebar-primary-nav')
    .getByRole('button', { name: 'Sessions', exact: true })
    .click()
  await expect(page.getByTestId('sessions-page')).toBeVisible()
}

test.beforeEach(async ({ orcaPage: page, electronApp }) => {
  await waitForSessionReady(page)
  await ensureTerminalVisible(page)
  await page.setViewportSize({ width: 1440, height: 960 })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  expect(
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every((window) => !window.isVisible())
    )
  ).toBe(true)
})

test('reuses the full workbench from project management and creates in context', async ({
  orcaPage: page
}) => {
  test.setTimeout(150_000)
  const fixture = await seedSessions(page, 0)
  const secondTabId = await page.evaluate((id) => {
    const store = window.__store!
    const tab = store.getState().createTab(id, undefined, undefined, { activate: false })
    store.getState().setAiVaultTabTitle(tab.id, {
      agent: 'codex',
      sessionId: 'project-second',
      title: 'Project second session'
    })
    return tab.id
  }, fixture.worktreeId)
  const searchControl = page.getByRole('button', {
    name: 'Search worktrees and browser tabs',
    exact: true
  })
  await expect(
    page
      .locator('.sidebar-primary-nav')
      .getByRole('button', { name: 'Search worktrees and browser tabs', exact: true })
  ).toBeVisible()
  const searchBounds = (await searchControl.boundingBox())!
  const newTaskBounds = (await page
    .locator('.sidebar-primary-nav')
    .getByRole('button', { name: 'New task', exact: true })
    .boundingBox())!
  expect(searchBounds.y + searchBounds.height).toBeLessThanOrEqual(newTaskBounds.y)
  await expect(searchControl).toContainText('Shift')
  await page.getByRole('button', { name: 'Projects', exact: true }).click()
  const pane = page.getByTestId('projects-navigation-pane')
  await expect(pane).toBeVisible()
  const resizeHandle = pane.getByRole('separator', { name: 'Resize projects pane' })
  const beforeWidth = (await pane.boundingBox())!.width
  const handleBox = (await resizeHandle.boundingBox())!
  await page.mouse.move(handleBox.x + 2, handleBox.y + 100)
  await page.mouse.down()
  await page.mouse.move(handleBox.x + 82, handleBox.y + 100, { steps: 8 })
  await page.mouse.up()
  await expect.poll(async () => (await pane.boundingBox())!.width).toBeGreaterThan(beforeWidth + 60)
  await resizeHandle.dblclick()
  await expect.poll(async () => (await pane.boundingBox())!.width).toBe(320)
  await expect(page.getByRole('button', { name: 'Project sessions', exact: true })).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(pane.getByText('Ungrouped', { exact: true })).toHaveCount(0)
  await pane.locator(`[data-worktree-id="${fixture.worktreeId}"]`).first().click()
  await expect(
    page.locator(
      `[data-terminal-workbench-container] [data-tab-id="${fixture.terminalId}"]:visible`
    )
  ).toBeVisible()
  await expect(
    page.locator(`[data-terminal-workbench-container] [data-tab-id="${secondTabId}"]:visible`)
  ).toBeVisible()
  await page
    .locator(`[data-terminal-workbench-container] [data-tab-id="${secondTabId}"]:visible`)
    .click()
  await expect(
    page.locator(
      `[data-terminal-workbench-container] [data-tab-id="${fixture.terminalId}"]:visible`
    )
  ).toBeVisible()
  await expect(
    page.locator(`[data-terminal-workbench-container] [data-tab-id="${secondTabId}"]:visible`)
  ).toHaveAttribute('data-active', 'true')
  await expect(page.locator('[data-terminal-workbench-container]')).toHaveAttribute(
    'aria-hidden',
    'false'
  )
  await expect(page.getByTestId('session-detail')).toHaveCount(0)
  await page.getByRole('button', { name: 'Toggle right sidebar', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Find files', exact: true })).toBeVisible()
  const toggleRect = (await page
    .getByRole('button', { name: 'Toggle right sidebar', exact: true })
    .boundingBox())!
  const minimizeRect = (await page
    .getByRole('button', { name: 'Minimize', exact: true })
    .boundingBox())!
  expect(toggleRect.x + toggleRect.width).toBeLessThanOrEqual(minimizeRect.x)

  await capture(page, 'projects-workspace-tabs-light')
  await page.evaluate(() => window.__store!.getState().updateSettings({ theme: 'dark' }))
  await capture(page, 'projects-workspace-tabs-dark')
  await page.evaluate(async (id) => {
    const state = window.__store!.getState()
    const repo = state.repos.find((candidate) =>
      state.worktreesByRepo[candidate.id]?.some((worktree) => worktree.id === id)
    )!
    const group = await state.createProjectGroup('Project navigation group')
    if (
      !group ||
      !(await state.moveProjectToGroup(repo.id, group.id, undefined, { hostId: 'local' }))
    ) {
      throw new Error('Could not seed project group')
    }
  }, fixture.worktreeId)
  await expect(pane.getByText('Project navigation group', { exact: true })).toBeVisible()
  await pane
    .locator(`[data-worktree-id]:not([data-worktree-id="${fixture.worktreeId}"])`)
    .first()
    .click()
  await expect(page.locator('[data-terminal-workbench-container]')).toHaveAttribute(
    'aria-hidden',
    'false'
  )
  await expect(
    page.locator(
      `[data-terminal-workbench-container] [data-tab-id="${fixture.terminalId}"]:visible`
    )
  ).toHaveCount(0)
  await pane.locator(`[data-worktree-id="${fixture.worktreeId}"]`).first().click()
  await expect(
    page.locator(
      `[data-terminal-workbench-container] [data-tab-id="${fixture.terminalId}"]:visible`
    )
  ).toBeVisible()
  await capture(page, 'projects-grouped-workspace-tabs')
  await pane.getByRole('button', { name: 'New session', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New session', exact: true }).click()
  await expect(page.locator('#session-create-workspace')).not.toContainText('Choose a workspace')
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).first().click()
  await pane.getByRole('button', { name: 'New session', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New worktree', exact: true }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  const composer = page.getByRole('dialog', { name: /Create (Workspace|Worktree)/i })
  const workspaceName = `project-entry-${Date.now()}`
  await composer.getByPlaceholder(/Type a name/i).fill(workspaceName)
  await composer.getByRole('button', { name: /Create (Workspace|Worktree)/i }).click()
  await expect(composer).toBeHidden({ timeout: 20_000 })
  await expect(pane).toBeVisible({ timeout: 30_000 })
  await expect(pane.locator('[data-worktree-id][aria-current="page"]').first()).toContainText(
    workspaceName
  )
  await expect(
    page.locator(
      `[data-terminal-workbench-container] [data-tab-id="${fixture.terminalId}"]:visible`
    )
  ).toHaveCount(0)
})

test('filters real session rows and preserves search through narrow list/detail navigation', async ({
  orcaPage: page
}) => {
  await seedSessions(page)
  await openSessions(page)
  const rows = page.getByTestId('session-center-row')
  const search = page.getByRole('textbox', { name: 'Search sessions', exact: true })
  await expect(rows).toHaveCount(3)
  await expect(rows.filter({ hasText: 'P2 Workspace continuity' })).toBeVisible()
  await expect(rows.first()).toHaveCSS('height', '56px')
  await capture(page, 'p2-01-light-all')

  await page.getByRole('button', { name: 'Session scope', exact: true }).click()
  await page.getByRole('option', { name: 'Unassigned', exact: true }).click()
  await expect(rows).toHaveCount(2)
  await expect(rows.filter({ hasText: 'P2 Workspace continuity' })).toHaveCount(0)
  await search.fill('P2 Temporary 01')
  await expect(rows).toHaveCount(1)
  await rows.first().click()
  await expect(
    page.getByTestId('session-detail').getByRole('heading', { name: /P2 Temporary 01/ })
  ).toBeVisible()
  await expect(page.locator('[data-session-terminal] .xterm')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('session-content-loading')).toHaveCount(0)
  await expect(page.getByTestId('session-chat-anchor')).toHaveAttribute('aria-busy', 'false')
  await capture(page, 'p2-02-light-filtered-detail')

  await page.evaluate(() => window.__store!.getState().updateSettings({ theme: 'dark' }))
  await expect(page.locator('html')).toHaveClass(/dark/)
  await capture(page, 'p2-03-dark-filtered-detail')
  await page.setViewportSize({ width: 900, height: 760 })
  const back = page.getByRole('button', { name: 'Back to session list', exact: true })
  await expect(back).toBeVisible()
  await back.click()
  const list = page.getByTestId('sessions-list-scroll')
  await expect(list).toBeVisible()
  await expect(list).toBeFocused()
  await expect(page.locator(':focus')).toBeVisible()
  await rows.first().click()
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          document.activeElement?.closest('[data-session-terminal]') ||
          document.activeElement?.getAttribute('aria-label') === 'Back to session list'
        )
      )
    )
    .toBe(true)
  await expect(page.locator(':focus')).toBeVisible()
  await expect(search).not.toBeVisible()
  await capture(page, 'p2-04-dark-narrow-detail')
  await back.click()
  await expect(list).toBeFocused()
  await expect(page.locator(':focus')).toBeVisible()
  await expect(search).toBeVisible()
  await expect(search).toHaveValue('P2 Temporary 01')
  await expect(page.getByRole('button', { name: 'Session scope', exact: true })).toContainText(
    'Unassigned'
  )
  await expect(rows).toHaveCount(1)
  await capture(page, 'p2-05-dark-narrow-list')
  await search.fill('no-such-session-p2')
  await expect(page.getByText('No sessions in this view', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Clear search', exact: true }).click()
  await expect(rows).toHaveCount(2)
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.evaluate(() =>
    window.__store!.getState().updateSettings({ uiLanguage: 'zh', theme: 'light' })
  )
  await expect(page.getByRole('button', { name: '会话范围', exact: true })).toContainText(
    '未关联项目'
  )
  await rows.first().click()
  await expect(
    page
      .getByTestId('session-detail')
      .getByRole('button', { name: '关闭会话视图', exact: true })
      .first()
  ).toBeVisible()
  await capture(page, 'p2-09-zh-light')
})

test('returns to the same terminal and browser guest without duplicate tabs or PTY replacement', async ({
  orcaPage: page
}) => {
  test.setTimeout(150_000)
  const fixture = await seedSessions(page, 0)
  const boundPane = page
    .locator('[data-pty-id]')
    .filter({ has: page.locator('.xterm') })
    .first()
  await expect(boundPane).toBeVisible()
  await expect(boundPane).toHaveAttribute('data-pty-id', /\S+/)
  const ptyId = (await boundPane.getAttribute('data-pty-id'))!
  const xterm = await page.locator('.xterm').first().elementHandle()
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end(
      '<title>P2 retained browser</title><p>Session navigation keeps this browser guest.</p>'
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('P2 browser fixture failed to listen')
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
    const guestId = await browser.evaluate((element) =>
      (element as HTMLElement & { getWebContentsId(): number }).getWebContentsId()
    )
    const tabs = page.locator('.terminal-tab-strip').first().locator('[data-tab-id]')
    await expect(tabs).toHaveCount(2)
    await openSessions(page)
    await page
      .getByTestId('session-center-row')
      .filter({ hasText: 'P2 Workspace continuity' })
      .click()
    await expect(page.getByTestId('sessions-page')).toBeVisible()
    await expect(page.locator('[data-session-terminal] .xterm')).toBeVisible()
    expect(await page.evaluate(() => window.__store!.getState().activeWorktreeId)).toBe(
      fixture.worktreeId
    )
    await page.getByRole('button', { name: 'Session scope', exact: true }).click()
    await page.getByRole('option', { name: /^orca-e2e-repo/ }).click()
    await expect(page.getByTestId('session-center-row')).toHaveCount(1)
    const search = page.getByRole('textbox', { name: 'Search sessions', exact: true })
    await search.fill('P2 Workspace continuity')
    await page.getByTestId('session-center-row').click()
    await expect(page.getByTestId('sessions-page')).toBeVisible()
    await expect(page.locator('[data-session-terminal] .xterm')).toBeVisible()
    expect(await page.evaluate(() => window.__store!.getState().activeWorktreeId)).toBe(
      fixture.worktreeId
    )
    await expect(page.getByRole('button', { name: 'Open workspace', exact: true })).toHaveCount(0)
    await page.locator('[data-session-terminal] .xterm-helper-textarea').focus()
    await page.keyboard.type('echo P2_DIRECT_SESSION_INPUT')
    await page.keyboard.press('Enter')
    await expect
      .poll(() =>
        page.evaluate((tabId) => {
          const terminal = window.__paneManagers?.get(tabId)?.getPanes?.()[0]?.terminal
          const buffer = terminal?.buffer.active
          if (!buffer) {
            return ''
          }
          return Array.from(
            { length: buffer.length },
            (_, index) => buffer.getLine(index)?.translateToString() ?? ''
          ).join('\n')
        }, fixture.terminalId)
      )
      .toContain('P2_DIRECT_SESSION_INPUT')
    await expect(page.getByTestId('sessions-page')).toBeVisible()
    expect(await page.evaluate(() => window.__store!.getState().activeWorktreeId)).toBe(
      fixture.worktreeId
    )
    await capture(page, 'p2-corrected-terminal-three-columns')
    await expect(boundPane).toBeVisible()
    await expect(boundPane).toHaveAttribute('data-pty-id', ptyId)
    await expect(tabs).toHaveCount(2)
    expect(await xterm!.evaluate((element) => element.isConnected)).toBe(true)
    expect(await guest!.evaluate((element) => element.isConnected)).toBe(true)
    await page.evaluate(() => window.__store!.setState({ activeView: 'terminal' }))
    await page.locator(`[data-tab-id="${browserId}"]`).click()
    await expect(browser).toBeVisible()
    expect(
      await browser.evaluate((element) =>
        (element as HTMLElement & { getWebContentsId(): number }).getWebContentsId()
      )
    ).toBe(guestId)

    await openSessions(page)
    await expect(search).toHaveValue('P2 Workspace continuity')
    await expect(page.getByTestId('session-center-row')).toHaveAttribute('aria-selected', 'true')
    await expect(
      page
        .getByTestId('session-detail')
        .getByRole('heading', { name: 'P2 Workspace continuity', exact: true })
    ).toBeVisible()
    await capture(page, 'p2-06-workspace-return-state')
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
})

test('restores a virtual list position and selected row after leaving the session center', async ({
  orcaPage: page
}) => {
  test.setTimeout(150_000)
  await seedSessions(page, 36)
  await openSessions(page)
  const search = page.getByRole('textbox', { name: 'Search sessions', exact: true })
  await search.fill('P2 Temporary')
  const list = page.getByTestId('sessions-list-scroll')
  await list.focus()
  await page.keyboard.press('End')
  await expect(
    page.locator('[data-testid="session-center-row"][aria-selected="true"]')
  ).toHaveCount(0)
  await page.keyboard.press('Enter')
  const selected = page.locator('[data-testid="session-center-row"][aria-selected="true"]')
  await expect(selected).toHaveCount(1)
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(500)
  const before = await list.evaluate((element) => element.scrollTop)
  const selectedKey = await selected.getAttribute('data-session-key')
  await capture(page, 'p2-07-virtual-list-end')
  await page
    .locator('.sidebar-primary-nav')
    .getByRole('button', { name: 'New task', exact: true })
    .click()
  await expect(page.getByTestId('sessions-page')).not.toBeVisible()
  await openSessions(page)
  await expect(search).toHaveValue('P2 Temporary')
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeCloseTo(before, 0)
  await expect(
    page.locator('[data-testid="session-center-row"][aria-selected="true"]')
  ).toHaveAttribute('data-session-key', selectedKey!)
  await expect(page.getByTestId('session-detail')).toBeVisible()
  await capture(page, 'p2-08-virtual-list-restored')
  await page.setViewportSize({ width: 900, height: 760 })
  await page.getByRole('button', { name: 'Back to session list', exact: true }).click()
  await expect(list).toBeVisible()
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(500)
  await expect(page.locator(`[data-session-key="${selectedKey}"]`).last()).toBeVisible()
  await capture(page, 'p2-review-narrow-list-return')
  await expect(page.getByTestId('session-navigation')).toHaveCount(0)
  await expect(page.locator('.sidebar-workspace-section')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Projects', exact: true })).toBeVisible()
})

test('keeps connection and activity indicators within a session row', async ({
  orcaPage: page
}) => {
  await seedSessions(page, 1)
  await page.evaluate(() => {
    const store = window.__store!
    const bucket = 'global-floating-terminal'
    store.setState({
      unifiedTabsByWorktree: {
        ...store.getState().unifiedTabsByWorktree,
        [bucket]: store.getState().unifiedTabsByWorktree[bucket].map((tab) => ({
          ...tab,
          executionHostId: 'ssh:p2-offline'
        }))
      }
    })
  })
  await openSessions(page)
  const row = page.getByTestId('session-center-row').filter({ hasText: 'P2 Temporary 00' })
  await expect(row.locator('.session-connection')).toBeVisible()
  await capture(page, 'p2-review-offline-row')
  const bounds = await row.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const indicators = element.querySelectorAll('.session-activity, .session-connection')
    return [...indicators].map((indicator) => indicator.getBoundingClientRect().right - rect.right)
  })
  expect(bounds.every((overflow) => overflow <= 0)).toBe(true)
})

test('terminates an archived session through its real terminal owner', async ({
  orcaPage: page
}) => {
  test.setTimeout(150_000)
  await seedSessions(page, 1)
  await openSessions(page)
  const row = page.getByTestId('session-center-row').filter({ hasText: 'P2 Temporary 00' })
  await row.click()
  const terminal = page.locator('[data-session-terminal]:visible [data-pty-id]').first()
  await expect(terminal).toHaveAttribute('data-pty-id', /\S+/, { timeout: 30_000 })
  const ptyId = (await terminal.getAttribute('data-pty-id'))!
  await row.hover()
  await row.getByRole('button', { name: 'Archive session', exact: true }).click()
  await expect(row).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(
        async (id) => (await window.api.pty.listSessions()).some((s) => s.id === id),
        ptyId
      )
    )
    .toBe(true)
  await page.getByRole('button', { name: /Archived/ }).click()
  await row.hover()
  await row.getByRole('button', { name: 'Terminate session', exact: true }).click()
  await expect(row).toHaveCount(0, { timeout: 20_000 })
  await expect
    .poll(
      () =>
        page.evaluate(
          async (id) => (await window.api.pty.listSessions()).some((s) => s.id === id),
          ptyId
        ),
      { timeout: 20_000 }
    )
    .toBe(false)
  await expect(
    page.getByTestId('session-center-row').filter({ hasText: 'P2 Workspace continuity' })
  ).toBeVisible()
})

test('resizes the sessions column and remembers its width across navigation', async ({
  orcaPage: page
}) => {
  await seedSessions(page, 1)
  await openSessions(page)
  const pane = page.locator('aside.sessions-list-pane')
  const handle = pane.getByRole('separator', { name: 'Resize sessions pane' })
  await expect(pane).toBeVisible()
  const beforeWidth = (await pane.boundingBox())!.width
  const box = (await handle.boundingBox())!
  await page.mouse.move(box.x + 2, box.y + 100)
  await page.mouse.down()
  await page.mouse.move(box.x + 82, box.y + 100, { steps: 8 })
  await page.mouse.up()
  await expect.poll(async () => (await pane.boundingBox())!.width).toBeGreaterThan(beforeWidth + 60)
  const resizedWidth = (await pane.boundingBox())!.width
  await page.getByRole('button', { name: 'Projects', exact: true }).click()
  await openSessions(page)
  await expect.poll(async () => (await pane.boundingBox())!.width).toBe(resizedWidth)
  await handle.dblclick()
  await expect.poll(async () => (await pane.boundingBox())!.width).toBe(320)
  await expect(
    page.getByTestId('session-center-row').filter({ hasText: 'P2 Temporary 00' })
  ).toBeVisible()
})
