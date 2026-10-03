import { describe, expect, it } from 'vitest'
import { formatSkillShareLink, parseSkillShareId } from './skill-share-link'

describe('parseSkillShareId', () => {
  it('formats and accepts the current HiveCode link', () => {
    expect(formatSkillShareLink('share_123')).toBe('hivecode://skills/share/share_123')
    expect(parseSkillShareId('hivecode://skills/share/share_123')).toBe('share_123')
  })

  it('accepts legacy links and bare identifiers for compatibility', () => {
    expect(parseSkillShareId('share_123')).toBe('share_123')
    expect(parseSkillShareId('https://app.orca.dev/skills/share/share_123')).toBe('share_123')
    expect(parseSkillShareId('https://share.onorca.dev/skills/share/share_123/')).toBe('share_123')
    expect(parseSkillShareId('orca://skills/share/share_123')).toBe('share_123')
  })

  it('rejects attacker origins and lookalike paths', () => {
    expect(parseSkillShareId('https://attacker.test/skills/share/share_123')).toBeNull()
    expect(parseSkillShareId('https://app.orca.dev/skills/share/share_123/more')).toBeNull()
    expect(parseSkillShareId('javascript:share_123')).toBeNull()
    expect(() => formatSkillShareLink('../share_123')).toThrow('skill-share-id-invalid')
  })
})
