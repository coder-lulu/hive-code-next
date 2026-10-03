import type { DiscoveredSkill, SkillDiscoverySource, SkillSourceKind } from '../../../shared/skills'

type InstalledAgentSkillMatchOptions = {
  sourceKinds?: readonly SkillSourceKind[]
}

function normalizeSkillName(value: string): string {
  return value.trim().toLowerCase()
}

function basenameFromPath(pathValue: string): string {
  return pathValue.split(/[\\/]/).findLast(Boolean) ?? pathValue
}

export function hasInstalledAgentSkill(
  skills: readonly DiscoveredSkill[],
  skillName: string,
  options: InstalledAgentSkillMatchOptions = {}
): boolean {
  return hasInstalledAgentSkillNamed(skills, [skillName], options)
}

export function hasInstalledAgentSkillNamed(
  skills: readonly DiscoveredSkill[],
  skillNames: readonly string[],
  options: InstalledAgentSkillMatchOptions = {}
): boolean {
  const expected = new Set(skillNames.map(normalizeSkillName))
  return skills.some((skill) => {
    if (!skill.installed) {
      return false
    }
    if (options.sourceKinds && !options.sourceKinds.includes(skill.sourceKind)) {
      return false
    }
    return (
      expected.has(normalizeSkillName(skill.name)) ||
      expected.has(normalizeSkillName(basenameFromPath(skill.directoryPath)))
    )
  })
}

/**
 * True when a root this query cares about did not answer, so its skills are
 * unknown rather than absent. The host serves such a root's last answer, but a
 * root that has never answered has none to serve, and a bare "Not installed"
 * there offers Install for a skill that may already be present.
 */
export function hasUnreadableAgentSkillSource(
  sources: readonly SkillDiscoverySource[],
  sourceKinds?: readonly SkillSourceKind[]
): boolean {
  return sources.some(
    (source) =>
      source.skippedReason === 'unavailable' &&
      (!sourceKinds || sourceKinds.includes(source.sourceKind))
  )
}
