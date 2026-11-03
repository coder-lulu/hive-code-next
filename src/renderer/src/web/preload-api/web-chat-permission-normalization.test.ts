import { expect, it } from 'vitest'
import { mergeSettings, runtimeChatPermissionSetting } from './web-preference-normalization'
import { getDefaultSettings } from '../../../../shared/constants'
import { resolveAgentPermission } from '../../../../shared/tui-agent-permission-choice'

it.each([
  '--dangerously-skip-permissions --model sonnet',
  '',
  '--permission-mode plan --model sonnet'
])('preserves browser Arguments as raw text without deriving grants: %s', (args) => {
  const base = getDefaultSettings('~')
  const loaded = mergeSettings(base, {
    agentDefaultArgs: { claude: args },
    agentDefaultEnv: { goose: { GOOSE_MODE: 'auto', NOTE: 'raw' } }
  })
  expect(loaded.agentDefaultArgs?.claude).toBe(args)
  expect(loaded.agentDefaultEnv?.goose).toEqual({ GOOSE_MODE: 'auto', NOTE: 'raw' })
  expect(resolveAgentPermission('claude', loaded).choice).toBe(
    resolveAgentPermission('claude', base).choice
  )
  expect(resolveAgentPermission('goose', loaded).choice).toBe(
    resolveAgentPermission('goose', base).choice
  )
  expect(mergeSettings(loaded, {})).toEqual(loaded)
})
it('projects only the current typed permission authority', () => {
  expect(runtimeChatPermissionSetting({ nativeChatPermissionMode: 'ask' })).toEqual({})
  expect(
    runtimeChatPermissionSetting({
      agentPermissionDefault: 'ask',
      agentPermissionOverrides: { claude: 'own' }
    })
  ).toEqual({ agentPermissionDefault: 'ask', agentPermissionOverrides: { claude: 'own' } })
})
