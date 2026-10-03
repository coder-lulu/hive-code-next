import type { SkillFreshnessInventory } from '../../../shared/skill-freshness'
import type { DiscoveredSkill } from '../../../shared/skills'
import type { SettingsNavInstallStatus } from './settings-navigation-types'
import { getLinearAgentSkillUpdateTarget } from './linear-agent-skill-update-command'
import { getSkillFreshnessDisplayStatus } from './skill-freshness-display-status'

type AgentSkillNavInstallStatusInput = {
  name: string
  installed: boolean
  loading: boolean
  error?: string | null
  inventory: SkillFreshnessInventory | null
}

export function getAgentSkillNavInstallStatus({
  name,
  installed,
  loading,
  error,
  inventory
}: AgentSkillNavInstallStatusInput): SettingsNavInstallStatus {
  if (loading) {
    return 'checking'
  }
  if (error) {
    return 'needs-attention'
  }
  if (!installed) {
    return 'install'
  }
  return getSkillFreshnessDisplayStatus(inventory, name)
}

export function getLinearAgentSkillNavInstallStatus(
  input: Omit<AgentSkillNavInstallStatusInput, 'name'> & {
    skills: readonly DiscoveredSkill[]
  }
): SettingsNavInstallStatus {
  // Why: the sidebar must evaluate the same installed name the card will update,
  // including legacy-only linear-tickets installs.
  const updateTarget = getLinearAgentSkillUpdateTarget(input.skills, input.installed)
  return getAgentSkillNavInstallStatus({ ...input, name: updateTarget.skillName })
}

export function getAgentCapabilitiesNavInstallStatus(
  statuses: readonly SettingsNavInstallStatus[]
): SettingsNavInstallStatus {
  if (statuses.includes('needs-attention')) {
    return 'needs-attention'
  }
  if (statuses.includes('update-available')) {
    return 'update-available'
  }
  if (statuses.includes('checking')) {
    return 'checking'
  }
  if (statuses.includes('install')) {
    return 'install'
  }
  if (statuses.includes('up-to-date')) {
    return 'up-to-date'
  }
  return 'installed'
}
