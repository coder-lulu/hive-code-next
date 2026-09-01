import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_DISPLAY_NAME, PRIMARY_CLI_COMMAND } from '@/product-brand'
import { MobileEmulatorAgentControlRow } from './MobileEmulatorAgentControlRow'

const mocks = vi.hoisted(() => ({
  canUseLocalSkillFreshness: true,
  freshnessSkillName: undefined as string | undefined,
  terminalTitle: undefined as string | undefined,
  terminalAriaLabel: undefined as string | undefined
}))

vi.mock('@/hooks/useActiveProjectSkillRuntime', () => ({
  useActiveProjectSkillRuntime: () => ({
    canUseLocalSkillFreshness: mocks.canUseLocalSkillFreshness,
    terminalShellOverride: undefined
  })
}))

vi.mock('../emulator-pane/use-mobile-emulator-agent-setup-state', () => ({
  useMobileEmulatorAgentSetupState: () => ({
    cliActionLabel: 'Enable',
    cliBusy: false,
    cliEnabled: true,
    cliInstallStatus: null,
    cliLoading: false,
    cliSkillError: null,
    cliSkillInstalled: true,
    cliSkillLoading: false,
    cliSupported: true,
    completedCount: 2,
    handleEnableCli: vi.fn(),
    refreshCliSkill: vi.fn(),
    step2Blocked: false
  })
}))

vi.mock('./AgentSkillSetupPanel', () => ({
  AgentSkillSetupPanel: ({
    freshnessSkillName,
    terminalTitle,
    terminalAriaLabel
  }: {
    freshnessSkillName?: string
    terminalTitle: string
    terminalAriaLabel: string
  }) => {
    mocks.freshnessSkillName = freshnessSkillName
    mocks.terminalTitle = terminalTitle
    mocks.terminalAriaLabel = terminalAriaLabel
    return null
  }
}))

vi.mock('./SetupStepBadge', () => ({ StepBadge: () => null }))
vi.mock('./MobileEmulatorExamples', () => ({ MobileEmulatorExamples: () => null }))

describe('MobileEmulatorAgentControlRow freshness authority', () => {
  beforeEach(() => {
    mocks.canUseLocalSkillFreshness = true
    mocks.freshnessSkillName = undefined
    mocks.terminalTitle = undefined
    mocks.terminalAriaLabel = undefined
  })

  it('exposes local freshness only for a resolved local non-WSL runtime', () => {
    renderToStaticMarkup(<MobileEmulatorAgentControlRow />)
    expect(mocks.freshnessSkillName).toBe('orca-cli')

    mocks.canUseLocalSkillFreshness = false
    renderToStaticMarkup(<MobileEmulatorAgentControlRow />)
    expect(mocks.freshnessSkillName).toBeUndefined()
  })

  it('shows only the HiveCode brand and primary CLI command', () => {
    const markup = renderToStaticMarkup(<MobileEmulatorAgentControlRow />)

    expect(mocks.terminalTitle).toBe(`${APP_DISPLAY_NAME} CLI skill setup`)
    expect(mocks.terminalAriaLabel).toBe(`${APP_DISPLAY_NAME} CLI skill install terminal`)
    expect(markup).toContain(`${PRIMARY_CLI_COMMAND} emulator list --json`)
    expect(markup).not.toContain('orca emulator')
  })
})
