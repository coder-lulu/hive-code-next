import { describe, expect, it } from 'vitest'
import {
  agentChatPermissionModes,
  chatModelSupportsAutoMode,
  offeredChatPermissionModes,
  newChatPermissionModeForSettings
} from './agent-chat-permission-mode'
import { normalizeAgentPermissionOverrides } from './tui-agent-permission-choice'

describe('current permission policy', () => {
  it('does not derive a current grant from old global mode or command arguments', () => {
    const settings = Object.assign(
      { agentPermissionDefault: undefined },
      {
        nativeChatPermissionMode: 'full-access',
        agentDefaultArgs: { claude: '--dangerously-skip-permissions' }
      }
    )
    expect(newChatPermissionModeForSettings('claude', settings)).toBe('own')
    expect(newChatPermissionModeForSettings('claude', { agentPermissionDefault: 'ask' })).toBe(
      'ask'
    )
    expect(
      newChatPermissionModeForSettings('claude', {
        agentPermissionDefault: 'ask',
        agentPermissionOverrides: { claude: 'own' }
      })
    ).toBe('own')
  })

  it('accepts only current agents and permission choices in overrides', () => {
    expect(
      normalizeAgentPermissionOverrides({
        codex: 'auto',
        claude: 'invented',
        unrelated: 'full-access'
      })
    ).toEqual({ codex: 'auto' })
  })

  it('offers Claude Auto only with positive current model support', () => {
    const support = agentChatPermissionModes('claude')!
    expect(chatModelSupportsAutoMode([], 'default')).toBe(false)
    expect(offeredChatPermissionModes(support, false)).not.toContain('auto')
    expect(
      chatModelSupportsAutoMode(
        [{ id: 'current', isDefault: true, supportsAutoMode: true }],
        'default'
      )
    ).toBe(true)
    expect(offeredChatPermissionModes(support, true)).toContain('auto')
  })
})
