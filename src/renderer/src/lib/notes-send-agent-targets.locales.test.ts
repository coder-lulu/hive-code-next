import { afterEach, describe, expect, it } from 'vitest'
import { i18n, translate } from '@/i18n/i18n'
import { makePaneKey } from '../../../shared/stable-pane-id'
import { AGENT_STATUS_STALE_AFTER_MS } from '../../../shared/agent-status-types'
import type { AgentStatusState } from '../../../shared/agent-status-types'
import type { TerminalLayoutSnapshot, TerminalTab } from '../../../shared/terminal-tab-types'
import {
  deriveNotesSendAgentTargets,
  type NotesSendAgentTargetState
} from './notes-send-agent-targets'

const LOCALES = ['en', 'es', 'fr', 'ja', 'ko', 'zh']
const LEAF_A = '11111111-1111-4111-8111-111111111111'
const LEAF_B = '22222222-2222-4222-8222-222222222222'
const PANE_KEY = makePaneKey('tab', LEAF_A)
const NOW = 10_000

function targetState(state: AgentStatusState, split = false): NotesSendAgentTargetState {
  const layout: TerminalLayoutSnapshot = {
    root: split
      ? {
          type: 'split',
          direction: 'horizontal',
          first: { type: 'leaf', leafId: LEAF_A },
          second: { type: 'leaf', leafId: LEAF_B }
        }
      : { type: 'leaf', leafId: LEAF_A },
    activeLeafId: split ? LEAF_B : LEAF_A,
    expandedLeafId: null,
    ptyIdsByLeafId: { [LEAF_A]: 'pty-a', ...(split ? { [LEAF_B]: 'pty-b' } : {}) }
  }
  const tab: TerminalTab = {
    id: 'tab',
    worktreeId: 'wt',
    ptyId: null,
    title: 'Codex ready',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 1,
    launchAgent: 'codex'
  }
  return {
    agentStatusByPaneKey: {
      [PANE_KEY]: {
        paneKey: PANE_KEY,
        state,
        prompt: '',
        updatedAt: NOW,
        stateStartedAt: NOW,
        agentType: 'codex',
        stateHistory: []
      }
    },
    tabsByWorktree: { wt: [tab] },
    unifiedTabsByWorktree: {},
    terminalLayoutsByTabId: { tab: layout },
    ptyIdsByTabId: { tab: split ? ['pty-a', 'pty-b'] : ['pty-a'] },
    runtimePaneTitlesByTabId: { tab: { [split ? 2 : 1]: 'Codex ready' } }
  }
}

afterEach(async () => {
  await i18n.changeLanguage('en')
})

describe('notes send targets across UI languages', () => {
  it.each(LOCALES)('keeps permission rows disabled and deduplicated in %s', async (locale) => {
    await i18n.changeLanguage(locale)
    for (const state of ['waiting', 'blocked'] as const) {
      for (const split of [false, true]) {
        const targets = deriveNotesSendAgentTargets(targetState(state, split), 'wt', NOW)
        expect(targets).toEqual([
          expect.objectContaining({
            paneKey: PANE_KEY,
            status: 'disabled',
            disabledReason: translate('components.agentSend.permission', 'Agent needs permission')
          })
        ])
      }
    }
  })

  it.each(LOCALES)('retains live-title promotion of stale rows in %s', async (locale) => {
    await i18n.changeLanguage(locale)
    const state = targetState('done')
    state.agentStatusByPaneKey[PANE_KEY].updatedAt = NOW - AGENT_STATUS_STALE_AFTER_MS - 1
    expect(deriveNotesSendAgentTargets(state, 'wt', NOW)).toEqual([
      expect.objectContaining({ paneKey: PANE_KEY, status: 'eligible' })
    ])
  })

  it.each(LOCALES)('localizes permission hints before a hook arrives in %s', async (locale) => {
    await i18n.changeLanguage(locale)
    const state = targetState('done')
    state.agentStatusByPaneKey = {}
    state.runtimePaneTitlesByTabId = { tab: { 1: 'Codex - action required' } }
    expect(deriveNotesSendAgentTargets(state, 'wt', NOW)).toEqual([
      expect.objectContaining({
        paneKey: PANE_KEY,
        status: 'disabled',
        disabledReason: translate('components.agentSend.permission', 'Agent needs permission')
      })
    ])
  })
})
