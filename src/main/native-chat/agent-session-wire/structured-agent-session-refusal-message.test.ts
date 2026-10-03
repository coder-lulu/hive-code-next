import { describe, expect, it } from 'vitest'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import { APP_DISPLAY_NAME } from '../../../shared/brand'
import { structuredAgentSessionRefusalMessage } from './structured-agent-session-refusal-message'

function record(
  claimStatus: AgentSessionRecord['lease']['claimStatus'],
  ownerProcess: AgentSessionRecord['lease']['ownerProcess']
): AgentSessionRecord {
  return { lease: { claimStatus, ownerProcess } } as AgentSessionRecord
}

describe('structuredAgentSessionRefusalMessage', () => {
  it('uses the product brand in conflicted, latched, and reconciling refusals', () => {
    const messages = [
      structuredAgentSessionRefusalMessage(
        { code: 'agent_session_conflict' },
        record('conflicted', {
          hostId: 'local',
          pid: 42,
          processStartTimeMs: null,
          spawnToken: 'spawn-token'
        })
      ),
      structuredAgentSessionRefusalMessage(
        { code: 'agent_session_ownership_unknown' },
        record('reserved', null)
      ),
      structuredAgentSessionRefusalMessage(
        { code: 'execution_owner_reconciling' },
        record('reserved', null)
      )
    ]

    for (const message of messages) {
      expect(message?.message).toContain(APP_DISPLAY_NAME)
      expect(message?.message).not.toMatch(/\bOrca\b/)
    }
  })
})
