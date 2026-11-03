import { ORCA_LINEAR_SKILL_INSTALL_COMMAND } from '@/lib/agent-feature-install-commands'
import { buildSkillCommandForRuntime } from './CliSkillRuntimeSetup'
import {
  ensureOrcaCliAvailableForAgentSkillTerminal,
  isOrcaCliAvailableOnPath
} from '@/lib/agent-skill-cli-prerequisite'
import {
  ensureWslCliAvailableForAgentSkillTerminal,
  getWslCliDistroRequest
} from './CliSkillRuntimeSetup'
import { translate } from '@/i18n/i18n'
import { useCallback, useMemo } from 'react'
import { LINEAR_AGENT_SKILL_NAMES } from '@/lib/agent-feature-skill-names'
import { getLinearAgentSkillUpdateTarget } from '@/lib/linear-agent-skill-update-command'
import {
  GLOBAL_AGENT_SKILL_SOURCE_KINDS,
  useInstalledAgentSkillNames
} from '@/hooks/useInstalledAgentSkills'
import { useActiveProjectSkillRuntime } from '@/hooks/useActiveProjectSkillRuntime'

export function useLinearAgentSkillSetup(): {
  // Legacy-only installs update the legacy name.
  updateSkillName: string
  installCommand: string
  updateCommand: string
  freshnessSkillName: string | undefined
  skillInstalled: boolean
  skillLoading: boolean
  // Keep known status through focus rescans instead of flashing Checking.
  skillChecking: boolean
  /** The scan could not vouch for "not installed", so no surface may claim it. */
  skillUnverifiable: boolean
  installDisabled: boolean
  error: string | null
  preInstallNotice: string
  getPrerequisiteStatus: () => Promise<Awaited<ReturnType<typeof window.api.cli.getInstallStatus>>>
  onBeforeOpenTerminal: () => Promise<void>
  refreshSkill: () => Promise<boolean>
} {
  const activeSkillRuntime = useActiveProjectSkillRuntime()
  const {
    installed: skillInstalled,
    loading: skillLoading,
    settled: skillSettled,
    installedUnverifiable: skillUnverifiable,
    error: skillError,
    skills: linearSkills,
    refresh: refreshSkill
  } = useInstalledAgentSkillNames(LINEAR_AGENT_SKILL_NAMES, {
    discoveryTarget: activeSkillRuntime.discoveryTarget,
    sourceKinds: GLOBAL_AGENT_SKILL_SOURCE_KINDS
  })

  const updateTarget = useMemo(
    () => getLinearAgentSkillUpdateTarget(linearSkills, skillInstalled),
    [linearSkills, skillInstalled]
  )
  // Freshness cannot verify WSL, so report presence there.
  const freshnessSkillName = activeSkillRuntime.canUseSkillFreshness
    ? updateTarget.skillName
    : undefined

  const getPrerequisiteStatus = useCallback(async () => {
    if (activeSkillRuntime.discoveryRuntimeTarget?.kind === 'environment') {
      throw new Error('CLI registration must be verified on the selected host.')
    }
    return activeSkillRuntime.agentRuntime?.runtime === 'wsl'
      ? window.api.cli.getWslInstallStatus(getWslCliDistroRequest(activeSkillRuntime.agentRuntime))
      : window.api.cli.getInstallStatus()
  }, [activeSkillRuntime.agentRuntime, activeSkillRuntime.discoveryRuntimeTarget])
  const onBeforeOpenTerminal = useCallback(async () => {
    // Never register this computer's CLI for a different selected host.
    await getPrerequisiteStatus()
    await (activeSkillRuntime.agentRuntime?.runtime === 'wsl'
      ? ensureWslCliAvailableForAgentSkillTerminal(activeSkillRuntime.agentRuntime)
      : ensureOrcaCliAvailableForAgentSkillTerminal())
    if (!isOrcaCliAvailableOnPath(await getPrerequisiteStatus())) {
      throw new Error('CLI registration is unavailable.')
    }
  }, [activeSkillRuntime.agentRuntime, getPrerequisiteStatus])
  const installDisabled = Boolean(activeSkillRuntime.installDisabledReason)

  return {
    preInstallNotice: translate(
      'auto.components.settings.linearSkill.cliPrerequisite',
      'Register the CLI on the selected host before installing agent skills.'
    ),
    getPrerequisiteStatus,
    onBeforeOpenTerminal,
    updateSkillName: updateTarget.skillName,
    installCommand: buildSkillCommandForRuntime(
      ORCA_LINEAR_SKILL_INSTALL_COMMAND,
      activeSkillRuntime.agentRuntime
    ),
    updateCommand: buildSkillCommandForRuntime(
      updateTarget.command,
      activeSkillRuntime.agentRuntime
    ),
    freshnessSkillName,
    skillInstalled,
    skillLoading,
    skillChecking: skillLoading && !skillSettled,
    skillUnverifiable,
    installDisabled,
    error: activeSkillRuntime.installDisabledReason ?? skillError,
    refreshSkill
  }
}
