import { describe, expect, it } from 'vitest'
import type { DiscoveredSkill } from '../../shared/skills'
import {
  AGENT_SKILL_SELECTOR_AMBIGUOUS_CODE,
  AGENT_SKILL_SELECTOR_NOT_FOUND_CODE
} from '../../shared/agent-skill-sharing-contract'
import { selectDiscoveredSkills } from './agent-skill-selection'

function skill(id: string, name: string): DiscoveredSkill {
  return {
    id,
    name,
    description: null,
    providers: ['agent-skills'],
    sourceKind: 'home',
    sourceLabel: 'Shared',
    rootPath: '/skills',
    directoryPath: `/skills/${id}`,
    skillFilePath: `/skills/${id}/SKILL.md`,
    installed: true,
    updatedAt: null
  }
}

describe('agent skill selection', () => {
  it('keeps the first exact ID match ahead of an identically named skill', () => {
    const first = skill('selector', 'first')
    expect(
      selectDiscoveredSkills(
        [first, skill('selector', 'second'), skill('other', 'selector')],
        ['selector']
      )
    ).toEqual([first])
  })

  it('bounds discovery reads when selecting a large batch by name', () => {
    let reads = 0
    const entries = Array.from({ length: 100 }, (_, index) => {
      const entry = skill(`id-${index}`, `name-${index}`)
      return {
        ...entry,
        get name() {
          reads++
          return entry.name
        }
      }
    })
    expect(
      selectDiscoveredSkills(
        entries,
        entries.map((entry) => entry.name)
      )
    ).toHaveLength(100)
    expect(reads).toBeLessThanOrEqual(entries.length * 6)
  })

  it('accepts exact IDs and unambiguous names while deduplicating repeats', () => {
    expect(
      selectDiscoveredSkills(
        [skill('id-alpha', 'alpha'), skill('id-beta', 'beta')],
        ['alpha', 'id-beta', 'alpha']
      ).map((entry) => entry.id)
    ).toEqual(['id-alpha', 'id-beta'])
  })

  it('fails missing selectors with installed-list recovery', () => {
    expect(() => selectDiscoveredSkills([], ['missing'])).toThrow(
      expect.objectContaining({
        code: AGENT_SKILL_SELECTOR_NOT_FOUND_CODE,
        message: expect.stringContaining('hive skills installed')
      })
    )
  })

  it('requires an ID when names are ambiguous', () => {
    expect(() =>
      selectDiscoveredSkills([skill('one', 'same'), skill('two', 'same')], ['same'])
    ).toThrow(
      expect.objectContaining({
        code: AGENT_SKILL_SELECTOR_AMBIGUOUS_CODE,
        message: expect.stringContaining('hive skills installed')
      })
    )
  })

  it('rejects two exact IDs whose bundle folder names would collide', () => {
    expect(() =>
      selectDiscoveredSkills([skill('one', 'same'), skill('two', 'same')], ['one', 'two'])
    ).toThrow(expect.objectContaining({ code: AGENT_SKILL_SELECTOR_AMBIGUOUS_CODE }))
  })
})
