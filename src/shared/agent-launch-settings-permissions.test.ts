import { expect, it } from 'vitest'
import { agentLaunchSettingsMutationUpdates } from './agent-launch-settings'
import { structuredLaunchSeedOptions } from './native-chat/input/native-chat-session-option-defaults'
import { AgentLaunchSettingsMutation } from './rpc-contract/agent-launch-settings-params'

it.each(['own', 'ask', 'accept-edits', 'auto', 'full-access'] as const)(
  'typed %s permission updates seed new chats',
  (mode) => {
    const before = { agentPermissionDefault: 'own' as const }
    const mutation = AgentLaunchSettingsMutation.parse({ type: 'permissions', mode })
    const after = { ...before, ...agentLaunchSettingsMutationUpdates(before, mutation, 'linux') }
    for (const agent of ['claude', 'codex'] as const) {
      expect(structuredLaunchSeedOptions(after, agent)).toEqual({
        permissionMode: agent === 'codex' && mode === 'accept-edits' ? 'ask' : mode
      })
    }
  }
)
it.each([
  { type: 'permission', choice: 'full-access' },
  { type: 'permissions', mode: 'yolo' },
  { type: 'permissions', mode: 'manual' },
  { type: 'permissions', mode: 'ask', syncNativeChat: true }
])('rejects retired writes %j', (mutation) => {
  expect(AgentLaunchSettingsMutation.safeParse(mutation).success).toBe(false)
})
