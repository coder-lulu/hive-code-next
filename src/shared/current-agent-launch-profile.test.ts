import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from './constants'
import {
  resolveTuiAgentLaunchArgs,
  resolveTuiAgentLaunchEnv,
  resolveResumeLaunchRecipe
} from './tui-agent-launch-defaults'

describe('one current launch profile', () => {
  it('adds no bypass arguments or environment for the provider-own default', () => {
    const settings = getDefaultSettings('/hive-current-profile')
    expect(settings.agentPermissionDefault).toBe('own')
    expect(resolveTuiAgentLaunchArgs('claude', settings)).toBe('')
    expect(resolveTuiAgentLaunchEnv('goose', settings)).toEqual({})
    expect(resolveTuiAgentLaunchArgs('claude', undefined)).toBe('')
    expect(resolveTuiAgentLaunchEnv('goose', undefined)).toEqual({})
  })

  it('preserves explicit user arguments and environment in the current profile', () => {
    const settings = getDefaultSettings('/hive-current-profile')
    settings.agentDefaultArgs = { claude: '--model current-model' }
    settings.agentDefaultEnv = { claude: { USER_CHOICE: 'kept' } }
    expect(resolveTuiAgentLaunchArgs('claude', settings)).toBe('--model current-model')
    expect(resolveTuiAgentLaunchEnv('claude', settings)).toEqual({ USER_CHOICE: 'kept' })
  })

  it('applies an explicit typed Ask recipe without built-in bypass defaults', () => {
    const settings = getDefaultSettings('/hive-current-profile')
    settings.agentPermissionDefault = 'ask'
    settings.agentDefaultArgs = {}
    settings.agentDefaultEnv = {}
    const args = resolveTuiAgentLaunchArgs('claude', settings)
    expect(args).toContain('--permission-mode default')
    expect(args).not.toContain('--dangerously-skip-permissions')
    expect(resolveTuiAgentLaunchEnv('goose', settings)).toEqual({})
  })

  it('requires the exact saved recipe and preserves its host authority and one-launch choice', () => {
    expect(() => resolveResumeLaunchRecipe(undefined)).toThrow('Saved launch recipe is unavailable')
    const saved = {
      agentArgs: '--model saved',
      agentEnv: { USER_CHOICE: 'saved' },
      hostDefaultsAuthoritative: true as const,
      agentPermissionMode: 'manual' as const
    }
    const recipe = resolveResumeLaunchRecipe(saved)
    expect(recipe).toEqual(saved)
    recipe.agentEnv.USER_CHOICE = 'changed'
    expect(saved.agentEnv.USER_CHOICE).toBe('saved')
  })
})
