import { expect, it } from 'vitest'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import { parseAgentSessionTabTable } from './agent-session-tab-table'
import { structuredAgentSessionTabId } from '../../shared/structured-agent-session-projection'

it('preserves a clear chain tab while assigning the reopened source a collision-free id', () => {
  const source = '11111111-1111-4111-8111-111111111111'
  const replacement = '22222222-2222-4222-8222-222222222222'
  const records = new Map<string, AgentSessionRecord>([
    [source, { sessionId: source, conversationCommand: { command: 'clear', phase: 'committed', replacementSessionId: replacement } } as AgentSessionRecord],
    [replacement, { sessionId: replacement } as AgentSessionRecord]
  ])
  const result = parseAgentSessionTabTable({ visibleSessionIds: [source, replacement] }, records, true)
  expect(result.valid).toBe(true)
  expect(result.table?.tabIdFor(replacement)).toBe(structuredAgentSessionTabId(source))
  expect(result.table?.tabIdFor(source)).toBe(`${structuredAgentSessionTabId(source)}-reopened`)
})
