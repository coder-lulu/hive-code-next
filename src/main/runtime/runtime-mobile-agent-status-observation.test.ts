import { describe, expect, it } from 'vitest'
import {
  AGENT_STATUS_STALE_AFTER_MS,
  type AgentStatusIpcPayload
} from '../../shared/agent-status-types'
import type { RuntimeMobileSessionTerminalTab } from '../../shared/runtime-types'
import { selectFreshAgentRowForMobileTab } from './runtime-hook-agent-row-selection'
import { buildRuntimeMobileAgentStatus } from './runtime-mobile-agent-status-builder'

const TAB = 'hive-tab'
const LEAF = '11111111-1111-4111-8111-111111111111'
const PANE = `${TAB}:${LEAF}`
const tab: RuntimeMobileSessionTerminalTab = {
  type: 'terminal',
  id: `${TAB}::${LEAF}`,
  parentTabId: TAB,
  leafId: LEAF,
  title: 'HiveCode AI',
  isActive: true,
  launchAgent: 'hivecode'
}

function publish(row: AgentStatusIpcPayload, retained: boolean) {
  return buildRuntimeMobileAgentStatus(
    null,
    tab,
    'term-1',
    retained
      ? selectFreshAgentRowForMobileTab({
          paneKey: PANE,
          terminalHandle: 'term-1',
          hookRows: [row]
        })
      : null,
    () => [row],
    {
      getPaneKey: () => PANE,
      getLeaf: () => null,
      getTrackedTitle: () => null
    }
  ).agentStatus
}

function hook(state: 'working' | 'done'): AgentStatusIpcPayload {
  const now = Date.now()
  return {
    paneKey: PANE,
    tabId: TAB,
    worktreeId: 'wt',
    connectionId: null,
    state,
    prompt: '',
    agentType: 'hivecode',
    receivedAt: now,
    stateStartedAt: now,
    providerSession: { key: 'session_id', id: 'session-1' }
  }
}

describe('mobile activity observation provenance', () => {
  for (const retained of [true, false]) {
    for (const origin of ['hook', 'osc'] as const) {
      it.each(['working', 'done'] as const)(
        `preserves ${origin} %s through retained=${retained}`,
        (state) => {
          const row = hook(state)
          row.observation = {
            origin,
            authorityId: 'central',
            incarnation: 1,
            revision: 2,
            observedAt: row.receivedAt,
            kind: 'transition'
          }
          const status = publish(row, retained)
          expect(status?.observation).toEqual(row.observation)
          expect(status).not.toHaveProperty('connectionId')
          expect(status?.state).toBe(state)
        }
      )
    }
    it(`does not invent evidence for legacy or identity-only rows retained=${retained}`, () => {
      expect(publish(hook('working'), retained)?.observation).toBeUndefined()
      const row = hook('done')
      row.providerSessionOnly = true
      row.observation = {
        origin: 'hook',
        authorityId: 'central',
        incarnation: 1,
        revision: 2,
        observedAt: row.receivedAt,
        kind: 'identity-only'
      }
      expect(publish(row, retained)?.observation).toBeUndefined()
    })
    it.each(['restored', 'stale', 'title'] as const)(
      `does not promote %s evidence to session activity retained=${retained}`,
      (kind) => {
        const row = hook('working')
        row.observation = {
          origin: kind === 'title' ? 'title' : 'hook',
          authorityId: 'central',
          incarnation: 1,
          revision: 2,
          observedAt: row.receivedAt,
          kind: 'snapshot'
        }
        if (kind === 'restored') {
          row.restoredUnconfirmed = true
        }
        if (kind === 'stale') {
          row.receivedAt -= AGENT_STATUS_STALE_AFTER_MS + 1
          row.observation.observedAt = row.receivedAt
        }
        const status = publish(row, retained)
        if (kind === 'title') {
          expect(status?.observation).toEqual(row.observation)
        } else {
          expect(status?.observation).toBeUndefined()
        }
      }
    )
  }
})
