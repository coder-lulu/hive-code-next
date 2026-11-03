import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from './constants'
import { DEFAULT_SOURCE_CONTROL_ACTION_COMMAND_TEMPLATES } from './source-control-ai-actions'
import {
  getDefaultSourceControlAiSettings,
  normalizeSourceControlAiSettings,
  resolveSourceControlAiEnabled,
  resolveSourceControlAiForOperation,
  resolveSourceControlAiInstructions
} from './source-control-ai'

describe('one current Source Control AI contract', () => {
  it('does not let a retired mirrored setting disable the current default', () => {
    const settings = getDefaultSettings('/current-profile')
    settings.sourceControlAi = undefined
    Reflect.set(settings, 'commitMessageAi', { enabled: false, agentId: 'custom' })
    expect(resolveSourceControlAiEnabled({ settings })).toBe(true)
  })

  it('keeps an explicit current opt-out and unrelated current recipes', () => {
    const settings = getDefaultSettings('/current-profile')
    settings.sourceControlAi = {
      ...getDefaultSourceControlAiSettings(),
      enabled: false,
      actions: {
        commitMessage: { agentId: 'codex', commandInputTemplate: 'Current {basePrompt}' },
        pullRequest: { commandInputTemplate: 'Review {basePrompt}' }
      }
    }
    Reflect.set(settings, 'commitMessageAi', { enabled: true, agentId: 'claude' })
    expect(resolveSourceControlAiEnabled({ settings })).toBe(false)
    expect(normalizeSourceControlAiSettings(settings.sourceControlAi).actions).toMatchObject(
      settings.sourceControlAi.actions!
    )
  })

  it('does not import retired launch defaults or publish unknown mirrored fields', () => {
    const value = { ...getDefaultSourceControlAiSettings(), actions: undefined }
    Reflect.set(value, 'launchActionDefaults', {
      commitMessage: { agentId: 'codex', commandInputTemplate: 'Retired template' }
    })
    Reflect.set(value, 'retiredMirror', true)
    const current = normalizeSourceControlAiSettings(value)
    expect(current.actions!.commitMessage!.commandInputTemplate).toBe(
      DEFAULT_SOURCE_CONTROL_ACTION_COMMAND_TEMPLATES.commitMessage
    )
    expect(current).not.toHaveProperty('launchActionDefaults')
    expect(current).not.toHaveProperty('retiredMirror')
  })

  it('cannot select a model from a retired mirrored host catalog', () => {
    const settings = getDefaultSettings('/current-profile')
    settings.sourceControlAi = { ...getDefaultSourceControlAiSettings(), agentId: 'codex' }
    Reflect.set(settings, 'commitMessageAi', {
      selectedModelByAgentByHost: { remote: { codex: 'retired-model' } },
      discoveredModelsByAgentByHost: {
        remote: { codex: [{ id: 'retired-model', label: 'Retired' }] }
      }
    })
    const result = resolveSourceControlAiForOperation({
      settings,
      operation: 'commitMessage',
      discoveryHostKey: 'remote'
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.params.model).not.toBe('retired-model')
  })

  it('keeps current instructions, an explicit repo reset and a custom recipe', () => {
    const settings = getDefaultSettings('/current-profile')
    settings.sourceControlAi = {
      ...getDefaultSourceControlAiSettings(),
      agentId: 'codex',
      instructionsByOperation: { commitMessage: 'Current instruction' },
      actions: {
        commitMessage: {
          commandInputTemplate: 'Custom {basePrompt}',
          agentArgs: '--literal-user-arg'
        }
      }
    }
    expect(resolveSourceControlAiInstructions({ settings, operation: 'commitMessage' })).toBe(
      'Current instruction'
    )
    expect(
      resolveSourceControlAiInstructions({
        settings,
        operation: 'commitMessage',
        repo: { sourceControlAi: { instructionsByOperation: { commitMessage: '' } } }
      })
    ).toBe('')
    const result = resolveSourceControlAiForOperation({ settings, operation: 'commitMessage' })
    expect(result.ok).toBe(true)
    if (result.ok)
      expect(result.value.params).toMatchObject({
        customPrompt: 'Current instruction',
        commandInputTemplate: 'Custom {basePrompt}',
        agentArgs: '--literal-user-arg'
      })
  })

  it('cannot borrow local model discovery or selection for a remote host', () => {
    const settings = getDefaultSettings('/current-profile')
    settings.sourceControlAi = {
      ...getDefaultSourceControlAiSettings(),
      agentId: 'codex',
      selectedModelByAgent: { codex: 'local-only-model' },
      discoveredModelsByAgent: { codex: [{ id: 'local-only-model', label: 'Local only' }] }
    }
    const result = resolveSourceControlAiForOperation({
      settings,
      operation: 'commitMessage',
      discoveryHostKey: 'remote'
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.params.model).not.toBe('local-only-model')
  })
})
