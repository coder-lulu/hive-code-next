// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { useAiCommitPrSettings } from './useAiCommitPrSettings'

const mocks = vi.hoisted(() => ({
  state: { settings: null as GlobalSettings | null, updateSettings: vi.fn() }
}))
vi.mock('@/store', () => ({
  useAppStore: (select: (state: typeof mocks.state) => unknown) => select(mocks.state)
}))
vi.mock('@/lib/agent-catalog', () => ({ getAgentCatalog: () => [] }))

describe('current Source Control AI onboarding settings', () => {
  afterEach(cleanup)
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state.settings = getDefaultSettings('/current-profile')
  })
  it('reads the current opt-out while ignoring a retired mirrored setting', () => {
    mocks.state.settings!.sourceControlAi!.enabled = false
    Reflect.set(mocks.state.settings!, 'commitMessageAi', {
      enabled: true,
      agentId: 'codex',
      selectedModelByAgent: {},
      selectedThinkingByModel: {},
      customPrompt: '',
      customAgentCommand: ''
    })
    const { result } = renderHook(() => useAiCommitPrSettings())
    expect(result.current.config.enabled).toBe(false)
  })
  it('writes only current preferences and preserves an unrelated explicit recipe', () => {
    mocks.state.settings!.sourceControlAi!.actions!.pullRequest = {
      agentId: 'claude',
      commandInputTemplate: 'Independent {basePrompt}'
    }
    const { result } = renderHook(() => useAiCommitPrSettings())
    act(() => result.current.toggleAi())
    expect(mocks.state.updateSettings).toHaveBeenCalledOnce()
    const updates = mocks.state.updateSettings.mock.calls[0]![0]
    expect(updates).not.toHaveProperty('commitMessageAi')
    expect(updates.sourceControlAi).toMatchObject({
      enabled: false,
      actions: {
        pullRequest: { agentId: 'claude', commandInputTemplate: 'Independent {basePrompt}' }
      }
    })
  })
})
