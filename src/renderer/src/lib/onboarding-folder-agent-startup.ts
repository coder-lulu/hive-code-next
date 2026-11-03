import { buildAgentStartupPlan } from '@/lib/tui-agent-startup'
import { tuiAgentToAgentKind } from '@/lib/telemetry'
import { isTuiAgentEnabled } from '../../../shared/tui-agent-selection'
import type { AgentStartedTelemetry } from '@/lib/worktree-startup-payload'
import type { StartupCommandDelivery } from '../../../shared/codex-startup-delivery'
import type { SleepingAgentLaunchConfig } from '../../../shared/agent-session-resume'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { OnboardingState } from '../../../shared/onboarding-state-types'
import type { TuiAgent } from '../../../shared/tui-agent'
import { resolveAgentStartupPlanInputs } from '../../../shared/agent-startup-plan-inputs'
import type { AgentStartupShell } from '../../../shared/tui-agent-startup-shell'

export type OnboardingFolderAgentStartup = {
  command: string
  env?: Record<string, string>
  launchConfig?: SleepingAgentLaunchConfig
  launchAgent?: TuiAgent
  startupCommandDelivery?: StartupCommandDelivery
  telemetry: AgentStartedTelemetry
}

function getClientPlatform(): NodeJS.Platform {
  if (navigator.userAgent.includes('Windows')) {
    return 'win32'
  }
  return navigator.userAgent.includes('Mac') ? 'darwin' : 'linux'
}

export function onboardingFolderDefaultAgent(settings: GlobalSettings | null): TuiAgent | null {
  const agent = settings?.defaultTuiAgent
  return agent && agent !== 'blank' && isTuiAgentEnabled(agent, settings?.disabledTuiAgents)
    ? agent
    : null
}

export function buildOnboardingFolderAgentStartup(
  settings: GlobalSettings | null,
  context?: { platform: NodeJS.Platform; shell?: AgentStartupShell; isRemote: boolean }
): OnboardingFolderAgentStartup | undefined {
  const agent = onboardingFolderDefaultAgent(settings)
  if (!settings || !agent) {
    return undefined
  }

  const startupPlan = buildAgentStartupPlan({
    ...resolveAgentStartupPlanInputs({
      agent,
      settings,
      platform: context?.platform ?? getClientPlatform(),
      shell: context?.shell,
      isRemote: context?.isRemote === true
    }),
    prompt: '',
    allowEmptyPromptLaunch: true
  })
  if (!startupPlan) {
    return undefined
  }

  return {
    command: startupPlan.launchCommand,
    ...(startupPlan.env ? { env: startupPlan.env } : {}),
    launchConfig: startupPlan.launchConfig,
    launchAgent: agent,
    ...(startupPlan.startupCommandDelivery
      ? { startupCommandDelivery: startupPlan.startupCommandDelivery }
      : {}),
    telemetry: {
      agent_kind: tuiAgentToAgentKind(agent),
      launch_source: 'onboarding',
      request_kind: 'new'
    }
  }
}

export function shouldSeedFolderAgentAfterDismissedOnboarding(
  onboarding: OnboardingState | null,
  hasExistingProject: boolean
): boolean {
  return (
    onboarding?.outcome === 'dismissed' &&
    !hasExistingProject &&
    !onboarding.checklist.addedRepo &&
    !onboarding.checklist.addedFolder
  )
}

export function buildDismissedOnboardingFolderAgentStartup(
  settings: GlobalSettings | null,
  onboarding: OnboardingState | null,
  hasExistingProject: boolean
): OnboardingFolderAgentStartup | undefined {
  if (!shouldSeedFolderAgentAfterDismissedOnboarding(onboarding, hasExistingProject)) {
    return undefined
  }
  return buildOnboardingFolderAgentStartup(settings)
}
