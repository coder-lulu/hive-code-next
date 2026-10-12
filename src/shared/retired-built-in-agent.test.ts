import { describe, expect, it } from 'vitest'
import { isTuiAgent } from './tui-agent-config'
import type { TuiAgent } from './tui-agent'
import { isTuiAgentEnabled, pickTuiAgent } from './tui-agent-selection'
import { getAgentModelProbeSpec } from './agent-model-probe-spec'
import { getAgentSessionOptionCatalog } from './agent-session-option-catalog'
import {
  isNativeChatSupportedAgent,
  resolveNativeChatTranscriptAgent
} from './native-chat-agent-support'
import {
  decodePersistedAgentSessionProviderHandle,
  isAgentSessionProviderHandle,
  isStructuredAgentId
} from './agent-session-provider-handle-encoding'

describe('retired built-in agent boundaries', () => {
  it('does not offer or substitute the retired agent from persisted launch settings', () => {
    const retired: TuiAgent = JSON.parse('"hivecode"')
    expect(isTuiAgent(retired)).toBe(false)
    expect(isTuiAgentEnabled(retired)).toBe(false)
    expect(pickTuiAgent(retired, [retired, 'codex'])).toBe('codex')
    expect(pickTuiAgent(retired, [retired])).toBeNull()
    expect(getAgentModelProbeSpec(retired)).toBeUndefined()
    expect(getAgentSessionOptionCatalog(retired)).toBeNull()
    expect(isNativeChatSupportedAgent(retired)).toBe(false)
    expect(resolveNativeChatTranscriptAgent(retired)).toBeNull()
  })

  it.each([
    {
      transport: 'managed-pi',
      agent: 'managed-pi',
      nativeId: 'ha-session:12345678-1234-4567-8123-123456789abc'
    },
    { transport: 'managed-pi', agent: 'custom-agent', nativeId: 'session' },
    { transport: 'acp', agent: 'managed-pi', nativeId: 'session' },
    { transport: 'acp', agent: 'hivecode', nativeId: 'session' }
  ])(
    'refuses a retired handle instead of admitting a generic provider: $transport/$agent',
    (handle) => {
      expect(isAgentSessionProviderHandle(handle)).toBe(false)
      expect(decodePersistedAgentSessionProviderHandle(handle)).toBeNull()
    }
  )

  it('does not decode the retired stored identity or reserve it as a current agent', () => {
    expect(
      decodePersistedAgentSessionProviderHandle({
        provider: 'managed-pi',
        sessionId: 'ha-session:12345678-1234-4567-8123-123456789abc'
      })
    ).toBeNull()
    expect(isStructuredAgentId('managed-pi')).toBe(false)
    expect(isStructuredAgentId('hivecode')).toBe(false)
  })

  it('retains independent external agents and opaque custom transports', () => {
    for (const agent of ['claude', 'codex', 'pi', 'omp'] as const) {
      expect(isTuiAgent(agent)).toBe(true)
      expect(isStructuredAgentId(agent)).toBe(true)
      expect(pickTuiAgent(agent, [agent])).toBe(agent)
    }
    const custom = { transport: 'acp', agent: 'custom-agent', nativeId: 'session' }
    expect(isAgentSessionProviderHandle(custom)).toBe(true)
    expect(decodePersistedAgentSessionProviderHandle(custom)).toEqual(custom)
  })
})
