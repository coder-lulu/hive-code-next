import type {
  DiscoveredSkill,
  SkillDiscoveryResult,
  SkillDiscoverySource
} from '../../../shared/skills'

export function skill(overrides: Partial<DiscoveredSkill>): DiscoveredSkill {
  return {
    id: 'skill-1',
    name: 'Example Skill',
    description: null,
    providers: ['agent-skills'],
    sourceKind: 'home',
    sourceLabel: 'Agent skills home',
    rootPath: '/Users/test/.agents/skills',
    directoryPath: '/Users/test/.agents/skills/example-skill',
    skillFilePath: '/Users/test/.agents/skills/example-skill/SKILL.md',
    installed: true,
    updatedAt: null,
    ...overrides
  }
}

export function discoveryResult(
  skills: DiscoveredSkill[] = [],
  sources: SkillDiscoverySource[] = []
): SkillDiscoveryResult {
  return {
    skills,
    sources,
    scannedAt: Date.now()
  }
}

/** A root the host could not read: it reports `exists` because it cannot prove otherwise. */
export function unavailableSource(
  overrides: Partial<SkillDiscoverySource> = {}
): SkillDiscoverySource {
  return {
    id: 'home',
    label: 'Agent skills home',
    path: '/Users/test/.agents/skills',
    sourceKind: 'home',
    providers: ['agent-skills'],
    owner: null,
    exists: true,
    skippedReason: 'unavailable',
    ...overrides
  }
}
