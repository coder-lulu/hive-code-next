import {
  AGENT_SKILL_SELECTOR_AMBIGUOUS_CODE,
  AGENT_SKILL_SELECTOR_NOT_FOUND_CODE,
  AgentSkillSharingError
} from '../../shared/agent-skill-sharing-contract'
import type { DiscoveredSkill } from '../../shared/skills'
import { PRIMARY_CLI_COMMAND } from '../../shared/brand'

export function selectDiscoveredSkills(
  skills: readonly DiscoveredSkill[],
  selectors: readonly string[]
): DiscoveredSkill[] {
  const ids = new Map<string, DiscoveredSkill>()
  const names = new Map<string, DiscoveredSkill[]>()
  for (const skill of skills) {
    if (!ids.has(skill.id)) {
      ids.set(skill.id, skill)
    }
    const name = skill.name
    const matches = names.get(name)
    if (matches) {
      matches.push(skill)
    } else {
      names.set(name, [skill])
    }
  }
  const selected = new Map<string, DiscoveredSkill>()
  for (const selector of selectors) {
    const exactId = ids.get(selector)
    if (exactId) {
      selected.set(exactId.id, exactId)
      continue
    }
    const named = names.get(selector) ?? []
    if (named.length === 0) {
      throw new AgentSkillSharingError(
        AGENT_SKILL_SELECTOR_NOT_FOUND_CODE,
        `Installed skill "${selector}" was not found. Run \`${PRIMARY_CLI_COMMAND} skills installed\` to list valid selectors.`,
        { selector }
      )
    }
    if (named.length > 1) {
      throw new AgentSkillSharingError(
        AGENT_SKILL_SELECTOR_AMBIGUOUS_CODE,
        `More than one installed skill is named "${selector}". Use its discovery ID from \`${PRIMARY_CLI_COMMAND} skills installed\`.`,
        { selector, matchingIds: named.map((skill) => skill.id) }
      )
    }
    selected.set(named[0].id, named[0])
  }
  const values = [...selected.values()]
  const byName = new Map<string, DiscoveredSkill[]>()
  for (const skill of values) {
    const name = skill.name
    const matches = byName.get(name)
    if (matches) {
      matches.push(skill)
    } else {
      byName.set(name, [skill])
    }
  }
  const collision = [...byName.entries()].find(([, named]) => named.length > 1)
  if (collision) {
    throw new AgentSkillSharingError(
      AGENT_SKILL_SELECTOR_AMBIGUOUS_CODE,
      `The selected skills include more than one installed skill named "${collision[0]}". Publish them in separate bundles.`,
      { selector: collision[0], matchingIds: collision[1].map((skill) => skill.id) }
    )
  }
  return values
}
