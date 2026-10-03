import path from 'node:path'
import { expect, test } from './helpers/orca-app'
import { createSeededTestRepo } from './helpers/seeded-test-repo'
import { waitForSessionReady } from './helpers/store'

test('shares one board while keeping global agents, independent filters and a separate window', async ({
  orcaPage: page,
  electronApp
}, testInfo) => {
  await waitForSessionReady(page)
  const secondPath = createSeededTestRepo({ publishPath: false })
  const secondId = await page.evaluate(async (repoPath) => {
    const result = await window.api.repos.add({ path: repoPath })
    if ('error' in result) {
      throw new Error(result.error)
    }
    return result.repo.id
  }, secondPath)
  await expect
    .poll(
      () =>
        page.evaluate(async (repoId) => {
          const store = window.__store!
          await store.getState().fetchRepos()
          if (!store.getState().repos.some((repo) => repo.id === repoId)) {
            return false
          }
          await store.getState().updateRepo(repoId, { externalWorktreeVisibility: 'show' })
          await store.getState().fetchWorktrees(repoId)
          return (store.getState().worktreesByRepo[repoId]?.length ?? 0) >= 2
        }, secondId),
      { timeout: 30000 }
    )
    .toBe(true)

  await page.evaluate(async (secondId) => {
    const store = window.__store!
    await store.getState().updateSettings({
      uiLanguage: 'en',
      theme: 'light',
      tabAutoGenerateTitle: false,
      agentDashboardShowIdle: true
    })
    const state = store.getState()
    const firstRepo = state.repos.find((repo) => repo.id !== secondId)!
    const chosen = [firstRepo.id, secondId].map((repoId) =>
      state.worktreesByRepo[repoId].find((tree) => !tree.isMainWorktree)!
    )
    for (const [index, tree] of chosen.entries()) {
      await store.getState().updateWorktreeMeta(tree.id, {
        displayName: index ? 'Board Beta' : 'Board Alpha',
        workspaceStatus: 'in-progress'
      })
      const tab = store
        .getState()
        .createTab(tree.id, undefined, undefined, { activate: false, id: `board-agent-${index}` })
      const leaf = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
      store.getState().setAgentStatus(
        `${tab.id}:${leaf}`,
        {
          state: 'working',
          prompt: index ? 'Beta global task' : 'Alpha global task',
          agentType: 'codex'
        },
        'Codex',
        { updatedAt: Date.now(), stateStartedAt: Date.now() },
        {
          tabId: tab.id,
          terminalHandle: `board-test-${index}`,
          worktreeId: tree.id
        }
      )
    }
    store.getState().setFilterRepoIds([firstRepo.id])
    store.getState().setShowSleepingWorkspaces(true)
    store.getState().setHideDefaultBranchWorkspace(false)
    store.getState().setSidebarOpen(true)
    store.getState().openSessionsPage()
    store.getState().updateSessionsView({ navigation: 'projects' })
    store.setState({
      workspaceBoardOpen: false,
      workspaceBoardView: 'workspaces',
      sidebarWidth: 240,
      rightSidebarOpen: false
    })
  }, secondId)
  await page.setViewportSize({ width: 1400, height: 950 })
  await expect(
    page.locator('.sidebar-primary-nav').getByRole('button', { name: /Agent Dashboard/ })
  ).toHaveCount(0)
  await page.locator('[data-workspace-board-trigger]').click()
  const board = page.locator('[data-workspace-board-sheet]')
  await expect(board).toHaveCount(1)
  await expect(board.getByRole('tab', { name: 'Workspaces' })).toHaveAttribute(
    'data-state',
    'active'
  )
  const workspaceSearch = board.getByRole('textbox', { name: 'Search workspaces' })
  await workspaceSearch.fill('Board Alpha')
  await expect(board.getByText('Board Alpha', { exact: true })).toBeVisible()
  await board.getByRole('tab', { name: 'Agents' }).click()
  await expect(board.getByRole('button', { name: /Beta global task/ })).toBeVisible()
  const agentSearch = board.getByRole('textbox', { name: 'Search agents' })
  await agentSearch.fill('Beta')
  await expect(board.getByRole('button', { name: /Alpha global task/ })).toHaveCount(0)
  await board.getByRole('tab', { name: 'Workspaces' }).click()
  await expect(workspaceSearch).toHaveValue('Board Alpha')
  await board.getByRole('tab', { name: 'Agents' }).click()
  await expect(agentSearch).toHaveValue('Beta')
  await page.screenshot({
    path: path.join(testInfo.outputDir, 'board-agents-light.png'),
    animations: 'disabled'
  })

  const popoutReady = electronApp.waitForEvent('window')
  await board.getByRole('button', { name: 'Open in separate window' }).click()
  const popout = await popoutReady
  await expect(popout.getByRole('heading', { name: 'Agents', exact: true })).toBeVisible()
  await expect(popout.getByRole('button', { name: /Alpha global task/ })).toBeVisible()
  await expect(popout.getByRole('button', { name: /Beta global task/ })).toBeVisible()
  await expect(board).toBeVisible()
  await expect(agentSearch).toHaveValue('Beta')
  await popout.close()

  await board.getByRole('button', { name: /Beta global task/ }).click()
  const preview = page.locator('[data-slot="dialog-content"]')
  await expect(preview).toBeVisible()
  await preview.getByRole('button', { name: 'Close', exact: true }).press('Escape')
  await expect(preview).toHaveCount(0)
  await expect(board).toBeVisible()
  await agentSearch.press('Escape')
  await expect(agentSearch).toHaveValue('')
  await agentSearch.press('Escape')
  await expect(board).toHaveCount(0)

  await page.evaluate(async () => {
    await window.__store!.getState().updateSettings({ theme: 'dark' })
  })
  await page.locator('[data-workspace-board-trigger]').click()
  await board.getByRole('tab', { name: 'Workspaces' }).click()
  await page.screenshot({
    path: path.join(testInfo.outputDir, 'board-workspaces-dark.png'),
    animations: 'disabled'
  })
  await page.evaluate(async () => {
    await window.__store!.getState().updateSettings({ uiLanguage: 'zh' })
  })
  await expect(board.getByRole('heading', { name: '看板', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 1100, height: 800 })
  await electronApp.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())!
    main.webContents.setZoomFactor(1.3)
  })
  await expect(board.getByRole('tab', { name: '智能体', exact: true })).toBeVisible()
  await expect(board.getByRole('button', { name: '关闭看板', exact: true })).toBeVisible()
  await page.screenshot({
    path: path.join(testInfo.outputDir, 'board-workspaces-zh-dark-130.png'),
    animations: 'disabled'
  })
})
