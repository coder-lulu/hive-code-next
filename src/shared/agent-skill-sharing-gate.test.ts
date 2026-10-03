import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from './constants'
import {
  AGENT_SKILL_SHARING_DISABLED_CODE,
  AGENT_SKILL_SHARING_DISABLED_MESSAGE,
  AGENT_SKILL_SHARING_DISABLED_NEXT_STEPS,
  assertAgentSkillSharingAllowed,
  isAgentSkillSharingEnabled
} from './agent-skill-sharing-gate'

describe('agent skill sharing gate', () => {
  it('defaults off', () => {
    expect(isAgentSkillSharingEnabled(getDefaultSettings('/tmp'))).toBe(false)
  })

  it('only grants an exact true boolean', () => {
    expect(isAgentSkillSharingEnabled({ agentSkillSharingEnabled: true })).toBe(true)
    expect(isAgentSkillSharingEnabled({ agentSkillSharingEnabled: false })).toBe(false)
    expect(isAgentSkillSharingEnabled({ agentSkillSharingEnabled: 'yes' as never })).toBe(false)
    expect(isAgentSkillSharingEnabled({ agentSkillSharingEnabled: 1 as never })).toBe(false)
  })

  it('throws a structured recovery error when disabled', () => {
    expect(() => assertAgentSkillSharingAllowed(() => false)).toThrow(
      expect.objectContaining({ code: AGENT_SKILL_SHARING_DISABLED_CODE })
    )
  })

  it('uses HiveCode branding in user-facing recovery copy', () => {
    const copy = [AGENT_SKILL_SHARING_DISABLED_MESSAGE, ...AGENT_SKILL_SHARING_DISABLED_NEXT_STEPS]
    expect(copy.join('\n')).toContain('HiveCode')
    expect(copy.join('\n')).not.toContain('Orca')
  })
})
