import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'

test.use({ minimumSeededWorktreeCount: 1 })

test('pins and archives sessions without closing their terminal, then restores them from the archive group', async ({
  orcaPage: page,
  electronApp
}) => {
  test.setTimeout(150_000)
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
  const terminalId = await page.evaluate(async () => {
    const store = window.__store!
    await store.getState().updateSettings({ theme: 'light', uiLanguage: 'en' })
    store.setState({
      sidebarOpen: true,
      sidebarWidth: 240,
      rightSidebarOpen: false,
      sessionListMetadata: {}
    })
    const state = store.getState()
    const terminal = state.tabsByWorktree[state.activeWorktreeId!][0]
    state.setAiVaultTabTitle(terminal.id, {
      agent: 'codex',
      sessionId: 'p2-actions-worktree',
      title: 'P2 Actions retained terminal'
    })
    const temporary = state.createTab('global-floating-terminal', undefined, undefined, {
      activate: false
    })
    store.getState().setAiVaultTabTitle(temporary.id, {
      agent: 'codex',
      sessionId: 'p2-actions-temporary',
      title: 'P2 Actions other session'
    })
    return terminal.id
  })
  await page
    .locator('.sidebar-primary-nav')
    .getByRole('button', { name: 'Sessions', exact: true })
    .click()
  const rows = page.getByTestId('session-center-row')
  await expect(rows).toHaveCount(2)
  const target = rows.filter({ hasText: 'P2 Actions retained terminal' })
  await target.locator('.session-row-select').click()
  await expect(page.locator('[data-session-terminal] .xterm')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-session-terminal] [data-pty-id]').first()).toHaveAttribute(
    'data-pty-id',
    /\S+/,
    { timeout: 30_000 }
  )
  const before = await page.evaluate(
    (id) => ({
      tabs: Object.values(window.__store!.getState().tabsByWorktree)
        .flat()
        .map((tab) => tab.id)
        .sort(),
      ptys: window.__paneManagers
        ?.get(id)
        ?.getPanes()
        .map((pane) => pane.container.dataset.ptyId)
    }),
    terminalId
  )
  expect(before.ptys?.filter(Boolean).length).toBeGreaterThan(0)
  const selectedKey = await target.getAttribute('data-session-key')
  await page.mouse.move(1000, 700)
  await expect(target.locator('.session-row-actions')).toHaveCSS('opacity', '0')
  await target.hover()
  await expect(target.locator('.session-row-actions')).toHaveCSS('opacity', '1')
  await target.getByRole('button', { name: 'Pin session', exact: true }).click()
  await expect(rows.first()).toHaveAttribute('data-session-key', selectedKey!)
  await expect(target.getByRole('button', { name: 'Unpin session', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  expect(
    await page.evaluate(() => window.__store!.getState().sessionsView.selectedSessionKey)
  ).toBe(selectedKey)
  if (process.env.HIVE_UI_BASELINE_DIR) {
    mkdirSync(process.env.HIVE_UI_BASELINE_DIR, { recursive: true })
    await page.screenshot({
      path: path.join(process.env.HIVE_UI_BASELINE_DIR, 'p2-session-actions-hover.png'),
      animations: 'disabled'
    })
  }
  await page.mouse.move(1000, 700)
  await expect(target.locator('.session-row-actions')).toHaveCSS('opacity', '0')
  await target.hover()
  await target.getByRole('button', { name: 'Archive session', exact: true }).click()
  await expect(target).toHaveCount(0)
  const archivedGroup = page.getByRole('button', { name: /Archived/ })
  await expect(archivedGroup).toHaveAttribute('aria-expanded', 'false')
  expect(
    await page.evaluate(() => window.__store!.getState().sessionsView.selectedSessionKey)
  ).toBeNull()
  expect(
    await page.evaluate(
      (id) => ({
        tabs: Object.values(window.__store!.getState().tabsByWorktree)
          .flat()
          .map((tab) => tab.id)
          .sort(),
        ptys: window.__paneManagers
          ?.get(id)
          ?.getPanes()
          .map((pane) => pane.container.dataset.ptyId)
      }),
      terminalId
    )
  ).toEqual(before)
  await expect
    .poll(() =>
      page.evaluate(
        async (key) => (await window.api.ui.get()).sessionListMetadata?.[key!],
        selectedKey
      )
    )
    .toEqual({ pinned: true, archived: true })
  const search = page.getByRole('textbox', { name: 'Search sessions', exact: true })
  await search.fill('P2 Actions retained terminal')
  await expect(rows).toHaveCount(0)
  await expect(archivedGroup).toBeVisible()
  await archivedGroup.click()
  await expect(target).toBeVisible()
  await target.locator('.session-row-select').click()
  await expect(page.locator('[data-session-terminal] .xterm')).toBeVisible()
  expect(
    await page.evaluate(
      (id) =>
        window.__paneManagers
          ?.get(id)
          ?.getPanes()
          .map((pane) => pane.container.dataset.ptyId),
      terminalId
    )
  ).toEqual(before.ptys)
  await target.hover()
  await target.getByRole('button', { name: 'Unarchive session', exact: true }).click()
  await expect(archivedGroup).toHaveCount(0)
  await expect(target).toBeVisible()
  await expect(target.getByRole('button', { name: 'Unpin session', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await search.fill('')
  await expect(rows).toHaveCount(2)
  await expect(rows.first()).toHaveAttribute('data-session-key', selectedKey!)
  await target.getByRole('button', { name: 'Unpin session', exact: true }).focus()
  await expect(target.locator('.session-row-actions')).toHaveCSS('opacity', '1')
  await page.keyboard.press('Enter')
  await expect(target.getByRole('button', { name: 'Pin session', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false'
  )
  expect(
    await page.evaluate(() => window.__store!.getState().sessionsView.selectedSessionKey)
  ).toBe(selectedKey)
})
