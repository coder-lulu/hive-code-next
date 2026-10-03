import type { Page } from '@stablyai/playwright-test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { seedLineageScenario } from './worktree-lineage-state'
import { worktreeRow } from './worktree-row-locators'

// Optional screenshots accompany the behavioral assertions.
const CAPTURE_EVIDENCE = process.env.ORCA_CAPTURE_EVIDENCE === '1'
const SHOT_DIR = resolve(process.cwd(), 'logs/e2e/worktree-lineage-agent-expansion')

async function captureSidebar(page: Page, name: string): Promise<void> {
  if (!CAPTURE_EVIDENCE) {
    return
  }
  mkdirSync(SHOT_DIR, { recursive: true })
  await sidebar(page).screenshot({ path: resolve(SHOT_DIR, name) })
}

// Seed two independent sessions alongside the child-workspaces disclosure.
async function seedTwoParentAgents(page: Page, worktreeId: string): Promise<void> {
  await page.evaluate((worktreeId) => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }
    const state = store.getState()
    if (!state.worktreeCardProperties.includes('inline-agents')) {
      state.setWorktreeCardProperties([...state.worktreeCardProperties, 'inline-agents'])
    }
    while ((store.getState().tabsByWorktree[worktreeId] ?? []).length < 2) {
      store.getState().createTab(worktreeId)
    }
    const tabs = (store.getState().tabsByWorktree[worktreeId] ?? []).slice(0, 2)
    const now = Date.now()
    const specs = [
      { state: 'working' as const, prompt: 'Refactor auth middleware', agentType: 'claude' },
      { state: 'done' as const, prompt: 'Write unit tests for parser', agentType: 'codex' }
    ]
    tabs.forEach((tab, index) => {
      const spec = specs[index]!
      const leafId = crypto.randomUUID()
      store
        .getState()
        .setAgentStatus(
          `${tab.id}:${leafId}`,
          { state: spec.state, prompt: spec.prompt, agentType: spec.agentType },
          spec.agentType,
          { updatedAt: now, stateStartedAt: now }
        )
    })
  }, worktreeId)
}

function sidebar(page: Page) {
  return page.locator('[data-worktree-sidebar]').first()
}

function sessionDisclosure(page: Page, parentId: string) {
  return worktreeRow(page, parentId).getByRole('button', { name: 'Toggle sessions', exact: true })
}

function childWorkspacesChip(page: Page, parentId: string) {
  return worktreeRow(page, parentId)
    .getByRole('button', { name: /child workspace/i })
    .first()
}

test.describe('Worktree lineage agent-list expansion independence', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
  })

  test('toggling child worktrees does not collapse expanded sessions', async ({ orcaPage }) => {
    const { parentId, childId } = await seedLineageScenario(orcaPage)
    const parentRow = worktreeRow(orcaPage, parentId)
    const childRow = worktreeRow(orcaPage, childId)

    await parentRow.click()
    await expect(parentRow).toHaveAttribute('aria-current', 'page')

    await seedTwoParentAgents(orcaPage, parentId)

    const sessions = parentRow.locator('.project-tree-session-row')
    await expect(sessionDisclosure(orcaPage, parentId)).toBeVisible({ timeout: 10_000 })
    await expect(childWorkspacesChip(orcaPage, parentId)).toBeVisible()
    await expect(childRow).toBeVisible()
    await expect(sessionDisclosure(orcaPage, parentId)).toHaveAttribute('aria-expanded', 'true')
    await expect(sessions).toHaveCount(2)
    await sessionDisclosure(orcaPage, parentId).click()
    await expect(sessionDisclosure(orcaPage, parentId)).toHaveAttribute('aria-expanded', 'false')
    await expect(sessions.first()).toBeHidden()
    await expect(parentRow.locator('.project-tree-agent-summary')).toBeVisible()
    await captureSidebar(orcaPage, '1-before-both-collapsed.png')

    await sessionDisclosure(orcaPage, parentId).click()
    await expect(sessionDisclosure(orcaPage, parentId)).toHaveAttribute('aria-expanded', 'true')
    await expect(sessions.nth(0)).toBeVisible()
    await expect(sessions.nth(1)).toBeVisible()
    await captureSidebar(orcaPage, '2-agents-expanded.png')

    // Collapse the child worktrees via the chip. This remounts the parent card.
    await childWorkspacesChip(orcaPage, parentId).click()
    await expect(childRow).toBeHidden()

    await expect(sessionDisclosure(orcaPage, parentId)).toHaveAttribute('aria-expanded', 'true')
    await expect(sessions).toHaveCount(2)
    await expect(sessions.nth(0)).toBeVisible()
    await expect(sessions.nth(1)).toBeVisible()
    await captureSidebar(orcaPage, '3-after-children-toggle-agents-still-expanded.png')
  })
})
