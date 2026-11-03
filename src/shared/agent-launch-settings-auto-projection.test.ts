import { describe, expect, it } from 'vitest'
import {
  agentLaunchSettingsMutationUpdates,
  projectAgentLaunchSettings
} from './agent-launch-settings'
import { AGENT_PERMISSION_CHOICES } from './tui-agent-permission-choice'

describe('typed agent launch permission projection', () => {
  it.each(AGENT_PERMISSION_CHOICES)(
    'publishes explicit %s without legacy projection markers',
    (choice) => {
      const settings = projectAgentLaunchSettings({ agentPermissionDefault: choice })
      expect(settings.agentPermissionDefault).toBe(choice)
      expect(settings).not.toHaveProperty('permissionMode')
      expect(settings).not.toHaveProperty('autoPermissionMode')
      expect(settings).not.toHaveProperty('nonAutoPermissionMode')
    }
  )

  it('does not infer a global permission grant from custom terminal arguments', () => {
    const settings = projectAgentLaunchSettings({
      agentPermissionDefault: 'own',
      agentDefaultArgs: { codex: '--approve-for-me', claude: '--model sonnet' }
    })
    expect(settings.agentPermissionDefault).toBe('own')
    expect(settings.agentPermissionOverrides).toEqual({})
    expect(settings.agentDefaultArgs.codex).toBe('--approve-for-me')
  })

  it('keeps explicitly scoped agent policies when selecting global Auto', () => {
    const updates = agentLaunchSettingsMutationUpdates(
      {
        agentPermissionDefault: 'ask',
        agentPermissionOverrides: { codex: 'own', claude: 'full-access' }
      },
      { type: 'permissions', mode: 'auto' },
      'darwin'
    )
    expect(updates.agentPermissionDefault).toBe('auto')
    expect(updates.agentPermissionOverrides).toMatchObject({ codex: 'own', claude: 'full-access' })
    expect(updates).not.toHaveProperty('agentDefaultArgs')
    expect(updates).not.toHaveProperty('agentDefaultEnv')
  })

  it('resets only the selected agent override to the global policy', () => {
    const updates = agentLaunchSettingsMutationUpdates(
      { agentPermissionDefault: 'auto', agentPermissionOverrides: { codex: 'own', claude: 'ask' } },
      { type: 'permissions', agent: 'codex', mode: 'default' },
      'darwin'
    )
    expect(updates).toEqual({ agentPermissionOverrides: { claude: 'ask' } })
  })
})
