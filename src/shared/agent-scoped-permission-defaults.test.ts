import { describe, expect, it } from 'vitest'
import { agentLaunchSettingsMutationUpdates } from './agent-launch-settings'
import { structuredLaunchSeedOptions } from './native-chat/input/native-chat-session-option-defaults'
import { resolveTuiAgentLaunchArgs } from './tui-agent-launch-defaults'
import { AgentLaunchSettingsMutation } from './rpc-contract/agent-launch-settings-params'

const settings = {
  agentPermissionDefault: 'full-access' as const,
  nativeChatPermissionMode: 'ask' as const
}

describe('one permission for terminals and new chats', () => {
  it('uses a scoped typed mutation for both surfaces without storing a chat copy', () => {
    const mutation = AgentLaunchSettingsMutation.parse({
      type: 'permissions',
      agent: 'codex',
      mode: 'auto'
    })
    const updates = agentLaunchSettingsMutationUpdates(settings, mutation, 'linux')
    const after = { ...settings, ...updates }
    expect(resolveTuiAgentLaunchArgs('codex', after)).toBe('--approve-for-me')
    expect(structuredLaunchSeedOptions(after, 'codex')).toEqual({ permissionMode: 'auto' })
    expect(structuredLaunchSeedOptions(after, 'claude')).toEqual({ permissionMode: 'full-access' })
    expect(updates).not.toHaveProperty('agentNativeChatPermissionModes')
    expect(updates).not.toHaveProperty('nativeChatPermissionMode')
  })

  it('own sends no terminal flag and seeds delegation without changing saved model options', () => {
    const after = {
      ...settings,
      ...agentLaunchSettingsMutationUpdates(
        settings,
        { type: 'permissions', agent: 'codex', mode: 'own' },
        'linux'
      )
    }
    expect(resolveTuiAgentLaunchArgs('codex', after)).toBe('')
    expect(structuredLaunchSeedOptions(after, 'codex')).toEqual({ permissionMode: 'own' })
    expect(structuredLaunchSeedOptions(after, 'pi')).toBeUndefined()
    expect(after).not.toHaveProperty('nativeChatSessionOptions')
  })
})

it('scoped reset removes only the requested override and immediately follows the global choice', () => {
  const before = {
    agentPermissionDefault: 'ask' as const,
    agentPermissionOverrides: { claude: 'full-access' as const, codex: 'own' as const }
  }
  const mutation = AgentLaunchSettingsMutation.parse({
    type: 'permissions',
    agent: 'claude',
    mode: 'default'
  })
  const after = { ...before, ...agentLaunchSettingsMutationUpdates(before, mutation, 'linux') }
  expect(after.agentPermissionOverrides).toEqual({ codex: 'own' })
  expect(structuredLaunchSeedOptions(after, 'claude')).toEqual({ permissionMode: 'ask' })
})
it.each([
  { type: 'permissions', mode: 'default' },
  { type: 'permissions', agent: 'unknown', mode: 'ask' },
  { type: 'permissions', agent: 'gemini', mode: 'auto' },
  { type: 'permissions', agent: 'claude', mode: 'yolo' },
  { type: 'permissions', mode: 'ask', exceptAuto: true }
])('rejects invalid scoped writes %j', (mutation) => {
  expect(AgentLaunchSettingsMutation.safeParse(mutation).success).toBe(false)
})

it('rejects invalid direct mutations before producing any settings updates', () => {
  expect(() =>
    agentLaunchSettingsMutationUpdates(settings, { type: 'permissions', mode: 'default' }, 'linux')
  ).toThrow('Choose a permission')
  expect(() =>
    agentLaunchSettingsMutationUpdates(
      settings,
      { type: 'permissions', agent: 'gemini', mode: 'auto' },
      'linux'
    )
  ).toThrow('Unsupported agent permission')
})
