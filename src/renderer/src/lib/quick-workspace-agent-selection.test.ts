import { describe, expect, it } from 'vitest'
import { TUI_AGENT_AUTO_PICK_ORDER } from '../../../shared/tui-agent-selection'
import { AGENT_CATALOG } from './agent-catalog'
import {
  filterQuickWorkspaceAgents,
  pickQuickWorkspaceAgent,
  resolveQuickWorkspaceAgentSelection
} from './quick-workspace-agent-selection'

describe('filterQuickWorkspaceAgents', () => {
  it('does not advertise the local built-in agent before target detection establishes support', () => {
    expect(filterQuickWorkspaceAgents([{ id: 'hivecode', label: 'HiveCode AI' }], null)).toEqual([])
    expect(pickQuickWorkspaceAgent('hivecode', null)).toBe('claude')
  })
  it('includes the built-in HiveCode AI without an external CLI installation', () => {
    expect(
      filterQuickWorkspaceAgents([{ id: 'hivecode', label: 'HiveCode AI' }], ['hivecode'])
    ).toEqual([{ id: 'hivecode', label: 'HiveCode AI' }])
    expect(pickQuickWorkspaceAgent('hivecode', ['hivecode'])).toBe('hivecode')
  })

  const catalog = [
    { id: 'claude' as const, label: 'Claude' },
    { id: 'codex' as const, label: 'Codex' },
    { id: 'opencode' as const, label: 'OpenCode' }
  ]

  it('keeps only detected and enabled agents while preserving catalog metadata', () => {
    expect(filterQuickWorkspaceAgents(catalog, ['claude', 'codex'], ['claude'])).toEqual([
      { id: 'codex', label: 'Codex' }
    ])
  })

  it('keeps enabled catalog entries while first detection is pending', () => {
    expect(
      filterQuickWorkspaceAgents(catalog, null, ['opencode']).map((entry) => entry.id)
    ).toEqual(['claude', 'codex'])
  })
})

describe('pickQuickWorkspaceAgent', () => {
  it('keeps the fallback order in sync with the desktop agent catalog', () => {
    expect(TUI_AGENT_AUTO_PICK_ORDER).toEqual(AGENT_CATALOG.map((agent) => agent.id))
    expect(new Set(TUI_AGENT_AUTO_PICK_ORDER).size).toBe(TUI_AGENT_AUTO_PICK_ORDER.length)
  })

  it('uses the first enabled catalog agent while detection is pending', () => {
    expect(pickQuickWorkspaceAgent(null, null, [])).toBe('claude')
    expect(pickQuickWorkspaceAgent(null, null, ['claude'])).toBe('claude-agent-teams')
    expect(pickQuickWorkspaceAgent(null, null, ['claude', 'claude-agent-teams'])).toBe('openclaude')
    expect(
      pickQuickWorkspaceAgent(null, null, ['claude', 'claude-agent-teams', 'openclaude'])
    ).toBe('codex')
  })

  it('respects blank and disabled preferred agents', () => {
    expect(pickQuickWorkspaceAgent('blank', null, [])).toBeNull()
    expect(pickQuickWorkspaceAgent('codex', null, ['codex'])).toBe('claude')
  })

  it('uses detected enabled agents after detection resolves', () => {
    expect(pickQuickWorkspaceAgent(null, ['codex'], ['claude'])).toBe('codex')
    expect(pickQuickWorkspaceAgent('codex', ['claude', 'codex'], ['codex'])).toBe('claude')
  })
})

describe('resolveQuickWorkspaceAgentSelection', () => {
  it('uses the preferred quick agent until the user picks an override', () => {
    expect(
      resolveQuickWorkspaceAgentSelection({
        quickAgentOverride: undefined,
        preferredQuickAgent: 'claude',
        detectedAgentIds: ['claude', 'codex'],
        disabledTuiAgents: []
      })
    ).toEqual({ quickAgent: 'claude', quickAgentOverride: undefined })
  })

  it('keeps explicit blank overrides stable', () => {
    expect(
      resolveQuickWorkspaceAgentSelection({
        quickAgentOverride: null,
        preferredQuickAgent: 'claude',
        detectedAgentIds: ['claude'],
        disabledTuiAgents: []
      })
    ).toEqual({ quickAgent: null, quickAgentOverride: null })
  })

  it('keeps an available user override', () => {
    expect(
      resolveQuickWorkspaceAgentSelection({
        quickAgentOverride: 'codex',
        preferredQuickAgent: 'claude',
        detectedAgentIds: new Set(['claude', 'codex']),
        disabledTuiAgents: []
      })
    ).toEqual({ quickAgent: 'codex', quickAgentOverride: 'codex' })
  })

  it('replaces an unavailable override with the preferred quick agent', () => {
    expect(
      resolveQuickWorkspaceAgentSelection({
        quickAgentOverride: 'codex',
        preferredQuickAgent: 'claude',
        detectedAgentIds: ['claude'],
        disabledTuiAgents: []
      })
    ).toEqual({ quickAgent: 'claude', quickAgentOverride: 'claude' })
  })
})
