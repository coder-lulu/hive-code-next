import path from 'node:path'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

test.use({ orcaAppExtraEnv: { ORCA_BACKGROUND_LAUNCH: '1' } })

test('groups offline runtime projects and sessions and restores them on reconnect', async ({
  orcaPage: page,
  electronApp
}, testInfo) => {
  await waitForSessionReady(page)
  await page.evaluate(async () => {
    const store = window.__store!
    await store.getState().updateSettings({ uiLanguage: 'en', theme: 'light' })
    const state = store.getState()
    const localRepo = state.repos[0]
    const localTree = state.worktreesByRepo[localRepo.id].find((tree) => !tree.isMainWorktree)!
    const localTab = state.createTab(localTree.id, undefined, undefined, { activate: false })
    const localUnified = store
      .getState()
      .unifiedTabsByWorktree[localTree.id].find((tab) => tab.entityId === localTab.id)!
    const remoteRepo = {
      ...localRepo,
      id: 'offline-test-repo',
      path: '/offline/project',
      displayName: 'Remote project',
      executionHostId: 'runtime:offline-test' as const,
      connectionId: null,
      projectGroupId: null
    }
    const remoteTree = {
      ...localTree,
      id: 'offline-test-worktree',
      repoId: remoteRepo.id,
      path: '/offline/workspace',
      hostId: 'runtime:offline-test' as const,
      displayName: 'Remote workspace',
      isPinned: false
    }
    store.setState({
      repos: [...state.repos, remoteRepo],
      worktreesByRepo: { ...state.worktreesByRepo, [remoteRepo.id]: [remoteTree] },
      tabsByWorktree: {
        ...store.getState().tabsByWorktree,
        [remoteTree.id]: [
          {
            ...localTab,
            id: 'offline-test-terminal',
            worktreeId: remoteTree.id,
            title: 'Remote session',
            customTitle: 'Remote session',
            launchAgent: 'codex',
            ptyId: null
          }
        ]
      },
      unifiedTabsByWorktree: {
        ...store.getState().unifiedTabsByWorktree,
        [remoteTree.id]: [
          {
            ...localUnified,
            id: 'offline-test-unified',
            worktreeId: remoteTree.id,
            entityId: 'offline-test-terminal',
            executionHostId: 'runtime:offline-test',
            label: 'Remote session',
            customLabel: 'Remote session'
          }
        ]
      },
      runtimeStatusByEnvironmentId: new Map([
        ['offline-test', { status: null, checkedAt: Date.now() }]
      ]),
      workspaceHostScope: 'all',
      visibleWorkspaceHostIds: null
    })
    store.getState().setFilterRepoIds([])
    store.getState().setShowSleepingWorkspaces(true)
    store.getState().setHideDefaultBranchWorkspace(false)
    store.getState().setSidebarOpen(true)
    store.getState().openSessionsPage()
    store
      .getState()
      .updateSessionsView({ navigation: 'projects', scope: { kind: 'all' }, query: '' })
  })
  await page.setViewportSize({ width: 1400, height: 950 })
  const projects = page.locator('.projects-navigation-pane')
  const directory = projects.getByRole('button', { name: 'Offline', exact: true })
  await expect(directory).toBeVisible()
  await directory.click()
  await expect(directory).toHaveAttribute('aria-expanded', 'false')
  await expect(projects.getByText('Remote workspace', { exact: true })).toHaveCount(0)
  const remoteHeader = projects.getByRole('button', { name: /^Remote project/ })
  for (const directoryWasCollapsed of [true, false]) {
    if (!directoryWasCollapsed) {
      await expect(remoteHeader).not.toHaveClass(/ring-1/)
    }
    await page.evaluate(() => window.__store!.getState().openModal('worktree-palette'))
    const palette = page.getByRole('dialog', { name: 'Jump to...' })
    await expect(palette).toBeVisible()
    await palette.getByRole('combobox').fill('Remote project')
    await palette.locator('[cmdk-item][data-value*="project:repo:offline-test-repo"]').click()
    await expect(palette).toBeHidden()
    await expect(directory).toHaveAttribute('aria-expanded', 'true')
    await expect(remoteHeader).toBeVisible()
    await testInfo.attach(`offline-header-collapsed-${directoryWasCollapsed}`, {
      body: JSON.stringify(
        await remoteHeader.evaluate((element) => ({
          id: element.id,
          className: element.className,
          text: element.textContent
        }))
      ),
      contentType: 'application/json'
    })
    await expect(remoteHeader).toHaveAttribute('id', /^worktree-list-option-runtime-offline%3A/)
    await expect(
      remoteHeader,
      `offline header highlight, collapsed=${directoryWasCollapsed}`
    ).toHaveClass(/ring-1/)
    await expect(page.getByText('Target no longer exists', { exact: true })).toHaveCount(0)
  }
  await expect(projects.getByText('Remote workspace', { exact: true })).toBeVisible()
  await page.screenshot({
    path: path.join(testInfo.outputDir, 'offline-projects-light.png'),
    animations: 'disabled'
  })

  await page
    .locator('.sidebar-primary-nav')
    .getByRole('button', { name: 'Sessions', exact: true })
    .click()
  const sessions = page.locator('.sessions-list-pane')
  const offlineSessions = sessions.getByRole('button', { name: /Offline/ })
  await expect(offlineSessions).toBeVisible()
  await expect(sessions.getByRole('option', { name: /Remote session/ })).toHaveCount(0)
  await offlineSessions.click()
  await expect(sessions.getByRole('option', { name: /Remote session/ })).toBeVisible()
  await page.evaluate(async () => {
    await window.__store!.getState().updateSettings({ uiLanguage: 'zh', theme: 'dark' })
  })
  await expect(sessions.getByRole('button', { name: /离线/ })).toBeVisible()
  await page.screenshot({
    path: path.join(testInfo.outputDir, 'offline-sessions-dark-zh.png'),
    animations: 'disabled'
  })
  await page.evaluate(() => {
    const store = window.__store!
    store.setState({
      runtimeStatusByEnvironmentId: new Map([
        ['offline-test', { status: { runtimeId: 'offline-test' } as never, checkedAt: Date.now() }]
      ])
    })
  })
  await expect(sessions.getByRole('button', { name: /离线/ })).toHaveCount(0)
  await expect(sessions.getByRole('option', { name: /Remote session/ })).toBeVisible()
  await page.evaluate(() => {
    window.__store!.getState().updateSessionsView({ navigation: 'projects' })
  })
  await expect(projects.getByRole('button', { name: '离线', exact: true })).toHaveCount(0)
  await expect(projects.getByText('Remote workspace', { exact: true })).toBeVisible()
  expect(
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((window) => window.isVisible())
    )
  ).toBe(false)
})
