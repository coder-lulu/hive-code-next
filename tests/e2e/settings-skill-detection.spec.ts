import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import type {
  DiscoveredSkill,
  SkillDiscoveryResult,
  SkillSourceKind
} from '../../src/shared/skills'
import { ORCHESTRATION_ENABLED_STORAGE_KEY } from '../../src/renderer/src/lib/orchestration-setup-state'

type MockSkillDiscoveryGlobal = typeof globalThis & {
  __orcaSettingsSkillDiscoveryResult?: SkillDiscoveryResult
}

function makeSkill(sourceKind: SkillSourceKind, directoryPath: string): DiscoveredSkill {
  return {
    id: `${sourceKind}-orca-cli`,
    name: 'orchestration',
    description: null,
    providers: ['agent-skills'],
    sourceKind,
    sourceLabel: sourceKind,
    rootPath: directoryPath.replace(/[\\/]orchestration$/, ''),
    directoryPath,
    skillFilePath: `${directoryPath}/SKILL.md`,
    installed: true,
    updatedAt: null
  }
}

function discoveryResult(skills: DiscoveredSkill[]): SkillDiscoveryResult {
  return {
    skills,
    sources: [],
    scannedAt: Date.now()
  }
}

async function installMockSkillDiscovery(
  app: ElectronApplication,
  result: SkillDiscoveryResult
): Promise<void> {
  await app.evaluate((electron, initialResult) => {
    const global = globalThis as MockSkillDiscoveryGlobal
    global.__orcaSettingsSkillDiscoveryResult = initialResult
    electron.ipcMain.removeHandler('skills:discover')
    electron.ipcMain.handle('skills:discover', () => {
      const latest = (globalThis as MockSkillDiscoveryGlobal).__orcaSettingsSkillDiscoveryResult
      if (!latest) {
        throw new Error('Missing mocked skill discovery result')
      }
      return latest
    })
  }, result)
}

async function setMockSkillDiscovery(
  app: ElectronApplication,
  result: SkillDiscoveryResult
): Promise<void> {
  await app.evaluate((_, nextResult) => {
    ;(globalThis as MockSkillDiscoveryGlobal).__orcaSettingsSkillDiscoveryResult = nextResult
  }, result)
}

async function openOrchestrationSettings(page: Page): Promise<void> {
  await page.evaluate(
    ({ enabledKey }) => {
      localStorage.removeItem(enabledKey)
      const state = window.__store!.getState()
      state.setSettingsSearchQuery('orchestration')
      state.openSettingsPage()
    },
    {
      enabledKey: ORCHESTRATION_ENABLED_STORAGE_KEY
    }
  )
  await expect(page.getByPlaceholder('Search settings')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /^Agent Capabilities\b/ }).click()
  await expect(
    page
      .locator('[data-settings-section="agent-capabilities"]')
      .getByRole('heading', { name: 'Agent Capabilities', exact: true })
  ).toBeInViewport({ timeout: 10_000 })
}

test.describe('Settings skill detection', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
  })

  test('shows installed only for global orchestration skill installs', async ({
    electronApp,
    orcaPage
  }) => {
    await installMockSkillDiscovery(
      electronApp,
      discoveryResult([
        makeSkill('repo', '/workspace/.agents/skills/orchestration'),
        makeSkill('plugin', '/Users/test/.codex/plugins/cache/vendor/orchestration')
      ])
    )

    await openOrchestrationSettings(orcaPage)
    const section = orcaPage.locator('[data-settings-section="agent-capabilities"] #orchestration')
    await section.getByRole('button', { name: 'Re-check' }).click()

    await expect(section.getByText('Not installed', { exact: true })).toBeVisible()
    await expect(section.getByRole('button', { name: 'Install skill' })).toBeVisible()
    await expect(
      section.getByText('Coordinate task handoffs and sequential or parallel child agents.')
    ).toBeVisible()

    await setMockSkillDiscovery(
      electronApp,
      discoveryResult([makeSkill('home', '/Users/test/.agents/skills/orchestration')])
    )
    await section.getByRole('button', { name: 'Re-check' }).click()

    await expect(section.getByRole('button', { name: 'Update' })).toBeVisible()
    await expect(section.getByRole('button', { name: 'Install skill' })).toHaveCount(0)
    await expect(
      section.getByText('Coordinate task handoffs and sequential or parallel child agents.')
    ).toBeVisible()
  })

  test('keeps a failed skill scan out of install and coverage until re-check succeeds', async ({
    electronApp,
    orcaPage
  }) => {
    await electronApp.evaluate((electron) => {
      electron.ipcMain.removeHandler('skills:discover')
      electron.ipcMain.handle('skills:discover', () => {
        throw new Error('Skill scan offline')
      })
    })

    await openOrchestrationSettings(orcaPage)
    await expect
      .poll(() =>
        orcaPage.evaluate(() => window.__store!.getState().runtimeEnvironmentCatalogSettled)
      )
      .toBe(true)
    const capabilitySection = orcaPage.locator('[data-settings-section="agent-capabilities"]')
    const orchestrationCard = capabilitySection.locator('#orchestration')
    await orchestrationCard.getByRole('button', { name: 'Re-check' }).click()
    await expect(orchestrationCard.getByText('Check failed')).toBeVisible()
    await expect(orchestrationCard.getByText('Skill scan offline')).toBeVisible()
    await expect(orchestrationCard.getByRole('button', { name: 'Install skill' })).toBeDisabled()
    await expect(
      capabilitySection.getByRole('alert').filter({
        hasText: 'agent coverage is unavailable'
      })
    ).toBeVisible()
    await expect(orcaPage.getByRole('button', { name: /^Agent Capabilities\b/ })).toContainText(
      'Review skill'
    )

    await installMockSkillDiscovery(electronApp, discoveryResult([]))
    await orchestrationCard.getByRole('button', { name: 'Re-check' }).click()
    await expect(orchestrationCard.getByText('Not installed')).toBeVisible()
    await expect(orchestrationCard.getByRole('button', { name: 'Install skill' })).toBeEnabled()
    await expect(capabilitySection.getByText('agent coverage is unavailable')).toHaveCount(0)
  })
})
