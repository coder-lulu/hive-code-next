import { describe, expect, it, vi } from 'vitest'
import { getDefaultPersistedState } from '../../../shared/constants'
import { updateSettings } from './settings-update'
import { DEFAULT_SOURCE_CONTROL_ACTION_COMMAND_TEMPLATES } from '../../../shared/source-control-ai-actions'

describe('current settings write policy', () => {
  it('cannot infer consent from malformed input or retain a cohort field', () => {
    const state = getDefaultPersistedState('/hive-current-profile')
    state.settings.telemetry = { optedIn: false, installId: 'recorded-install' }
    const operations = {
      state,
      bumpLocalWorktreeScanGeneration: vi.fn(),
      removeRetainedBlob: vi.fn(),
      scheduleSave: vi.fn(),
      notifySettingsChanged: vi.fn()
    }
    const updates = { telemetry: { optedIn: false, installId: '' } }
    Reflect.set(updates.telemetry, 'optedIn', 'enabled')
    Reflect.set(updates.telemetry, 'existedBeforeTelemetryRelease', true)
    const result = updateSettings(operations, updates, { notifyListeners: true })
    expect(result.telemetry).toEqual({ optedIn: false, installId: 'recorded-install' })
    expect(operations.notifySettingsChanged).toHaveBeenCalledExactlyOnceWith(
      { telemetry: { optedIn: false, installId: 'recorded-install' } },
      undefined
    )
  })

  it('normalizes per-agent view choices before persistence and publication', () => {
    const operations = {
      state: getDefaultPersistedState('/hive-current-profile'),
      bumpLocalWorktreeScanGeneration: vi.fn(),
      removeRetainedBlob: vi.fn(),
      scheduleSave: vi.fn(),
      notifySettingsChanged: vi.fn()
    }
    const updates = { nativeChatProviders: { claude: true, codex: false } }
    Reflect.set(updates.nativeChatProviders, 'opencode', 'enabled')
    Reflect.set(updates.nativeChatProviders, 'unknownAgent', true)
    const result = updateSettings(operations, updates, { notifyListeners: true })
    expect(result.nativeChatProviders).toEqual({ claude: true, codex: false })
    expect(operations.notifySettingsChanged).toHaveBeenCalledExactlyOnceWith(
      { nativeChatProviders: { claude: true, codex: false } },
      undefined
    )
  })

  it('writes current choices without producing rollout metadata', () => {
    const state = getDefaultPersistedState('/hive-current-profile')
    const operations = {
      state,
      bumpLocalWorktreeScanGeneration: vi.fn(),
      removeRetainedBlob: vi.fn(),
      scheduleSave: vi.fn(),
      notifySettingsChanged: vi.fn()
    }
    const result = updateSettings(operations, {
      terminalCursorStyle: 'bar',
      terminalTuiScrollSensitivity: 3,
      autoRenameBranchFromWork: false,
      visibleTaskProviders: ['github'],
      agentDefaultArgs: { claude: '--custom-current-arg' }
    })
    expect(result).toMatchObject({ terminalCursorStyle: 'bar', autoRenameBranchFromWork: false })
    expect(Object.keys(result).filter((key) => /Migrat|Defaulted/i.test(key))).toEqual([])
    expect(operations.scheduleSave).toHaveBeenCalledOnce()
  })

  it('discards unknown input without publishing it to settings listeners', () => {
    const operations = {
      state: getDefaultPersistedState('/hive-current-profile'),
      bumpLocalWorktreeScanGeneration: vi.fn(),
      removeRetainedBlob: vi.fn(),
      scheduleSave: vi.fn(),
      notifySettingsChanged: vi.fn()
    }
    const updates = Object.assign(
      { terminalScrollbackRows: 4321 },
      { experimentalSidekick: true, opencodeGoApiKey: ['retired', 'fixture'].join('-') }
    )
    const result = updateSettings(operations, updates, { notifyListeners: true })
    expect(result).toHaveProperty('terminalScrollbackRows', 4321)
    expect(result).not.toHaveProperty('experimentalSidekick')
    expect(result).not.toHaveProperty('opencodeGoApiKey')
    expect(operations.notifySettingsChanged).toHaveBeenCalledExactlyOnceWith(
      { terminalScrollbackRows: 4321 },
      undefined
    )
  })

  it('keeps an explicit source-control recipe reset cleared', () => {
    const state = getDefaultPersistedState('/hive-current-profile')
    const previous = state.settings.sourceControlAi!
    previous.instructionsByOperation.commitMessage = 'My custom commit instruction'
    previous.actions!.commitMessage = { commandInputTemplate: 'My custom command' }
    const operations = {
      state,
      bumpLocalWorktreeScanGeneration: vi.fn(),
      removeRetainedBlob: vi.fn(),
      scheduleSave: vi.fn(),
      notifySettingsChanged: vi.fn()
    }
    const result = updateSettings(operations, {
      sourceControlAi: {
        ...previous,
        actions: {
          ...previous.actions,
          commitMessage: {
            commandInputTemplate: DEFAULT_SOURCE_CONTROL_ACTION_COMMAND_TEMPLATES.commitMessage
          }
        }
      }
    })
    expect(result.sourceControlAi!.actions!.commitMessage!.commandInputTemplate).toBe(
      DEFAULT_SOURCE_CONTROL_ACTION_COMMAND_TEMPLATES.commitMessage
    )
  })
})
