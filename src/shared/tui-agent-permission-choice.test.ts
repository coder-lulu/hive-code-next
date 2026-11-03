import { describe, expect, it, vi } from 'vitest'
import {
  agentLaunchSettingsMutationUpdates,
  projectAgentLaunchSettings
} from './agent-launch-settings'
import { resolveTuiAgentLaunchArgs } from './tui-agent-launch-defaults'
import { applyAllAgentsPermission, resolveAgentPermission } from './tui-agent-permission-choice'
import { wholeAgentEnvironmentUpdates } from './agent-launch-permission-updates'
import * as startupShell from './tui-agent-startup-shell'
import * as launchCompiler from './agent-session-option-launch'

// Current writes never migrate permission grants from command or environment text.
describe('current terminal permission choices', () => {
  it.each(['own', 'ask', 'accept-edits', 'auto', 'full-access'] as const)(
    'persists explicit %s while keeping agent overrides',
    (mode) => {
      const settings = {
        agentPermissionDefault: 'own' as const,
        agentPermissionOverrides: { codex: 'ask' as const }
      }
      const updates = agentLaunchSettingsMutationUpdates(
        settings,
        { type: 'permissions', mode },
        'linux'
      )
      expect(updates.agentPermissionDefault).toBe(mode)
      expect(resolveAgentPermission('codex', updates).choice).toBe('ask')
    }
  )
  it('Own injects no flag; Ask composes the current provider recipe', () => {
    expect(
      resolveTuiAgentLaunchArgs('claude', {
        agentPermissionDefault: 'own',
        agentDefaultArgs: { claude: '--model opus' }
      })
    ).toBe('--model opus')
    expect(resolveTuiAgentLaunchArgs('claude', { agentPermissionDefault: 'ask' })).toBe(
      '--permission-mode default'
    )
    expect(resolveTuiAgentLaunchArgs('codex', { agentPermissionDefault: 'ask' })).toBe(
      '-a on-request -s read-only -c approvals_reviewer=user'
    )
  })
  it('missing typed choice stays Own', () => {
    expect(resolveAgentPermission('claude', {})).toEqual({ choice: 'own', source: 'all' })
    expect(resolveTuiAgentLaunchArgs('claude', {})).toBe('')
  })
  it('Auto preserves unsupported agents previous choice', () => {
    const after = applyAllAgentsPermission({ agentPermissionDefault: 'full-access' }, 'auto')
    expect(resolveAgentPermission('claude', after).choice).toBe('auto')
    expect(resolveAgentPermission('gemini', after).choice).toBe('full-access')
  })
  it.each(['--dangerously-skip-permissions', '--permission-mode auto', ''])(
    'saving arguments %s never changes a typed grant',
    (value) => {
      const settings = { agentPermissionDefault: 'ask' as const }
      const updates = agentLaunchSettingsMutationUpdates(
        settings,
        { type: 'arguments', agent: 'claude', value },
        'linux'
      )
      expect(updates).not.toHaveProperty('agentPermissionDefault')
      expect(updates).not.toHaveProperty('agentPermissionOverrides')
      expect(resolveAgentPermission('claude', { ...settings, ...updates }).choice).toBe('ask')
    }
  )
  it('editing a Goose environment carrier never changes a typed grant', () => {
    const settings = {
      agentPermissionDefault: 'ask' as const,
      agentDefaultEnv: { goose: { GOOSE_MODE: 'auto', KEEP: '1' }, claude: { OTHER: '1' } }
    }
    for (const updates of [
      agentLaunchSettingsMutationUpdates(
        settings,
        { type: 'environment-remove', agent: 'goose', name: 'GOOSE_MODE' },
        'linux'
      ),
      wholeAgentEnvironmentUpdates(settings, 'goose', { GOOSE_MODE: 'auto' }, 'linux')
    ]) {
      expect(updates).not.toHaveProperty('agentPermissionDefault')
      expect(updates).not.toHaveProperty('agentPermissionOverrides')
      expect(updates.agentDefaultEnv?.claude).toEqual({ OTHER: '1' })
    }
  })
  it('uses execution-host environment case rules', () => {
    const settings = { agentDefaultEnv: { claude: { Path: 'old', KEEP: '1' } } }
    const mutation = {
      type: 'environment-set' as const,
      agent: 'claude' as const,
      name: 'PATH',
      value: 'new'
    }
    expect(
      agentLaunchSettingsMutationUpdates(settings, mutation, 'win32').agentDefaultEnv?.claude
    ).toEqual({ PATH: 'new', KEEP: '1' })
    expect(
      agentLaunchSettingsMutationUpdates(settings, mutation, 'linux').agentDefaultEnv?.claude
    ).toEqual({ Path: 'old', PATH: 'new', KEEP: '1' })
  })
  it.each([20, 200])('projects %s arguments/env entries without shell compilation', (count) => {
    const tokenize = vi.spyOn(startupShell, 'tokenizeStartupCommand')
    const compile = vi.spyOn(launchCompiler, 'resolveAgentSessionOptionLaunch')
    try {
      const settings = {
        agentPermissionDefault: 'ask' as const,
        agentDefaultArgs: { claude: '--model opus '.repeat(count) },
        agentDefaultEnv: {
          claude: Object.fromEntries(Array.from({ length: count }, (_, i) => [`K${i}`, 'private']))
        }
      }
      expect(projectAgentLaunchSettings(settings).environmentNames.claude).toHaveLength(count)
      expect(tokenize).not.toHaveBeenCalled()
      expect(compile).not.toHaveBeenCalled()
    } finally {
      vi.restoreAllMocks()
    }
  })
})
