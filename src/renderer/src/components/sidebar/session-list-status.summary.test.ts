import { describe, expect, it } from 'vitest'
import { AGENT_STATUS_STALE_AFTER_MS } from '../../../../shared/agent-status-types'
import type { AgentSessionStatusSummary } from '../../../../shared/agent-session-wire'
import { resolveSessionListStatus, type SessionListStatusInput } from './session-list-status'

const now = 2_000_000
const identity = {
  ownerBucketKey: 'runtime:alpha|workspace',
  executionHostId: 'runtime:alpha' as const,
  tabId: 'tab-1',
  paneKey: null,
  providerSessionId: 'provider-1'
}
function input(
  patch: Partial<AgentSessionStatusSummary> = {},
  receivedAt = now - 10
): SessionListStatusInput {
  return {
    identity,
    now,
    connection: { identity, value: 'connected' },
    execution: null,
    activity: {
      identity,
      value: {
        kind: 'summary',
        sessionId: 'session-1',
        receivedAt,
        summary: {
          sessionId: 'session-1',
          workspaceId: 'workspace',
          agent: 'codex',
          status: 'working',
          updatedAt: now - 100,
          latestPrompt: '',
          providerSession: { key: 'session_id', id: 'provider-1' },
          ...patch
        }
      }
    }
  }
}

describe('host-qualified structured session summaries', () => {
  it.each([
    ['working', 'running'],
    ['attention', 'waiting'],
    ['idle', 'unknown'],
    [null, 'unknown']
  ] as const)('maps %s conservatively to %s', (status, activity) => {
    expect(resolveSessionListStatus(input({ status }))).toMatchObject({
      activity,
      execution: 'unverifiable',
      lastActivityAt: now - 100
    })
  })

  it.each([now + 1, 0, Number.NaN, now - AGENT_STATUS_STALE_AFTER_MS - 1])(
    'rejects receipt %s independently of the host activity clock',
    (receipt) => {
      expect(resolveSessionListStatus(input({}, receipt)).activity).toBe('unknown')
    }
  )

  it.each([
    { sessionId: 'other' },
    { workspaceId: 'other' },
    { workspaceId: 'runtime:beta|workspace' },
    { providerSession: { key: 'session_id' as const, id: 'other' } }
  ])('rejects a different identity inside the summary envelope: %j', (patch) => {
    expect(resolveSessionListStatus(input(patch))).toMatchObject({
      activity: 'unknown',
      lastActivityAt: null
    })
  })

  it('does not reuse a same-id session from another execution host', () => {
    expect(
      resolveSessionListStatus({
        ...input(),
        identity: {
          ...identity,
          ownerBucketKey: 'runtime:beta|workspace',
          executionHostId: 'runtime:beta'
        }
      })
    ).toMatchObject({ activity: 'unknown', connection: 'unknown' })
  })

  it('keeps heartbeat receipt separate from activity ordering and permission claims', () => {
    const first = resolveSessionListStatus(
      input({ status: 'attention', latestPrompt: 'Permission granted, done' })
    )
    const heartbeat = resolveSessionListStatus(input({ status: 'attention' }, now))
    expect(first.activity).toBe('waiting')
    expect(heartbeat.lastActivityAt).toBe(first.lastActivityAt)
  })
})
